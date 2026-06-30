# API

The app exposes both OpenAI-compatible routes and native app routes.

Base URL:

```text
http://127.0.0.1:3434
```

## Authentication

Local private mode does not require authentication by default. Protected routes require an API key when `NIPUX_API_KEY`, `NIPUX_API_KEYS`, a managed server key, or `NIPUX_PUBLIC_API=1` is set.

Use either header:

```text
Authorization: Bearer <key>
x-api-key: <key>
```

`GET /api/status` and `GET /api/exposure` remain unauthenticated so clients can discover whether auth is required and how the server is exposed. Neither route returns raw API keys. `GET /api/exposure/client` is protected when auth is enabled and can return snippets containing only the key supplied by the current request.

## OpenAI-Compatible

### `GET /v1/models`

Returns Fast, Balanced, Smart model records.

### `POST /v1/chat/completions`

```bash
curl http://127.0.0.1:3434/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "balanced",
    "messages": [{"role": "user", "content": "Write a short local AI plan."}]
  }'
```

Streaming is supported:

```json
{ "stream": true }
```

### `POST /v1/responses`

Basic Responses-style wrapper for text input.

### `POST /v1/images/generations`

Proxies to a configured local OpenAI-compatible image worker. Returns `501` with a Nipux job record when no local image worker is configured.

```json
{
  "prompt": "A quiet local AI workstation",
  "size": "1024x1024",
  "response_format": "b64_json"
}
```

### `POST /v1/audio/speech`

Returns local audio bytes. A configured loopback speech worker is used first. If no speech worker is configured, the app uses built-in local system speech when available.

```bash
curl http://127.0.0.1:3434/v1/audio/speech \
  -H 'content-type: application/json' \
  -o speech.wav \
  -d '{"input":"Local speech works.","voice":"alloy"}'
```

### `POST /v1/audio/transcriptions`

Accepts OpenAI-style multipart audio uploads and sends them to the configured local transcription worker. Returns `501` with a Nipux job record when no local transcription worker is configured.

```bash
curl http://127.0.0.1:3434/v1/audio/transcriptions \
  -F file=@voice.webm \
  -F model=local-transcription
```

## Native Routes

### `GET /api/status`

Hardware profile, llama backend health, persisted settings, SearXNG status, Playwright availability, and generated serve commands.

### `GET /api/readiness`

Returns the everyday setup summary used by the Setup page and `bun run ready`. It aggregates chat, browser agents, voice output/input, image/video workers, web search, local search, and API exposure.

```json
{
  "usable": true,
  "headline": "Ready for local chat. Some optional capabilities may still need setup.",
  "items": [
    { "id": "chat", "label": "Chat", "status": "ready" }
  ],
  "nextSteps": ["Configure a local transcription worker for microphone input."]
}
```

### `GET /api/diagnostics`

Returns a read-only local diagnostics report for the Usage page. The report includes hardware, setup preflight, readiness, capability profile, runtime status, local supervisor dry-run plan, launch commands, media runtime plan, model states, recent usage, storage totals, and redacted auth state. API key values are never returned.

### `GET /api/usage/summary`

Returns the local Usage dashboard data from SQLite: aggregate totals, per-lane breakdowns, model breakdowns, recent errors, and the recent event timeline. The route does not export prompts, audio, images, or API keys; event metadata is the same small operational metadata recorded by local handlers.

### `GET /api/capability-profile`

Returns the consumer-facing machine profile used by the Setup page and `bun run capabilities`. It classifies the machine as minimal CPU, CPU-standard, GPU-accelerated, or high-memory workstation; picks the recommended Fast/Balanced/Smart mode; and marks each lane as default, available, slow, optional, or blocked.

```json
{
  "tier": "cpu-standard",
  "tierLabel": "CPU-standard machine",
  "recommendedPreset": "balanced",
  "defaultLanes": ["chat", "search", "agents", "browser", "speech", "transcription", "api"],
  "blockedLanes": ["image", "video"],
  "commands": {
    "startLocal": "bun run local --open",
    "installModel": "bun run model:install balanced"
  }
}
```

### `GET /api/setup/actions`

Returns structured setup actions used by the Setup page and `bun run setup:actions`. Each action has a status, kind, description, related capability tags, and copyable commands. The response also includes `nextActions`, a ranked short list of non-ready actions that the UI can show before the full setup list.

```json
{
  "actions": [
    {
      "id": "start-llama",
      "label": "Start local chat backend",
      "status": "recommended",
      "kind": "start",
      "commands": [{"label": "Command", "command": "llama serve ...", "copyable": true}]
    }
  ],
  "nextActions": [
    {
      "id": "install-chat-model",
      "label": "Install Balanced chat model",
      "status": "recommended",
      "commands": [{"label": "Review download", "command": "bun run model:plan balanced", "copyable": true}]
    }
  ],
  "summary": { "ready": 4, "recommended": 5, "optional": 3, "blocked": 0 }
}
```

### `GET /api/launch/profile`

Returns the machine-specific launch profile used by the Setup page and `bun run launch:profile`. It includes local UI/API URLs, hardware, selected model, llama.cpp command, media worker health, non-secret env values, local script paths, and clickable launcher file paths rendered by the Setup page.

### `GET /api/launch/supervisor`

Returns the dry-run plan for `bun run local`: the app process, managed local llama.cpp process when `llama` and a local GGUF model path are available, bundled local workers that would start from configured environment variables, whether `--open`/`NIPUX_OPEN_BROWSER=1` would open the browser, skipped processes, and next steps. It never starts processes.

### `GET /api/exposure`

Returns non-secret LAN/public API exposure metadata for the Settings page and setup tooling. It includes the local API URL, detected LAN URLs, bind host, whether public mode is enabled, whether protected routes are locked, API-key counts, copyable private/protected launch commands, OpenAI-compatible client snippets, warnings, and next steps.

```json
{
  "localUrl": "http://127.0.0.1:3434",
  "apiBaseUrl": "http://127.0.0.1:3434/v1",
  "bindHost": "127.0.0.1",
  "publicApi": false,
  "exposedOnLan": false,
  "protected": false,
  "locked": false,
  "auth": {
    "required": false,
    "configured": false,
    "envKeyCount": 0,
    "storedKeyCount": 0,
    "totalKeyCount": 0
  },
  "commands": {
    "privateLocal": "bun run local",
    "protectedLan": "NIPUX_PUBLIC_API=1 bun run local"
  },
  "client": {
    "openaiCompatible": true,
    "baseUrl": "http://127.0.0.1:3434/v1",
    "apiKey": "not-required-for-private-local-mode",
    "authHeader": "",
    "env": "OPENAI_BASE_URL=http://127.0.0.1:3434/v1\nOPENAI_API_KEY=not-required-for-private-local-mode",
    "modelsCurl": "curl 'http://127.0.0.1:3434/v1/models'",
    "chatCurl": "curl 'http://127.0.0.1:3434/v1/chat/completions' \\\n  -H 'content-type: application/json' \\\n  --data '{\"model\":\"balanced\",\"messages\":[{\"role\":\"user\",\"content\":\"Say hello from Nipux.\"}],\"stream\":false}'"
  }
}
```

### `GET /api/exposure/client`

Returns copyable OpenAI-compatible client setup for the current caller. In private localhost mode, it returns the same no-key local snippets. When API auth is enabled, this route is protected by the same `Authorization: Bearer <key>` or `x-api-key` header as other protected routes and includes only the key supplied on that request. The response also includes a redacted copy for UI display.

```json
{
  "openaiCompatible": true,
  "baseUrl": "http://127.0.0.1:3434/v1",
  "apiKey": "npx_example",
  "containsSecret": true,
  "keySource": "request",
  "warning": "These snippets include the API key supplied by this request. Copy them only into clients you control.",
  "env": "OPENAI_BASE_URL=http://127.0.0.1:3434/v1\nOPENAI_API_KEY=npx_example",
  "redacted": {
    "env": "OPENAI_BASE_URL=http://127.0.0.1:3434/v1\nOPENAI_API_KEY=npx_exampl...mple"
  }
}
```

### `POST /api/launch/profile/write`

Writes `launch-profile.json`, `nipux.env`, local launcher scripts, and clickable `.command`, `.cmd`, and `.desktop` launchers under `NIPUX_HOME`, then returns the profile and written file list. This does not write API keys.

### `GET /api/settings`

Returns persisted app settings and non-secret environment status.

```json
{
  "settings": {
    "searxngUrl": "http://127.0.0.1:8888",
    "browserHeadless": true,
    "devMode": false,
    "defaultModelPreset": "balanced",
    "imageWorkerUrl": "http://127.0.0.1:8081",
    "speechWorkerUrl": "http://127.0.0.1:8082",
    "transcriptionWorkerUrl": "http://127.0.0.1:8083",
    "videoWorkerUrl": "http://127.0.0.1:8084"
  },
  "env": {
    "bindHost": "127.0.0.1",
    "publicApi": false,
    "authRequired": false,
    "authConfigured": false,
    "envKeyCount": 0,
    "storedKeyCount": 0
  }
}
```

### `PATCH /api/settings`

```json
{
  "searxngUrl": "http://127.0.0.1:8888",
  "browserHeadless": true,
  "devMode": false,
  "defaultModelPreset": "balanced",
  "imageWorkerUrl": "http://127.0.0.1:8081",
  "speechWorkerUrl": "http://127.0.0.1:8082",
  "transcriptionWorkerUrl": "http://127.0.0.1:8083",
  "videoWorkerUrl": "http://127.0.0.1:8084"
}
```

Environment variables provide boot defaults; saved settings take precedence at runtime.

### `GET /api/api-keys`

Lists managed server API keys without exposing raw key values. Returns labels, prefixes, created timestamps, and last-used timestamps.

### `POST /api/api-keys`

```json
{
  "label": "Laptop client"
}
```

Creates a managed server API key and returns the raw key once. The database stores only a SHA-256 hash plus a short display prefix.

### `DELETE /api/api-keys/:id`

Revokes a managed server API key. Environment keys are controlled only through environment variables.

## Media Routes

Media routes only talk to loopback workers such as `http://127.0.0.1:8081`. Remote URLs are rejected so the product does not silently become an external API wrapper.

### `GET /api/media/capabilities`

Returns image, speech, transcription, and video capability status plus setup hints. A loopback worker URL is `offline` until the local process responds to a health check.

### `GET /api/media/runtimes`

Returns the hardware-aware local media runtime plan. Each runtime includes the capability kind, current worker status, health-check result, default loopback URL, endpoint contract, setting key, environment variable, hardware fit, setup notes, and setup commands.

```json
{
  "runtimes": [
    {
      "kind": "image",
      "status": "unconfigured",
      "defaultUrl": "http://127.0.0.1:8081",
      "endpoint": "/v1/images/generations",
      "envVar": "NIPUX_IMAGE_WORKER_URL",
      "localOnly": true
    }
  ]
}
```

The image runtime can use the bundled local command worker:

```bash
NIPUX_IMAGE_COMMAND=/path/to/local-image-command bun run worker:image
```

The image worker exposes `POST /v1/images/generations` on `http://127.0.0.1:8081`. By default it invokes the local command with `{input} {output}`, where `{input}` is a JSON request file and `{output}` is the image file the command should write. Override `NIPUX_IMAGE_ARGS` for a specific local backend.

### `GET /api/media/images/backends`

Returns hardware-aware local image backend presets. The current presets include a Diffusers SDXL Turbo path, a lighter Diffusers SD 1.5 path, and a custom-command adapter. All presets are local-only and are meant to feed the bundled image command worker. The Media page uses this endpoint to show a compact Local Image Setup guide for the recommended or selected backend.

```json
{
  "recommendedPresetId": "diffusers-sdxl-turbo",
  "presets": [
    {
      "id": "diffusers-sdxl-turbo",
      "label": "Diffusers SDXL Turbo",
      "model": "stabilityai/sdxl-turbo",
      "recommended": true,
      "localOnly": true,
      "install": {
        "installed": false,
        "command": "bun run image:install diffusers-sdxl-turbo"
      }
    }
  ]
}
```

The repo also includes `scripts/image-backends/diffusers-image.py`, which implements the `{input} {output}` command contract for local Diffusers pipelines. Managed Diffusers presets include an `install` object with the current local runtime status, Python path, and one-command installer.

### `POST /api/media/images/backends/select`

Persists a selected image backend preset and sets the image worker URL to the local default. The local supervisor uses the selected preset to populate `NIPUX_IMAGE_COMMAND`, `NIPUX_IMAGE_ARGS`, and `NIPUX_IMAGE_MODEL` when env vars do not override them.

```json
{
  "presetId": "diffusers-sdxl-turbo"
}
```

### `DELETE /api/media/images/backends/selection`

Clears the selected image backend preset and clears the persisted image worker URL.

The video runtime can use the bundled local command worker:

```bash
NIPUX_VIDEO_COMMAND=/path/to/local-video-command bun run worker:video
```

The video worker exposes `POST /v1/video/generations` on `http://127.0.0.1:8084`. By default it invokes the local command with `{input} {output}`, where `{input}` is a JSON request file and `{output}` is the video file the command should write. Override `NIPUX_VIDEO_ARGS` for a specific local backend.

The transcription runtime can use the bundled worker wrapper:

```bash
bun run transcription:install base.en
NIPUX_WHISPER_MODEL="$HOME/.nipux-local-ai/models/whisper.cpp/ggml-base.en.bin" bun run worker:transcription
```

The install command downloads the local Whisper model and prints the exact worker start command. The worker exposes `POST /v1/audio/transcriptions` on `http://127.0.0.1:8083` and invokes a local `whisper-cli` compatible command.

Runtime status values:

- `ready`: built-in local speech is available, or the configured loopback worker responded.
- `offline`: a loopback worker URL is configured, but no local process responded.
- `unconfigured`: no worker URL is set.
- `invalid`: the configured URL is not an allowed loopback HTTP(S) URL.

### `POST /api/media/runtimes/defaults`

Persists recommended default loopback worker URLs such as `http://127.0.0.1:8081`. This does not start model workers and does not mark a lane ready by itself.

```json
{
  "includeOptional": false,
  "overwrite": false,
  "kinds": ["image", "transcription"]
}
```

Returns applied/skipped settings plus a fresh runtime plan.

### `GET /api/media/jobs`

Lists recent media jobs and failed setup attempts.

### `POST /api/media/images/generate`

```json
{
  "prompt": "A local AI control room",
  "size": "1024x1024",
  "response_format": "b64_json"
}
```

### `POST /api/media/audio/speech`

```json
{
  "input": "Local speech generation is ready.",
  "voice": "alloy"
}
```

When no speech worker is configured, this route returns a JSON payload containing base64 audio from the built-in local speech engine if one is available.

### `POST /api/media/audio/transcriptions`

```json
{
  "audioBase64": "...",
  "mime": "audio/wav"
}
```

### `POST /api/media/video/generate`

```json
{
  "prompt": "A four second product demo shot",
  "seconds": 4
}
```

### `GET /api/chats`

Lists persisted chats.

### `POST /api/chats`

```json
{
  "title": "New chat",
  "modelPreset": "balanced"
}
```

### `GET /api/chats/:id`

Returns a chat and its messages.

### `PATCH /api/chats/:id`

```json
{
  "modelPreset": "smart"
}
```

### `POST /api/chats/:id/messages`

```json
{
  "role": "user",
  "content": "Remember this conversation."
}
```

### `POST /api/chats/:id/respond`

Runs the app-native chat flow: persists the user message, searches indexed local documents, uses local SearXNG web search for current/web requests, executes clear local image/speech/video media requests, injects relevant local/web context and media tool activity into the model prompt, streams or returns the assistant response, appends deterministic source/tool lines, and persists the assistant message with any media job ids.

```json
{
  "content": "Search local notes for the launch requirements.",
  "modelPreset": "balanced",
  "stream": true,
  "useLocalSearch": true,
  "useWebSearch": true,
  "useMediaTools": true
}
```

Omit `useWebSearch` to let chat automatically use SearXNG for prompts that ask for web, current, latest, recent, or news context.

Set `stream` to `false` for a JSON response with `output` and `citations`.

### `DELETE /api/chats/:id`

Deletes a persisted chat and messages.

### `GET /api/models`

Local model registry.

### `GET /api/runtime/status`

Returns llama.cpp process state and backend health.

### `POST /api/runtime/start`

```json
{
  "modelPreset": "balanced"
}
```

Starts `llama serve` with the selected preset. Requires `llama` on `PATH`.

### `POST /api/runtime/stop`

Stops the app-managed runtime process.

### `POST /api/runtime/test`

```json
{
  "modelPreset": "balanced",
  "prompt": "Say hello."
}
```

Runs a non-streaming test prompt against the active backend.

### `GET /api/models/hf/search?q=qwen`

Searches Hugging Face GGUF models.

### `GET /api/models/hf/files?repo=owner/name`

Lists GGUF files for a Hugging Face model repo.

### `GET /api/models/install-plan?modelPreset=balanced`

Returns the selected built-in model, chosen GGUF filename, reported download size when available, target path, install command, and llama.cpp start command. Use this before triggering a large model download.

### `POST /api/models/download`

```json
{
  "repo": "Qwen/Qwen3-8B-GGUF",
  "filename": "Qwen3-8B-Q4_K_M.gguf"
}
```

Uses `HF_TOKEN` when present. When the repo is not one of the built-in presets, the downloaded GGUF is registered as a custom local model and returned in the `model` field.

### `POST /api/models/install`

```json
{
  "modelPreset": "balanced"
}
```

Downloads the GGUF file for a built-in preset. If `filename` is omitted, the server lists the preset repository and selects the best `.gguf` file matching the preset quantization. Runtime start commands use the downloaded local path after install.

Set `"dryRun": true` to return the same install plan without downloading:

```json
{
  "modelPreset": "balanced",
  "dryRun": true
}
```

### `POST /api/agents/run`

```json
{
  "input": "Search my local notes for product requirements and summarize them.",
  "agentId": "optional-agent-id",
  "modelPreset": "balanced"
}
```

Runs the local agent with memory and local tool context. The response includes `toolEvents`, `localResults`, `webResults`, any created `browserSessions`, and any created `mediaJobs`. Recent runs returned by `GET /api/agents` include persisted `toolEvents` and resolved `mediaJobs` so clients can render agent-created artifacts after refresh. Natural-language requests for local search, web search, browser use, image generation, speech generation, or video generation are executed through the agent tool layer. Agent browser navigation creates a pending approval instead of navigating immediately. Agent media generation uses only the configured matching local media path; without one, the agent records a failed media job and reports setup guidance. Speech generation can use a local loopback worker or the built-in local system speech fallback when available.

### `GET /api/agents/:id/memories`

Lists active agent memories. Add `?q=query` to search with scored token retrieval. Add `?includeArchived=1` to inspect memories archived by compaction.

### `POST /api/agents/:id/memories`

```json
{
  "kind": "fact",
  "content": "The user prefers local-first defaults.",
  "importance": 4,
  "summary": "Local-first defaults matter."
}
```

Supported kinds are `fact`, `profile`, `procedure`, `task`, and `summary`. The server adds source metadata, token count, timestamps, and a generated summary when one is not provided.

### `POST /api/agents/:id/memories/compact`

```json
{
  "maxSource": 30
}
```

Compacts old active `task` memories into one `summary` memory, archives the source memories, and stores their ids as provenance on the summary.

### `PATCH /api/memories/:id`

```json
{
  "kind": "procedure",
  "content": "Updated memory content.",
  "importance": 5,
  "summary": "Updated procedure."
}
```

### `DELETE /api/memories/:id`

Deletes an agent memory.

### `GET /api/hermes/status`

Detects whether Hermes is installed and returns setup commands for wiring Hermes to the local model backend.

## Browser Sessions

Browser sessions are designed for agents but are also directly controllable from the UI/API. Install Chromium first:

```bash
bun run browsers:install
```

### `GET /api/browsers`

Lists browser sessions.

### `POST /api/browsers`

```json
{
  "label": "Agent Browser",
  "agentId": "optional-agent-id"
}
```

Creates a session without launching Chromium.

### `POST /api/browsers/:id/open`

Launches or attaches to the session.

### `POST /api/browsers/:id/navigate`

```json
{
  "url": "example.com"
}
```

Plain domains are normalized to `https://`.

### `GET /api/browsers/:id/screenshot`

Returns a PNG data URL for the current page.

### `POST /api/browsers/:id/click`

```json
{
  "x": 240,
  "y": 180
}
```

Coordinates are page screenshot pixels.

### `POST /api/browsers/:id/type`

```json
{
  "text": "hello"
}
```

Types into the focused page element.

### `POST /api/browsers/:id/key`

```json
{
  "key": "Enter"
}
```

### `POST /api/browsers/:id/close`

Closes the running browser context and keeps the session record.

Agent-originated `navigate`, `click`, `type`, and `key` actions are gated. Pass `"actor": "agent"` in the request body to create a pending permission request instead of executing immediately. Re-run the action with `permissionRequestId` after approval.

### `GET /api/browser-actions`

Lists browser action events. Optional query params:

```text
sessionId=<browser-session-id>
limit=120
```

### `GET /api/permissions`

Lists permission requests. Optional query param:

```text
status=pending
```

### `POST /api/permissions/:id/approve`

Approves a pending permission request.

### `POST /api/permissions/:id/deny`

Denies a pending permission request.

### `POST /api/search/documents`

Adds text to the local search index.

### `POST /api/search/documents/bulk`

```json
{
  "documents": [
    {
      "title": "notes.md",
      "path": "Research/notes.md",
      "body": "Local text to index"
    }
  ],
  "maxDocuments": 80,
  "maxBytes": 2097152
}
```

Adds browser-selected files or folders to the local search index. The response includes `indexed`, `skipped`, and `errors` arrays so the UI can report what happened without hiding unsupported or oversized files.

### `GET /api/search/documents`

Lists recently indexed local documents.

### `DELETE /api/search/documents/:id`

Deletes an indexed document.

### `POST /api/search/index-path`

```json
{
  "path": "/Users/example/notes",
  "maxFiles": 500,
  "maxBytes": 1048576,
  "recursive": true
}
```

Indexes allow-listed text/code files from a file or folder. The indexer skips common dependency/build/cache folders and overwrites existing indexed rows for the same file path.

### `POST /api/search/local`

Searches indexed local text.

### `POST /api/search/web`

Searches SearXNG when a URL is saved in Settings or provided by `NIPUX_SEARXNG_URL`.

### `GET /api/usage/summary`

Returns aggregate usage plus recent events.
