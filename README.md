# Nipux Local AI

A minimal local-first AI workspace: ChatGPT-like chat, local agents with persistent memory, local search, SearXNG web search, Hugging Face model discovery/downloads, usage stats, and an OpenAI-compatible API.

The first runnable build is intentionally LLM-only. Image/video/audio are capability lanes for later, but the current app does not require Docker or external model APIs.

## What Works Now

- Minimal web UI at `http://127.0.0.1:3434`
- OpenAI-compatible routes:
  - `POST /v1/chat/completions`
  - `POST /v1/responses`
  - `GET /v1/models`
- Fast / Balanced / Smart model modes
- Gemma 4 QAT GGUF defaults:
  - Fast: `google/gemma-4-E4B-it-qat-q4_0-gguf:Q4_0`
  - Balanced: `google/gemma-4-12B-it-qat-q4_0-gguf:Q4_0`
  - Smart: `google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0`
- Local SQLite persistence
- Agent memory and run history
- Local document indexing/search
- SearXNG adapter for local web search
- Hugging Face GGUF search, file listing, and direct download hooks
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
| `NIPUX_HOME` | `~/.nipux-local-ai` | Data, models, runtimes |
| `NIPUX_LLAMA_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible local LLM backend |
| `NIPUX_SEARXNG_URL` | empty | Local SearXNG URL, such as `http://127.0.0.1:8888` |
| `NIPUX_FAKE_LLM` | `0` | Enable streaming dev backend |
| `HF_TOKEN` | empty | Hugging Face token for gated models |

## Development

```bash
bun run check
bun test
bun run doctor
```

See [Architecture](docs/ARCHITECTURE.md), [API](docs/API.md), and [Runtime Matrix](docs/RUNTIME-MATRIX.md).
