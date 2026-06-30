# Runtime Matrix

The installer should run everywhere. Model capability depends on hardware.

| Hardware | Expected Mode | Notes |
| --- | --- | --- |
| CPU-only, 8-16GB RAM | Fast | Works, but tokens/sec will be modest. |
| CPU-only, 16GB+ RAM | Balanced possible | Qwen3 8B Q4_K_M can load on some systems but may be slow. |
| Apple Silicon 16GB | Balanced | Metal backend recommended. Keep context moderate. |
| Apple Silicon 32GB+ | Balanced / Smart | Unified memory helps model fit; speed varies. |
| NVIDIA 12GB VRAM | Balanced | CUDA path is the cleanest local GPU route. |
| NVIDIA 16GB+ VRAM | Balanced / Smart | Strong target for local users. |
| AMD Linux ROCm | Fast / Balanced | Runtime support depends on ROCm and llama.cpp build. |
| AMD Windows | Fast / Balanced | Prefer Vulkan/DirectML where supported. |
| Intel iGPU | Fast | Vulkan/DirectML may help but CPU fallback must work. |

## Consumer Capability Profile

Use the capability profile to translate hardware detection into everyday defaults:

```bash
bun run capabilities
bun run capabilities --json
GET /api/capability-profile
```

The profile classifies the machine as minimal CPU, CPU-standard, GPU-accelerated, or high-memory workstation. It then marks each product lane as `default`, `available`, `slow`, `optional`, or `blocked`.

Default lanes should stay simple: chat, local search, agents, browser control when memory allows, voice output, practical transcription, and the local/public API. Image and video remain opt-in because local weights, backend support, VRAM, and license terms decide whether they can actually run well.

Important assumptions:

- VRAM is not measured yet, so GPU decisions are conservative.
- Closed hosted models cannot be bundled locally unless local weights and license terms exist.
- Media lanes are local-only and require loopback workers before they are marked ready.

## Backend Preference

1. llama.cpp server for GGUF models and broad hardware support.
2. vLLM for high-throughput Linux/NVIDIA installs.
3. MLX for a future Apple-specific optimized path.
4. CPU fallback always available.

## Runtime Management

Use the platform-aware preflight to check required and optional local dependencies:

```bash
bun run ready
bun run preflight
bun run setup:actions
```

`bun run ready` is the everyday capability summary. `bun run setup:actions` converts that state into copyable install/start/configure commands. The preflight checks Bun, git, writable Nipux folders, llama.cpp command/backend state, Playwright Chromium, and SearXNG configuration. Missing llama.cpp, Chromium, or SearXNG are warnings because dev mode and core chat still work without them.

The app can start and stop an app-managed llama.cpp process:

```bash
bun run model:plan balanced
bun run model:install balanced --dry-run
POST /api/runtime/start
POST /api/runtime/stop
GET /api/runtime/status
```

This requires the `llama` executable to be installed and available on `PATH`, or `NIPUX_LLAMA_COMMAND` to point at the local executable. `bun run model:plan` and `model:install --dry-run` preview the selected GGUF file before a large download starts. `bun run local` can also start llama.cpp when a local GGUF model is installed in the registry or `NIPUX_LLAMA_MODEL_PATH` points at one. If a user starts llama.cpp outside the app, `GET /api/runtime/status` still reports backend health through the configured `NIPUX_LLAMA_BASE_URL`.

## SearXNG

Docker is not required by this project. SearXNG can be installed separately with its official installation script or from source, then exposed via:

```bash
export NIPUX_SEARXNG_URL=http://127.0.0.1:8888
```

The app stays usable if SearXNG is not configured; web search returns a setup hint.

## Browser Agents

Browser sessions use Playwright Chromium:

```bash
bun run browsers:install
```

Default mode is headless with screenshot/control through the UI. Set `NIPUX_BROWSER_HEADLESS=0` for visible Chromium windows. Autonomous browser actions must stay behind explicit user permission gates:

- navigation
- form entry
- downloads/uploads
- external posting
- purchases/payments
- credential access
- file writes/deletes

Approvals are scoped to the exact browser session, agent, action, and action details. The Agents view can approve and run replayable actions such as navigation, clicks, and key presses. Typed text is not displayed in approval records; the backend stores a length and SHA-256 fingerprint so an approval cannot be reused for different text with the same visible length.

## Media Workers

Image, speech, transcription, and video are local worker surfaces. They are configured with loopback URLs in Settings dev mode or environment variables:

```bash
NIPUX_IMAGE_WORKER_URL=http://127.0.0.1:8081
NIPUX_SPEECH_WORKER_URL=http://127.0.0.1:8082
NIPUX_TRANSCRIPTION_WORKER_URL=http://127.0.0.1:8083
NIPUX_VIDEO_WORKER_URL=http://127.0.0.1:8084
```

The current release does not bundle image or video model weights. It records media jobs and gives setup hints until local workers are configured. Remote media worker URLs are blocked. Image and video generation include bundled local command workers, but still require local backend commands and model files. Transcription includes a bundled whisper.cpp-compatible worker wrapper and a Whisper model installer, but still requires a local `whisper-cli` command.

Use the media runtime planner to see the current worker contracts and hardware fit:

```bash
bun run image:backends
bun run media:runtimes
bun run media:defaults
GET /api/media/images/backends
GET /api/media/runtimes
```

`media:defaults` persists recommended loopback URLs only. It does not start image, transcription, or video models. A media lane is `ready` only when the configured built-in path or loopback worker responds to a health check; otherwise configured workers show `offline`.

Default worker lanes:

| Lane | Default URL | Contract | Default Fit |
| --- | --- | --- | --- |
| Image | `http://127.0.0.1:8081` | `POST /v1/images/generations` | GPU or strong unified memory preferred |
| Speech | `http://127.0.0.1:8082` | `POST /v1/audio/speech` | CPU-friendly first bundle target |
| Transcription | `http://127.0.0.1:8083` | `POST /v1/audio/transcriptions` | CPU-friendly with small models |
| Video | `http://127.0.0.1:8084` | `POST /v1/video/generations` | Experimental, queued, GPU/unified memory preferred |

Start the bundled image command worker:

```bash
NIPUX_IMAGE_COMMAND=/path/to/local-image-command bun run worker:image
```

The default image command receives `{input} {output}`. The input is a JSON file with prompt, model, size, width, height, seed, and output path fields. Override `NIPUX_IMAGE_ARGS` when a backend needs different flags.

For a direct local Diffusers setup, run `bun run image:backends` and use the recommended preset. The bundled `scripts/image-backends/diffusers-image.py` command can run SDXL Turbo or another Diffusers text-to-image model after Python dependencies are installed. This remains opt-in because local model downloads, VRAM, and model license terms vary by machine.

Select a preset for `bun run local`:

```bash
bun run image:prepare diffusers-sdxl-turbo
bun run image:prepare diffusers-sdxl-turbo --install
```

Preparation stores the preset and local image worker URL, then prints the next `bun run local --open` step. It does not install Python packages unless `--install` is supplied; use the install command printed by `bun run image:backends` when you want to do that manually.

Start the bundled video command worker:

```bash
NIPUX_VIDEO_COMMAND=/path/to/local-video-command bun run worker:video
```

The default video command receives `{input} {output}`. The input is a JSON file with prompt, model, seconds, width, height, fps, seed, and output path fields. Override `NIPUX_VIDEO_ARGS` when a backend needs different flags.

Start the bundled transcription worker:

```bash
bun run transcription:install base.en
NIPUX_WHISPER_MODEL="$HOME/.nipux-local-ai/models/whisper.cpp/ggml-base.en.bin" bun run worker:transcription
```

Speech also has a built-in local fallback when the OS provides a supported speech command:

| OS | Built-In Speech Path |
| --- | --- |
| macOS | `say`, converted to WAV when `ffmpeg` is available |
| Linux | `espeak-ng` or `espeak` WAV output |
| Windows | PowerShell + System.Speech WAV output |

The configured speech worker URL takes priority over the built-in path.

Chat voice input uses the transcription worker lane. The browser records microphone audio and sends it to `/v1/audio/transcriptions`; the app converts the upload into the configured local worker request. There is no external fallback.
