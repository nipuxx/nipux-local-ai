# Nipux Local AI Goal

Build a local-first, one-command AI workspace that feels as simple as ChatGPT or OpenWebUI, but runs on the user's computer, exposes a public/local API, supports agents, and avoids Docker or node-graph complexity.

The product should be usable by everyday people first. Advanced controls belong in a dev mode, not on the main screen.

## Product Principles

- Local-first by default.
- One-command install.
- No Docker requirement.
- Minimal UI with no workflow-node surface.
- Fast / Balanced / Smart model modes instead of a huge model-picker UI.
- Hugging Face model search/download/test for users who want more control.
- OpenAI-compatible API so other tools can use the local server.
- Agents have persistent memory, search, browser sessions, action logs, and permission gates.
- CPU-only systems must still work with smaller models.
- GPU/unified-memory systems should auto-detect the best available acceleration path.
- Image/audio/video use local-only worker surfaces until bundled local media runtimes are reliable.

## Baseline v1

- Chat UI with persisted conversations.
- OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, and `/v1/models`.
- Local llama.cpp backend with automatic health checks.
- Model presets:
  - Fast: small Gemma/Qwen-class local model.
  - Balanced: Gemma 4 12B QAT Q4 GGUF target.
  - Smart: larger local model for strong GPUs/unified memory.
- Hugging Face model search, file listing, download, and test.
- Local agents with persistent memory.
- Agent browser sessions with user-visible screenshot controls.
- Local search over indexed files and notes.
- SearXNG-backed web search.
- Local-only media worker surfaces for images, speech, transcription, and video.
- Usage dashboard for requests, tokens, latency, errors, browser actions, and storage.
- Persisted Settings for default mode, SearXNG, browser headless mode, client API key, and dev controls.
- API key auth and explicit LAN/public exposure controls.
- One-command setup on macOS, Windows, and Linux.

## Sub-Agent Ownership

| Sub-Agent | Owns | Done Means |
| --- | --- | --- |
| Product Architect | `GOAL.md`, roadmap, UX boundaries | The repo has a clear spec and task map. |
| Runtime Installer | install scripts, setup CLI, hardware detection | Fresh machines can install and get a working dev/local path. |
| Model Backend | llama.cpp/vLLM/MLX adapters, model presets, HF downloads | Users can download, test, start, stop, and switch local models. |
| Chat/API | persisted chats, OpenAI-compatible APIs, streaming | Chat survives reloads and API clients work reliably. |
| Agent Memory | durable memory, summaries, retrieval, edit/delete | Agents remember useful facts and users can inspect/edit memory. |
| Browser Agent | Playwright sessions, visible control, action logs | Agents and users can safely operate browser sessions. |
| Search | local file indexing, SearXNG web search, citations | Agents/chat can search local and web context with clear results. |
| UI/UX | minimal Chat/Agents/Models/Search/Usage/Settings surfaces | Main UI stays clean; advanced tools live in dev mode. |
| Usage/Observability | dashboard, health checks, logs, export | Users can see what happened and diagnose failures. |
| Security/Permissions | API keys, LAN mode, action gates | Public mode cannot be enabled accidentally. |
| Testing/Release | tests, CI, packaging, migrations | Changes are covered and releasable across OSes. |
| Future Media | image/audio/video adapters | Capability lanes are ready but hidden until reliable. |

## Current Build State

- Bun local server and minimal web UI exist.
- SQLite persistence exists for models, agents, memory, usage, local docs, and browser sessions.
- llama.cpp-compatible chat proxy exists.
- Dev fake LLM streaming exists.
- Main chat can use indexed local search context and persist cited assistant responses.
- Gemma 4 Fast/Balanced/Smart model presets exist.
- Built-in model preset install plus Hugging Face GGUF search/list/download hooks exist.
- Hermes status/config adapter exists.
- Agent memory and run history exist.
- Agent memory CRUD, scored retrieval, summaries, provenance, and compaction exist.
- Agent runs can execute a conservative local tool layer for local search, SearXNG web search, and browser-session creation.
- Manual document indexing, browser file/folder import, dev file-path indexing, local search, and SearXNG adapter exist.
- Playwright browser sessions can open, navigate, screenshot, click, type, press keys, and close.
- Browser action logs and permission gates for agent-originated risky actions exist.
- Usage view exposes a copyable local diagnostics report with readiness, runtime, supervisor, media, model, storage, and recent usage state.
- Persisted app settings exist for default mode, SearXNG URL, browser headless mode, and dev mode.
- The UI has a Settings page and hides advanced controls unless dev mode is enabled.
- Platform-aware install preflight exists for Bun, git, local folders, llama.cpp, Playwright Chromium, and SearXNG.
- macOS/Linux and Windows installer scripts clone the pushed repo, use the lockfile, run setup, and optionally install Playwright Chromium.
- Release packaging creates a source zip, manifest, checksums, and GitHub Actions artifact workflow.
- Media tab, media job records, and local-only image/audio/video API surfaces exist; bundled image command worker, bundled video command worker, bundled transcription worker wrapper, and Whisper model installer exist, while bundled image/video model weights are still future work.
- Hardware-aware media runtime planner exists for local image, speech, transcription, and video worker setup.
- Media worker readiness is health-checked; configured loopback URLs show offline until a local worker responds.
- Recommended media worker loopback URLs can be applied through the UI, API, and CLI without falsely marking workers ready.
- Image generation can run through the bundled local command worker when a local image backend command is configured.
- Video generation can run through the bundled local command worker when a local video backend command is configured.
- Built-in local speech generation exists when the host OS has a supported system speech engine.
- Assistant chat messages can be played through the local speech route.
- Chat microphone input records audio and can transcribe through the configured local transcription worker, including the bundled whisper.cpp-compatible worker wrapper and local Whisper model install path.
- Setup page, `bun run ready`, `bun run setup:actions`, and `bun run src/cli.ts local --dry-run` summarize readiness and expose copyable setup/launch commands, including the local supervisor start/skip plan.
- Launch profile generation exists for machine-specific env, commands, and local launcher scripts that use the local supervisor.
- `bun run local` starts the app, local llama.cpp when `llama` and a local GGUF path are available, and configured bundled local workers from one command.
- One-command setup CLI and install scripts exist.
- CI exists for macOS, Linux, and Windows.

## Priority Order

1. Persist chat conversations in the UI/API.
2. Add API keys and public/LAN exposure guardrails.
3. Add model runtime start/stop/status management.
4. Improve Hugging Face download/test/start flow.
5. Add bundled local media runtimes and hardware-aware media model setup.
