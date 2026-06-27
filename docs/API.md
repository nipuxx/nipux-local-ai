# API

The app exposes both OpenAI-compatible routes and native app routes.

Base URL:

```text
http://127.0.0.1:3434
```

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

### `GET /api/models`

Local model registry.

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

### `POST /api/search/documents`

Adds text to the local search index.

### `POST /api/search/local`

Searches indexed local text.

### `POST /api/search/web`

Searches SearXNG when `NIPUX_SEARXNG_URL` is configured.

### `GET /api/usage/summary`

Returns aggregate usage plus recent events.
