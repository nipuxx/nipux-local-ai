# Nipux Local AI

A minimal local-first AI workspace: ChatGPT-like chat, local agents with persistent memory, local search, SearXNG web search, Hugging Face model discovery/downloads, usage stats, and an OpenAI-compatible API.

The first runnable build is intentionally LLM-only. Image/video/audio are capability lanes for later, but the current app does not require Docker or external model APIs.

## What Works Now

- Minimal web UI at `http://127.0.0.1:3434`
- OpenAI-compatible routes:
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
  - `GET /v1/models`
- Persisted chat conversations through native `/api/chats` routes
- Fast / Balanced / Smart model modes
- Gemma 4 QAT GGUF defaults:
  - Fast: `google/gemma-4-E4B-it-qat-q4_0-gguf:Q4_0`
  - Balanced: `google/gemma-4-12B-it-qat-q4_0-gguf:Q4_0`
  - Smart: `google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0`
- Local SQLite persistence
- Agent memory CRUD, scored retrieval, and run history
- Hermes detection/config adapter with internal-memory-agent fallback
- Agent browser sessions with Playwright-backed open, navigate, screenshot, click, type, key, and close APIs
- Manual document indexing plus safe file/folder indexing and local search
- SearXNG adapter for local web search
- Hugging Face GGUF search, file listing, and direct download hooks
- llama.cpp runtime status, start, stop, and prompt test controls
- Usage dashboard
- Hardware/runtime detection for CPU, Apple Metal, NVIDIA CUDA, AMD ROCm/Vulkan, Intel Vulkan/DirectML
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

The Models page can also start/stop/test the llama.cpp runtime through the local API. This requires `llama` to be installed and available on `PATH`.

## Browser Agents

Install the local Chromium runtime:

```bash
bun run browsers:install
```

The Agents view can create browser sessions, open them, navigate, capture screenshots, click inside screenshots, type text, press Enter, and close sessions. By default browsers run headless through the UI preview. To open visible Chromium windows:

```bash
NIPUX_BROWSER_HEADLESS=0 bun run start
```

## One-Command Installer Shape

The repo includes scripts for eventual public install:

```bash
curl -fsSL https://raw.githubusercontent.com/Nipux/nipux-local-ai/main/scripts/install.sh | bash
```

Windows:

```powershell
irm https://raw.githubusercontent.com/Nipux/nipux-local-ai/main/scripts/install.ps1 | iex
```

Those scripts install Bun if needed, clone the repo, install dependencies, and run the local setup command.

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `NIPUX_PORT` | `3434` | App/API port |
| `NIPUX_BIND_HOST` | `127.0.0.1` | Bind address. Set intentionally for LAN/public exposure. |
| `NIPUX_PUBLIC_API` | `0` | Set to `1` to bind `0.0.0.0` by default and require API keys. |
| `NIPUX_API_KEY` / `NIPUX_API_KEYS` | empty | Required for protected routes when public mode is enabled or keys are configured. |
| `NIPUX_HOME` | `~/.nipux-local-ai` | Data, models, runtimes |
| `NIPUX_LLAMA_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible local LLM backend |
| `NIPUX_SEARXNG_URL` | empty | Local SearXNG URL, such as `http://127.0.0.1:8888` |
| `NIPUX_FAKE_LLM` | `0` | Enable streaming dev backend |
| `NIPUX_BROWSER_HEADLESS` | `1` | Set to `0` for visible Playwright browser windows |
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
```

See [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), and [Runtime Matrix](docs/RUNTIME-MATRIX.md).
