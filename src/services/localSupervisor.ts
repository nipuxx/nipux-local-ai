import { existsSync } from "node:fs";
import { platform } from "node:os";
import { spawnSync } from "node:child_process";
import { BIND_HOST, LLAMA_BASE_URL, PORT } from "../config.ts";
import { IMAGE_BACKEND_SETTING_KEY, imageBackendWorkerEnv } from "./imageSetup.ts";
import { getModel } from "./modelRegistry.ts";
import { getAppSettings, getRawSetting } from "./settings.ts";
import { getConfiguredWhisperModelPath, WHISPER_MODEL_SETTING_KEY } from "./transcriptionSetup.ts";

type ManagedKind = "app" | "llm" | "image" | "transcription" | "video";
type ManagedStatus = "ready" | "skipped";

export interface ManagedProcessPlan {
  kind: ManagedKind;
  label: string;
  status: ManagedStatus;
  command: string[];
  env: Record<string, string>;
  url?: string;
  reason?: string;
  optional?: boolean;
}

export interface LocalSupervisorPlan {
  appUrl: string;
  openBrowser: boolean;
  openCommand: string[];
  processes: ManagedProcessPlan[];
  ready: ManagedProcessPlan[];
  skipped: ManagedProcessPlan[];
  nextSteps: string[];
}

type SpawnedProcess = ReturnType<typeof Bun.spawn>;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function displayCommand(command: string[], env: Record<string, string>) {
  const envText = Object.entries(env)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
  return `${envText ? `${envText} ` : ""}${command.map((part) => (part.includes(" ") ? shellQuote(part) : part)).join(" ")}`;
}

function workerUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

function commandExists(command: string) {
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  const check = platform() === "win32" ? spawnSync("where", [command]) : spawnSync("which", [command]);
  return check.status === 0;
}

function openCommandFor(url: string) {
  const os = platform();
  if (os === "win32") return ["cmd", "/c", "start", "", url];
  if (os === "darwin") return ["open", url];
  return ["xdg-open", url];
}

function llamaBaseUrl() {
  try {
    const url = new URL(LLAMA_BASE_URL);
    url.hostname = "127.0.0.1";
    if (!url.pathname.endsWith("/v1")) url.pathname = "/v1";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "http://127.0.0.1:8080/v1";
  }
}

function llamaPort() {
  try {
    return Number(new URL(llamaBaseUrl()).port || 80);
  } catch {
    return 8080;
  }
}

function configuredLlmPlan(): ManagedProcessPlan {
  const preset = getAppSettings().defaultModelPreset;
  const model = getModel(preset);
  const command = process.env.NIPUX_LLAMA_COMMAND || "llama";
  const envModelPath = process.env.NIPUX_LLAMA_MODEL_PATH?.trim();
  const modelPath = envModelPath || model.localPath || "";
  const baseUrl = llamaBaseUrl();

  if (process.env.NIPUX_FAKE_LLM === "1") {
    return {
      kind: "llm",
      label: "LLM backend",
      status: "skipped",
      command: [command, "serve"],
      env: {},
      url: baseUrl,
      reason: "Dev fake LLM is enabled, so no llama.cpp process will start.",
      optional: true,
    };
  }

  if (!commandExists(command)) {
    return {
      kind: "llm",
      label: "LLM backend",
      status: "skipped",
      command: [command, "serve"],
      env: {},
      url: baseUrl,
      reason: "Install llama.cpp, then rerun bun run local.",
    };
  }

  if (!modelPath) {
    return {
      kind: "llm",
      label: "LLM backend",
      status: "skipped",
      command: [command, "serve"],
      env: {},
      url: baseUrl,
      reason: `Run bun run model:install ${model.id}, or set NIPUX_LLAMA_MODEL_PATH to a local GGUF file.`,
    };
  }

  if (!existsSync(modelPath)) {
    return {
      kind: "llm",
      label: "LLM backend",
      status: "skipped",
      command: [command, "serve", "-m", modelPath],
      env: {},
      url: baseUrl,
      reason: `Local model path does not exist: ${modelPath}`,
    };
  }

  return {
    kind: "llm",
    label: `LLM backend (${model.label})`,
    status: "ready",
    command: [command, "serve", "-m", modelPath, "--port", String(llamaPort()), "--ctx-size", String(Math.min(model.contextTokens, 32768))],
    env: {},
    url: baseUrl,
  };
}

function configuredImagePlan(): ManagedProcessPlan {
  const selectedPresetId = process.env.NIPUX_IMAGE_BACKEND_PRESET || getRawSetting(IMAGE_BACKEND_SETTING_KEY, "");
  const selectedEnv = !process.env.NIPUX_IMAGE_COMMAND && selectedPresetId ? imageBackendWorkerEnv(selectedPresetId) : null;
  const env = {
    NIPUX_IMAGE_COMMAND: process.env.NIPUX_IMAGE_COMMAND ?? selectedEnv?.NIPUX_IMAGE_COMMAND ?? "",
    NIPUX_IMAGE_ARGS: process.env.NIPUX_IMAGE_ARGS ?? selectedEnv?.NIPUX_IMAGE_ARGS ?? "",
    NIPUX_IMAGE_MODEL: process.env.NIPUX_IMAGE_MODEL ?? selectedEnv?.NIPUX_IMAGE_MODEL ?? "",
  };
  const imageReady = Boolean(env.NIPUX_IMAGE_COMMAND) && (!selectedEnv || commandExists(env.NIPUX_IMAGE_COMMAND));
  return {
    kind: "image",
    label: selectedEnv ? `Image worker (${selectedPresetId})` : "Image worker",
    status: imageReady ? "ready" : "skipped",
    command: ["bun", "run", "worker:image"],
    env,
    url: workerUrl(8081),
    reason: imageReady
      ? undefined
      : selectedEnv
        ? `Run bun run image:install ${selectedPresetId}, then rerun bun run local.`
        : "Set NIPUX_IMAGE_COMMAND or choose a local image backend with bun run image:backends.",
  };
}

function configuredWorkerPlans(): ManagedProcessPlan[] {
  const configuredWhisperModel = getConfiguredWhisperModelPath();
  const storedWhisperModel = getRawSetting(WHISPER_MODEL_SETTING_KEY, "");
  const transcriptionReady = Boolean(configuredWhisperModel);
  const videoReady = Boolean(process.env.NIPUX_VIDEO_COMMAND);

  return [
    configuredImagePlan(),
    {
      kind: "transcription",
      label: "Transcription worker",
      status: transcriptionReady ? "ready" : "skipped",
      command: ["bun", "run", "worker:transcription"],
      env: {
        NIPUX_WHISPER_MODEL: configuredWhisperModel,
        NIPUX_WHISPER_COMMAND: process.env.NIPUX_WHISPER_COMMAND ?? "",
        NIPUX_WHISPER_ARGS: process.env.NIPUX_WHISPER_ARGS ?? "",
      },
      url: workerUrl(8083),
      reason: transcriptionReady
        ? undefined
        : storedWhisperModel
          ? `Saved Whisper model is missing: ${storedWhisperModel}. Run bun run transcription:prepare base.en --install.`
          : "Run bun run transcription:prepare base.en --install, then rerun bun run local --open.",
    },
    {
      kind: "video",
      label: "Video worker",
      status: videoReady ? "ready" : "skipped",
      command: ["bun", "run", "worker:video"],
      env: {
        NIPUX_VIDEO_COMMAND: process.env.NIPUX_VIDEO_COMMAND ?? "",
        NIPUX_VIDEO_ARGS: process.env.NIPUX_VIDEO_ARGS ?? "",
        NIPUX_VIDEO_MODEL: process.env.NIPUX_VIDEO_MODEL ?? "",
      },
      url: workerUrl(8084),
      reason: videoReady ? undefined : "Set NIPUX_VIDEO_COMMAND to start the optional bundled video command worker.",
      optional: true,
    },
  ];
}

export function getLocalSupervisorPlan(): LocalSupervisorPlan {
  const llm = configuredLlmPlan();
  const workers = configuredWorkerPlans();
  const readyServices = [llm, ...workers].filter((item) => item.status === "ready");
  const workerEnv: Record<string, string> = {};
  for (const worker of readyServices) {
    if (worker.kind === "llm") workerEnv.NIPUX_LLAMA_BASE_URL = worker.url ?? llamaBaseUrl();
    if (worker.kind === "image") workerEnv.NIPUX_IMAGE_WORKER_URL = worker.url ?? workerUrl(8081);
    if (worker.kind === "transcription") workerEnv.NIPUX_TRANSCRIPTION_WORKER_URL = worker.url ?? workerUrl(8083);
    if (worker.kind === "video") workerEnv.NIPUX_VIDEO_WORKER_URL = worker.url ?? workerUrl(8084);
  }

  const app: ManagedProcessPlan = {
    kind: "app",
    label: "Nipux app",
    status: "ready",
    command: ["bun", "run", "start"],
    env: workerEnv,
    url: `http://${BIND_HOST === "0.0.0.0" ? "127.0.0.1" : BIND_HOST}:${PORT}`,
  };
  const skippedServices = [llm, ...workers].filter((item) => item.status === "skipped");
  const processes = [...readyServices, app, ...skippedServices];
  const openBrowser = process.env.NIPUX_OPEN_BROWSER === "1";
  return {
    appUrl: app.url!,
    openBrowser,
    openCommand: openCommandFor(app.url!),
    processes,
    ready: processes.filter((item) => item.status === "ready"),
    skipped: processes.filter((item) => item.status === "skipped"),
    nextSteps: processes
      .filter((item) => item.status === "skipped" && (!item.optional || process.env.NIPUX_INCLUDE_OPTIONAL_WORKERS === "1"))
      .map((item) => item.reason ?? `${item.label} is not configured.`),
  };
}

async function drain(stream: ReadableStream<Uint8Array> | null, label: string) {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value);
    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      console.log(`[${label}] ${line}`);
    }
  }
}

function spawnManaged(processPlan: ManagedProcessPlan) {
  const proc = Bun.spawn(processPlan.command, {
    env: { ...process.env, ...processPlan.env },
    stdout: "pipe",
    stderr: "pipe",
  });
  void drain(proc.stdout, processPlan.kind);
  void drain(proc.stderr, processPlan.kind);
  return proc;
}

export function formatLocalSupervisorPlan(plan: LocalSupervisorPlan) {
  const lines = [
    "Nipux Local AI local supervisor",
    `Open: ${plan.appUrl}`,
    `Browser: ${plan.openBrowser ? `will open with ${displayCommand(plan.openCommand, {})}` : "not opened automatically; use bun run local --open"}`,
    "",
    "Will start:",
    ...plan.ready.map((item) => `  [start] ${item.label}: ${displayCommand(item.command, item.env)}`),
  ];
  if (plan.skipped.length) {
    lines.push("", "Skipped:");
    for (const item of plan.skipped) lines.push(`  [skip] ${item.label}: ${item.reason}`);
  }
  if (plan.nextSteps.length) {
    lines.push("", "Next steps:");
    for (const step of plan.nextSteps) lines.push(`  - ${step}`);
  }
  return lines.join("\n");
}

async function waitForApp(url: string, timeoutMs = 8000) {
  const statusUrl = `${url.replace(/\/$/, "")}/api/status`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(statusUrl);
      if (res.ok) return true;
    } catch {
      // The app process may still be binding the port.
    }
    await Bun.sleep(250);
  }
  return false;
}

async function openBrowserWhenReady(plan: LocalSupervisorPlan) {
  const ready = await waitForApp(plan.appUrl);
  if (!ready) {
    console.log(`Browser not opened; ${plan.appUrl} did not respond yet.`);
    return;
  }
  console.log(`Opening browser: ${plan.appUrl}`);
  try {
    Bun.spawn(plan.openCommand, { stdout: "ignore", stderr: "ignore" });
  } catch (error) {
    console.log(`Browser not opened; run ${plan.appUrl} manually. ${error instanceof Error ? error.message : ""}`.trim());
  }
}

export async function runLocalSupervisor(input: { dryRun?: boolean } = {}) {
  const plan = getLocalSupervisorPlan();
  if (input.dryRun) return plan;

  const children: SpawnedProcess[] = [];
  let stopping = false;
  let signalExitCode: number | undefined;
  const stopAll = () => {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill();
  };
  const onSigint = () => {
    signalExitCode = 130;
    stopAll();
  };
  const onSigterm = () => {
    signalExitCode = 143;
    stopAll();
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    console.log(formatLocalSupervisorPlan(plan));
    for (const processPlan of plan.ready) children.push(spawnManaged(processPlan));
    if (plan.openBrowser) void openBrowserWhenReady(plan);
    const firstExitCode = await Promise.race(children.map((child) => child.exited));
    stopAll();
    await Promise.allSettled(children.map((child) => child.exited));
    if (signalExitCode !== undefined) process.exitCode = signalExitCode;
    else if (firstExitCode !== 0) process.exitCode = firstExitCode;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
  return plan;
}
