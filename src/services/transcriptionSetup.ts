import { existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { MODEL_DIR } from "../config.ts";
import { getRawSetting, setRawSetting } from "./settings.ts";

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

export const DEFAULT_WHISPER_MODEL_PRESET = "base.en";
export const WHISPER_MODEL_SETTING_KEY = "whisper_model_path";

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
