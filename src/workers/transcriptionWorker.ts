import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { platform, tmpdir } from "node:os";

const DEFAULT_PORT = Number(process.env.NIPUX_TRANSCRIPTION_WORKER_PORT ?? 8083);
const DEFAULT_HOST = process.env.NIPUX_TRANSCRIPTION_WORKER_HOST ?? "127.0.0.1";

interface TranscriptionInput {
  audioBase64?: string;
  mime?: string;
  language?: string;
  prompt?: string;
  model?: string;
}

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "access-control-allow-origin": "*" } });
}

function extensionForMime(mime = "") {
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  if (mime.includes("mp4") || mime.includes("m4a")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  return ".wav";
}

function splitArgs(input: string) {
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return matches.map((part) => part.replace(/^["']|["']$/g, ""));
}

function renderArgs(template: string, values: Record<string, string>) {
  return splitArgs(template).map((part) => part.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? ""));
}

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandExists(command: string) {
  if (!command.trim()) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  const result = platform() === "win32"
    ? spawnSync("where", [command], { stdio: "ignore" })
    : spawnSync("sh", ["-c", `command -v ${shellArg(command)}`], { stdio: "ignore" });
  return result.status === 0;
}

async function readInput(req: Request): Promise<TranscriptionInput> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return {};
    const buffer = Buffer.from(await file.arrayBuffer());
    return {
      audioBase64: buffer.toString("base64"),
      mime: file.type || String(form.get("mime") ?? "audio/wav"),
      language: String(form.get("language") ?? ""),
      prompt: String(form.get("prompt") ?? ""),
      model: String(form.get("model") ?? ""),
    };
  }
  try {
    return (await req.json()) as TranscriptionInput;
  } catch {
    return {};
  }
}

async function collect(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return "";
  return new Response(stream).text();
}

export async function transcribeWithWhisper(input: TranscriptionInput) {
  const command = process.env.NIPUX_WHISPER_COMMAND || "whisper-cli";
  const modelPath = process.env.NIPUX_WHISPER_MODEL || input.model || "";
  if (!modelPath) {
    throw new Error("Set NIPUX_WHISPER_MODEL to a local whisper.cpp model path before starting this worker.");
  }
  if (!input.audioBase64?.trim()) throw new Error("audioBase64 is required.");

  const workDir = join(tmpdir(), `nipux-whisper-${crypto.randomUUID()}`);
  await mkdir(workDir, { recursive: true });
  const audioPath = join(workDir, `audio${extensionForMime(input.mime)}`);
  const outputPrefix = join(workDir, "transcript");
  const started = Date.now();

  try {
    await writeFile(audioPath, Buffer.from(input.audioBase64, "base64"));
    const defaultArgs = "-m {model} -f {audio} -otxt -of {output}";
    const args = renderArgs(process.env.NIPUX_WHISPER_ARGS || defaultArgs, {
      model: modelPath,
      audio: audioPath,
      output: outputPrefix,
      language: input.language || "",
      prompt: input.prompt || "",
    });
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([collect(proc.stdout), collect(proc.stderr), proc.exited]);
    if (exitCode !== 0) throw new Error(stderr || stdout || `whisper command exited with ${exitCode}`);

    let text = stdout.trim();
    try {
      const fileText = await readFile(`${outputPrefix}.txt`, "utf8");
      if (fileText.trim()) text = fileText.trim();
    } catch {
      // stdout remains the fallback for commands that do not write a .txt output file.
    }
    return {
      text,
      model: modelPath,
      language: input.language || undefined,
      durationMs: Date.now() - started,
      source: "whisper.cpp",
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*" } });
  if (req.method === "HEAD" || req.method === "GET") {
    const command = process.env.NIPUX_WHISPER_COMMAND || "whisper-cli";
    const hasModel = Boolean(process.env.NIPUX_WHISPER_MODEL);
    const hasCommand = commandExists(command);
    const ready = hasModel && hasCommand;
    if (req.method === "HEAD") {
      return new Response(null, { status: ready ? 200 : 503, headers: { "access-control-allow-origin": "*" } });
    }
    return json({
      ok: ready,
      worker: "nipux-whisper-transcription",
      command,
      requires: ["NIPUX_WHISPER_MODEL", "whisper-cli or NIPUX_WHISPER_COMMAND"],
      missing: [hasModel ? "" : "NIPUX_WHISPER_MODEL", hasCommand ? "" : command].filter(Boolean),
    }, ready ? 200 : 503);
  }
  if (url.pathname === "/v1/audio/transcriptions" && req.method === "POST") {
    try {
      return json(await transcribeWithWhisper(await readInput(req)));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 503);
    }
  }
  return json({ error: "not found" }, 404);
}

if (import.meta.main) {
  Bun.serve({ hostname: DEFAULT_HOST, port: DEFAULT_PORT, fetch: route });
  console.log(`Nipux transcription worker is running at http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  console.log("Set NIPUX_WHISPER_MODEL to a local whisper.cpp model path before transcribing.");
}
