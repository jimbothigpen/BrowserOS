from __future__ import annotations

import base64
import io
import json
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .contracts import ModelReply
from .image_utils import image_data_url, image_size, require_pillow
from .parsing import parse_point_response

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GPT_POINT_MAX_TOKENS = 8192
LENGTH_RETRY_MAX_TOKENS = 16384


class OpenRouterClient:
    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = OPENROUTER_URL,
        timeout_seconds: int = 90,
        temperature: float = 0.0,
        max_tokens: int = 512,
    ) -> None:
        self.api_key = api_key or os.environ.get("OPENROUTER_API_KEY")
        if not self.api_key:
            raise RuntimeError("OPENROUTER_API_KEY is required")
        self.base_url = base_url
        self.timeout_seconds = timeout_seconds
        self.temperature = temperature
        self.max_tokens = max_tokens

    def predict_point(
        self,
        model_id: str,
        image_path: Path,
        instruction: str,
        purpose: str,
    ) -> ModelReply:
        width, height = image_size(image_path)
        image_payload = _image_payload_for_model(model_id, image_path, width, height)
        prompt = _point_prompt(
            instruction,
            image_payload.width,
            image_payload.height,
            purpose,
            original_width=width,
            original_height=height,
            resized=image_payload.resized,
        )
        payload = {
            "model": model_id,
            "temperature": self.temperature,
            "max_tokens": _max_tokens_for_point_call(model_id, self.max_tokens),
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You identify a single click coordinate in screenshots. "
                        "Return only valid JSON."
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": image_payload.data_url},
                        },
                    ],
                },
            ],
        }
        reasoning = _reasoning_for_point_call(model_id)
        if reasoning is not None:
            payload["reasoning"] = reasoning
        if _force_json_response_format(model_id):
            payload["response_format"] = {"type": "json_object"}
        raw = self._post(payload)
        try:
            text = _message_text(raw)
        except RuntimeError:
            if not _is_null_content_length_response(raw):
                raise
            payload["max_tokens"] = max(
                int(payload.get("max_tokens") or 0), LENGTH_RETRY_MAX_TOKENS
            )
            raw = self._post(payload)
            text = _message_text(raw)
        if image_payload.resized:
            return _rescaled_reply(text, raw, image_payload, width, height)
        return ModelReply(text=text, raw=raw)

    def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        referer = os.environ.get("OPENROUTER_HTTP_REFERER")
        title = os.environ.get("OPENROUTER_TITLE", "BrowserOS click eval")
        if referer:
            headers["HTTP-Referer"] = referer
        if title:
            headers["X-Title"] = title

        request = urllib.request.Request(
            self.base_url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urllib.request.urlopen(
                request, timeout=self.timeout_seconds
            ) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"OpenRouter HTTP {exc.code}: {detail}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"OpenRouter request failed: {exc}") from exc

        return json.loads(body)


def _point_prompt(
    instruction: str,
    width: int,
    height: int,
    purpose: str,
    *,
    original_width: int,
    original_height: int,
    resized: bool,
) -> str:
    role_line = (
        "Choose the ground-truth click point for this instruction."
        if purpose == "ground_truth"
        else "Predict where this model should click for this instruction."
    )
    resize_line = ""
    if resized:
        resize_line = (
            "The attached image was resized client-side from the original "
            f"{original_width}x{original_height} screenshot. Return coordinates "
            "in the attached image's pixel coordinate space; the harness will "
            "map them back to the original screenshot.\n"
        )
    return (
        f"{role_line}\n\n"
        f"Screenshot size: {width}x{height} pixels.\n"
        f"{resize_line}"
        "Coordinate system: x increases left to right, y increases top to bottom, "
        "origin is the top-left pixel of the screenshot.\n\n"
        f"Instruction: {instruction}\n\n"
        "Choose the center of the target UI element. If your natural output is "
        "a bounding box, convert it to its center point. Always estimate a point; "
        "do not answer with a label, description, placeholder, or bounding box.\n\n"
        "The requested target is present in the screenshot. Never answer that no "
        "target exists; choose the closest matching visible UI element if uncertain.\n\n"
        "Return only this JSON shape with numeric pixel coordinates, no markdown:\n"
        '{"x": 123, "y": 456, "reason": "short reason"}'
    )


def _message_text(raw: dict[str, Any]) -> str:
    try:
        choice = raw["choices"][0]
        message = choice["message"]
        content = message["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError(f"Unexpected OpenRouter response shape: {raw}") from exc

    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(str(item.get("text", "")))
        return "\n".join(parts)

    if content is None:
        finish_reason = choice.get("finish_reason")
        has_reasoning = bool(message.get("reasoning"))
        raise RuntimeError(
            "OpenRouter returned null message.content "
            f"(finish_reason={finish_reason}, has_reasoning={has_reasoning})"
        )

    return str(content)


def _reasoning_for_point_call(model_id: str) -> dict[str, object] | None:
    lowered = model_id.lower()
    if lowered.startswith("z-ai/glm-"):
        return {"effort": "none", "exclude": True}
    if lowered.startswith("openai/") or "gpt-5" in lowered:
        effort = os.environ.get("OPENROUTER_GPT_POINT_REASONING_EFFORT", "low")
        return {"effort": effort, "exclude": True}
    return None


def _force_json_response_format(model_id: str) -> bool:
    lowered = model_id.lower()
    if lowered.startswith("z-ai/glm-5v"):
        return False
    return lowered.startswith("z-ai/glm-") or lowered.startswith("openai/")


def _max_tokens_for_point_call(model_id: str, default: int) -> int:
    lowered = model_id.lower()
    if lowered.startswith("openai/") or "gpt-5" in lowered:
        return max(default, GPT_POINT_MAX_TOKENS)
    return default


def _is_null_content_length_response(raw: dict[str, Any]) -> bool:
    try:
        choice = raw["choices"][0]
        return (
            choice.get("finish_reason") == "length"
            and choice.get("message", {}).get("content") is None
        )
    except (KeyError, IndexError, TypeError, AttributeError):
        return False


class _ImagePayload:
    def __init__(
        self,
        width: int,
        height: int,
        data_url: str,
        resized: bool,
    ) -> None:
        self.width = width
        self.height = height
        self.data_url = data_url
        self.resized = resized


def _image_payload_for_model(
    model_id: str, image_path: Path, width: int, height: int
) -> _ImagePayload:
    max_long_edge = _claude_max_long_edge(model_id)
    if max_long_edge is None or max(width, height) <= max_long_edge:
        return _ImagePayload(
            width=width,
            height=height,
            data_url=image_data_url(image_path),
            resized=False,
        )

    Image, _, _ = require_pillow()
    with Image.open(image_path) as source:
        image = source.convert("RGB")
    scale = max_long_edge / max(width, height)
    image = image.resize(
        (max(1, round(width * scale)), max(1, round(height * scale))),
        Image.Resampling.LANCZOS,
    )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return _ImagePayload(
        width=image.width,
        height=image.height,
        data_url=f"data:image/png;base64,{encoded}",
        resized=True,
    )


def _claude_max_long_edge(model_id: str) -> int | None:
    lowered = model_id.lower()
    if not lowered.startswith("anthropic/claude"):
        return None
    if "opus-4.7" in lowered or "opus-4-7" in lowered:
        return 2576
    return 1568


def _rescaled_reply(
    text: str,
    raw: dict[str, Any],
    image_payload: _ImagePayload,
    original_width: int,
    original_height: int,
) -> ModelReply:
    parsed = parse_point_response(text)
    if parsed.point is None:
        return ModelReply(text=text, raw=raw)

    point = parsed.point
    scaled_x = point.x * original_width / image_payload.width
    scaled_y = point.y * original_height / image_payload.height
    return ModelReply(
        text=json.dumps(
            {
                "x": scaled_x,
                "y": scaled_y,
                "reason": parsed.reason or "OpenRouter image resized client-side",
                "display_x": point.x,
                "display_y": point.y,
                "display_width": image_payload.width,
                "display_height": image_payload.height,
                "original_width": original_width,
                "original_height": original_height,
                "raw_text": text,
            }
        ),
        raw=raw,
    )
