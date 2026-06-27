import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_PORT = Number(process.env.NIPUX_VIDEO_WORKER_PORT ?? 8084);
const DEFAULT_HOST = process.env.NIPUX_VIDEO_WORKER_HOST ?? "127.0.0.1";

interface VideoInput {
  prompt?: string;
  model?: string;
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  seed?: number;
  negative_prompt?: string;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*" } });
}

function splitArgs(input: string) {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

function renderArgs(template: string, values: Record<string, string>) {
  return splitArgs(template).map((part) => part.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ""));
}

async function collect(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return "";
  return new Response(stream).text();
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function mimeForPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  return "video/mp4";
}

async function readInput(req: Request): Promise<VideoInput> {
  try {
    return (await req.json()) as VideoInput;
  } catch {
    return {};
  }
}

async function readGeneratedVideo(outputPath: string, stdout: string) {
  try {
    const buffer = await readFile(outputPath);
    if (buffer.length > 0) {
      const mime = mimeForPath(outputPath);
      const base64 = buffer.toString("base64");
      return {
        mime,
        base64,
        dataUrl: `data:${mime};base64,${base64}`,
      };
    }
  } catch {
    // stdout parsing below supports commands that emit JSON instead of writing a file.
  }

  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Video command did not write an output video or JSON result.");
  try {
    const parsed = JSON.parse(trimmed) as {
      data?: Array<{ dataUrl?: string; base64?: string; mime?: string; url?: string }>;
      dataUrl?: string;
      base64?: string;
      mime?: string;
      url?: string;
    };
    const data = parsed.data?.[0] ?? parsed;
    if (data.dataUrl || data.url) return data;
    if (data.base64 && data.mime) {
      return { ...data, dataUrl: `data:${data.mime};base64,${data.base64}` };
    }
  } catch {
    // Fall through to a clearer error.
  }
  throw new Error("Video command output was not a supported video result.");
}

export async function generateWithLocalVideoCommand(input: VideoInput) {
  const command = process.env.NIPUX_VIDEO_COMMAND || "";
  if (!command) {
    throw new Error("Set NIPUX_VIDEO_COMMAND to a local video-generation command before starting this worker.");
  }
  if (!input.prompt?.trim()) throw new Error("prompt is required.");

  const model = process.env.NIPUX_VIDEO_MODEL || input.model || "local-video";
  const seconds = clampInt(input.seconds, 4, 1, 60);
  const width = clampInt(input.width, 768, 128, 4096);
  const height = clampInt(input.height, 432, 128, 4096);
  const fps = clampInt(input.fps, 12, 1, 120);
  const workDir = join(tmpdir(), `nipux-video-${crypto.randomUUID()}`);
  const inputPath = join(workDir, "request.json");
  const outputPath = join(workDir, "video.mp4");
  const started = Date.now();

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(
      inputPath,
      JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negative_prompt,
        model,
        seconds,
        width,
        height,
        fps,
        seed: input.seed,
        outputPath,
      }, null, 2),
    );

    const args = renderArgs(process.env.NIPUX_VIDEO_ARGS || "{input} {output}", {
      input: inputPath,
      output: outputPath,
      prompt: input.prompt,
      negative_prompt: input.negative_prompt || "",
      model,
      seconds: String(seconds),
      width: String(width),
      height: String(height),
      fps: String(fps),
      seed: typeof input.seed === "number" ? String(input.seed) : "",
    });
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout), collect(proc.stderr), proc.exited]);
    if (exitCode !== 0) throw new Error(stderr || stdout || `video command exited with ${exitCode}`);

    return {
      created: Math.floor(Date.now() / 1000),
      model,
      data: [
        {
          ...(await readGeneratedVideo(outputPath, stdout)),
          revised_prompt: input.prompt,
          durationMs: Date.now() - started,
        },
      ],
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*" } });
  if (req.method === "HEAD" || req.method === "GET") {
    const ready = Boolean(process.env.NIPUX_VIDEO_COMMAND);
    if (req.method === "HEAD") {
      return new Response(null, { status: ready ? 200 : 503, headers: { "access-control-allow-origin": "*" } });
    }
    return json({
      ok: ready,
      worker: "nipux-local-video-command",
      requires: ["NIPUX_VIDEO_COMMAND"],
      defaultArgs: "{input} {output}",
    }, ready ? 200 : 503);
  }
  if (url.pathname === "/v1/video/generations" && req.method === "POST") {
    try {
      return json(await generateWithLocalVideoCommand(await readInput(req)));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  Bun.serve({ hostname: DEFAULT_HOST, port: DEFAULT_PORT, fetch: route });
  console.log(`Nipux video worker is running at http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  console.log("Set NIPUX_VIDEO_COMMAND to a local video-generation command before generating videos.");
}
