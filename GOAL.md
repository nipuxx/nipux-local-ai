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
  - Fast: small Qwen-class local model.
  - Balanced: Qwen3 8B Q4_K_M GGUF target.
  - Smart: larger Qwen3 MoE model for strong GPUs/unified memory.
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
- Main chat can use indexed local search context, local SearXNG web search for current/web requests, and persist cited assistant responses.
- Main chat can create agent-owned browser sessions from clear browser/navigation requests, persist the browser session, latest local screenshot preview, and tool events with the assistant message, approve, run, or deny pending browser navigation approvals inline, and inspect/control browser screenshots, URL navigation, typing, and Enter from the chat card.
- Main chat can create local-only image/speech/video media jobs from clear requests and persist generated artifacts with assistant messages.
- The Chat page surfaces a consumer-facing Local Chat Status guide with model/runtime, local/web search context, local voice, API mode, and the next run/install command before users type.
- The Chat page can start an installed local chat model and stop the managed runtime without enabling dev mode.
- Qwen3 Fast/Balanced/Smart model presets exist.
- Built-in model preset install plus Hugging Face GGUF search/list/download hooks exist; arbitrary downloaded GGUF files are registered as selectable custom local models.
- Model install planning and dry-run commands preview the selected GGUF file, reported size, target path, install command, and start command before downloading.
- The Models page previews the same built-in preset install plan before download and reuses the previewed GGUF filename when installing.
- The Models page surfaces a consumer-facing Local Model Setup guide with default mode status, llama.cpp runtime status, and the next install/start command.
- Hermes status/config adapter exists.
- Agent memory and run history exist.
- Agent memory CRUD, scored retrieval, summaries, provenance, and compaction exist.
- Agent runs can execute a conservative local tool layer for local search, SearXNG web search, browser-session creation, and local-only image/speech/video generation jobs.
- The Agents page surfaces a consumer-facing Agent Setup guide with active agent, memory, browser approval/session, and search tool status before the operational controls, and renders agent-created local media job artifacts inline.
- Manual document indexing, browser file/folder import, Search-page local/web readiness guidance, dev file-path indexing, local search, and SearXNG adapter exist.
- Playwright browser sessions can open, navigate, screenshot, click, type, press keys, and close.
- Browser action logs and permission gates for agent-originated risky actions exist.
- Agent browser approvals can show target details, approve and run replayable actions, and only reuse approvals for matching session/agent/action/details.
- Usage view exposes totals, per-lane activity, model usage, recent errors, visible storage breakdown, and a copyable local diagnostics report with readiness, runtime, supervisor, media, model, storage, and recent usage state.
- Persisted app settings exist for default mode, SearXNG URL, browser headless mode, dev mode, and managed hashed server API keys.
- API exposure planning exists for private localhost mode, protected LAN/public mode, key counts, warnings, LAN URLs, copyable launch commands, and OpenAI-compatible client quickstarts.
- Protected authenticated client setup exists so Settings can copy usable OpenAI-compatible env and curl snippets with the browser-held API key while `/api/exposure` remains non-secret discovery metadata.
- Public/native API clients can call one `/api/chat/respond` route to create or reuse a chat and run the same local search, web search, media, and browser tool flow as the Chat UI.
- The UI has a Settings page and hides advanced controls unless dev mode is enabled.
- Platform-aware install preflight exists for Bun, git, local folders, llama.cpp, Playwright Chromium, and SearXNG.
- macOS/Linux and Windows installer scripts clone the pushed repo, use the lockfile, run setup, and optionally install Playwright Chromium.
- Release packaging creates a source zip, manifest, checksums, and GitHub Actions artifact workflow.
- Media tab, media job records, and local-only image/audio/video API surfaces exist; bundled image command worker, bundled video command worker, bundled transcription worker wrapper, and Whisper model installer exist, while bundled image/video model weights are still future work.
- Consumer capability profiling exists for CPU-only, GPU, and high-memory machines, including default/optional/blocked product lanes.
- Hardware-aware media runtime planner exists for local image, speech, transcription, and video worker setup.
- Media worker readiness is health-checked; configured loopback URLs show offline until a local worker responds.
- Recommended media worker loopback URLs can be applied through the UI, API, and CLI without falsely marking workers ready.
- Image generation can run through the bundled local command worker when a local image backend command is configured.
- Hardware-aware local image backend presets exist, including an optional Diffusers command bridge for the image worker, and the Media page surfaces a consumer-facing local image setup guide.
- Image backend preset selection persists to Settings and can be used by `bun run local` when the selected local backend is installed.
- Managed Diffusers image backend presets report install status, expose `bun run image:install <preset>` for local Python runtime setup, and can be prepared through one API/CLI/UI action that selects the backend, persists the loopback worker URL, and returns the next local run steps.
- Video generation can run through the bundled local command worker when a local video backend command is configured.
- The Media page surfaces a consumer-facing local video setup guide that keeps video local-only, opt-in, and backend-command dependent.
- Built-in local speech generation exists when the host OS has a supported system speech engine.
- Assistant chat messages can be played through the local speech route.
- Chat microphone input records audio and can transcribe through the configured local transcription worker, including the bundled whisper.cpp-compatible worker wrapper and local Whisper model install path.
- The Media page surfaces a consumer-facing local voice setup guide for built-in speech output and bundled Whisper transcription setup.
- Setup page, `bun run ready`, `bun run capabilities`, `bun run setup:actions`, and `bun run src/cli.ts local --dry-run` summarize readiness, hardware capability, and copyable setup/launch commands, including the local supervisor start/skip plan.
- The Setup page surfaces a ranked next setup action before the detailed readiness and capability sections.
- `bun run setup:prepare`, `POST /api/setup/prepare`, and the Setup page Prepare Local App action run safe first-run preparation: local folders, first-run model default alignment, recommended managed image backend selection, launcher writing, and refreshed readiness/supervisor state without heavyweight downloads by default.
- Launch profile generation exists for machine-specific env, commands, local launcher scripts, and clickable launcher files that use the local supervisor and open the private local UI; the Setup page shows those launcher paths with copy actions.
- `bun run local --open` starts the app, opens the browser UI, starts local llama.cpp when `llama` and a local GGUF path are available, and starts configured bundled local workers from one command; `bun run local` remains available for server-only launches.
- One-command setup CLI and install scripts exist.
- CI exists for macOS, Linux, and Windows.

## Priority Order

1. Persist chat conversations in the UI/API.
2. Harden API keys and public/LAN exposure guardrails.
3. Add model runtime start/stop/status management.
4. Improve Hugging Face download/test/start flow.
5. Add bundled local media runtimes and hardware-aware media model setup.
