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
- Validate Bun, git, llama.cpp, Playwright Chromium, SearXNG, and model directories through preflight.
- Maintain the user-facing readiness summary for the Setup page and `bun run ready`.
- Maintain structured setup actions for copyable install/start/configure commands.
- Maintain launch profile, env, local supervisor, and launcher script generation for local/dev runs, including managed llama.cpp startup when local model prerequisites are present.
- Maintain the consumer capability profile that decides default, optional, slow, and blocked lanes for each hardware tier.
- Detect OS, RAM, GPU vendor, and recommended mode.
- Keep Docker out of the required path.
- Produce human-readable setup failures.

## Model Backend Agent

- Manage llama.cpp runtime status and process lifecycle.
- Add start/stop endpoints for local model serving.
- Maintain built-in preset install so everyday users do not need Hugging Face search first.
- Keep Hugging Face model discovery/download/test reliable.
- Add backend adapters later for vLLM and MLX.
- Track model disk usage and runnable state.

## Chat/API Agent

- Persist chats and messages.
- Maintain app-native chat retrieval and source citations over indexed local content.
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
- Maintain natural-language browser-session creation from agent runs.
- Add permission gates for risky actions.
- Add visible-browser mode and screenshot mode without confusing users.

## Search Agent

- Maintain consumer browser file/folder import and dev backend path indexing.
- Add PDF, Markdown, text, and doc ingestion.
- Maintain agent tool activity for local and web search.
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

- Maintain API key management.
- Keep public/LAN mode off unless explicitly enabled.
- Maintain API exposure warnings, discovery metadata, and copyable private/protected launch commands.
- Add user approvals for purchases, posting, downloads/uploads, credentials, destructive actions, and file writes/deletes.

## Testing/Release Agent

- Expand unit and API tests.
- Add browser tests that can run in CI.
- Add migration tests.
- Keep macOS/Linux/Windows CI green.
- Maintain release packaging, checksums, manifests, and update paths.

## Future Media Agent

- Keep image/audio/video API surfaces separate from the LLM-first path.
- Maintain local-only image, speech, transcription, and video worker APIs.
- Maintain the hardware-aware media runtime planner, default worker ports, endpoint contracts, and setup guidance.
- Maintain health checks so configured worker URLs only show ready when local processes respond.
- Maintain built-in local speech fallback while keeping Kokoro/Piper-style workers as the higher-quality replaceable path.
- Maintain the bundled local image command worker and hardware-aware image backend presets; bundled image model setup remains opt-in while install/runtime/licensing details vary by backend.
- Maintain the bundled whisper.cpp-compatible transcription worker and Whisper model setup automation; binary setup automation remains future work.
- Add Kokoro/Piper setup automation after worker APIs are stable.
- Maintain the bundled local video command worker; bundled video model setup remains future work and should stay queued, opt-in, and hardware-aware.
