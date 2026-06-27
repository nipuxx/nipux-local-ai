# Nipux Local AI

A minimal local-first AI workspace: ChatGPT-like chat, local agents with persistent memory, local search, SearXNG web search, local-only media worker surfaces, Hugging Face model discovery/downloads, persisted settings, usage stats, and an OpenAI-compatible API.

The first runnable build is still LLM-first. Image/audio/video routes and UI surfaces exist, but they require local loopback workers; the app does not call external media APIs.

## What Works Now

- Minimal web UI at `http://127.0.0.1:3434`
- OpenAI-compatible routes:
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
  - `GET /v1/models`
  - `POST /v1/audio/speech`
  - `POST /v1/audio/transcriptions`
- Persisted chat conversations through native `/api/chats` routes
- Main chat can retrieve indexed local documents and append source citations
- Local speech playback for assistant chat messages
- Microphone recording in chat that transcribes through a configured local transcription worker
- Fast / Balanced / Smart model modes
- Gemma 4 QAT GGUF defaults:
  - Fast: `google/gemma-4-E4B-it-qat-q4_0-gguf:Q4_0`
  - Balanced: `google/gemma-4-12B-it-qat-q4_0-gguf:Q4_0`
  - Smart: `google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0`
- Local SQLite persistence
- Agent memory CRUD, scored retrieval, summaries, provenance, compaction, and run history
- Agent tool activity for local search, SearXNG web search, and browser-session creation
- Hermes detection/config adapter with internal-memory-agent fallback
- Agent browser sessions with Playwright-backed open, navigate, screenshot, click, type, key, and close APIs
- Browser action logs and approval gates for agent-originated risky actions
- Manual document indexing, browser file/folder import, safe dev file-path indexing, and local search
- SearXNG adapter for local web search
- Media tab plus local-only image, speech, transcription, and video worker API surfaces
- Hardware-aware media runtime planner for image, speech, transcription, and video workers
- Media worker health checks so configured loopback URLs show `offline` until a worker actually responds
- Built-in local text-to-speech through macOS `say`, Linux `espeak`, or Windows SAPI when available
- Hugging Face GGUF search, file listing, and direct download hooks
- llama.cpp runtime status, start, stop, and prompt test controls
- Usage dashboard
- Settings page for default mode, SearXNG URL, browser headless mode, client API key, and dev controls
- Setup page, `bun run ready`, and `bun run setup:actions` for everyday local capability status and copyable setup commands
- Launch profile generation with machine-specific env, run commands, and local launcher scripts
- Hardware/runtime detection for CPU, Apple Metal, NVIDIA CUDA, AMD ROCm/Vulkan, Intel Vulkan/DirectML
- Platform-aware preflight checks for install/runtime readiness and repair hints
- macOS/Linux and Windows install scripts with optional Playwright Chromium setup
- Release zip, manifest, checksum generation, and GitHub Actions artifact workflow
- Dev fake LLM mode so the UI/API can be tested without a model server

## Quick Start

```bash
bun install
bun run dev
```

Open `http://127.0.0.1:3434`.

Dev mode sets `NIPUX_FAKE_LLM=1`, so chat streams immediately without a real model.

## Run With llama.cpp

Install llama.cpp:

```bash
curl -LsSf https://llama.app/install.sh | sh
```

On Windows:

```powershell
winget install llama.cpp
```

Start the default model:

```bash
llama serve -hf google/gemma-4-12B-it-qat-q4_0-gguf:Q4_0 --port 8080 --ctx-size 32768
```

Then run:

```bash
bun run start
```

The app proxies `/v1/chat/completions` to `http://127.0.0.1:8080/v1` by default.

Install the recommended built-in chat model preset:

```bash
bun run model:install
```

Pass `fast`, `balanced`, or `smart` to install a specific preset. The Models page exposes the same install action. Once a preset has a local GGUF path, runtime start commands prefer that local file over remote Hugging Face loading.

The Models page can also start/stop/test the llama.cpp runtime through the local API. This requires `llama` to be installed and available on `PATH`.

## Browser Agents

Install the local Chromium runtime:

```bash
bun run browsers:install
```

The Agents view can create browser sessions, open them, navigate, capture screenshots, click inside screenshots, type text, press Enter, and close sessions. By default browsers run headless through the UI preview. Use Settings to switch browser sessions to visible Chromium windows, or set the boot default with:

```bash
NIPUX_BROWSER_HEADLESS=0 bun run start
```

Agent runs can also create assigned browser sessions from natural-language tasks. If a task asks the agent to visit a URL, the session is created and navigation is queued behind the same user approval gate as other agent-originated browser actions.

## Media Workers

Media routes are local-only. Set worker URLs in Settings dev mode or through environment variables:

```bash
NIPUX_IMAGE_WORKER_URL=http://127.0.0.1:8081
NIPUX_SPEECH_WORKER_URL=http://127.0.0.1:8082
NIPUX_TRANSCRIPTION_WORKER_URL=http://127.0.0.1:8083
NIPUX_VIDEO_WORKER_URL=http://127.0.0.1:8084
```

Worker URLs must be loopback URLs such as `localhost` or `127.0.0.1`. External media APIs are intentionally rejected.

Image generation can use the bundled local command worker. The worker exposes the OpenAI-compatible image route and shells out to a local image command that receives a JSON request path and an output image path:

```bash
NIPUX_IMAGE_COMMAND=/path/to/local-image-command bun run worker:image
bun run media:defaults
```

The default command argument contract is `{input} {output}`. Set `NIPUX_IMAGE_ARGS` to adapt a local Stable Diffusion, Diffusers, MLX, or other image backend without exposing users to node graphs.

Video generation can use the bundled local command worker. It follows the same pattern, but writes a video request JSON file and expects a local backend to write a video file:

```bash
NIPUX_VIDEO_COMMAND=/path/to/local-video-command bun run worker:video
bun run media:defaults --include-optional
```

The default video command contract is `{input} {output}`. Keep this lane opt-in on smaller machines; local video runtimes are much more hardware-sensitive than chat, speech, or transcription.

Speech has a built-in local fallback when the OS has a supported speech command:

- macOS: `say`
- Linux: `espeak-ng` or `espeak`
- Windows: System.Speech through PowerShell

Configured speech worker URLs still take priority, so Kokoro/Piper-style workers can replace the built-in voice path.

Voice input in chat records microphone audio in the browser and sends it to `/v1/audio/transcriptions`. That route accepts OpenAI-style multipart uploads and translates them to the configured loopback transcription worker. The repo includes a whisper.cpp-compatible local worker wrapper:

```bash
bun run transcription:install base.en
NIPUX_WHISPER_MODEL="$HOME/.nipux-local-ai/models/whisper.cpp/ggml-base.en.bin" bun run worker:transcription
bun run media:defaults
```

`bun run transcription:install` downloads the default local Whisper model and prints the exact start command for this machine. `NIPUX_WHISPER_COMMAND` defaults to `whisper-cli`, so the wrapper still expects a whisper.cpp-compatible binary on `PATH`. If no local transcription worker is configured or reachable, the UI shows the setup error.

Inspect the hardware-aware local media runtime plan:

```bash
bun run media:runtimes
bun run media:runtimes --json
```

Seed recommended loopback worker URLs without marking them ready:

```bash
bun run media:defaults
```

The planner reports the expected worker contract, default local port, environment variable, current configured status, health-check result, and whether the detected hardware is a reasonable fit for each lane. A configured worker URL is only `ready` when a local process responds; otherwise it is `offline`.

## One-Command Installer Shape

The repo includes scripts for eventual public install:

```bash
curl -fsSL https://raw.githubusercontent.com/nipuxx/nipux-local-ai/main/scripts/install.sh | bash
```

Windows:

```powershell
irm https://raw.githubusercontent.com/nipuxx/nipux-local-ai/main/scripts/install.ps1 | iex
```

Those scripts install Bun if needed, clone or update the repo, install dependencies from the lockfile, run the local setup command, and install Playwright Chromium for browser agents. Set `NIPUX_INSTALL_BROWSERS=0` to skip the Chromium download and repair it later with `bun run browsers:install`.

Run the platform-aware readiness check at any time:

```bash
bun run ready
bun run preflight
bun run setup:actions
```

`bun run ready` summarizes the user-facing state: chat, browser agents, voice output/input, image/video workers, search, and API exposure. `bun run setup:actions` turns that state into copyable install/start/configure commands. `bun run preflight` keeps the lower-level installer checks.

Generate or rewrite the local launch profile:

```bash
bun run launch:profile
bun run launch:write
```

`bun run setup` also writes `launch-profile.json`, `nipux.env`, `start-dev.sh`, `start-local.sh`, `start-dev.ps1`, and `start-local.ps1` under `~/.nipux-local-ai`.

## Release Packaging

Build distributable release artifacts:

```bash
bun run package:release
```

This writes a source zip, JSON manifest, and `SHA256SUMS.txt` into `dist/`. See [Release Packaging](docs/RELEASE.md).

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIPUX_PORT` | `3434` | App/API port |
| `NIPUX_BIND_HOST` | `127.0.0.1` | Bind address. Set intentionally for LAN/public exposure. |
| `NIPUX_PUBLIC_API` | `0` | Set to `1` to bind `0.0.0.0` by default and require API keys. |
| `NIPUX_API_KEY` / `NIPUX_API_KEYS` | empty | Required for protected routes when public mode is enabled or keys are configured. |
| `NIPUX_HOME` | `~/.nipux-local-ai` | Data, models, runtimes |
| `NIPUX_LLAMA_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible local LLM backend |
| `NIPUX_SEARXNG_URL` | empty | Boot default for the Settings page SearXNG URL, such as `http://127.0.0.1:8888` |
| `NIPUX_IMAGE_WORKER_URL` | empty | Local OpenAI-compatible image worker URL |
| `NIPUX_SPEECH_WORKER_URL` | empty | Local text-to-speech worker URL |
| `NIPUX_TRANSCRIPTION_WORKER_URL` | empty | Local speech-to-text worker URL |
| `NIPUX_VIDEO_WORKER_URL` | empty | Local video generation worker URL |
| `NIPUX_FAKE_LLM` | `0` | Enable streaming dev backend |
| `NIPUX_DEV_UI` | `0` | Boot default for showing dev controls |
| `NIPUX_BROWSER_HEADLESS` | `1` | Boot default for headless Playwright browser windows. Set to `0` for visible windows. |
| `HF_TOKEN` | empty | Hugging Face token for gated models |

When API keys are configured, clients can authenticate with either:

```text
Authorization: Bearer <key>
x-api-key: <key>
```

## Development

```bash
bun run check
bun test
bun run doctor
bun run preflight
bun run ready
bun run media:runtimes
bun run package:release
```

See [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), [Runtime Matrix](docs/RUNTIME-MATRIX.md), and [Release Packaging](docs/RELEASE.md).
