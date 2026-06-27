import {
  API_KEYS,
  BIND_HOST,
  IMAGE_WORKER_URL,
  IS_DEV_UI,
  PUBLIC_API,
  SEARXNG_URL,
  SPEECH_WORKER_URL,
  TRANSCRIPTION_WORKER_URL,
  VIDEO_WORKER_URL,
} from "../config.ts";
import { db } from "../db.ts";
import { listModels } from "./modelRegistry.ts";

export interface AppSettings {
  searxngUrl: string;
  browserHeadless: boolean;
  devMode: boolean;
  defaultModelPreset: string;
  imageWorkerUrl: string;
  speechWorkerUrl: string;
  transcriptionWorkerUrl: string;
  videoWorkerUrl: string;
}

const DEFAULTS: AppSettings = {
  searxngUrl: SEARXNG_URL,
  browserHeadless: process.env.NIPUX_BROWSER_HEADLESS !== "0",
  devMode: IS_DEV_UI,
  defaultModelPreset: "balanced",
  imageWorkerUrl: IMAGE_WORKER_URL,
  speechWorkerUrl: SPEECH_WORKER_URL,
  transcriptionWorkerUrl: TRANSCRIPTION_WORKER_URL,
  videoWorkerUrl: VIDEO_WORKER_URL,
};

const KEYS: Record<keyof AppSettings, string> = {
  searxngUrl: "searxng_url",
  browserHeadless: "browser_headless",
  devMode: "dev_mode",
  defaultModelPreset: "default_model_preset",
  imageWorkerUrl: "image_worker_url",
  speechWorkerUrl: "speech_worker_url",
  transcriptionWorkerUrl: "transcription_worker_url",
  videoWorkerUrl: "video_worker_url",
};

function encode(value: string | boolean) {
  return typeof value === "boolean" ? (value ? "1" : "0") : value;
}

function bool(value: string, fallback: boolean) {
  if (value === "1" || value === "true") return true;
  if (value === "0" || value === "false") return false;
  return fallback;
}

export function getRawSetting(key: string, fallback = "") {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? fallback;
}

export function setRawSetting(key: string, value: string | boolean) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, encode(value));
}

export function getAppSettings(): AppSettings {
  const modelPreset = getRawSetting(KEYS.defaultModelPreset, DEFAULTS.defaultModelPreset);
  const modelIds = new Set(listModels().map((model) => model.id));
  return {
    searxngUrl: getRawSetting(KEYS.searxngUrl, DEFAULTS.searxngUrl),
    browserHeadless: bool(getRawSetting(KEYS.browserHeadless, encode(DEFAULTS.browserHeadless)), DEFAULTS.browserHeadless),
    devMode: bool(getRawSetting(KEYS.devMode, encode(DEFAULTS.devMode)), DEFAULTS.devMode),
    defaultModelPreset: modelIds.has(modelPreset) ? modelPreset : DEFAULTS.defaultModelPreset,
    imageWorkerUrl: getRawSetting(KEYS.imageWorkerUrl, DEFAULTS.imageWorkerUrl),
    speechWorkerUrl: getRawSetting(KEYS.speechWorkerUrl, DEFAULTS.speechWorkerUrl),
    transcriptionWorkerUrl: getRawSetting(KEYS.transcriptionWorkerUrl, DEFAULTS.transcriptionWorkerUrl),
    videoWorkerUrl: getRawSetting(KEYS.videoWorkerUrl, DEFAULTS.videoWorkerUrl),
  };
}

export function updateAppSettings(patch: Partial<AppSettings>) {
  if (typeof patch.searxngUrl === "string") setRawSetting(KEYS.searxngUrl, patch.searxngUrl.trim());
  if (typeof patch.browserHeadless === "boolean") setRawSetting(KEYS.browserHeadless, patch.browserHeadless);
  if (typeof patch.devMode === "boolean") setRawSetting(KEYS.devMode, patch.devMode);
  if (patch.defaultModelPreset && listModels().some((model) => model.id === patch.defaultModelPreset)) {
    setRawSetting(KEYS.defaultModelPreset, patch.defaultModelPreset);
  }
  if (typeof patch.imageWorkerUrl === "string") setRawSetting(KEYS.imageWorkerUrl, patch.imageWorkerUrl.trim());
  if (typeof patch.speechWorkerUrl === "string") setRawSetting(KEYS.speechWorkerUrl, patch.speechWorkerUrl.trim());
  if (typeof patch.transcriptionWorkerUrl === "string") setRawSetting(KEYS.transcriptionWorkerUrl, patch.transcriptionWorkerUrl.trim());
  if (typeof patch.videoWorkerUrl === "string") setRawSetting(KEYS.videoWorkerUrl, patch.videoWorkerUrl.trim());
  return getAppSettings();
}

export function getSettingsStatus() {
  return {
    settings: getAppSettings(),
    env: {
      bindHost: BIND_HOST,
      publicApi: PUBLIC_API,
      authRequired: API_KEYS.length > 0 || PUBLIC_API,
      authConfigured: API_KEYS.length > 0,
    },
  };
}
