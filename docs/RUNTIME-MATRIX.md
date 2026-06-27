# Runtime Matrix

The installer should run everywhere. Model capability depends on hardware.

| Hardware | Expected Mode | Notes |
| --- | --- | --- |
| CPU-only, 8-16GB RAM | Fast | Works, but tokens/sec will be modest. |
| CPU-only, 16GB+ RAM | Balanced possible | Gemma 12B Q4 can load on some systems but may be slow. |
| Apple Silicon 16GB | Balanced | Metal backend recommended. Keep context moderate. |
| Apple Silicon 32GB+ | Balanced / Smart | Unified memory helps model fit; speed varies. |
| NVIDIA 12GB VRAM | Balanced | CUDA path is the cleanest local GPU route. |
| NVIDIA 16GB+ VRAM | Balanced / Smart | Strong target for local users. |
| AMD Linux ROCm | Fast / Balanced | Runtime support depends on ROCm and llama.cpp build. |
| AMD Windows | Fast / Balanced | Prefer Vulkan/DirectML where supported. |
| Intel iGPU | Fast | Vulkan/DirectML may help but CPU fallback must work. |

## Backend Preference

1. llama.cpp server for GGUF models and broad hardware support.
2. vLLM for high-throughput Linux/NVIDIA installs.
3. MLX for a future Apple-specific optimized path.
4. CPU fallback always available.

## Runtime Management

Use the platform-aware preflight to check required and optional local dependencies:

```bash
bun run preflight
```

The preflight checks Bun, git, writable Nipux folders, llama.cpp command/backend state, Playwright Chromium, and SearXNG configuration. Missing llama.cpp, Chromium, or SearXNG are warnings because dev mode and core chat still work without them.

The app can start and stop an app-managed llama.cpp process:

```bash
POST /api/runtime/start
POST /api/runtime/stop
GET /api/runtime/status
```

This requires the `llama` executable to be installed and available on `PATH`. If a user starts llama.cpp outside the app, `GET /api/runtime/status` still reports backend health through the configured `NIPUX_LLAMA_BASE_URL`.

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

## Media Workers

Image, speech, transcription, and video are local worker surfaces. They are configured with loopback URLs in Settings dev mode or environment variables:

```bash
NIPUX_IMAGE_WORKER_URL=http://127.0.0.1:8081
NIPUX_SPEECH_WORKER_URL=http://127.0.0.1:8082
NIPUX_TRANSCRIPTION_WORKER_URL=http://127.0.0.1:8083
NIPUX_VIDEO_WORKER_URL=http://127.0.0.1:8084
```

The current release does not bundle media models. It records media jobs and gives setup hints until local workers are configured. Remote media worker URLs are blocked.

Use the media runtime planner to see the current worker contracts and hardware fit:

```bash
bun run media:runtimes
GET /api/media/runtimes
```

Default worker lanes:

| Lane | Default URL | Contract | Default Fit |
| --- | --- | --- | --- |
| Image | `http://127.0.0.1:8081` | `POST /v1/images/generations` | GPU or strong unified memory preferred |
| Speech | `http://127.0.0.1:8082` | `POST /v1/audio/speech` | CPU-friendly first bundle target |
| Transcription | `http://127.0.0.1:8083` | `POST /v1/audio/transcriptions` | CPU-friendly with small models |
| Video | `http://127.0.0.1:8084` | `POST /v1/video/generations` | Experimental, queued, GPU/unified memory preferred |

Speech also has a built-in local fallback when the OS provides a supported speech command:

| OS | Built-In Speech Path |
| --- | --- |
| macOS | `say`, converted to WAV when `ffmpeg` is available |
| Linux | `espeak-ng` or `espeak` WAV output |
| Windows | PowerShell + System.Speech WAV output |

The configured speech worker URL takes priority over the built-in path.
