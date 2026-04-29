from __future__ import annotations

import gc
import json
import re
import subprocess
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from types import MethodType
from typing import Any, Callable

from .contracts import ModelReply, ModelSkipped, ModelSpec, Point
from .image_utils import require_pillow
from .openrouter import _point_prompt
from .parsing import parse_point_response

IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


@dataclass(frozen=True)
class GpuInfo:
    present: bool
    name: str | None = None
    total_vram_gb: float | None = None
    reason: str | None = None


class LocalHFClient:
    def __init__(
        self,
        timeout_seconds: int = 90,
        max_new_tokens: int = 64,
        log_callback: Callable[[str], None] | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        self.max_new_tokens = max_new_tokens
        self._log_callback = log_callback
        self._gpu_info: GpuInfo | None = None
        self._loaded: dict[str, tuple[Any, ...]] = {}
        self._retain_loaded_depth = 0

    def predict_point(
        self,
        model: ModelSpec,
        image_path: Path,
        instruction: str,
        purpose: str,
    ) -> ModelReply:
        gpu_info = self.gpu_info()
        if not gpu_info.present:
            reason = f": {gpu_info.reason}" if gpu_info.reason else ""
            raise ModelSkipped(f"skipped - no usable CUDA GPU present{reason}")

        if (
            model.estimated_vram_gb is not None
            and gpu_info.total_vram_gb is not None
            and model.estimated_vram_gb > gpu_info.total_vram_gb
            and not model.allow_cpu_offload
        ):
            raise ModelSkipped(
                "skipped - GPU VRAM "
                f"{gpu_info.total_vram_gb:.1f}GB < estimated "
                f"{model.estimated_vram_gb:.1f}GB"
            )

        try:
            adapter = _adapter_for(model)
            if adapter == "molmopoint":
                return self._predict_molmopoint(model, image_path, instruction)
            if adapter == "showui":
                return self._predict_showui(model, image_path, instruction)
            if adapter == "groundnext":
                return self._predict_groundnext(model, image_path, instruction)
            if adapter == "opencua":
                return self._predict_opencua(model, image_path, instruction)
            if adapter in {
                "gta1",
                "gui_drag",
                "infigui",
                "qwen25_point_1000",
                "qwen25_tool_absolute",
                "zonui",
            }:
                return self._predict_qwen25_absolute(
                    model, image_path, instruction, mode=adapter
                )
            if adapter == "points_gui_g":
                return self._predict_points_gui_g(model, image_path, instruction)
            if adapter == "holo2":
                return self._predict_holo2(model, image_path, instruction)
            if adapter == "uground":
                return self._predict_qwen2_relative_1000(
                    model,
                    image_path,
                    _uground_prompt(instruction),
                    class_names=("Qwen2VLForConditionalGeneration",),
                )
            if adapter == "os_atlas_7b":
                return self._predict_qwen2_relative_1000(
                    model,
                    image_path,
                    _os_atlas_prompt(instruction, "with point"),
                    class_names=("Qwen2VLForConditionalGeneration",),
                )
            if adapter == "os_atlas_4b":
                return self._predict_os_atlas_4b(model, image_path, instruction)
            if adapter == "qwen3_vl":
                return self._predict_qwen3_vl(model, image_path, instruction)

            return self._predict_generic(model, image_path, instruction, purpose)
        finally:
            if self._retain_loaded_depth == 0:
                self._clear_loaded_models()

    @contextmanager
    def retain_loaded_models(self):
        self._retain_loaded_depth += 1
        try:
            yield
        finally:
            self._retain_loaded_depth -= 1
            if self._retain_loaded_depth == 0:
                self._clear_loaded_models()

    def gpu_info(self) -> GpuInfo:
        if self._gpu_info is None:
            self._gpu_info = detect_gpu()
        return self._gpu_info

    def _predict_generic(
        self,
        model: ModelSpec,
        image_path: Path,
        instruction: str,
        purpose: str,
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(model)
        image = _open_rgb_image(image_path)
        width, height = image.size
        prompt = _point_prompt(
            instruction,
            width,
            height,
            purpose,
            original_width=width,
            original_height=height,
            resized=False,
        )
        inputs = _build_inputs(processor, image, prompt)
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        return self._reply(model, text, raw={"adapter": "generic"})

    def _predict_qwen3_vl(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(
            model,
            class_names=("Qwen3VLForConditionalGeneration",),
            processor_kwargs=_pixel_kwargs(model),
        )
        image = _open_rgb_image(image_path)
        width, height = image.size
        prompt = _relative_1000_prompt(instruction)
        inputs = _build_qwen3_vl_inputs(processor, image, prompt, model)
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        return self._scaled_reply(
            model, text, width, height, coordinate_max=1000, adapter="qwen3_vl"
        )

    def _predict_molmopoint(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(
            model,
            class_names=("AutoModelForImageTextToText",),
            processor_kwargs={"padding_side": "left"},
        )
        image = _open_rgb_image(image_path)
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": instruction},
                    {"type": "image", "image": image},
                ],
            }
        ]
        inputs = processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
            return_dict=True,
            padding=True,
            return_pointing_metadata=True,
        )
        metadata = inputs.pop("metadata")
        inputs = _move_inputs(inputs, _first_model_device(hf_model))
        self._log(f"{model.name}: generating MolmoPoint grounding tokens")
        with torch.inference_mode(), torch.autocast(
            "cuda", dtype=_model_load_dtype(torch, model)
        ):
            output = hf_model.generate(
                **inputs,
                logits_processor=hf_model.build_logit_processor_from_inputs(inputs),
                max_new_tokens=model.max_new_tokens or 200,
                max_time=self.timeout_seconds,
                do_sample=False,
            )
        generated_tokens = output[:, inputs["input_ids"].size(1) :]
        generated_text = processor.post_process_image_text_to_text(
            generated_tokens,
            skip_special_tokens=False,
            clean_up_tokenization_spaces=False,
        )[0]
        points = hf_model.extract_image_points(
            generated_text,
            metadata["token_pooling"],
            metadata["subpatch_mapping"],
            metadata["image_sizes"],
        )
        if not points:
            return self._reply(
                model,
                generated_text,
                raw={"adapter": "molmopoint", "points": points},
            )
        point = points[0]
        return self._point_reply(
            model,
            Point(float(point[2]), float(point[3])),
            raw={"adapter": "molmopoint", "text": generated_text, "points": points},
        )

    def _predict_showui(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(
            model,
            class_names=("Qwen2VLForConditionalGeneration",),
            processor_kwargs=_pixel_kwargs(model),
        )
        width, height = _image_size(image_path)
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _showui_system_prompt()},
                    {
                        "type": "image",
                        "image": str(image_path),
                        **_pixel_kwargs(model),
                    },
                    {"type": "text", "text": instruction},
                ],
            }
        ]
        inputs = _qwen_messages_to_inputs(processor, messages)
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        return self._scaled_reply(
            model, text, width, height, coordinate_max=1, adapter="showui"
        )

    def _predict_groundnext(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, processor, tokenizer, hf_model = self._load_processor_tokenizer_model(
            model, class_names=("Qwen2_5_VLForConditionalGeneration",)
        )
        image = _open_rgb_image(image_path)
        original_width, original_height = image.size
        image, (width, height) = _smart_resize_image(image, model)
        messages = [
            {
                "role": "system",
                "content": _groundnext_system_prompt(width, height),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": instruction},
                ],
            },
        ]
        input_text = tokenizer.apply_chat_template(
            messages, add_generation_prompt=True, tokenize=False
        )
        inputs = processor(
            text=[input_text],
            images=[image],
            videos=None,
            padding=True,
            return_tensors="pt",
        )
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        point = _point_from_text(text)
        if point is None:
            return self._reply(model, text, raw={"adapter": "groundnext"})
        return self._point_reply(
            model,
            Point(
                x=point.x * original_width / width,
                y=point.y * original_height / height,
            ),
            raw={"adapter": "groundnext", "text": text},
        )

    def _predict_qwen25_absolute(
        self, model: ModelSpec, image_path: Path, instruction: str, mode: str
    ) -> ModelReply:
        torch, processor, tokenizer, hf_model = self._load_processor_tokenizer_model(
            model, class_names=("Qwen2_5_VLForConditionalGeneration",)
        )
        _patch_qwen25_mrope_section(hf_model)
        image = _open_rgb_image(image_path)
        original_width, original_height = image.size
        image, (width, height) = _smart_resize_image(image, model)
        messages = _qwen25_absolute_messages(instruction, image, width, height, mode)
        if mode == "infigui":
            inputs = _infigui_messages_to_inputs(processor, messages, image)
            text = self._generate_text(torch, processor, hf_model, inputs, model)
            return self._resized_absolute_reply(
                model,
                text,
                original_width,
                original_height,
                width,
                height,
                adapter=mode,
            )

        input_text = _qwen25_absolute_prompt_text(tokenizer, messages, mode)
        inputs = processor(
            text=[input_text],
            images=[image],
            videos=None,
            padding=True,
            return_tensors="pt",
        )
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        if mode == "qwen25_point_1000":
            return self._scaled_reply(
                model,
                text,
                original_width,
                original_height,
                coordinate_max=1000,
                adapter=mode,
            )
        return self._resized_absolute_reply(
            model,
            text,
            original_width,
            original_height,
            width,
            height,
            adapter=mode,
        )

    def _predict_holo2(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(
            model,
            class_names=(
                "AutoModelForImageTextToText",
                "Qwen3VLForConditionalGeneration",
            ),
        )
        image = _open_rgb_image(image_path)
        width, height = image.size
        processed_image, _resized_size = _smart_resize_image_for_processor(
            image, processor, model
        )
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": processed_image},
                    {"type": "text", "text": _holo2_localization_prompt(instruction)},
                ],
            }
        ]
        apply_chat_template = getattr(processor, "apply_chat_template")
        try:
            input_text = apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                thinking=False,
            )
        except TypeError:
            input_text = apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        inputs = processor(
            text=[input_text],
            images=[processed_image],
            padding=True,
            return_tensors="pt",
        )
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        return self._scaled_reply(
            model, text, width, height, coordinate_max=1000, adapter="holo2"
        )

    def _predict_opencua(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(
            model, class_names=("AutoModel", "AutoModelForCausalLM")
        )
        image = _open_rgb_image(image_path)
        original_width, original_height = image.size
        image, (width, height) = _smart_resize_image(image, model)
        messages = [
            {"role": "system", "content": _pyautogui_system_prompt()},
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": instruction},
                ],
            },
        ]
        input_text = _opencua_prompt_text(processor, messages)
        inputs = processor(
            text=[input_text],
            images=[image],
            padding=True,
            return_tensors="pt",
        )
        if "pixel_values" in inputs:
            inputs["pixel_values"] = inputs["pixel_values"].to(
                dtype=_dtype_from_model(torch, model)
            )
        device = _first_model_device(hf_model)
        inputs = _move_inputs(inputs, device)
        max_new_tokens = model.max_new_tokens or self.max_new_tokens
        self._log(
            f"{model.name}: generating OpenCUA action with "
            f"max_new_tokens={max_new_tokens}, max_time={self.timeout_seconds}s"
        )
        with torch.inference_mode():
            generated = hf_model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                max_time=self.timeout_seconds,
                do_sample=False,
            )
        text = _decode_output(processor, inputs, generated)
        return self._resized_absolute_reply(
            model,
            text,
            original_width,
            original_height,
            width,
            height,
            adapter="opencua",
        )

    def _predict_points_gui_g(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, tokenizer, image_processor, hf_model = self._load_points_gui_g_model(
            model
        )
        messages = [
            {
                "role": "system",
                "content": [{"type": "text", "text": _points_gui_g_system_prompt()}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": str(image_path)},
                    {"type": "text", "text": instruction},
                ],
            },
        ]
        generation_config = {
            "max_new_tokens": model.max_new_tokens or self.max_new_tokens,
            "do_sample": False,
        }
        chat = getattr(hf_model, "chat", None)
        if chat is None:
            raise RuntimeError("POINTS-GUI-G model does not expose chat()")
        self._log(f"{model.name}: generating POINTS-GUI-G normalized point")
        with torch.inference_mode():
            response = chat(messages, tokenizer, image_processor, generation_config)
        width, height = _image_size(image_path)
        return self._scaled_reply(
            model, str(response), width, height, coordinate_max=1, adapter="points_gui_g"
        )

    def _predict_qwen2_relative_1000(
        self,
        model: ModelSpec,
        image_path: Path,
        prompt: str,
        class_names: tuple[str, ...],
    ) -> ModelReply:
        torch, processor, hf_model = self._load_processor_model(
            model, class_names=class_names, processor_kwargs=_pixel_kwargs(model)
        )
        width, height = _image_size(image_path)
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": str(image_path), **_pixel_kwargs(model)},
                    {"type": "text", "text": prompt},
                ],
            }
        ]
        inputs = _qwen_messages_to_inputs(processor, messages)
        text = self._generate_text(torch, processor, hf_model, inputs, model)
        return self._scaled_reply(
            model, text, width, height, coordinate_max=1000, adapter=_adapter_for(model)
        )

    def _predict_os_atlas_4b(
        self, model: ModelSpec, image_path: Path, instruction: str
    ) -> ModelReply:
        torch, tokenizer, hf_model = self._load_os_atlas_4b_model(model)
        width, height = _image_size(image_path)
        pixel_values = _os_atlas_pixel_values(image_path, max_num=6)
        pixel_values = pixel_values.to(_dtype_from_model(torch, model)).to(
            _first_model_device(hf_model)
        )
        prompt = _os_atlas_prompt(instruction, "with point")
        generation_config = {
            "max_new_tokens": model.max_new_tokens or self.max_new_tokens,
            "do_sample": False,
        }
        self._log(f"{model.name}: generating with OS-Atlas chat")
        response, _history = hf_model.chat(
            tokenizer,
            pixel_values,
            prompt,
            generation_config,
            history=None,
            return_history=True,
        )
        return self._scaled_reply(
            model, response, width, height, coordinate_max=1000, adapter="os_atlas_4b"
        )

    def _generate_text(
        self,
        torch,
        processor,
        hf_model,
        inputs,
        model: ModelSpec,
    ) -> str:
        inputs = _move_inputs(inputs, _first_model_device(hf_model))
        max_new_tokens = model.max_new_tokens or self.max_new_tokens
        self._log(
            f"{model.name}: generating with max_new_tokens={max_new_tokens}, "
            f"max_time={self.timeout_seconds}s"
        )
        with torch.inference_mode():
            generated = hf_model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                max_time=self.timeout_seconds,
                do_sample=False,
            )
        return _decode_output(processor, inputs, generated)

    def _load_processor_model(
        self,
        model: ModelSpec,
        class_names: tuple[str, ...] = (
            "AutoModelForImageTextToText",
            "AutoModelForVision2Seq",
            "AutoModelForCausalLM",
        ),
        processor_kwargs: dict[str, Any] | None = None,
    ) -> tuple[Any, Any, Any]:
        key = _load_key(model, "processor_model", class_names)
        if key in self._loaded:
            return self._loaded[key]  # type: ignore[return-value]

        torch, transformers = _import_local_hf_dependencies()
        AutoProcessor = transformers.AutoProcessor
        self._log(f"{model.name}: loading processor")
        processor = _call_hf_loader(
            AutoProcessor.from_pretrained,
            model,
            trust_remote_code=True,
            **(processor_kwargs or {}),
        )
        model_cls = _model_class(transformers, class_names)
        hf_model = self._load_pretrained_model(torch, model_cls, model)
        self._loaded[key] = (torch, processor, hf_model)
        return self._loaded[key]  # type: ignore[return-value]

    def _load_processor_tokenizer_model(
        self,
        model: ModelSpec,
        class_names: tuple[str, ...],
    ) -> tuple[Any, Any, Any, Any]:
        key = _load_key(model, "processor_tokenizer_model", class_names)
        if key in self._loaded:
            return self._loaded[key]  # type: ignore[return-value]

        torch, transformers = _import_local_hf_dependencies()
        self._log(f"{model.name}: loading processor and tokenizer")
        processor = _call_hf_loader(
            transformers.AutoProcessor.from_pretrained,
            model,
            trust_remote_code=True,
        )
        if _adapter_for(model) == "infigui":
            setattr(processor, "padding_side", "left")
        tokenizer = _call_hf_loader(
            transformers.AutoTokenizer.from_pretrained,
            model,
            trust_remote_code=True,
        )
        model_cls = _model_class(transformers, class_names)
        hf_model = self._load_pretrained_model(torch, model_cls, model)
        self._loaded[key] = (torch, processor, tokenizer, hf_model)
        return self._loaded[key]  # type: ignore[return-value]

    def _load_tokenizer_image_processor_model(
        self,
        model: ModelSpec,
        class_names: tuple[str, ...],
    ) -> tuple[Any, Any, Any, Any]:
        key = _load_key(model, "tokenizer_image_processor_model", class_names)
        if key in self._loaded:
            return self._loaded[key]  # type: ignore[return-value]

        torch, transformers = _import_local_hf_dependencies()
        self._log(f"{model.name}: loading tokenizer and image processor")
        tokenizer = _call_hf_loader(
            transformers.AutoTokenizer.from_pretrained,
            model,
            trust_remote_code=True,
        )
        image_processor = _call_hf_loader(
            transformers.AutoImageProcessor.from_pretrained,
            model,
            trust_remote_code=True,
        )
        model_cls = _model_class(transformers, class_names)
        hf_model = self._load_pretrained_model(torch, model_cls, model)
        self._loaded[key] = (torch, tokenizer, image_processor, hf_model)
        return self._loaded[key]  # type: ignore[return-value]

    def _load_points_gui_g_model(self, model: ModelSpec) -> tuple[Any, Any, Any, Any]:
        key = _load_key(model, "points_gui_g", ("AutoModelForCausalLM",))
        if key in self._loaded:
            return self._loaded[key]  # type: ignore[return-value]

        torch, transformers = _import_local_hf_dependencies()
        _require_points_gui_g_flash_attn(model)
        image_processor_cls = getattr(transformers, "Qwen2VLImageProcessor", None)
        if image_processor_cls is None:
            raise ModelSkipped(
                "skipped - installed transformers lacks Qwen2VLImageProcessor"
            )

        self._log(f"{model.name}: loading POINTS-GUI-G tokenizer/image processor")
        tokenizer = _call_hf_loader(
            transformers.AutoTokenizer.from_pretrained,
            model,
            trust_remote_code=True,
        )
        image_processor = _call_hf_loader(
            image_processor_cls.from_pretrained,
            model,
            trust_remote_code=True,
        )
        hf_model = self._load_pretrained_model(
            torch, transformers.AutoModelForCausalLM, model
        )
        self._loaded[key] = (torch, tokenizer, image_processor, hf_model)
        return self._loaded[key]  # type: ignore[return-value]

    def _load_os_atlas_4b_model(self, model: ModelSpec) -> tuple[Any, Any, Any]:
        key = _load_key(model, "os_atlas_4b", ("AutoModel",))
        if key in self._loaded:
            return self._loaded[key]  # type: ignore[return-value]

        torch, transformers = _import_local_hf_dependencies()
        _patch_dynamic_cache_compat()
        config = _load_os_atlas_4b_config(transformers, model)
        self._log(f"{model.name}: loading OS-Atlas tokenizer")
        tokenizer = _call_hf_loader(
            transformers.AutoTokenizer.from_pretrained,
            model,
            trust_remote_code=True,
            use_fast=False,
        )
        with _ignore_optional_flash_attn_import_for_os_atlas():
            hf_model = self._load_pretrained_model(
                torch,
                transformers.AutoModel,
                model,
                config=config,
                low_cpu_mem_usage=True,
            )
        _patch_generation_mixin(hf_model)
        _patch_os_atlas_generate_without_cache(hf_model)
        self._loaded[key] = (torch, tokenizer, hf_model)
        return self._loaded[key]  # type: ignore[return-value]

    def _load_pretrained_model(
        self,
        torch,
        model_cls,
        model: ModelSpec,
        **extra_kwargs,
    ):
        self._log(f"{model.name}: loading weights")
        kwargs = _model_load_kwargs(torch, model)
        kwargs.update(extra_kwargs)
        try:
            hf_model = _call_hf_loader(
                model_cls.from_pretrained,
                model,
                trust_remote_code=True,
                **kwargs,
            )
        except Exception as exc:
            if _looks_like_cve_torch_load_guard(exc):
                raise ModelSkipped(
                    "skipped - torch>=2.6.0 is required to load this model's "
                    "PyTorch .bin weights safely; run `uv sync --extra local`"
                ) from exc
            if _looks_like_cuda_fit_failure(exc):
                raise ModelSkipped(
                    "skipped - model did not fit on the CUDA GPU without CPU offload"
                ) from exc
            raise
        _reject_cpu_offload(model, hf_model)
        hf_model.eval()
        return hf_model

    def _reply(
        self,
        model: ModelSpec,
        text: str,
        raw: dict[str, Any] | None = None,
    ) -> ModelReply:
        payload = {"model": model.model_id, **(raw or {})}
        return ModelReply(text=text, raw=payload)

    def _point_reply(
        self,
        model: ModelSpec,
        point: Point,
        raw: dict[str, Any] | None = None,
    ) -> ModelReply:
        return self._reply(
            model,
            json.dumps({"x": point.x, "y": point.y}, ensure_ascii=False),
            raw=raw,
        )

    def _scaled_reply(
        self,
        model: ModelSpec,
        text: str,
        width: int,
        height: int,
        coordinate_max: int,
        adapter: str,
    ) -> ModelReply:
        point = _point_from_text(_strip_thinking(text))
        if point is None:
            return self._reply(model, text, raw={"adapter": adapter})
        return self._point_reply(
            model,
            Point(
                x=point.x / coordinate_max * width,
                y=point.y / coordinate_max * height,
            ),
            raw={"adapter": adapter, "text": text, "coordinate_max": coordinate_max},
        )

    def _resized_absolute_reply(
        self,
        model: ModelSpec,
        text: str,
        original_width: int,
        original_height: int,
        resized_width: int,
        resized_height: int,
        adapter: str,
    ) -> ModelReply:
        point = _point_from_text(_strip_thinking(text))
        if point is None:
            return self._reply(model, text, raw={"adapter": adapter})
        return self._point_reply(
            model,
            Point(
                x=point.x * original_width / resized_width,
                y=point.y * original_height / resized_height,
            ),
            raw={
                "adapter": adapter,
                "text": text,
                "resized_width": resized_width,
                "resized_height": resized_height,
            },
        )

    def _log(self, message: str) -> None:
        if self._log_callback is not None:
            self._log_callback(f"[local_hf] {message}")

    def _clear_loaded_models(self) -> None:
        if self._loaded:
            self._log("clearing loaded model objects and CUDA cache")
        self._loaded.clear()
        gc.collect()
        try:
            import torch
        except ImportError:
            return
        if not torch.cuda.is_available():
            return
        torch.cuda.empty_cache()
        try:
            torch.cuda.ipc_collect()
        except RuntimeError:
            pass


def detect_gpu() -> GpuInfo:
    nvidia = _detect_nvidia_smi()
    try:
        import torch
    except ImportError:
        return GpuInfo(present=False, reason="torch is not installed")

    if not torch.cuda.is_available():
        if nvidia.present:
            return GpuInfo(
                present=False,
                name=nvidia.name,
                total_vram_gb=nvidia.total_vram_gb,
                reason=(
                    "NVIDIA GPU was detected by nvidia-smi, but CUDA is "
                    "unavailable to PyTorch"
                ),
            )
        return GpuInfo(present=False, reason="no CUDA GPU detected")

    props = torch.cuda.get_device_properties(0)
    return GpuInfo(
        present=True,
        name=props.name or nvidia.name,
        total_vram_gb=(
            nvidia.total_vram_gb
            if nvidia.total_vram_gb is not None
            else props.total_memory / 1024**3
        ),
    )


def _detect_nvidia_smi() -> GpuInfo:
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (FileNotFoundError, subprocess.SubprocessError):
        return GpuInfo(present=False, reason="nvidia-smi unavailable")

    line = next((item.strip() for item in result.stdout.splitlines() if item.strip()), "")
    if not line:
        return GpuInfo(present=False, reason="nvidia-smi returned no GPUs")

    name, _, memory_mb_text = line.rpartition(",")
    try:
        total_vram_gb = float(memory_mb_text.strip()) / 1024
    except ValueError:
        total_vram_gb = None
    return GpuInfo(
        present=True,
        name=name.strip() or None,
        total_vram_gb=total_vram_gb,
    )


def _import_local_hf_dependencies():
    try:
        import torch
        import transformers
    except ImportError as exc:
        raise ModelSkipped(
            "skipped - local HF dependencies missing; install with "
            "`uv sync --extra local` or `pip install -r requirements.txt`"
        ) from exc
    return torch, transformers


def _require_points_gui_g_flash_attn(model: ModelSpec) -> None:
    try:
        from flash_attn import flash_attn_func
    except Exception as exc:
        raise ModelSkipped(_flash_attn_skip_message(model.name, str(exc))) from exc

    if not callable(flash_attn_func):
        raise ModelSkipped(
            _flash_attn_skip_message(
                model.name, "flash_attn did not expose flash_attn_func"
            )
        )


def _flash_attn_skip_message(model_name: str, detail: str) -> str:
    detail_text = f": {detail}" if detail else ""
    return (
        f"skipped - {model_name} requires FlashAttention 2, but flash-attn is "
        "missing or incompatible with this PyTorch/CUDA environment"
        f"{detail_text}. Install a matching flash-attn build for this "
        "environment, for example `pip install flash-attn --no-build-isolation`."
    )


def _looks_like_flash_attn_import_failure(exc: Exception) -> bool:
    if _looks_like_flash_attn_abi_failure(exc):
        return True

    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "flash_attn",
            "flash-attn",
            "flash attention",
            "flashattention",
            "flash_attention_2",
        )
    ) and any(
        marker in message
        for marker in (
            "undefined symbol",
            "cannot import",
            "failed to import",
            "no module named",
            "not found",
            "requires the following packages",
        )
    )


def _call_hf_loader(loader, model: ModelSpec, **kwargs):
    if model.revision:
        kwargs.setdefault("revision", model.revision)
    try:
        return loader(model.model_id, **kwargs)
    except Exception as exc:
        message = str(exc)
        if _looks_like_flash_attn_import_failure(exc):
            raise ModelSkipped(_flash_attn_skip_message(model.name, message)) from exc
        if "requires the following packages" in message or isinstance(
            exc, ImportError
        ):
            raise ModelSkipped(
                "skipped - local HF dependency missing for "
                f"{model.name}: {message}. Run `uv sync --extra local`."
            ) from exc
        raise


def _model_class(transformers, class_names: tuple[str, ...]):
    for name in class_names:
        model_cls = getattr(transformers, name, None)
        if model_cls is not None:
            return model_cls
    for name in (
        "AutoModelForImageTextToText",
        "AutoModelForVision2Seq",
        "AutoModelForCausalLM",
    ):
        model_cls = getattr(transformers, name, None)
        if model_cls is not None:
            return model_cls
    raise RuntimeError("Installed transformers does not provide a VLM model class")


def _model_load_kwargs(torch, model: ModelSpec) -> dict[str, Any]:
    kwargs: dict[str, Any] = {}
    if model.use_safetensors is not None:
        kwargs["use_safetensors"] = model.use_safetensors
    if model.attn_implementation:
        kwargs["attn_implementation"] = model.attn_implementation

    quantization = (model.quantization or "").lower()
    if quantization in {"bnb_4bit", "4bit"}:
        try:
            from transformers import BitsAndBytesConfig
        except ImportError as exc:
            raise ModelSkipped(
                "skipped - bitsandbytes quantization requested but transformers "
                "BitsAndBytesConfig is unavailable"
            ) from exc
        kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=_dtype_from_model(torch, model),
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
        )
        kwargs["device_map"] = "auto" if model.allow_cpu_offload else {"": "cuda:0"}
        return kwargs
    if quantization in {"bnb_8bit", "8bit"}:
        try:
            from transformers import BitsAndBytesConfig
        except ImportError as exc:
            raise ModelSkipped(
                "skipped - bitsandbytes quantization requested but transformers "
                "BitsAndBytesConfig is unavailable"
            ) from exc
        kwargs["quantization_config"] = BitsAndBytesConfig(load_in_8bit=True)
        kwargs["device_map"] = "auto" if model.allow_cpu_offload else {"": "cuda:0"}
        return kwargs

    kwargs["device_map"] = "auto" if model.allow_cpu_offload else {"": "cuda:0"}
    kwargs["dtype"] = _model_load_dtype(torch, model)
    return kwargs


def _model_load_dtype(torch, model: ModelSpec):
    dtype = (model.dtype or "").lower()
    if _adapter_for(model) == "molmopoint" and dtype in {"fp16", "float16"}:
        if torch.cuda.is_bf16_supported():
            return torch.bfloat16
        return torch.float32
    return _dtype_from_model(torch, model)


def _dtype_from_model(torch, model: ModelSpec):
    dtype = (model.dtype or "").lower()
    if dtype in {"bfloat16", "bf16"}:
        return torch.bfloat16
    if dtype in {"float16", "fp16"}:
        return torch.float16
    if dtype in {"float32", "fp32"}:
        return torch.float32
    if dtype == "auto":
        return "auto"
    return torch.float16


def _reject_cpu_offload(model: ModelSpec, hf_model) -> None:
    if model.allow_cpu_offload:
        return
    device_map = getattr(hf_model, "hf_device_map", None) or {}
    offloaded = {
        name: device
        for name, device in device_map.items()
        if str(device).lower() in {"cpu", "disk"}
    }
    if offloaded:
        raise ModelSkipped(
            "skipped - model was mapped to CPU/disk despite local GPU mode: "
            f"{offloaded}"
        )


def _build_inputs(processor, image, prompt: str):
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    apply_chat_template = getattr(processor, "apply_chat_template", None)
    if apply_chat_template is not None:
        try:
            return apply_chat_template(
                messages,
                tokenize=True,
                add_generation_prompt=True,
                return_dict=True,
                return_tensors="pt",
            )
        except TypeError:
            pass

    return processor(images=image, text=prompt, return_tensors="pt")


def _build_qwen3_vl_inputs(processor, image, prompt: str, model: ModelSpec):
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": prompt},
            ],
        }
    ]
    apply_chat_template = getattr(processor, "apply_chat_template", None)
    if apply_chat_template is not None:
        kwargs = {
            "tokenize": True,
            "add_generation_prompt": True,
            "return_dict": True,
            "return_tensors": "pt",
        }
        if _is_thinking_model(model):
            try:
                return apply_chat_template(messages, enable_thinking=False, **kwargs)
            except TypeError:
                pass
            try:
                return apply_chat_template(messages, thinking=False, **kwargs)
            except TypeError:
                pass
        try:
            return apply_chat_template(messages, **kwargs)
        except TypeError:
            pass

    return processor(images=image, text=prompt, return_tensors="pt")


def _is_thinking_model(model: ModelSpec) -> bool:
    return "thinking" in model.name.lower() or "thinking" in model.model_id.lower()


def _qwen_messages_to_inputs(processor, messages):
    try:
        from qwen_vl_utils import process_vision_info
    except ImportError as exc:
        raise ModelSkipped(
            "skipped - qwen-vl-utils missing; run `uv sync --extra local`"
        ) from exc

    text = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    image_inputs, video_inputs = process_vision_info(messages)
    return processor(
        text=[text],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    )


def _infigui_messages_to_inputs(processor, messages: list[dict[str, Any]], image):
    text = _qwen25_manual_prompt_text(messages)
    return processor(
        text=[text],
        images=[image],
        videos=None,
        padding=True,
        return_tensors="pt",
    )


def _move_inputs(inputs, device):
    if hasattr(inputs, "to"):
        return inputs.to(device)
    return {
        key: value.to(device) if hasattr(value, "to") else value
        for key, value in inputs.items()
    }


def _first_model_device(hf_model):
    device = getattr(hf_model, "device", None)
    if device is not None:
        return device
    return next(hf_model.parameters()).device


def _preferred_cuda_dtype(torch):
    if torch.cuda.is_bf16_supported():
        return torch.bfloat16
    return torch.float16


def _decode_output(processor, inputs, generated) -> str:
    input_ids = inputs.get("input_ids")
    if input_ids is not None and hasattr(generated, "shape"):
        generated = generated[:, input_ids.shape[-1] :]
    if hasattr(processor, "batch_decode"):
        decoded = processor.batch_decode(
            generated,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )
        return decoded[0] if decoded else ""
    if hasattr(processor, "decode"):
        return processor.decode(generated[0], skip_special_tokens=True)
    return json.dumps({"error": "processor cannot decode generated output"})


def _open_rgb_image(path: Path):
    Image, _, _ = require_pillow()
    with Image.open(path) as opened:
        return opened.convert("RGB")


def _image_size(path: Path) -> tuple[int, int]:
    image = _open_rgb_image(path)
    return image.size


def _smart_resize_image(image, model: ModelSpec):
    try:
        from qwen_vl_utils.vision_process import smart_resize
    except ImportError as exc:
        raise ModelSkipped(
            "skipped - qwen-vl-utils missing; run `uv sync --extra local`"
        ) from exc

    width, height = image.size
    min_pixels = model.min_pixels or 78_400
    max_pixels = model.max_pixels or 6_000_000
    resized_height, resized_width = smart_resize(
        height, width, factor=28, min_pixels=min_pixels, max_pixels=max_pixels
    )
    return image.resize((resized_width, resized_height)), (
        resized_width,
        resized_height,
    )


def _smart_resize_image_for_processor(image, processor, model: ModelSpec):
    image_processor = getattr(processor, "image_processor", None)
    patch_size = getattr(image_processor, "patch_size", 14)
    merge_size = getattr(image_processor, "merge_size", 2)
    size = getattr(image_processor, "size", {}) or {}
    min_pixels = model.min_pixels or size.get("shortest_edge") or 78_400
    max_pixels = model.max_pixels or size.get("longest_edge") or 6_000_000
    try:
        from qwen_vl_utils.vision_process import smart_resize
    except ImportError as exc:
        raise ModelSkipped(
            "skipped - qwen-vl-utils missing; run `uv sync --extra local`"
        ) from exc

    width, height = image.size
    resized_height, resized_width = smart_resize(
        height,
        width,
        factor=patch_size * merge_size,
        min_pixels=min_pixels,
        max_pixels=max_pixels,
    )
    return image.resize((resized_width, resized_height)), (
        resized_width,
        resized_height,
    )


def _pixel_kwargs(model: ModelSpec) -> dict[str, int]:
    kwargs: dict[str, int] = {}
    if model.min_pixels is not None:
        kwargs["min_pixels"] = model.min_pixels
    if model.max_pixels is not None:
        kwargs["max_pixels"] = model.max_pixels
    return kwargs


def _point_from_text(text: str) -> Point | None:
    parsed = parse_point_response(text)
    return parsed.point


def _strip_thinking(text: str) -> str:
    marker = "</think>"
    if marker in text:
        return text.split(marker, 1)[1].strip()
    return text


def _relative_1000_prompt(instruction: str) -> str:
    return (
        "Locate the single point to click for this instruction.\n\n"
        f"Instruction: {instruction}\n\n"
        "Return only one JSON object, no markdown:\n"
        '{"point_2d":[500,500],"label":"click"}\n\n'
        "Replace 500,500 with the target point; do not copy the example.\n"
        "The target is present in the image. Never answer that there are none; "
        "if uncertain, choose the closest matching visible UI element.\n"
        "Do not explain, enumerate, or reason in prose. Your entire response "
        "must be the JSON object.\n"
        "Use relative image coordinates: x and y are integers from 0 to 1000, "
        "where [0,0] is top-left and [1000,1000] is bottom-right."
    )


def _showui_system_prompt() -> str:
    return (
        "Based on the screenshot of the page, I give a text description and you "
        "give its corresponding location. The coordinate represents a clickable "
        "location [x, y] for an element, as a relative coordinate on the "
        "screenshot scaled from 0 to 1."
    )


def _groundnext_system_prompt(width: int, height: int) -> str:
    return (
        "You are a GUI grounding assistant. The screen resolution is "
        f"{width}x{height}. Return exactly one tool call in this form:\n"
        '<tool_call>{"name":"computer_use","arguments":{"action":"left_click",'
        '"coordinate":[123,456]}}</tool_call>\n'
        "Replace 123,456 with the target point. Use pixel coordinates in the "
        "current screen resolution."
    )


def _qwen25_absolute_messages(
    instruction: str,
    image,
    width: int,
    height: int,
    mode: str,
) -> list[dict[str, Any]]:
    if mode == "zonui":
        return [
            {
                "role": "system",
                "content": (
                    "Based on the screenshot of the page, I give a text "
                    "description and you give its corresponding location. The "
                    "coordinate represents a clickable location [x, y] for an "
                    "element."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {"type": "text", "text": instruction},
                ],
            },
        ]

    if mode == "qwen25_point_1000":
        return [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": (
                            f"Grounding instruction is: {instruction}\n"
                            "Locate the target UI element and return only this "
                            "JSON shape:\n"
                            '[{"point_2d": [500, 500], "label": "target"}]\n'
                            "Replace 500,500 with the target point.\n"
                            "The target is present in the image. Never answer "
                            "that there are none; if uncertain, choose the "
                            "closest matching visible UI element.\n"
                            "Use relative image coordinates where x and y are "
                            "integers from 0 to 1000."
                        ),
                    },
                ],
            }
        ]

    if mode == "qwen25_tool_absolute":
        return [
            {"role": "system", "content": _computer_use_tool_system_prompt(width, height)},
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": (
                            f"Instruction: {instruction}\n"
                            "Return only one <tool_call> JSON object for a "
                            "left click at the target pixel coordinate."
                        ),
                    },
                ],
            },
        ]

    if mode == "gui_drag":
        return [
            {"role": "system", "content": _gui_drag_tool_system_prompt(width, height)},
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": (
                            f"Instruction: {instruction}\n"
                            "Return exactly one computer_use tool call with "
                            'action "left_click" and a pixel coordinate.'
                        ),
                    },
                ],
            },
        ]

    if mode == "infigui":
        return [
            {
                "role": "system",
                "content": (
                    "You FIRST think about the reasoning process as an internal "
                    "monologue and then provide the final answer.\n"
                    "The reasoning process MUST BE enclosed within <think> "
                    "</think> tags."
                ),
            },
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": image},
                    {
                        "type": "text",
                        "text": (
                            f"The screen's resolution is {width}x{height}.\n"
                            f'Locate the UI element(s) for "{instruction}", '
                            "output the coordinates using JSON format: "
                            '[{"point_2d": [123, 456]}]. Replace 123,456 with '
                            "the target point."
                        ),
                    },
                ],
            },
        ]

    return [
        {"role": "system", "content": _pyautogui_system_prompt()},
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": instruction},
            ],
        },
    ]


def _qwen25_absolute_prompt_text(
    tokenizer, messages: list[dict[str, Any]], mode: str
) -> str:
    if mode in {"gui_drag", "qwen25_point_1000", "qwen25_tool_absolute", "zonui"}:
        return _qwen25_manual_prompt_text(messages)

    input_text = tokenizer.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    if mode not in {"gta1"}:
        return input_text

    converted_text, replacements = re.subn(
        r"<\|media_begin\|>.*?<\|media_end\|>",
        "<|vision_start|><|image_pad|><|vision_end|>",
        input_text,
        flags=re.DOTALL,
    )
    if replacements > 0:
        return converted_text
    if "<|vision_start|><|image_pad|><|vision_end|>" in input_text:
        return input_text
    raise RuntimeError("GTA1 chat template did not contain an image placeholder")


def _opencua_prompt_text(processor, messages: list[dict[str, Any]]) -> str:
    apply_chat_template = getattr(processor, "apply_chat_template", None)
    if apply_chat_template is None:
        tokenizer = getattr(processor, "tokenizer", None)
        apply_chat_template = getattr(tokenizer, "apply_chat_template", None)
    if apply_chat_template is None:
        raise RuntimeError("OpenCUA processor does not expose apply_chat_template")
    return apply_chat_template(messages, tokenize=False, add_generation_prompt=True)


def _qwen25_manual_prompt_text(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        role = str(message["role"])
        content = message["content"]
        parts.append(f"<|im_start|>{role}\n")
        if isinstance(content, str):
            parts.append(content)
        else:
            for item in content:
                if item.get("type") == "image":
                    parts.append("<|vision_start|><|image_pad|><|vision_end|>")
                elif item.get("type") == "text":
                    parts.append(str(item.get("text", "")))
        parts.append("<|im_end|>\n")
    parts.append("<|im_start|>assistant\n")
    return "".join(parts)


def _holo2_localization_prompt(instruction: str) -> str:
    schema = (
        '{"properties":{"x":{"description":"The x coordinate, normalized between '
        '0 and 1000.","minimum":0,"maximum":1000,"type":"integer"},"y":'
        '{"description":"The y coordinate, normalized between 0 and 1000.",'
        '"minimum":0,"maximum":1000,"type":"integer"}},"required":["x","y"],'
        '"type":"object"}'
    )
    return (
        "Localize an element on the GUI image according to the provided target "
        "and output a click position.\n"
        f" * You must output a valid JSON following the format: {schema}\n"
        " Your target is:\n"
        f"{instruction}"
    )


def _pyautogui_system_prompt() -> str:
    return (
        "You are a GUI agent. You are given a task and a screenshot of the "
        "screen. You need to perform a series of pyautogui actions to complete "
        "the task."
    )


def _computer_use_tool_system_prompt(width: int, height: int) -> str:
    return (
        "You are a GUI agent. You are given a task and a screenshot of the "
        "screen. The screen resolution is "
        f"{width}x{height}. Return exactly one tool call in this form:\n"
        '<tool_call>{"name":"computer_use","arguments":{"action":"left_click",'
        '"coordinate":[123,456]}}</tool_call>\n'
        "Replace 123,456 with the target point. Use pixel coordinates in the "
        "current screen resolution."
    )


def _gui_drag_tool_system_prompt(width: int, height: int) -> str:
    return (
        "You are a helpful assistant.\n"
        "# Tools\n"
        "You may call one function to assist with the user query. You are "
        "provided with function signatures within <tools></tools> XML tags:\n"
        "<tools>\n"
        '{"type":"function","function":{"name":"computer_use","description":'
        '"Use a mouse and keyboard to interact with a computer, and take '
        f"screenshots. The screen's resolution is {width}x{height}. Make sure "
        'to click buttons, links, icons, etc. with the cursor tip in the center '
        'of the element.","parameters":{"properties":{"action":{"description":'
        '"The action to perform.","enum":["left_click","mouse_move",'
        '"left_click_drag","right_click","middle_click","double_click","scroll",'
        '"wait","terminate"],"type":"string"},"coordinate":{"description":'
        '"(x, y): The x pixel from the left edge and y pixel from the top edge. '
        'Required for click/move actions.","type":"array"}},"required":'
        '["action"],"type":"object"}}}\n'
        "</tools>\n"
        "Return a json object with function name and arguments within "
        "<tool_call></tool_call> XML tags:\n"
        "<tool_call>\n"
        '{"name":"computer_use","arguments":{"action":"left_click",'
        '"coordinate":[123,456]}}\n'
        "</tool_call>\n"
        "Replace 123,456 with the target point."
    )


def _points_gui_g_system_prompt() -> str:
    return (
        "You are a GUI agent. Based on the UI screenshot provided, please locate "
        "the exact position of the element that matches the instruction given by "
        "the user.\n"
        "Requirements for the output:\n"
        "- Return only the point (x, y) representing the center of the target "
        "element\n"
        "- Coordinates must be normalized to the range [0, 1]\n"
        "- Round each coordinate to three decimal places\n"
        "- Format the output as strictly (x, y) without any additional text"
    )


def _uground_prompt(instruction: str) -> str:
    return (
        "Your task is to identify the precise coordinates (x, y) of a specific "
        "area/element/object on the screen based on a description. Return a "
        "single string (x, y). The output must be in the range [0,1000), where "
        "(0,0) is top-left and (1000,1000) is bottom-right.\n\n"
        f"Description: {instruction}\n\nAnswer:"
    )


def _os_atlas_prompt(instruction: str, suffix: str) -> str:
    return (
        "In this UI screenshot, what is the position of the element "
        f'corresponding to the command "{instruction}" ({suffix})?'
    )


def _os_atlas_pixel_values(image_path: Path, max_num: int):
    import torch
    import torchvision.transforms as T
    from torchvision.transforms.functional import InterpolationMode

    image = _open_rgb_image(image_path)
    transform = T.Compose(
        [
            T.Lambda(lambda img: img.convert("RGB") if img.mode != "RGB" else img),
            T.Resize((448, 448), interpolation=InterpolationMode.BICUBIC),
            T.ToTensor(),
            T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
        ]
    )
    images = _dynamic_preprocess(
        image, image_size=448, use_thumbnail=True, max_num=max_num
    )
    return torch.stack([transform(item) for item in images])


def _dynamic_preprocess(
    image,
    min_num: int = 1,
    max_num: int = 12,
    image_size: int = 448,
    use_thumbnail: bool = False,
):
    orig_width, orig_height = image.size
    aspect_ratio = orig_width / orig_height
    target_ratios = {
        (i, j)
        for n in range(min_num, max_num + 1)
        for i in range(1, n + 1)
        for j in range(1, n + 1)
        if min_num <= i * j <= max_num
    }
    target_ratios = sorted(target_ratios, key=lambda item: item[0] * item[1])
    target_aspect_ratio = _find_closest_aspect_ratio(
        aspect_ratio, target_ratios, orig_width, orig_height, image_size
    )
    target_width = image_size * target_aspect_ratio[0]
    target_height = image_size * target_aspect_ratio[1]
    blocks = target_aspect_ratio[0] * target_aspect_ratio[1]
    resized_img = image.resize((target_width, target_height))
    processed_images = []
    for index in range(blocks):
        box = (
            (index % (target_width // image_size)) * image_size,
            (index // (target_width // image_size)) * image_size,
            ((index % (target_width // image_size)) + 1) * image_size,
            ((index // (target_width // image_size)) + 1) * image_size,
        )
        processed_images.append(resized_img.crop(box))
    if use_thumbnail and len(processed_images) != 1:
        processed_images.append(image.resize((image_size, image_size)))
    return processed_images


def _find_closest_aspect_ratio(
    aspect_ratio: float,
    target_ratios,
    width: int,
    height: int,
    image_size: int,
):
    best_ratio_diff = float("inf")
    best_ratio = (1, 1)
    area = width * height
    for ratio in target_ratios:
        target_aspect_ratio = ratio[0] / ratio[1]
        ratio_diff = abs(aspect_ratio - target_aspect_ratio)
        if ratio_diff < best_ratio_diff:
            best_ratio_diff = ratio_diff
            best_ratio = ratio
        elif (
            ratio_diff == best_ratio_diff
            and area > 0.5 * image_size * image_size * ratio[0] * ratio[1]
        ):
            best_ratio = ratio
    return best_ratio


def _load_os_atlas_4b_config(transformers, model: ModelSpec):
    try:
        from transformers.dynamic_module_utils import get_class_from_dynamic_module
    except ImportError:
        return None

    config_class = get_class_from_dynamic_module(
        "configuration_internvl_chat.InternVLChatConfig",
        model.model_id,
        revision=model.revision,
    )
    config_class.has_no_defaults_at_init = True
    return config_class.from_pretrained(
        model.model_id,
        trust_remote_code=True,
        revision=model.revision,
    )


def _patch_generation_mixin(hf_model) -> None:
    try:
        from transformers.generation import GenerationMixin
    except ImportError:
        try:
            from transformers.generation.utils import GenerationMixin
        except ImportError:
            return
    try:
        from transformers import GenerationConfig
    except ImportError:
        try:
            from transformers.generation.configuration_utils import GenerationConfig
        except ImportError:
            GenerationConfig = None

    candidates = [
        getattr(hf_model, "language_model", None),
        getattr(hf_model, "llm", None),
    ]
    for candidate in candidates:
        if candidate is None:
            continue
        if not hasattr(candidate, "generate"):
            cls = candidate.__class__
            if not issubclass(cls, GenerationMixin):
                patched_cls = type(
                    f"{cls.__name__}WithGenerationMixin",
                    (cls, GenerationMixin),
                    {},
                )
                candidate.__class__ = patched_cls
        if getattr(candidate, "generation_config", None) is None:
            config = getattr(candidate, "config", None)
            if GenerationConfig is not None and config is not None:
                candidate.generation_config = GenerationConfig.from_model_config(config)


def _patch_qwen25_mrope_section(hf_model) -> None:
    configs = [
        getattr(hf_model, "config", None),
        getattr(getattr(hf_model, "config", None), "text_config", None),
        getattr(getattr(hf_model, "model", None), "config", None),
        getattr(getattr(hf_model, "language_model", None), "config", None),
    ]
    for config in configs:
        if config is None:
            continue
        rope_scaling = getattr(config, "rope_scaling", None)
        if isinstance(rope_scaling, dict) and "mrope_section" not in rope_scaling:
            rope_scaling["mrope_section"] = [16, 24, 24]


def _patch_os_atlas_generate_without_cache(hf_model) -> None:
    if getattr(hf_model, "_click_eval_no_cache_generate", False):
        return

    def generate_without_cache(
        self,
        pixel_values=None,
        input_ids=None,
        attention_mask=None,
        visual_features=None,
        generation_config=None,
        output_hidden_states=None,
        return_dict=None,
        **generate_kwargs,
    ):
        if self.img_context_token_id is None:
            raise RuntimeError("OS-Atlas image context token was not initialized")
        if pixel_values is not None:
            vit_embeds = (
                visual_features
                if visual_features is not None
                else self.extract_feature(pixel_values)
            )
            input_embeds = self.language_model.get_input_embeddings()(input_ids)
            batch_size, seq_len, hidden_size = input_embeds.shape
            input_embeds = input_embeds.reshape(batch_size * seq_len, hidden_size)
            flat_input_ids = input_ids.reshape(batch_size * seq_len)
            selected = flat_input_ids == self.img_context_token_id
            if selected.sum() == 0:
                raise RuntimeError("OS-Atlas prompt did not contain image tokens")
            input_embeds[selected] = vit_embeds.reshape(-1, hidden_size).to(
                input_embeds.device
            )
            input_embeds = input_embeds.reshape(batch_size, seq_len, hidden_size)
        else:
            input_embeds = self.language_model.get_input_embeddings()(input_ids)

        generate_kwargs.pop("use_cache", None)
        if generation_config is not None:
            try:
                generation_config.use_cache = False
            except AttributeError:
                pass
        generated = self.language_model.generate(
            input_ids=input_ids,
            inputs_embeds=input_embeds,
            attention_mask=attention_mask,
            generation_config=generation_config,
            output_hidden_states=output_hidden_states,
            return_dict=return_dict,
            use_cache=False,
            **generate_kwargs,
        )
        if (
            input_ids is not None
            and hasattr(generated, "shape")
            and generated.shape[-1] > input_ids.shape[-1]
        ):
            return generated[:, input_ids.shape[-1] :]
        return generated

    hf_model.generate = MethodType(generate_without_cache, hf_model)
    hf_model._click_eval_no_cache_generate = True


def _patch_dynamic_cache_compat() -> None:
    try:
        from transformers.cache_utils import DynamicCache
    except ImportError:
        return

    def seen_tokens(self):
        return self.get_seq_length()

    def get_max_length(self):
        if not hasattr(self, "get_max_cache_shape"):
            return None
        max_length = self.get_max_cache_shape()
        if max_length == -1:
            return None
        return max_length

    def get_usable_length(self, new_seq_length: int, layer_idx: int = 0) -> int:
        max_length = self.get_max_length()
        previous_seq_length = self.get_seq_length(layer_idx)
        if max_length is not None and previous_seq_length + new_seq_length > max_length:
            return max_length - new_seq_length
        return previous_seq_length

    if not hasattr(DynamicCache, "seen_tokens"):
        DynamicCache.seen_tokens = property(seen_tokens)  # type: ignore[attr-defined]
    if not hasattr(DynamicCache, "get_max_length"):
        DynamicCache.get_max_length = get_max_length  # type: ignore[attr-defined]
    if not hasattr(DynamicCache, "get_usable_length"):
        DynamicCache.get_usable_length = get_usable_length  # type: ignore[attr-defined]


@contextmanager
def _ignore_optional_flash_attn_import_for_os_atlas():
    try:
        import transformers.dynamic_module_utils as dynamic_module_utils
    except ImportError:
        yield
        return

    original_get_imports = dynamic_module_utils.get_imports

    def get_imports_without_flash_attn(filename):
        imports = original_get_imports(filename)
        if str(filename).endswith("modeling_intern_vit.py"):
            return [item for item in imports if item != "flash_attn"]
        return imports

    dynamic_module_utils.get_imports = get_imports_without_flash_attn
    try:
        yield
    finally:
        dynamic_module_utils.get_imports = original_get_imports


def _load_key(
    model: ModelSpec, kind: str, class_names: tuple[str, ...] = ()
) -> str:
    return "|".join(
        [
            kind,
            model.model_id,
            model.revision or "",
            model.quantization or "",
            model.dtype or "",
            ",".join(class_names),
        ]
    )


def _adapter_for(model: ModelSpec) -> str:
    model_id = model.model_id.lower()
    if model.adapter == "os_atlas":
        if "os-atlas-base-4b" in model_id:
            return "os_atlas_4b"
        if "os-atlas-base-7b" in model_id:
            return "os_atlas_7b"
    if model.adapter == "qwen3_vl" and "holo2" in model_id:
        return "holo2"
    if model.adapter:
        return model.adapter
    if "molmopoint" in model_id:
        return "molmopoint"
    if "showui" in model_id:
        return "showui"
    if "groundnext" in model_id:
        return "groundnext"
    if "fara" in model_id:
        return "qwen25_tool_absolute"
    if "gui-drag" in model_id:
        return "gui_drag"
    if "opencua" in model_id:
        return "opencua"
    if "gta1" in model_id:
        return "gta1"
    if "infigui" in model_id:
        return "infigui"
    if "points-gui-g" in model_id:
        return "points_gui_g"
    if "holo2" in model_id:
        return "holo2"
    if "uground" in model_id:
        return "uground"
    if "os-atlas-base-4b" in model_id:
        return "os_atlas_4b"
    if "os-atlas-base-7b" in model_id:
        return "os_atlas_7b"
    if any(
        marker in model_id
        for marker in ("qwen3-vl", "gui-owl-1.5", "kv-ground", "ui-venus", "holo2")
    ):
        return "qwen3_vl"
    if "mai-ui" in model_id:
        return "qwen3_vl"
    return "generic"


def _looks_like_cuda_fit_failure(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "out of memory",
            "cuda error",
            "not enough memory",
            "cannot access accelerator device",
            "torch not compiled with cuda",
        )
    )


def _looks_like_cve_torch_load_guard(exc: Exception) -> bool:
    message = str(exc).lower()
    return "torch.load" in message and "vulnerability" in message


def _looks_like_flash_attn_abi_failure(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "flash_attn" in message
        and ("undefined symbol" in message or "version mismatch" in message)
    )
