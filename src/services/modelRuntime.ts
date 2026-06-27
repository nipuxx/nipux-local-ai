import { LLAMA_BASE_URL } from "../config.ts";
import { chatText, testLlamaBackend } from "../providers/llamaCpp.ts";
import { getModel, llamaServeCommand } from "./modelRegistry.ts";
import { recordUsage } from "./usage.ts";

type RuntimeProcess = ReturnType<typeof Bun.spawn>;

interface ActiveRuntime {
  process: RuntimeProcess;
  modelPreset: string;
  port: number;
  startedAt: string;
  logs: string[];
}

let activeRuntime: ActiveRuntime | null = null;

function portFromBaseUrl() {
  try {
    return Number(new URL(LLAMA_BASE_URL).port || 80);
  } catch {
    return 8080;
  }
}

async function drain(stream: ReadableStream<Uint8Array> | null, logs: string[]) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      logs.push(line);
      if (logs.length > 80) logs.shift();
    }
  }
}

function runtimeSnapshot(backend: Awaited<ReturnType<typeof testLlamaBackend>>) {
  return {
    running: Boolean(activeRuntime),
    modelPreset: activeRuntime?.modelPreset ?? null,
    pid: activeRuntime?.process.pid ?? null,
    port: activeRuntime?.port ?? portFromBaseUrl(),
    startedAt: activeRuntime?.startedAt ?? null,
    command: activeRuntime ? llamaServeCommand(activeRuntime.modelPreset, activeRuntime.port) : null,
    backend,
    logs: activeRuntime?.logs.slice(-30) ?? [],
  };
}

export async function getRuntimeStatus() {
  if (activeRuntime) {
    const exited = await Promise.race([activeRuntime.process.exited, Bun.sleep(0).then(() => null)]);
    if (typeof exited === "number") activeRuntime = null;
  }
  return runtimeSnapshot(await testLlamaBackend());
}

export async function startModelRuntime(modelPreset = "balanced") {
  const started = Date.now();
  if (activeRuntime) return runtimeSnapshot(await testLlamaBackend());
  const model = getModel(modelPreset);
  const port = portFromBaseUrl();
  const logs: string[] = [];

  try {
    const proc = Bun.spawn(["llama", "serve", "-hf", model.llamaRef, "--port", String(port), "--ctx-size", String(Math.min(model.contextTokens, 32768))], {
      stdout: "pipe",
      stderr: "pipe",
    });
    activeRuntime = {
      process: proc,
      modelPreset: model.id,
      port,
      startedAt: new Date().toISOString(),
      logs,
    };
    void drain(proc.stdout, logs);
    void drain(proc.stderr, logs);
    proc.exited.then(() => {
      if (activeRuntime?.process === proc) activeRuntime = null;
    });
    recordUsage({ kind: "model", model: model.id, latencyMs: Date.now() - started, status: "ok", meta: { action: "start", port } });
    return runtimeSnapshot(await testLlamaBackend());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordUsage({ kind: "model", model: model.id, latencyMs: Date.now() - started, status: "error", meta: { action: "start", error: message } });
    throw new Error(`Could not start llama.cpp. Install llama.cpp first, then retry. ${message}`);
  }
}

export async function stopModelRuntime() {
  const started = Date.now();
  if (!activeRuntime) return runtimeSnapshot(await testLlamaBackend());
  const model = activeRuntime.modelPreset;
  activeRuntime.process.kill();
  await Promise.race([activeRuntime.process.exited, Bun.sleep(3000)]);
  activeRuntime = null;
  recordUsage({ kind: "model", model, latencyMs: Date.now() - started, status: "ok", meta: { action: "stop" } });
  return runtimeSnapshot(await testLlamaBackend());
}

export async function testModelPrompt(prompt: string, modelPreset = "balanced") {
  const started = Date.now();
  const output = await chatText([{ role: "user", content: prompt }], modelPreset);
  recordUsage({
    kind: "model",
    model: modelPreset,
    tokensIn: Math.ceil(prompt.length / 4),
    tokensOut: Math.ceil(output.length / 4),
    latencyMs: Date.now() - started,
    status: "ok",
    meta: { action: "test" },
  });
  return { output };
}
