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
- Image/audio/video are future capability lanes; the working baseline remains LLM-first until the core app is reliable.

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
- Usage dashboard for requests, tokens, latency, errors, browser actions, and storage.
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
- Gemma 4 Fast/Balanced/Smart model presets exist.
- Hugging Face GGUF search/list/download hooks exist.
- Hermes status/config adapter exists.
- Agent memory and run history exist.
- Agent memory CRUD and scored retrieval exist.
- Manual document indexing, file/folder indexing, local search, and SearXNG adapter exist.
- Playwright browser sessions can open, navigate, screenshot, click, type, press keys, and close.
- One-command setup CLI and install scripts exist.
- CI exists for macOS, Linux, and Windows.

## Priority Order

1. Persist chat conversations in the UI/API.
2. Add API keys and public/LAN exposure guardrails.
3. Add model runtime start/stop/status management.
4. Improve Hugging Face download/test/start flow.
5. Add memory summarization/compaction and provenance.
6. Add better browser action logs and permission gates.
7. Add Settings and Dev mode surfaces.
8. Improve install reliability on Windows/Linux/macOS.
9. Add release packaging.
10. Add media lanes only after the LLM-first product is solid.
