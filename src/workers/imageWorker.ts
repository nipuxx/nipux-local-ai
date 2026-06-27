import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const DEFAULT_PORT = Number(process.env.NIPUX_IMAGE_WORKER_PORT ?? 8081);
const DEFAULT_HOST = process.env.NIPUX_IMAGE_WORKER_HOST ?? "127.0.0.1";

interface ImageInput {
  prompt?: string;
  model?: string;
  size?: string;
  width?: number;
  height?: number;
  n?: number;
  response_format?: string;
  negative_prompt?: string;
  seed?: number;
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

function parseSize(input: ImageInput) {
  const match = String(input.size ?? "").match(/^(\d+)x(\d+)$/);
  const width = clampInt(input.width ?? match?.[1], 1024, 64, 4096);
  const height = clampInt(input.height ?? match?.[2], 1024, 64, 4096);
  return { width, height, size: `${width}x${height}` };
}

function mimeForPath(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

async function readInput(req: Request): Promise<ImageInput> {
  try {
    return (await req.json()) as ImageInput;
  } catch {
    return {};
  }
}

async function readGeneratedImage(outputPath: string, stdout: string) {
  try {
    const buffer = await readFile(outputPath);
    if (buffer.length > 0) {
      return {
        b64_json: buffer.toString("base64"),
        mime: mimeForPath(outputPath),
      };
    }
  } catch {
    // stdout parsing below supports commands that emit JSON instead of writing a file.
  }

  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Image command did not write an output image or JSON result.");
  try {
    const parsed = JSON.parse(trimmed) as { data?: Array<{ b64_json?: string; url?: string }>; b64_json?: string; url?: string };
    const data = parsed.data?.[0] ?? parsed;
    if (data.b64_json || data.url) return data;
  } catch {
    // Fall through to a clearer error.
  }
  throw new Error("Image command output was not a supported image result.");
}

async function runImageCommand(input: ImageInput, index: number) {
  const command = process.env.NIPUX_IMAGE_COMMAND || "";
  if (!command) {
    throw new Error("Set NIPUX_IMAGE_COMMAND to a local image-generation command before starting this worker.");
  }
  if (!input.prompt?.trim()) throw new Error("prompt is required.");

  const model = process.env.NIPUX_IMAGE_MODEL || input.model || "local-image";
  const { width, height, size } = parseSize(input);
  const workDir = join(tmpdir(), `nipux-image-${crypto.randomUUID()}`);
  const inputPath = join(workDir, "request.json");
  const outputPath = join(workDir, `image-${index}.png`);
  const started = Date.now();

  try {
    await mkdir(workDir, { recursive: true });
    await writeFile(
      inputPath,
      JSON.stringify({
        prompt: input.prompt,
        negative_prompt: input.negative_prompt,
        model,
        width,
        height,
        size,
        seed: typeof input.seed === "number" ? input.seed + index : undefined,
        outputPath,
        index,
      }, null, 2),
    );

    const args = renderArgs(process.env.NIPUX_IMAGE_ARGS || "{input} {output}", {
      input: inputPath,
      output: outputPath,
      prompt: input.prompt,
      negative_prompt: input.negative_prompt || "",
      model,
      width: String(width),
      height: String(height),
      size,
      seed: typeof input.seed === "number" ? String(input.seed + index) : "",
      index: String(index),
    });
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout), collect(proc.stderr), proc.exited]);
    if (exitCode !== 0) throw new Error(stderr || stdout || `image command exited with ${exitCode}`);

    return {
      ...(await readGeneratedImage(outputPath, stdout)),
      revised_prompt: input.prompt,
      durationMs: Date.now() - started,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function generateWithLocalImageCommand(input: ImageInput) {
  const count = clampInt(input.n ?? 1, 1, 1, 4);
  const data = [];
  for (let index = 0; index < count; index += 1) {
    data.push(await runImageCommand(input, index));
  }
  return {
    created: Math.floor(Date.now() / 1000),
    model: process.env.NIPUX_IMAGE_MODEL || input.model || "local-image",
    data,
  };
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*" } });
  if (req.method === "HEAD" || req.method === "GET") {
    const ready = Boolean(process.env.NIPUX_IMAGE_COMMAND);
    if (req.method === "HEAD") {
      return new Response(null, { status: ready ? 200 : 503, headers: { "access-control-allow-origin": "*" } });
    }
    return json({
      ok: ready,
      worker: "nipux-local-image-command",
      requires: ["NIPUX_IMAGE_COMMAND"],
      defaultArgs: "{input} {output}",
    }, ready ? 200 : 503);
  }
  if (url.pathname === "/v1/images/generations" && req.method === "POST") {
    try {
      return json(await generateWithLocalImageCommand(await readInput(req)));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  Bun.serve({ hostname: DEFAULT_HOST, port: DEFAULT_PORT, fetch: route });
  console.log(`Nipux image worker is running at http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  console.log("Set NIPUX_IMAGE_COMMAND to a local image-generation command before generating images.");
}
