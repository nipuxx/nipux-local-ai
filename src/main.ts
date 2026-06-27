import { existsSync } from "node:fs";
import { join } from "node:path";
import { deleteDocument, listLocalDocuments } from "./db.ts";
import {
  API_KEYS,
  APP_NAME,
  BIND_HOST,
  IS_DEV_UI,
  IS_FAKE_LLM,
  LLAMA_BASE_URL,
  PORT,
  PUBLIC_API,
  WEB_DIR,
} from "./config.ts";
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
import {
  listBrowserActionEvents,
  listPermissionRequests,
  PermissionRequiredError,
  resolvePermissionRequest,
  type BrowserActor,
  type PermissionStatus,
} from "./services/browserAudit.ts";
import { addChatMessage, createChat, deleteChat, getChat, listChatMessages, listChats, updateChatModel } from "./services/chats.ts";
import { indexPath } from "./services/fileIndexer.ts";
import { getHermesStatus } from "./services/hermes.ts";
import { detectHardware } from "./services/hardware.ts";
import { getLaunchProfile, writeLaunchProfileFiles } from "./services/launchProfile.ts";
import {
  generateImage,
  generateSpeech,
  generateVideo,
  getMediaCapabilities,
  listMediaJobs,
  MediaUnavailableError,
  transcribeAudio,
  type MediaKind,
  type MediaJob,
} from "./services/media.ts";
import { applyRecommendedMediaRuntimeDefaults, getMediaRuntimePlan } from "./services/mediaRuntimes.ts";
import {
  createAgentMemory,
  compactAgentMemories,
  deleteAgentMemory,
  listAgentMemories,
  searchAgentMemoriesScored,
  updateAgentMemory,
} from "./services/memory.ts";
import {
  downloadHuggingFaceFile,
  listHuggingFaceFiles,
  listModels,
  llamaServeCommand,
  searchHuggingFace,
} from "./services/modelRegistry.ts";
import { getRuntimeStatus, startModelRuntime, stopModelRuntime, testModelPrompt } from "./services/modelRuntime.ts";
import { getReadinessReport } from "./services/readiness.ts";
import { addLocalDocument, localSearch, webSearch } from "./services/search.ts";
import { getAppSettings, getSettingsStatus, updateAppSettings, type AppSettings } from "./services/settings.ts";
import { getUsageSummary, getUsageTimeline, recordUsage } from "./services/usage.ts";

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,x-api-key",
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

function browserContext(body: { actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }) {
  return {
    actor: body.actor === "agent" ? ("agent" as BrowserActor) : ("user" as BrowserActor),
    agentId: body.agentId,
    reason: body.reason,
    permissionRequestId: body.permissionRequestId,
  };
}

function tokenFromRequest(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (apiKey) return apiKey.trim();
  const auth = req.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function authRequired(pathname: string) {
  if (pathname === "/api/status") return false;
  return pathname.startsWith("/api/") || pathname.startsWith("/v1/");
}

export function authorizeRequest(
  req: Request,
  pathname: string,
  config: { apiKeys?: string[]; publicApi?: boolean } = {},
) {
  const apiKeys = config.apiKeys ?? API_KEYS;
  const publicApi = config.publicApi ?? PUBLIC_API;
  const required = apiKeys.length > 0 || publicApi;
  if (!required || !authRequired(pathname)) return { ok: true, required };
  if (publicApi && apiKeys.length === 0) {
    return {
      ok: false,
      required,
      status: 403,
      message: "Public API mode requires NIPUX_API_KEY or NIPUX_API_KEYS before protected routes are available.",
    };
  }
  const token = tokenFromRequest(req);
  if (apiKeys.includes(token)) return { ok: true, required };
  return { ok: false, required, status: 401, message: "Missing or invalid Nipux API key." };
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

function mediaError(error: unknown) {
  if (error instanceof MediaUnavailableError) {
    return json({ error: error.message, job: publicMediaJob(error.job) }, error.status);
  }
  return json({ error: error instanceof Error ? error.message : String(error) }, 502);
}

function openAiMediaError(error: unknown) {
  if (error instanceof MediaUnavailableError) {
    return json({ error: { message: error.message }, nipux: { job: publicMediaJob(error.job) } }, error.status);
  }
  return json({ error: { message: error instanceof Error ? error.message : String(error) } }, 502);
}

function scrubLargeFields(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item === "string" && /base64/i.test(key)) return [key, `[${item.length} chars omitted]`];
      if (typeof item === "string" && /audio/i.test(key) && item.length > 120) {
        return [key, `[${item.length} chars omitted]`];
      }
      return [key, item];
    }),
  );
}

function publicMediaJob(job: MediaJob): MediaJob {
  return {
    ...job,
    input: scrubLargeFields(job.input),
    output: scrubLargeFields(job.output),
  };
}

function audioResponse(result: unknown) {
  const payload = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const base64 = typeof payload.base64 === "string" ? payload.base64 : "";
  const mime = typeof payload.mime === "string" ? payload.mime : "audio/wav";
  if (!base64) return json({ error: { message: "Speech backend did not return base64 audio." } }, 502);
  return new Response(Buffer.from(base64, "base64"), {
    headers: {
      ...corsHeaders,
      "content-type": mime,
    },
  });
}

async function readTranscriptionInput(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return { error: "file is required" };
    const buffer = Buffer.from(await file.arrayBuffer());
    return {
      audioBase64: buffer.toString("base64"),
      mime: file.type || "audio/webm",
      language: typeof form.get("language") === "string" ? String(form.get("language")) : undefined,
      prompt: typeof form.get("prompt") === "string" ? String(form.get("prompt")) : undefined,
      model: typeof form.get("model") === "string" ? String(form.get("model")) : undefined,
    };
  }
  const body = await readJson<{ audioBase64?: string; mime?: string; language?: string; prompt?: string; model?: string }>(req);
  return body;
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  const auth = authorizeRequest(req, url.pathname);
  if (!auth.ok) return json({ error: auth.message }, auth.status ?? 401);

  if (url.pathname === "/api/status") {
    const settings = getAppSettings();
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
      bindHost: BIND_HOST,
      publicApi: PUBLIC_API,
      auth: {
        required: API_KEYS.length > 0 || PUBLIC_API,
        configured: API_KEYS.length > 0,
      },
      settings,
      llamaBaseUrl: LLAMA_BASE_URL,
      searxngConfigured: Boolean(settings.searxngUrl),
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

  if (url.pathname === "/api/settings" && req.method === "GET") return json(getSettingsStatus());
  if (url.pathname === "/api/settings" && req.method === "PATCH") {
    const body = await readJson<Partial<AppSettings>>(req);
    return json({ settings: updateAppSettings(body), env: getSettingsStatus().env });
  }
  if (url.pathname === "/api/readiness" && req.method === "GET") return json(await getReadinessReport());
  if (url.pathname === "/api/launch/profile" && req.method === "GET") return json(await getLaunchProfile());
  if (url.pathname === "/api/launch/profile/write" && req.method === "POST") return json(await writeLaunchProfileFiles());

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
  if (url.pathname === "/api/runtime/status" && req.method === "GET") return json(await getRuntimeStatus());
  if (url.pathname === "/api/runtime/start" && req.method === "POST") {
    const body = await readJson<{ modelPreset?: string }>(req);
    try {
      return json(await startModelRuntime(body.modelPreset ?? getAppSettings().defaultModelPreset));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }
  if (url.pathname === "/api/runtime/stop" && req.method === "POST") return json(await stopModelRuntime());
  if (url.pathname === "/api/runtime/test" && req.method === "POST") {
    const body = await readJson<{ prompt?: string; modelPreset?: string }>(req);
    if (!body.prompt) return json({ error: "prompt is required" }, 400);
    try {
      return json(await testModelPrompt(body.prompt, body.modelPreset ?? getAppSettings().defaultModelPreset));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  if (url.pathname === "/api/chats" && req.method === "GET") return json({ chats: listChats() });
  if (url.pathname === "/api/chats" && req.method === "POST") {
    const body = await readJson<{ title?: string; modelPreset?: string }>(req);
    return json({ chat: createChat(body.modelPreset ?? getAppSettings().defaultModelPreset, body.title ?? "New chat") });
  }
  const chatMessagesMatch = url.pathname.match(/^\/api\/chats\/([^/]+)\/messages$/);
  if (chatMessagesMatch) {
    const [, chatId] = chatMessagesMatch;
    try {
      if (req.method === "GET") return json({ chat: getChat(chatId), messages: listChatMessages(chatId) });
      if (req.method === "POST") {
        const body = await readJson<{ role?: string; content?: string }>(req);
        if (!body.role || !body.content) return json({ error: "role and content are required" }, 400);
        if (!["system", "user", "assistant", "tool"].includes(body.role)) return json({ error: "invalid role" }, 400);
        return json({ message: addChatMessage(chatId, body.role as never, body.content), chat: getChat(chatId) });
      }
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  }
  const chatMatch = url.pathname.match(/^\/api\/chats\/([^/]+)$/);
  if (chatMatch) {
    const [, chatId] = chatMatch;
    try {
      if (req.method === "GET") return json({ chat: getChat(chatId), messages: listChatMessages(chatId) });
      if (req.method === "PATCH") {
        const body = await readJson<{ modelPreset?: string }>(req);
        if (!body.modelPreset) return json({ error: "modelPreset is required" }, 400);
        return json({ chat: updateChatModel(chatId, body.modelPreset) });
      }
      if (req.method === "DELETE") return json(deleteChat(chatId));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  }

  if (url.pathname === "/api/search/local" && req.method === "POST") {
    const body = await readJson<{ query?: string }>(req);
    return json({ results: localSearch(body.query ?? "") });
  }
  if (url.pathname === "/api/search/documents" && req.method === "GET") return json({ documents: listLocalDocuments() });
  const documentMatch = url.pathname.match(/^\/api\/search\/documents\/(\d+)$/);
  if (documentMatch && req.method === "DELETE") return json(deleteDocument(Number(documentMatch[1])));
  if (url.pathname === "/api/search/web" && req.method === "POST") {
    const body = await readJson<{ query?: string }>(req);
    return json({ results: await webSearch(body.query ?? "") });
  }
  if (url.pathname === "/api/search/documents" && req.method === "POST") {
    const body = await readJson<{ title?: string; body?: string; path?: string }>(req);
    if (!body.title || !body.body) return json({ error: "title and body are required" }, 400);
    return json({ id: addLocalDocument(body.title, body.body, body.path) });
  }
  if (url.pathname === "/api/search/index-path" && req.method === "POST") {
    const body = await readJson<{ path?: string; maxFiles?: number; maxBytes?: number; recursive?: boolean }>(req);
    if (!body.path) return json({ error: "path is required" }, 400);
    const started = Date.now();
    try {
      const result = await indexPath(body.path, {
        maxFiles: body.maxFiles,
        maxBytes: body.maxBytes,
        recursive: body.recursive,
      });
      recordUsage({
        kind: "search",
        latencyMs: Date.now() - started,
        status: "ok",
        meta: { action: "index-path", path: body.path, indexed: result.indexed, skipped: result.skipped, errors: result.errors.length },
      });
      return json(result);
    } catch (error) {
      recordUsage({
        kind: "search",
        latencyMs: Date.now() - started,
        status: "error",
        meta: { action: "index-path", path: body.path, error: error instanceof Error ? error.message : String(error) },
      });
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  if (url.pathname === "/api/agents" && req.method === "GET") return json({ agents: listAgents(), runs: listAgentRuns() });
  if (url.pathname === "/api/hermes/status" && req.method === "GET") {
    return json(await getHermesStatus(url.searchParams.get("model") ?? "balanced"));
  }
  if (url.pathname === "/api/agents" && req.method === "POST") {
    const body = await readJson<{ name?: string; modelPreset?: string }>(req);
    return json({ agent: createAgent(body.name ?? "Agent", body.modelPreset ?? getAppSettings().defaultModelPreset) });
  }
  if (url.pathname === "/api/agents/run" && req.method === "POST") {
    const body = await readJson<{ input?: string; agentId?: string; modelPreset?: string }>(req);
    if (!body.input) return json({ error: "input is required" }, 400);
    return json(await runAgent(body.input, body.agentId, body.modelPreset));
  }
  const agentMemoryCompactMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/memories\/compact$/);
  if (agentMemoryCompactMatch && req.method === "POST") {
    const [, agentId] = agentMemoryCompactMatch;
    const body = await readJson<{ maxSource?: number }>(req);
    return json(compactAgentMemories(agentId, body.maxSource));
  }
  const agentMemoryMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/memories$/);
  if (agentMemoryMatch) {
    const [, agentId] = agentMemoryMatch;
    if (req.method === "GET") {
      const query = url.searchParams.get("q") ?? "";
      const includeArchived = url.searchParams.get("includeArchived") === "1";
      const memories = query
        ? searchAgentMemoriesScored(agentId, query, 80)
        : listAgentMemories(agentId, 80, { includeArchived });
      return json({ memories });
    }
    if (req.method === "POST") {
      const body = await readJson<{
        kind?: "profile" | "task" | "procedure" | "fact" | "summary";
        content?: string;
        importance?: number;
        summary?: string;
      }>(req);
      if (!body.content?.trim()) return json({ error: "content is required" }, 400);
      return json({
        memory: createAgentMemory({
          agentId,
          kind: body.kind,
          content: body.content,
          importance: body.importance,
          summary: body.summary,
        }),
      });
    }
  }
  const memoryMatch = url.pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (memoryMatch) {
    const [, id] = memoryMatch;
    try {
      if (req.method === "PATCH") {
        const body = await readJson<{
          kind?: "profile" | "task" | "procedure" | "fact" | "summary";
          content?: string;
          importance?: number;
          summary?: string;
        }>(req);
        return json({ memory: updateAgentMemory(id, body) });
      }
      if (req.method === "DELETE") return json(deleteAgentMemory(id));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 404);
    }
  }

  if (url.pathname === "/api/browsers" && req.method === "GET") return json({ sessions: listBrowserSessions() });
  if (url.pathname === "/api/browsers" && req.method === "POST") {
    const body = await readJson<{ agentId?: string; label?: string }>(req);
    return json({ session: createBrowserSession(body.agentId, body.label) });
  }
  if (url.pathname === "/api/browser-actions" && req.method === "GET") {
    return json({
      events: listBrowserActionEvents({
        browserSessionId: url.searchParams.get("sessionId") ?? undefined,
        limit: Number(url.searchParams.get("limit") ?? 120),
      }),
    });
  }
  if (url.pathname === "/api/permissions" && req.method === "GET") {
    const status = url.searchParams.get("status") as PermissionStatus | null;
    return json({
      requests: listPermissionRequests(
        status && ["pending", "approved", "denied"].includes(status) ? status : undefined,
      ),
    });
  }
  const permissionAction = url.pathname.match(/^\/api\/permissions\/([^/]+)\/(approve|deny)$/);
  if (permissionAction && req.method === "POST") {
    const [, id, action] = permissionAction;
    return json({ request: resolvePermissionRequest(id, action === "approve" ? "approved" : "denied") });
  }
  const browserAction = url.pathname.match(/^\/api\/browsers\/([^/]+)\/(open|navigate|screenshot|click|type|key|close)$/);
  if (browserAction) {
    const [, id, action] = browserAction;
    try {
      if (action === "open" && req.method === "POST") {
        const body = await readJson<{ actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }>(req);
        return json({ session: await openBrowserSession(id, browserContext(body)) });
      }
      if (action === "navigate" && req.method === "POST") {
        const body = await readJson<{ url?: string; actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }>(req);
        if (!body.url) return json({ error: "url is required" }, 400);
        return json({ session: await navigateBrowserSession(id, body.url, browserContext(body)) });
      }
      if (action === "screenshot" && req.method === "GET") {
        return json(await screenshotBrowserSession(id, {
          actor: url.searchParams.get("actor") === "agent" ? "agent" : "user",
          agentId: url.searchParams.get("agentId"),
          reason: url.searchParams.get("reason") ?? undefined,
          permissionRequestId: url.searchParams.get("permissionRequestId") ?? undefined,
        }));
      }
      if (action === "click" && req.method === "POST") {
        const body = await readJson<{ x?: number; y?: number; actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }>(req);
        if (typeof body.x !== "number" || typeof body.y !== "number") return json({ error: "x and y are required" }, 400);
        return json({ session: await clickBrowserSession(id, body.x, body.y, browserContext(body)) });
      }
      if (action === "type" && req.method === "POST") {
        const body = await readJson<{ text?: string; actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }>(req);
        if (typeof body.text !== "string") return json({ error: "text is required" }, 400);
        return json({ session: await typeInBrowserSession(id, body.text, browserContext(body)) });
      }
      if (action === "key" && req.method === "POST") {
        const body = await readJson<{ key?: string; actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }>(req);
        if (!body.key) return json({ error: "key is required" }, 400);
        return json({ session: await pressBrowserKey(id, body.key, browserContext(body)) });
      }
      if (action === "close" && req.method === "POST") {
        const body = await readJson<{ actor?: string; agentId?: string; reason?: string; permissionRequestId?: string }>(req);
        return json({ session: await closeBrowserSession(id, browserContext(body)) });
      }
    } catch (error) {
      if (error instanceof PermissionRequiredError) {
        return json({ permissionRequired: true, request: error.request }, 202);
      }
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }

  if (url.pathname === "/api/usage/summary") return json({ summary: getUsageSummary(), timeline: getUsageTimeline() });

  if (url.pathname === "/api/media/capabilities" && req.method === "GET") return json(await getMediaCapabilities());
  if (url.pathname === "/api/media/runtimes" && req.method === "GET") return json(await getMediaRuntimePlan());
  if (url.pathname === "/api/media/runtimes/defaults" && req.method === "POST") {
    const body = await readJson<{ includeOptional?: boolean; overwrite?: boolean; kinds?: MediaKind[] }>(req);
    return json(await applyRecommendedMediaRuntimeDefaults(body));
  }
  if (url.pathname === "/api/media/jobs" && req.method === "GET") return json({ jobs: listMediaJobs(Number(url.searchParams.get("limit") ?? 80)) });
  if (url.pathname === "/api/media/images/generate" && req.method === "POST") {
    const body = await readJson<{ prompt?: string; model?: string; size?: string; n?: number; response_format?: string }>(req);
    if (!body.prompt?.trim()) return json({ error: "prompt is required" }, 400);
    try {
      return json(await generateImage(body));
    } catch (error) {
      return mediaError(error);
    }
  }
  if (url.pathname === "/api/media/audio/speech" && req.method === "POST") {
    const body = await readJson<{ input?: string; voice?: string; model?: string; response_format?: string }>(req);
    if (!body.input?.trim()) return json({ error: "input is required" }, 400);
    try {
      return json(await generateSpeech(body));
    } catch (error) {
      return mediaError(error);
    }
  }
  if (url.pathname === "/api/media/audio/transcriptions" && req.method === "POST") {
    const body = await readJson<{ audioBase64?: string; mime?: string; language?: string; prompt?: string }>(req);
    if (!body.audioBase64?.trim()) return json({ error: "audioBase64 is required" }, 400);
    try {
      return json(await transcribeAudio(body));
    } catch (error) {
      return mediaError(error);
    }
  }
  if (url.pathname === "/api/media/video/generate" && req.method === "POST") {
    const body = await readJson<{ prompt?: string; seconds?: number; width?: number; height?: number; model?: string }>(req);
    if (!body.prompt?.trim()) return json({ error: "prompt is required" }, 400);
    try {
      return json(await generateVideo(body));
    } catch (error) {
      return mediaError(error);
    }
  }

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
  if (url.pathname === "/v1/images/generations" && req.method === "POST") {
    const body = await readJson<{ prompt?: string; model?: string; size?: string; n?: number; response_format?: string }>(req);
    if (!body.prompt?.trim()) return json({ error: { message: "prompt is required" } }, 400);
    try {
      const { result } = await generateImage(body);
      return json(result);
    } catch (error) {
      return openAiMediaError(error);
    }
  }
  if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
    const body = await readJson<{ input?: string; voice?: string; model?: string; response_format?: string }>(req);
    if (!body.input?.trim()) return json({ error: { message: "input is required" } }, 400);
    try {
      const { result } = await generateSpeech(body);
      return audioResponse(result);
    } catch (error) {
      return openAiMediaError(error);
    }
  }
  if (url.pathname === "/v1/audio/transcriptions" && req.method === "POST") {
    const body = await readTranscriptionInput(req);
    if ("error" in body) return json({ error: { message: body.error } }, 400);
    if (!body.audioBase64?.trim()) return json({ error: { message: "audio is required" } }, 400);
    try {
      const { result } = await transcribeAudio(body);
      return json(result);
    } catch (error) {
      return openAiMediaError(error);
    }
  }

  const file = await staticFile(url.pathname);
  if (file) return file;
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  Bun.serve({ port: PORT, hostname: BIND_HOST, fetch: route });
  console.log(`${APP_NAME} is running at http://${BIND_HOST}:${PORT}`);
  if (IS_FAKE_LLM) console.log("Dev fake LLM is enabled.");
  if (PUBLIC_API && API_KEYS.length === 0) console.log("Public API mode is enabled but protected routes are locked until NIPUX_API_KEY is set.");
}
