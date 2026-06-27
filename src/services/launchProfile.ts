import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { API_KEYS, BIND_HOST, IS_FAKE_LLM, LLAMA_BASE_URL, NIPUX_HOME, PORT, PUBLIC_API } from "../config.ts";
import type { HardwareProfile } from "../types.ts";
import { activeStoredApiKeyCount } from "./apiKeys.ts";
import { detectHardware } from "./hardware.ts";
import { getMediaRuntimePlan, type MediaRuntimePlan } from "./mediaRuntimes.ts";
import { getModel, llamaServeCommand } from "./modelRegistry.ts";
import { getReadinessReport, type ReadinessReport } from "./readiness.ts";
import { getAppSettings, type AppSettings } from "./settings.ts";

const REPO_ROOT = resolve(import.meta.dir, "../..");

export interface LaunchProfile {
  version: 1;
  generatedAt: string;
  app: string;
  repoRoot: string;
  home: string;
  localUrl: string;
  apiBaseUrl: string;
  bindHost: string;
  port: number;
  mode: "dev" | "local";
  publicApi: boolean;
  auth: {
    required: boolean;
    serverKeyConfigured: boolean;
    envKeyCount: number;
    storedKeyCount: number;
  };
  hardware: HardwareProfile;
  settings: AppSettings;
  model: {
    preset: string;
    label: string;
    llamaRef: string;
    command: string;
    backendUrl: string;
  };
  media: Array<Pick<MediaRuntimePlan, "kind" | "label" | "status" | "workerUrl" | "defaultUrl" | "recommended" | "health">>;
  commands: {
    oneCommandLocal: string;
    oneCommandDev: string;
    setup: string;
    appDev: string;
    appLocal: string;
    model: string;
    readiness: string;
    preflight: string;
    mediaDefaults: string;
    browsersInstall: string;
    openUi: string;
  };
  files: {
    profileJson: string;
    envFile: string;
    startLocalSh: string;
    startDevSh: string;
    startLocalPs1: string;
    startDevPs1: string;
  };
  env: {
    local: Record<string, string>;
    dev: Record<string, string>;
  };
  readiness: Pick<ReadinessReport, "usable" | "headline" | "counts" | "nextSteps">;
}

export interface LaunchProfileWriteResult {
  profile: LaunchProfile;
  written: string[];
}

function localHost() {
  return BIND_HOST === "0.0.0.0" ? "127.0.0.1" : BIND_HOST;
}

function fileTargets() {
  return {
    profileJson: join(NIPUX_HOME, "launch-profile.json"),
    envFile: join(NIPUX_HOME, "nipux.env"),
    startLocalSh: join(NIPUX_HOME, "start-local.sh"),
    startDevSh: join(NIPUX_HOME, "start-dev.sh"),
    startLocalPs1: join(NIPUX_HOME, "start-local.ps1"),
    startDevPs1: join(NIPUX_HOME, "start-dev.ps1"),
  };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function powershellQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

function envFor(settings: AppSettings, fakeLlm: boolean) {
  return {
    NIPUX_HOME,
    NIPUX_PORT: String(PORT),
    NIPUX_BIND_HOST: BIND_HOST,
    NIPUX_PUBLIC_API: PUBLIC_API ? "1" : "0",
    NIPUX_LLAMA_BASE_URL: LLAMA_BASE_URL,
    NIPUX_LLAMA_COMMAND: process.env.NIPUX_LLAMA_COMMAND ?? "",
    NIPUX_LLAMA_MODEL_PATH: process.env.NIPUX_LLAMA_MODEL_PATH ?? "",
    NIPUX_SEARXNG_URL: settings.searxngUrl,
    NIPUX_IMAGE_WORKER_URL: settings.imageWorkerUrl,
    NIPUX_IMAGE_COMMAND: process.env.NIPUX_IMAGE_COMMAND ?? "",
    NIPUX_IMAGE_ARGS: process.env.NIPUX_IMAGE_ARGS ?? "",
    NIPUX_IMAGE_MODEL: process.env.NIPUX_IMAGE_MODEL ?? "",
    NIPUX_SPEECH_WORKER_URL: settings.speechWorkerUrl,
    NIPUX_TRANSCRIPTION_WORKER_URL: settings.transcriptionWorkerUrl,
    NIPUX_VIDEO_WORKER_URL: settings.videoWorkerUrl,
    NIPUX_VIDEO_COMMAND: process.env.NIPUX_VIDEO_COMMAND ?? "",
    NIPUX_VIDEO_ARGS: process.env.NIPUX_VIDEO_ARGS ?? "",
    NIPUX_VIDEO_MODEL: process.env.NIPUX_VIDEO_MODEL ?? "",
    NIPUX_BROWSER_HEADLESS: settings.browserHeadless ? "1" : "0",
    NIPUX_DEV_UI: settings.devMode || fakeLlm ? "1" : "0",
    NIPUX_FAKE_LLM: fakeLlm ? "1" : "0",
  };
}

function envText(env: Record<string, string>) {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

function shLauncher(profile: LaunchProfile, fakeLlm: boolean) {
  const env = envFor(profile.settings, fakeLlm);
  return [
    "#!/usr/bin/env sh",
    "set -eu",
    `cd ${shellQuote(profile.repoRoot)}`,
    ...Object.entries(env).map(([key, value]) => `export ${key}=${shellQuote(value)}`),
    "exec bun run local",
    "",
  ].join("\n");
}

function ps1Launcher(profile: LaunchProfile, fakeLlm: boolean) {
  const env = envFor(profile.settings, fakeLlm);
  return [
    `Set-Location ${powershellQuote(profile.repoRoot)}`,
    ...Object.entries(env).map(([key, value]) => `$env:${key} = ${powershellQuote(value)}`),
    "bun run local",
    "",
  ].join("\n");
}

export async function getLaunchProfile(): Promise<LaunchProfile> {
  const [hardware, mediaPlan, readiness] = await Promise.all([detectHardware(), getMediaRuntimePlan(), getReadinessReport()]);
  const settings = getAppSettings();
  const model = getModel(settings.defaultModelPreset);
  const localUrl = `http://${localHost()}:${PORT}`;
  const files = fileTargets();
  const storedKeyCount = activeStoredApiKeyCount();

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    app: "Nipux Local AI",
    repoRoot: REPO_ROOT,
    home: NIPUX_HOME,
    localUrl,
    apiBaseUrl: `${localUrl}/v1`,
    bindHost: BIND_HOST,
    port: PORT,
    mode: IS_FAKE_LLM ? "dev" : "local",
    publicApi: PUBLIC_API,
    auth: {
      required: API_KEYS.length + storedKeyCount > 0 || PUBLIC_API,
      serverKeyConfigured: API_KEYS.length + storedKeyCount > 0,
      envKeyCount: API_KEYS.length,
      storedKeyCount,
    },
    hardware,
    settings,
    model: {
      preset: model.id,
      label: model.label,
      llamaRef: model.llamaRef,
      command: llamaServeCommand(model.id),
      backendUrl: LLAMA_BASE_URL,
    },
    media: mediaPlan.runtimes.map((runtime) => ({
      kind: runtime.kind,
      label: runtime.label,
      status: runtime.status,
      workerUrl: runtime.workerUrl,
      defaultUrl: runtime.defaultUrl,
      recommended: runtime.recommended,
      health: runtime.health,
    })),
    commands: {
      oneCommandLocal: "bun run setup && bun run local",
      oneCommandDev: "bun run setup && bun run dev",
      setup: "bun run setup",
      appDev: "NIPUX_FAKE_LLM=1 NIPUX_DEV_UI=1 bun run local",
      appLocal: "bun run local",
      model: llamaServeCommand(model.id),
      readiness: "bun run ready",
      preflight: "bun run preflight",
      mediaDefaults: "bun run media:defaults",
      browsersInstall: "bun run browsers:install",
      openUi: localUrl,
    },
    files,
    env: {
      local: envFor(settings, false),
      dev: envFor(settings, true),
    },
    readiness: {
      usable: readiness.usable,
      headline: readiness.headline,
      counts: readiness.counts,
      nextSteps: readiness.nextSteps,
    },
  };
}

export async function writeLaunchProfileFiles(): Promise<LaunchProfileWriteResult> {
  const profile = await getLaunchProfile();
  mkdirSync(NIPUX_HOME, { recursive: true });
  const written: string[] = [];

  writeFileSync(profile.files.profileJson, JSON.stringify(profile, null, 2) + "\n");
  written.push(profile.files.profileJson);

  writeFileSync(profile.files.envFile, envText(profile.env.local));
  written.push(profile.files.envFile);

  writeFileSync(profile.files.startLocalSh, shLauncher(profile, false));
  chmodSync(profile.files.startLocalSh, 0o755);
  written.push(profile.files.startLocalSh);

  writeFileSync(profile.files.startDevSh, shLauncher(profile, true));
  chmodSync(profile.files.startDevSh, 0o755);
  written.push(profile.files.startDevSh);

  writeFileSync(profile.files.startLocalPs1, ps1Launcher(profile, false));
  written.push(profile.files.startLocalPs1);

  writeFileSync(profile.files.startDevPs1, ps1Launcher(profile, true));
  written.push(profile.files.startDevPs1);

  return { profile, written };
}

export function formatLaunchProfile(profile: LaunchProfile) {
  return [
    `Nipux Local AI launch profile`,
    `Home: ${profile.home}`,
    `UI: ${profile.localUrl}`,
    `API: ${profile.apiBaseUrl}`,
    `Mode: ${profile.mode}`,
    `Hardware: ${profile.hardware.os} ${profile.hardware.arch}, ${profile.hardware.totalRamGb}GB RAM, ${profile.hardware.accelerator}`,
    `Model: ${profile.model.label} (${profile.model.preset})`,
    "",
    "Commands:",
    `  Local: ${profile.commands.oneCommandLocal}`,
    `  Dev:   ${profile.commands.oneCommandDev}`,
    `  Model: ${profile.commands.model}`,
    `  App:   ${profile.commands.appLocal}`,
    `  Ready: ${profile.commands.readiness}`,
    "",
    "Files:",
    `  Profile: ${profile.files.profileJson}`,
    `  Env:     ${profile.files.envFile}`,
    `  macOS/Linux dev launcher: ${profile.files.startDevSh}`,
    `  Windows dev launcher:     ${profile.files.startDevPs1}`,
  ].join("\n");
}
