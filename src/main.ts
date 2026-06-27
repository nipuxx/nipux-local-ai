import { existsSync } from "node:fs";
import { join } from "node:path";
import { APP_NAME, IS_DEV_UI, IS_FAKE_LLM, LLAMA_BASE_URL, PORT, SEARXNG_URL, WEB_DIR } from "./config.ts";
import { chatCompletion, estimateMessageTokens, testLlamaBackend } from "./providers/llamaCpp.ts";
import { createAgent, listAgentRuns, listAgents, runAgent } from "./services/agents.ts";
import {
  clickBrowserSession,
  closeBrowserSession,
  createBrowserSession,
  isPlaywrightAvailable,
  listBrowserSessions,
  navigateBrowserSession,
  openBrowserSession,
  pressBrowserKey,
  screenshotBrowserSession,
  typeInBrowserSession,
} from "./services/browserBroker.ts";
import { getHermesStatus } from "./services/hermes.ts";
import { detectHardware } from "./services/hardware.ts";
import {
  downloadHuggingFaceFile,
  listHuggingFaceFiles,
  listModels,
  llamaServeCommand,
  searchHuggingFace,
} from "./services/modelRegistry.ts";
import { addLocalDocument, localSearch, webSearch } from "./services/search.ts";
import { getUsageSummary, getUsageTimeline, recordUsage } from "./services/usage.ts";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    return {} as T;
  }
}

async function staticFile(pathname: string) {
  const filePath = pathname === "/" ? join(WEB_DIR, "index.html") : join(WEB_DIR, pathname.replace(/^\/+/, ""));
  if (!existsSync(filePath)) return null;
  return new Response(Bun.file(filePath));
}

async function handleOpenAiChat(req: Request) {
  const started = Date.now();
  const body = await readJson<{ model?: string; messages?: Array<{ role: string; content: string }>; stream?: boolean }>(req);
  if (!Array.isArray(body.messages)) return json({ error: { message: "messages must be an array" } }, 400);
  try {
    const res = await chatCompletion({
      ...body,
      messages: body.messages.map((message) => ({ role: message.role as never, content: message.content })),
    });
    recordUsage({
      kind: "chat",
      model: body.model ?? "balanced",
      tokensIn: estimateMessageTokens(body.messages.map((message) => ({ role: message.role as never, content: message.content }))),
      latencyMs: Date.now() - started,
      status: "ok",
      meta: { stream: Boolean(body.stream) },
    });
    for (const [key, value] of Object.entries(corsHeaders)) res.headers.set(key, value);
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordUsage({ kind: "chat", model: body.model, latencyMs: Date.now() - started, status: "error", meta: { error: message } });
    return json({ error: { message } }, 503);
  }
}

async function handleResponses(req: Request) {
  const body = await readJson<{ model?: string; input?: string | Array<{ role?: string; content?: string }> }>(req);
  const input = typeof body.input === "string" ? body.input : (body.input ?? []).map((item) => item.content ?? "").join("\n");
  const chatReq = new Request(req.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: body.model, messages: [{ role: "user", content: input }], stream: false }),
  });
  const res = await handleOpenAiChat(chatReq);
  if (!res.ok) return res;
  const payload = await res.json();
  const outputText = payload.choices?.[0]?.message?.content ?? "";
  return json({
    id: `resp-${crypto.randomUUID()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model: body.model ?? "balanced",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: outputText }] }],
  });
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  if (url.pathname === "/api/status") {
    const [hardware, llama, playwright, hermes] = await Promise.all([
      detectHardware(),
      testLlamaBackend(),
      isPlaywrightAvailable(),
      getHermesStatus(),
    ]);
    return json({
      app: APP_NAME,
      fakeLlm: IS_FAKE_LLM,
      devUi: IS_DEV_UI,
      llamaBaseUrl: LLAMA_BASE_URL,
      searxngConfigured: Boolean(SEARXNG_URL),
      hardware,
      llama,
      hermes,
      playwright,
      serveCommands: {
        fast: llamaServeCommand("fast"),
        balanced: llamaServeCommand("balanced"),
        smart: llamaServeCommand("smart"),
      },
    });
  }

  if (url.pathname === "/api/models" && req.method === "GET") return json({ models: listModels() });
  if (url.pathname === "/api/models/test" && req.method === "POST") {
    const body = await readJson<{ baseUrl?: string }>(req);
    return json(await testLlamaBackend(body.baseUrl));
  }
  if (url.pathname === "/api/models/hf/search" && req.method === "GET") {
    return json({ results: await searchHuggingFace(url.searchParams.get("q") ?? "") });
  }
  if (url.pathname === "/api/models/hf/files" && req.method === "GET") {
    const repo = url.searchParams.get("repo");
    if (!repo) return json({ error: "repo is required" }, 400);
    return json({ files: await listHuggingFaceFiles(repo) });
  }
  if (url.pathname === "/api/models/download" && req.method === "POST") {
    const body = await readJson<{ repo?: string; filename?: string }>(req);
    if (!body.repo || !body.filename) return json({ error: "repo and filename are required" }, 400);
    return json(await downloadHuggingFaceFile(body.repo, body.filename));
  }

  if (url.pathname === "/api/search/local" && req.method === "POST") {
    const body = await readJson<{ query?: string }>(req);
    return json({ results: localSearch(body.query ?? "") });
  }
  if (url.pathname === "/api/search/web" && req.method === "POST") {
    const body = await readJson<{ query?: string }>(req);
    return json({ results: await webSearch(body.query ?? "") });
  }
  if (url.pathname === "/api/search/documents" && req.method === "POST") {
    const body = await readJson<{ title?: string; body?: string; path?: string }>(req);
    if (!body.title || !body.body) return json({ error: "title and body are required" }, 400);
    return json({ id: addLocalDocument(body.title, body.body, body.path) });
  }

  if (url.pathname === "/api/agents" && req.method === "GET") return json({ agents: listAgents(), runs: listAgentRuns() });
  if (url.pathname === "/api/hermes/status" && req.method === "GET") {
    return json(await getHermesStatus(url.searchParams.get("model") ?? "balanced"));
  }
  if (url.pathname === "/api/agents" && req.method === "POST") {
    const body = await readJson<{ name?: string; modelPreset?: string }>(req);
    return json({ agent: createAgent(body.name ?? "Agent", body.modelPreset ?? "balanced") });
  }
  if (url.pathname === "/api/agents/run" && req.method === "POST") {
    const body = await readJson<{ input?: string; agentId?: string; modelPreset?: string }>(req);
    if (!body.input) return json({ error: "input is required" }, 400);
    return json(await runAgent(body.input, body.agentId, body.modelPreset));
  }

  if (url.pathname === "/api/browsers" && req.method === "GET") return json({ sessions: listBrowserSessions() });
  if (url.pathname === "/api/browsers" && req.method === "POST") {
    const body = await readJson<{ agentId?: string; label?: string }>(req);
    return json({ session: createBrowserSession(body.agentId, body.label) });
  }
  const browserAction = url.pathname.match(/^\/api\/browsers\/([^/]+)\/(open|navigate|screenshot|click|type|key|close)$/);
  if (browserAction) {
    const [, id, action] = browserAction;
    try {
      if (action === "open" && req.method === "POST") return json({ session: await openBrowserSession(id) });
      if (action === "navigate" && req.method === "POST") {
        const body = await readJson<{ url?: string }>(req);
        if (!body.url) return json({ error: "url is required" }, 400);
        return json({ session: await navigateBrowserSession(id, body.url) });
      }
      if (action === "screenshot" && req.method === "GET") return json(await screenshotBrowserSession(id));
      if (action === "click" && req.method === "POST") {
        const body = await readJson<{ x?: number; y?: number }>(req);
        if (typeof body.x !== "number" || typeof body.y !== "number") return json({ error: "x and y are required" }, 400);
        return json({ session: await clickBrowserSession(id, body.x, body.y) });
      }
      if (action === "type" && req.method === "POST") {
        const body = await readJson<{ text?: string }>(req);
        if (typeof body.text !== "string") return json({ error: "text is required" }, 400);
        return json({ session: await typeInBrowserSession(id, body.text) });
      }
      if (action === "key" && req.method === "POST") {
        const body = await readJson<{ key?: string }>(req);
        if (!body.key) return json({ error: "key is required" }, 400);
        return json({ session: await pressBrowserKey(id, body.key) });
      }
      if (action === "close" && req.method === "POST") return json({ session: await closeBrowserSession(id) });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  if (url.pathname === "/api/usage/summary") return json({ summary: getUsageSummary(), timeline: getUsageTimeline() });

  if (url.pathname === "/v1/models") {
    return json({
      object: "list",
      data: listModels().map((model) => {
        const { id, ...rest } = model;
        return { id, object: "model", owned_by: "nipux-local-ai", ...rest };
      }),
    });
  }
  if (url.pathname === "/v1/chat/completions" && req.method === "POST") return handleOpenAiChat(req);
  if (url.pathname === "/v1/responses" && req.method === "POST") return handleResponses(req);
  if (url.pathname === "/v1/images/generations") {
    return json({ error: { message: "Image generation is intentionally disabled in the first LLM-only build." } }, 501);
  }

  const file = await staticFile(url.pathname);
  if (file) return file;
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  Bun.serve({ port: PORT, fetch: route });
  console.log(`${APP_NAME} is running at http://127.0.0.1:${PORT}`);
  if (IS_FAKE_LLM) console.log("Dev fake LLM is enabled.");
}
