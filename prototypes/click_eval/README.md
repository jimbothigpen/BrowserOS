# Click Eval Prototype

Tiny VLM click-point evaluation harness.

## Layout

- `src/click_eval/`: runtime package and CLI
- `tests/`: fixture-based tests with no network calls
- `examples/`: default task/model config files and sample screenshot
- `runs/`: suggested output location

## Input

Create a JSONL task file:

```jsonl
{"task_id":"chat_1","image_path":"screenshots/page.png","instruction":"click the chat button"}
{"task_id":"send_1","image_path":"screenshots/page.png","instruction":"click send","gt_point":[510,742]}
```

`image_path` is resolved relative to the task file. If `gt_point` is absent,
the judge model is called once and the resolved coordinate is cached in the run
output.

The default model config is `examples/models.json`. The abbreviated cloud/API
portion is:

```json
{
  "judge_model": "anthropic/claude-opus-4.7",
  "candidate_models": [
    {
      "name": "qwen3-vl-8b-instruct",
      "provider": "openrouter",
      "model": "qwen/qwen3-vl-8b-instruct"
    },
    {
      "name": "qwen3-vl-8b-thinking",
      "provider": "openrouter",
      "model": "qwen/qwen3-vl-8b-thinking"
    },
    {
      "name": "ui-tars-1.5-7b",
      "provider": "openrouter",
      "model": "bytedance/ui-tars-1.5-7b"
    },
    {"name": "moondream", "provider": "moondream", "model": "moondream-cloud"}
  ]
}
```

The `name` is only the short label shown in plots and summary files. OpenRouter
is the default provider, but the examples keep it explicit for routability
audits. The active OpenRouter click-model shortlist was checked against
`https://openrouter.ai/api/v1/models` on 2026-04-26 and includes:

- `qwen/qwen3-vl-8b-instruct`
- `qwen/qwen3-vl-8b-thinking`
- `bytedance/ui-tars-1.5-7b`

Shortlist models not found in the current OpenRouter catalog are documented
below as `local_hf` candidates. They are included in `examples/models.json`, but
the provider checks for a CUDA/NVIDIA GPU before importing local inference
dependencies or downloading weights. If no usable CUDA GPU is present, they are
recorded as skipped with the CUDA detection reason.

| Model | Hosting | Setup needed |
| --- | --- | --- |
| `mPLUG/GUI-Owl-1.5-2B-Instruct` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI-agent adapter. |
| `mPLUG/GUI-Owl-1.5-4B-Instruct` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI-agent adapter. |
| `mPLUG/GUI-Owl-1.5-8B-Instruct` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI-agent adapter. |
| `vocaela/KV-Ground-8B-BaseGuiOwl1.5-0315` | Hugging Face | Included as `local_hf`; high-performing ScreenSpot-Pro GUI grounder, non-commercial license. |
| `inclusionAI/UI-Venus-1.5-2B` | Hugging Face | Included as `local_hf`; small Qwen3-VL GUI agent. |
| `inclusionAI/UI-Venus-1.5-8B` | Hugging Face | Included as `local_hf`; strong Apache-2.0 GUI agent/grounder. |
| `Hcompany/Holo2-4B` | Hugging Face | Included as `local_hf`; Qwen3-VL computer-use model. |
| `Hcompany/Holo2-8B` | Hugging Face | Included as `local_hf`; Qwen3-VL computer-use model. |
| `Salesforce/GTA1-7B` | Hugging Face | Included as `local_hf`; outputs `pyautogui.click(...)` coordinates after Qwen smart resize. |
| `xlangai/OpenCUA-7B` | Hugging Face | Included as `local_hf`; outputs `pyautogui.click(...)` coordinates after Qwen smart resize. |
| `InfiX-ai/InfiGUI-G1-3B` | Hugging Face | Included as `local_hf`; outputs JSON `point_2d` coordinates after Qwen smart resize. |
| `InfiX-ai/InfiGUI-G1-7B` | Hugging Face | Included as `local_hf`; outputs JSON `point_2d` coordinates after Qwen smart resize. |
| `tencent/POINTS-GUI-G` | Hugging Face | Included as `local_hf`; outputs normalized `(x, y)` coordinates and needs `WePOINTS`. |
| `Tongyi-MAI/MAI-UI-8B` | Hugging Face | Included as `local_hf`; may need `HF_TOKEN` depending on access. |
| `allenai/MolmoPoint-GUI-8B` | Hugging Face | Included as `local_hf`; outputs pointing tokens, so model-specific parser tuning may improve results. |
| `microsoft/Fara-7B` | Hugging Face and Microsoft Foundry | Included as `local_hf`; Foundry use would need endpoint credentials and a separate adapter. |
| `ServiceNow/GroundNext-7B-V0` | Hugging Face and Azure AI Foundry | Included as `local_hf`; Azure use would need endpoint credentials and a separate adapter. |
| `osunlp/UGround-V1-7B` | Hugging Face | Included as `local_hf`; the model card also documents vLLM OpenAI-compatible serving. |
| `OS-Copilot/OS-Atlas-Base-4B` | Hugging Face | Included as `local_hf`; outputs normalized coordinates/boxes, so parser tuning may improve results. |
| `OS-Copilot/OS-Atlas-Base-7B` | Hugging Face | Included as `local_hf`; outputs normalized coordinates/boxes, so parser tuning may improve results. |
| `showlab/ShowUI-2B` | Hugging Face | Included as `local_hf`; parser tuning may be needed for action-dictionary outputs. |
| `Qwen/Qwen3-VL-4B-Instruct` | Hugging Face | Included as `local_hf`; not currently routable through OpenRouter. |
| `Qwen/Qwen3-VL-4B-Thinking` | Hugging Face | Included as `local_hf`; not currently routable through OpenRouter. |

For HF-local models, install optional local dependencies with:

```bash
uv sync --extra local
```

This installs `torch`, `torchvision`, `transformers`, `accelerate`, `einops`,
`qwen-vl-utils`, `safetensors`, `timm`, `sentencepiece`, `protobuf`,
`requests`, `tiktoken`, and `WePOINTS`. `torch>=2.6` is required for models
that still ship PyTorch `.bin` weights because older PyTorch releases are
blocked by the CVE-2025-32434 `torch.load` guard. MolmoPoint also expects
`einops`, and the Qwen-derived GUI models use `qwen-vl-utils` for image
preprocessing. POINTS-GUI-G requires FlashAttention 2 at runtime, but it is not
installed by the local extra because its native build must match the active
Python, PyTorch, and CUDA environment.

The local provider is intentionally conservative: it only runs when PyTorch can
use CUDA, and it skips non-offloaded models whose estimated VRAM exceeds the
detected GPU memory. Models marked `allow_cpu_offload` use Transformers
`device_map="auto"`; other local models load directly onto `cuda:0`. This
means a misconfigured container where `nvidia-smi` works but `torch.cuda` does
not will be skipped instead of silently running an 8B model on CPU. Local
generation uses the CLI `--timeout` value as the Transformers `max_time` budget.
Several model-specific adapters are included for MolmoPoint, GroundNext,
UGround, OS-Atlas, ShowUI, Qwen3-VL, OpenCUA, GTA1, InfiGUI, and POINTS-GUI-G.
Local model configs use `fp16` and CPU offload for the larger checkpoints
instead of quantization. MolmoPoint is the
exception: its official inference path uses BF16 autocast, and FP16 overflows in
its pointing-token generation path. Timing for offloaded models will include
CPU-GPU transfer overhead. The local runner unloads each HF model after its
inference and clears the CUDA cache before the next local model. For
gated/private downloads, set `HF_TOKEN`. For Azure/Foundry-hosted variants,
expect an endpoint URL plus API key and a dedicated provider adapter.

Moondream candidates use a provider-qualified
entry:

```json
{
  "candidate_models": [
    {
      "name": "moondream",
      "provider": "moondream",
      "model": "moondream-cloud"
    }
  ]
}
```

## Run

```bash
cd prototypes/click_eval
uv sync
export OPENROUTER_API_KEY=...
# Optional, for Moondream candidates:
export MOONDREAM_API_KEY=...
uv run click-eval run
```

Without `uv`, use:

```bash
cd prototypes/click_eval
python -m pip install -r requirements.txt
python -m click_eval run
```

On an interactive terminal, `run` shows tqdm progress bars for tasks and model
calls. In non-interactive output, it prints plain status lines instead. Use
`--no-progress` to suppress both.

The CLI also loads `MOONDREAM_API_KEY` and `OPENROUTER_API_KEY` from a local
`.env` file in `prototypes/click_eval/` or the current working directory.
Moondream calls use `POST https://api.moondream.ai/v1/point` with the screenshot
as a base64 data URL and the click instruction converted to an object query.

During a run, the CLI shows progress bars for tasks and per-task candidate model
calls. It also prints compact status lines for GT resolution, provider/model
calls, prediction failures, and the output directory.

OpenRouter candidate calls are sent concurrently in bounded batches of 4. Local
HF/GPU candidates stay synchronous and serial to avoid GPU memory contention;
Moondream and GT resolution also remain synchronous.

Outputs:

- `resolved_tasks.jsonl`: task manifest with cached `gt_point`
- `predictions.jsonl`: raw candidate responses and parsed points
- `scores.csv`: per-task L2 distances and threshold hits
- `summary.json`: aggregate metrics per model
- `annotated/*.png`: screenshot overlays with GT and predictions

`predictions.jsonl`, `scores.csv`, and `summary.json` include per-model
`duration_seconds` timing fields. Skipped local models are marked with
`skipped=true` and an error message explaining the skip reason.

By default, `click-eval run` uses:

- `examples/tasks.jsonl`
- `examples/models.json`
- `runs/<timestamp>`

## Development

```bash
cd prototypes/click_eval
uv run pytest
uv run ruff check .
```
