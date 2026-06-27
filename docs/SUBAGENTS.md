# Sub-Agent Execution Map

This file translates the product goal into independently owned workstreams. The app is one codebase, but these boundaries keep work from collapsing into a cluttered all-in-one tool.

## Product Architect Agent

- Maintain `GOAL.md`.
- Keep the main UI minimal.
- Decide which features are default, advanced, or dev-only.
- Keep Fast / Balanced / Smart model semantics consistent.
- Prevent local-first behavior from depending on external APIs.

## Runtime Installer Agent

- Maintain `scripts/install.sh`, `scripts/install.ps1`, and the setup CLI.
- Validate Bun, git, llama.cpp, Playwright Chromium, and model directories.
- Detect OS, RAM, GPU vendor, and recommended mode.
- Keep Docker out of the required path.
- Produce human-readable setup failures.

## Model Backend Agent

- Manage llama.cpp runtime status and process lifecycle.
- Add start/stop endpoints for local model serving.
- Keep Hugging Face model discovery/download/test reliable.
- Add backend adapters later for vLLM and MLX.
- Track model disk usage and runnable state.

## Chat/API Agent

- Persist chats and messages.
- Keep `/v1/chat/completions`, `/v1/responses`, and `/v1/models` compatible enough for real local clients.
- Support streaming.
- Add API keys and LAN/public mode behavior.
- Add API docs and examples.

## Agent Memory Agent

- Maintain scored memory retrieval.
- Maintain memory summarization, compaction, and archived-source provenance.
- Keep editable memory UI simple.
- Keep Hermes/internal agents using the same memory database.
- Add stronger semantic retrieval later.

## Browser Agent

- Keep Playwright sessions reliable.
- Add browser action logs.
- Add agent/session assignment.
- Add permission gates for risky actions.
- Add visible-browser mode and screenshot mode without confusing users.

## Search Agent

- Add file/folder indexing.
- Add PDF, Markdown, text, and doc ingestion.
- Improve SearXNG setup and status checks.
- Add result citations for chat/agent answers.
- Add semantic/vector search later.

## UI/UX Agent

- Keep the first screen useful, not a landing page.
- Make Chat, Agents, Models, Search, Usage, and Settings polished.
- Keep advanced options behind a dev toggle.
- Ensure responsive layout works on laptop and mobile widths.

## Usage/Observability Agent

- Track request counts, tokens, latency, errors, model usage, browser actions, storage, and backend health.
- Add exportable diagnostics.
- Make failures visible without dumping raw logs into the main UI.

## Security/Permissions Agent

- Add API key management.
- Keep public/LAN mode off unless explicitly enabled.
- Add warnings and health checks for exposed bind addresses.
- Add user approvals for purchases, posting, downloads/uploads, credentials, destructive actions, and file writes/deletes.

## Testing/Release Agent

- Expand unit and API tests.
- Add browser tests that can run in CI.
- Add migration tests.
- Keep macOS/Linux/Windows CI green.
- Add release packaging and update paths.

## Future Media Agent

- Keep image/audio/video API surfaces separate from the LLM-first path.
- Add local image generation only when install/runtime/licensing details are clear.
- Add Whisper.cpp and Kokoro/Piper after core chat/agents/search are solid.
- Add video generation last.
