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

Returns `501` in v0.1 because this build is LLM-only.

## Native Routes

### `GET /api/status`

Hardware profile, llama backend health, SearXNG status, Playwright availability, and generated serve commands.

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

Lists agent memories. Add `?q=query` to search with scored token retrieval.

### `POST /api/agents/:id/memories`

```json
{
  "kind": "fact",
  "content": "The user prefers local-first defaults.",
  "importance": 4
}
```

### `PATCH /api/memories/:id`

```json
{
  "kind": "procedure",
  "content": "Updated memory content.",
  "importance": 5
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

Searches SearXNG when `NIPUX_SEARXNG_URL` is configured.

### `GET /api/usage/summary`

Returns aggregate usage plus recent events.
