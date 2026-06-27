import { db } from "../db.ts";
import { generateLocalSpeech, getLocalSpeechRuntime } from "./localSpeech.ts";
import { getAppSettings } from "./settings.ts";
import { recordUsage } from "./usage.ts";

export type MediaKind = "image" | "speech" | "transcription" | "video";
export type MediaJobStatus = "queued" | "running" | "completed" | "failed";

export interface MediaJob {
  id: string;
  kind: MediaKind;
  status: MediaJobStatus;
  prompt: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string | null;
  workerUrl?: string | null;
  createdAt: string;
  completedAt?: string | null;
}

export interface MediaCapability {
  kind: MediaKind;
  label: string;
  configured: boolean;
  status: "ready" | "unconfigured" | "invalid" | "offline";
  workerUrl: string;
  setup: string;
  source: "worker" | "builtin" | "none";
  health?: {
    checked: boolean;
    reachable: boolean;
    detail: string;
    statusCode?: number;
  };
  builtin?: {
    engine: string;
    command: string;
    outputMime: string;
  };
  localOnly: true;
}

export class MediaUnavailableError extends Error {
  constructor(
    message: string,
    readonly job: MediaJob,
    readonly status = 501,
  ) {
    super(message);
  }
}

type MediaSettingKey = "imageWorkerUrl" | "speechWorkerUrl" | "transcriptionWorkerUrl" | "videoWorkerUrl";

const MEDIA_CONFIG: Record<MediaKind, { label: string; settingKey: MediaSettingKey; endpoint: string; setup: string }> = {
  image: {
    label: "Image Generation",
    settingKey: "imageWorkerUrl",
    endpoint: "v1/images/generations",
    setup: "Run a local OpenAI-compatible image worker, then set its URL in Settings.",
  },
  speech: {
    label: "Text to Speech",
    settingKey: "speechWorkerUrl",
    endpoint: "v1/audio/speech",
    setup: "Run a local OpenAI-compatible speech worker such as Kokoro/Piper, then set its URL in Settings.",
  },
  transcription: {
    label: "Speech to Text",
    settingKey: "transcriptionWorkerUrl",
    endpoint: "v1/audio/transcriptions",
    setup: "Run a local transcription worker such as whisper.cpp, then set its URL in Settings.",
  },
  video: {
    label: "Video Generation",
    settingKey: "videoWorkerUrl",
    endpoint: "v1/video/generations",
    setup: "Run a local video worker, then set its URL in Settings. Jobs should stay queued/opt-in on smaller machines.",
  },
};

function safeJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function rowToJob(row: {
  id: string;
  kind: MediaKind;
  status: MediaJobStatus;
  prompt: string;
  inputJson: string;
  outputJson: string;
  error?: string | null;
  workerUrl?: string | null;
  createdAt: string;
  completedAt?: string | null;
}): MediaJob {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    prompt: row.prompt,
    input: safeJson(row.inputJson),
    output: safeJson(row.outputJson),
    error: row.error,
    workerUrl: row.workerUrl,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export function isLocalWorkerUrl(value: string) {
  if (!value.trim()) return false;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  } catch {
    return false;
  }
}

async function checkLocalWorkerHealth(workerUrl: string): Promise<NonNullable<MediaCapability["health"]>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 900);
  try {
    const res = await fetch(workerUrl, { method: "HEAD", signal: controller.signal });
    return {
      checked: true,
      reachable: true,
      statusCode: res.status,
      detail: `Worker responded with HTTP ${res.status}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes("abort")) {
      return { checked: true, reachable: false, detail: "Worker health check timed out." };
    }
    return { checked: true, reachable: false, detail: message || "Worker did not respond." };
  } finally {
    clearTimeout(timeout);
  }
}

function workerUrlFor(kind: MediaKind) {
  const settings = getAppSettings();
  return String(settings[MEDIA_CONFIG[kind].settingKey] ?? "").trim();
}

function usageKind(kind: MediaKind) {
  if (kind === "video") return "video";
  if (kind === "image") return "image";
  return "audio";
}

function endpointFor(baseUrl: string, endpoint: string) {
  const base = new URL(baseUrl);
  const href = base.href.endsWith("/") ? base.href : `${base.href}/`;
  const normalizedEndpoint = base.pathname.replace(/\/$/, "").endsWith("/v1") && endpoint.startsWith("v1/")
    ? endpoint.slice(3)
    : endpoint;
  return new URL(normalizedEndpoint, href);
}

export async function getMediaCapabilities(): Promise<{ capabilities: Record<MediaKind, MediaCapability> }> {
  const localSpeech = getLocalSpeechRuntime();
  const capabilityEntries = await Promise.all(
    (Object.keys(MEDIA_CONFIG) as MediaKind[]).map(async (kind) => {
      const config = MEDIA_CONFIG[kind];
      const workerUrl = workerUrlFor(kind);
      const configured = isLocalWorkerUrl(workerUrl);
      const builtinSpeech = kind === "speech" && !workerUrl && localSpeech.available;
      const health = configured ? await checkLocalWorkerHealth(workerUrl) : undefined;
      let status: MediaCapability["status"] = "unconfigured";
      if (builtinSpeech) status = "ready";
      else if (configured) status = health?.reachable ? "ready" : "offline";
      else if (workerUrl) status = "invalid";
      return [
        kind,
        {
          kind,
          label: config.label,
          configured: configured || builtinSpeech,
          status,
          workerUrl: builtinSpeech ? "builtin://system-speech" : workerUrl,
          setup: status === "invalid"
            ? "Worker URLs must be local loopback HTTP(S) URLs such as http://127.0.0.1:8081."
            : status === "offline"
              ? `Start the local ${config.label.toLowerCase()} worker on ${workerUrl}.`
            : builtinSpeech
              ? localSpeech.setup
              : config.setup,
          source: configured ? "worker" : builtinSpeech ? "builtin" : "none",
          health,
          builtin: builtinSpeech
            ? {
                engine: localSpeech.engine,
                command: localSpeech.command,
                outputMime: localSpeech.outputMime,
              }
            : undefined,
          localOnly: true as const,
        },
      ];
    }),
  );
  const capabilities = Object.fromEntries(capabilityEntries) as Record<MediaKind, MediaCapability>;

  return { capabilities };
}

export function createMediaJob(kind: MediaKind, input: Record<string, unknown>, workerUrl?: string | null): MediaJob {
  const id = crypto.randomUUID();
  const prompt = typeof input.prompt === "string" ? input.prompt : typeof input.input === "string" ? input.input : "";
  db.prepare(
    `INSERT INTO media_jobs (id, kind, status, prompt, input_json, worker_url)
     VALUES (?, ?, 'running', ?, ?, ?)`,
  ).run(id, kind, prompt, JSON.stringify(input), workerUrl ?? null);
  return getMediaJob(id);
}

export function completeMediaJob(id: string, output: Record<string, unknown>): MediaJob {
  db.prepare(
    `UPDATE media_jobs
     SET status = 'completed', output_json = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(JSON.stringify(output), id);
  return getMediaJob(id);
}

export function failMediaJob(id: string, error: string): MediaJob {
  db.prepare(
    `UPDATE media_jobs
     SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(error, id);
  return getMediaJob(id);
}

export function getMediaJob(id: string): MediaJob {
  const row = db
    .prepare(
      `SELECT id, kind, status, prompt, input_json AS inputJson, output_json AS outputJson,
        error, worker_url AS workerUrl, created_at AS createdAt, completed_at AS completedAt
       FROM media_jobs
       WHERE id = ?`,
    )
    .get(id) as Parameters<typeof rowToJob>[0] | null;
  if (!row) throw new Error(`Media job ${id} was not found.`);
  return rowToJob(row);
}

export function listMediaJobs(limit = 80): MediaJob[] {
  return db
    .prepare(
      `SELECT id, kind, status, prompt, input_json AS inputJson, output_json AS outputJson,
        error, worker_url AS workerUrl, created_at AS createdAt, completed_at AS completedAt
       FROM media_jobs
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((row) => rowToJob(row as Parameters<typeof rowToJob>[0]));
}

async function callLocalWorker(kind: MediaKind, input: Record<string, unknown>) {
  const config = MEDIA_CONFIG[kind];
  const workerUrl = workerUrlFor(kind);
  const job = createMediaJob(kind, input, workerUrl || null);
  const started = Date.now();

  if (!workerUrl) {
    const failed = failMediaJob(job.id, config.setup);
    recordUsage({ kind: usageKind(kind), latencyMs: Date.now() - started, status: "error", meta: { jobId: job.id, reason: "unconfigured" } });
    throw new MediaUnavailableError(config.setup, failed);
  }

  if (!isLocalWorkerUrl(workerUrl)) {
    const message = "Media workers must be local loopback URLs. External media APIs are intentionally blocked.";
    const failed = failMediaJob(job.id, message);
    recordUsage({ kind: usageKind(kind), latencyMs: Date.now() - started, status: "error", meta: { jobId: job.id, reason: "non_local_worker" } });
    throw new MediaUnavailableError(message, failed, 400);
  }

  try {
    const res = await fetch(endpointFor(workerUrl, config.endpoint), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const contentType = res.headers.get("content-type") ?? "";
    let output: Record<string, unknown>;
    if (contentType.startsWith("audio/") || contentType.startsWith("video/")) {
      const buffer = Buffer.from(await res.arrayBuffer());
      output = {
        mime: contentType,
        base64: buffer.toString("base64"),
        dataUrl: `data:${contentType};base64,${buffer.toString("base64")}`,
      };
    } else {
      output = (await res.json()) as Record<string, unknown>;
    }
    if (!res.ok) throw new Error(typeof output.error === "string" ? output.error : `Media worker returned ${res.status}.`);
    const completed = completeMediaJob(job.id, output);
    recordUsage({ kind: usageKind(kind), latencyMs: Date.now() - started, status: "ok", meta: { jobId: job.id, workerUrl } });
    return { job: completed, result: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = failMediaJob(job.id, message);
    recordUsage({ kind: usageKind(kind), latencyMs: Date.now() - started, status: "error", meta: { jobId: job.id, error: message } });
    throw new MediaUnavailableError(message, failed, 502);
  }
}

async function callBuiltInSpeech(input: { input?: string; voice?: string; model?: string; response_format?: string }) {
  const started = Date.now();
  const job = createMediaJob("speech", { ...input, source: "builtin-system-speech" }, "builtin://system-speech");
  try {
    const output = await generateLocalSpeech(input.input ?? "", input.voice);
    const completed = completeMediaJob(job.id, output);
    recordUsage({
      kind: "audio",
      model: "builtin-system-speech",
      latencyMs: Date.now() - started,
      status: "ok",
      meta: { jobId: job.id, engine: output.engine, source: "builtin" },
    });
    return { job: completed, result: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = failMediaJob(job.id, message);
    recordUsage({ kind: "audio", model: "builtin-system-speech", latencyMs: Date.now() - started, status: "error", meta: { jobId: job.id, error: message } });
    throw new MediaUnavailableError(message, failed, 502);
  }
}

export async function generateImage(input: { prompt?: string; model?: string; size?: string; n?: number; response_format?: string }) {
  return callLocalWorker("image", input as Record<string, unknown>);
}

export async function generateSpeech(input: { input?: string; voice?: string; model?: string; response_format?: string }) {
  if (!workerUrlFor("speech") && getLocalSpeechRuntime().available) return callBuiltInSpeech(input);
  return callLocalWorker("speech", input as Record<string, unknown>);
}

export async function transcribeAudio(input: { audioBase64?: string; mime?: string; language?: string; prompt?: string }) {
  return callLocalWorker("transcription", input as Record<string, unknown>);
}

export async function generateVideo(input: { prompt?: string; seconds?: number; width?: number; height?: number; model?: string }) {
  return callLocalWorker("video", input as Record<string, unknown>);
}
