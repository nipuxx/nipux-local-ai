# API

The app exposes both OpenAI-compatible routes and native app routes.

Base URL:

```text
http://127.0.0.1:3434
```

## Authentication

Local private mode does not require authentication by default. Protected routes require an API key when either `NIPUX_API_KEY`, `NIPUX_API_KEYS`, or `NIPUX_PUBLIC_API=1` is set.

Use either header:

```text
Authorization: Bearer <key>
x-api-key: <key>
```

`GET /api/status` remains unauthenticated so clients can discover whether auth is required.

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

## Native Routes

### `GET /api/status`

Hardware profile, llama backend health, persisted settings, SearXNG status, Playwright availability, and generated serve commands.

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
    "authConfigured": false
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

## Media Routes

Media routes only talk to loopback workers such as `http://127.0.0.1:8081`. Remote URLs are rejected so the product does not silently become an external API wrapper.

### `GET /api/media/capabilities`

Returns image, speech, transcription, and video capability status plus setup hints.

### `GET /api/media/runtimes`

Returns the hardware-aware local media runtime plan. Each runtime includes the capability kind, current worker status, default loopback URL, endpoint contract, setting key, environment variable, hardware fit, and setup notes.

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

### `GET /api/models/hf/search?q=gemma`

Searches Hugging Face GGUF models.

### `GET /api/models/hf/files?repo=owner/name`

Lists GGUF files for a Hugging Face model repo.

### `POST /api/models/download`

```json
{
  "repo": "google/gemma-4-12B-it-qat-q4_0-gguf",
  "filename": "model.gguf"
}
```

Uses `HF_TOKEN` when present.

### `POST /api/agents/run`

```json
{
  "input": "Search my local notes for product requirements and summarize them.",
  "modelPreset": "balanced"
}
```

Runs the local agent with memory and search context.

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
