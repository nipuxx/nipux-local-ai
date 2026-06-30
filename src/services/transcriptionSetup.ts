import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";
import { MODEL_DIR } from "../config.ts";
import { getAppSettings, getRawSetting, setRawSetting, updateAppSettings, type AppSettings } from "./settings.ts";

export interface WhisperModelPreset {
  id: "tiny.en" | "base.en";
  label: string;
  filename: string;
  sizeMb: number;
  recommended: boolean;
  description: string;
}

export interface WhisperModelInstallResult {
  preset: WhisperModelPreset;
  targetPath: string;
  downloaded: boolean;
  configured: boolean;
  sizeBytes: number;
  startCommand: string;
  localCommand: string;
  defaultsCommand: string;
  sourceUrl: string;
}

export interface TranscriptionSetupPlan {
  localOnly: true;
  workerUrl: string;
  presets: WhisperModelPreset[];
  recommendedPresetId: string;
  configuredModelPath: string;
  savedModelPath: string;
  modelInstalled: boolean;
  command: {
    envVar: "NIPUX_WHISPER_COMMAND";
    command: string;
    installed: boolean;
    detail: string;
    installHint: string;
  };
  settings: AppSettings;
  commands: {
    install: string;
    prepare: string;
    prepareInstall: string;
    start: string;
    local: string;
    workerUrl: string;
  };
  nextSteps: string[];
}

export interface TranscriptionSetupPrepareResult {
  selectedPresetId: string;
  installed: boolean;
  install?: WhisperModelInstallResult;
  settings: AppSettings;
  plan: TranscriptionSetupPlan;
  commands: TranscriptionSetupPlan["commands"];
  nextSteps: string[];
}

export const DEFAULT_WHISPER_MODEL_PRESET = "base.en";
export const WHISPER_MODEL_SETTING_KEY = "whisper_model_path";
export const DEFAULT_TRANSCRIPTION_WORKER_URL = "http://127.0.0.1:8083";

export const WHISPER_MODEL_PRESETS: WhisperModelPreset[] = [
  {
    id: "tiny.en",
    label: "Tiny English",
    filename: "ggml-tiny.en.bin",
    sizeMb: 75,
    recommended: false,
    description: "Fastest local transcription model for low-memory machines and quick tests.",
  },
  {
    id: "base.en",
    label: "Base English",
    filename: "ggml-base.en.bin",
    sizeMb: 142,
    recommended: true,
    description: "Default local voice-input model with a better quality/speed balance.",
  },
];

const DEFAULT_MODEL_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function whisperModelDir() {
  return join(MODEL_DIR, "whisper.cpp");
}

function whisperCommand() {
  return process.env.NIPUX_WHISPER_COMMAND?.trim() || "whisper-cli";
}

function commandExists(command: string) {
  if (!command.trim()) return false;
  if (command.includes("/") || command.includes("\\")) return existsSync(command);
  const result = platform() === "win32"
    ? spawnSync("where", [command], { stdio: "ignore" })
    : spawnSync("sh", ["-c", `command -v ${shellArg(command)}`], { stdio: "ignore" });
  return result.status === 0;
}

function whisperCommandInstallHint(command: string) {
  return `Install whisper.cpp so ${command} is on PATH, or set NIPUX_WHISPER_COMMAND to a local whisper.cpp-compatible binary.`;
}

export function getWhisperModelPreset(id = DEFAULT_WHISPER_MODEL_PRESET) {
  return WHISPER_MODEL_PRESETS.find((preset) => preset.id === id) ?? WHISPER_MODEL_PRESETS.find((preset) => preset.id === DEFAULT_WHISPER_MODEL_PRESET)!;
}

export function whisperModelPath(id = DEFAULT_WHISPER_MODEL_PRESET) {
  const preset = getWhisperModelPreset(id);
  return join(whisperModelDir(), preset.filename);
}

export function whisperModelSourceUrl(id = DEFAULT_WHISPER_MODEL_PRESET) {
  const preset = getWhisperModelPreset(id);
  const baseUrl = process.env.NIPUX_WHISPER_MODEL_BASE_URL || DEFAULT_MODEL_BASE_URL;
  return `${baseUrl.replace(/\/$/, "")}/${preset.filename}`;
}

export function getConfiguredWhisperModelPath() {
  const envPath = process.env.NIPUX_WHISPER_MODEL?.trim();
  if (envPath) return envPath;
  const storedPath = getRawSetting(WHISPER_MODEL_SETTING_KEY, "").trim();
  return storedPath && existsSync(storedPath) ? storedPath : "";
}

export function whisperStartCommand(id = DEFAULT_WHISPER_MODEL_PRESET) {
  return `NIPUX_WHISPER_MODEL=${shellArg(whisperModelPath(id))} bun run worker:transcription`;
}

export function whisperInstallCommand(id = DEFAULT_WHISPER_MODEL_PRESET) {
  return `bun run transcription:install ${getWhisperModelPreset(id).id}`;
}

export function transcriptionPrepareCommand(id = DEFAULT_WHISPER_MODEL_PRESET, install = false) {
  return `bun run transcription:prepare ${getWhisperModelPreset(id).id}${install ? " --install" : ""}`;
}

export function getTranscriptionSetupPlan(): TranscriptionSetupPlan {
  const settings = getAppSettings();
  const command = whisperCommand();
  const commandInstalled = commandExists(command);
  const savedModelPath = getRawSetting(WHISPER_MODEL_SETTING_KEY, "");
  const configuredModelPath = getConfiguredWhisperModelPath();
  const installCommand = whisperInstallCommand();
  const startCommand = whisperStartCommand();
  const commands = {
    install: installCommand,
    prepare: transcriptionPrepareCommand(DEFAULT_WHISPER_MODEL_PRESET),
    prepareInstall: transcriptionPrepareCommand(DEFAULT_WHISPER_MODEL_PRESET, true),
    start: startCommand,
    local: "bun run local --open",
    workerUrl: `transcriptionWorkerUrl = ${DEFAULT_TRANSCRIPTION_WORKER_URL}`,
  };
  const nextSteps = [
    configuredModelPath ? "" : `Install the local Whisper model: ${commands.prepareInstall}`,
    commandInstalled ? "" : whisperCommandInstallHint(command),
    settings.transcriptionWorkerUrl === DEFAULT_TRANSCRIPTION_WORKER_URL ? "" : `Save the local worker URL: ${commands.prepare}`,
    "Run bun run local --open.",
  ].filter(Boolean);

  return {
    localOnly: true,
    workerUrl: DEFAULT_TRANSCRIPTION_WORKER_URL,
    presets: WHISPER_MODEL_PRESETS,
    recommendedPresetId: DEFAULT_WHISPER_MODEL_PRESET,
    configuredModelPath,
    savedModelPath,
    modelInstalled: Boolean(configuredModelPath),
    command: {
      envVar: "NIPUX_WHISPER_COMMAND",
      command,
      installed: commandInstalled,
      detail: commandInstalled ? `${command} is available.` : `${command} is not available on PATH.`,
      installHint: whisperCommandInstallHint(command),
    },
    settings,
    commands,
    nextSteps,
  };
}

export async function prepareTranscriptionSetup(input: {
  presetId?: string;
  install?: boolean;
} = {}): Promise<TranscriptionSetupPrepareResult> {
  const preset = getWhisperModelPreset(input.presetId);
  const existingTarget = whisperModelPath(preset.id);
  let install: WhisperModelInstallResult | undefined;
  if (input.install) {
    install = await installWhisperModel(preset.id);
  } else if (existsSync(existingTarget)) {
    setRawSetting(WHISPER_MODEL_SETTING_KEY, existingTarget);
  }

  const settings = updateAppSettings({ transcriptionWorkerUrl: DEFAULT_TRANSCRIPTION_WORKER_URL });
  const plan = getTranscriptionSetupPlan();
  const installed = Boolean(install?.configured || plan.configuredModelPath);
  const nextSteps = [
    installed ? "" : `Run ${transcriptionPrepareCommand(preset.id, true)} to download ${preset.label}.`,
    plan.command.installed ? "" : plan.command.installHint,
    "Run bun run local --open.",
  ].filter(Boolean);

  return {
    selectedPresetId: preset.id,
    installed,
    install,
    settings,
    plan,
    commands: plan.commands,
    nextSteps,
  };
}

export function formatTranscriptionSetupPlan(plan: TranscriptionSetupPlan) {
  const lines = [
    "Local transcription setup",
    `Worker URL: ${plan.workerUrl}`,
    `Model: ${plan.modelInstalled ? plan.configuredModelPath : "not installed"}`,
    `Command: ${plan.command.command} (${plan.command.installed ? "available" : "missing"})`,
    "",
    "Commands:",
    `  Prepare: ${plan.commands.prepare}`,
    `  Install and prepare: ${plan.commands.prepareInstall}`,
    `  Standalone worker: ${plan.commands.start}`,
    `  Launch app: ${plan.commands.local}`,
    "",
    "Next steps:",
  ];
  for (const step of plan.nextSteps.length ? plan.nextSteps : ["Run bun run local --open."]) lines.push(`  - ${step}`);
  return lines.join("\n");
}

export async function installWhisperModel(id = DEFAULT_WHISPER_MODEL_PRESET): Promise<WhisperModelInstallResult> {
  const preset = getWhisperModelPreset(id);
  const targetDir = whisperModelDir();
  const targetPath = whisperModelPath(preset.id);
  const partialPath = `${targetPath}.partial`;
  const sourceUrl = whisperModelSourceUrl(preset.id);

  mkdirSync(targetDir, { recursive: true });
  if (existsSync(targetPath)) {
    setRawSetting(WHISPER_MODEL_SETTING_KEY, targetPath);
    return {
      preset,
      targetPath,
      downloaded: false,
      configured: true,
      sizeBytes: statSync(targetPath).size,
      startCommand: whisperStartCommand(preset.id),
      localCommand: "bun run local --open",
      defaultsCommand: "bun run media:defaults",
      sourceUrl,
    };
  }

  const headers: string[] = [];
  if (process.env.HF_TOKEN) headers.push("-H", `Authorization: Bearer ${process.env.HF_TOKEN}`);
  const proc = Bun.spawn(["curl", "-L", "--fail", "--continue-at", "-", ...headers, "-o", partialPath, sourceUrl], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`Whisper model download failed: ${stderr || stdout}`);
  }
  renameSync(partialPath, targetPath);
  setRawSetting(WHISPER_MODEL_SETTING_KEY, targetPath);

  return {
    preset,
    targetPath,
    downloaded: true,
    configured: true,
    sizeBytes: statSync(targetPath).size,
    startCommand: whisperStartCommand(preset.id),
    localCommand: "bun run local --open",
    defaultsCommand: "bun run media:defaults",
    sourceUrl,
  };
}
