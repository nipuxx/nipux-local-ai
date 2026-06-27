import {
  API_KEYS,
  BIND_HOST,
  IS_DEV_UI,
  PUBLIC_API,
  SEARXNG_URL,
} from "../config.ts";
import { db } from "../db.ts";

export interface AppSettings {
  searxngUrl: string;
  browserHeadless: boolean;
  devMode: boolean;
  defaultModelPreset: "fast" | "balanced" | "smart";
}

const DEFAULTS: AppSettings = {
  searxngUrl: SEARXNG_URL,
  browserHeadless: process.env.NIPUX_BROWSER_HEADLESS !== "0",
  devMode: IS_DEV_UI,
  defaultModelPreset: "balanced",
};

const KEYS: Record<keyof AppSettings, string> = {
  searxngUrl: "searxng_url",
  browserHeadless: "browser_headless",
  devMode: "dev_mode",
  defaultModelPreset: "default_model_preset",
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
  return {
    searxngUrl: getRawSetting(KEYS.searxngUrl, DEFAULTS.searxngUrl),
    browserHeadless: bool(getRawSetting(KEYS.browserHeadless, encode(DEFAULTS.browserHeadless)), DEFAULTS.browserHeadless),
    devMode: bool(getRawSetting(KEYS.devMode, encode(DEFAULTS.devMode)), DEFAULTS.devMode),
    defaultModelPreset: ["fast", "balanced", "smart"].includes(modelPreset)
      ? (modelPreset as AppSettings["defaultModelPreset"])
      : DEFAULTS.defaultModelPreset,
  };
}

export function updateAppSettings(patch: Partial<AppSettings>) {
  if (typeof patch.searxngUrl === "string") setRawSetting(KEYS.searxngUrl, patch.searxngUrl.trim());
  if (typeof patch.browserHeadless === "boolean") setRawSetting(KEYS.browserHeadless, patch.browserHeadless);
  if (typeof patch.devMode === "boolean") setRawSetting(KEYS.devMode, patch.devMode);
  if (patch.defaultModelPreset && ["fast", "balanced", "smart"].includes(patch.defaultModelPreset)) {
    setRawSetting(KEYS.defaultModelPreset, patch.defaultModelPreset);
  }
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
