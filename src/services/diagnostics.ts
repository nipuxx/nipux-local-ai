import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { API_KEYS, BIND_HOST, DATA_DIR, DB_PATH, IS_DEV_UI, IS_FAKE_LLM, MODEL_DIR, NIPUX_HOME, PORT, PUBLIC_API, RUNTIME_DIR } from "../config.ts";
import { getApiExposurePlan } from "./apiExposure.ts";
import { detectHardware } from "./hardware.ts";
import { getLaunchProfile } from "./launchProfile.ts";
import { getLocalSupervisorPlan } from "./localSupervisor.ts";
import { getMediaRuntimePlan } from "./mediaRuntimes.ts";
import { listModels } from "./modelRegistry.ts";
import { getRuntimeStatus } from "./modelRuntime.ts";
import { getReadinessReport } from "./readiness.ts";
import { getSetupPreflight } from "./setupChecks.ts";
import { getSettingsStatus } from "./settings.ts";
import { getUsageSummary, getUsageTimeline } from "./usage.ts";

interface StorageStats {
  path: string;
  exists: boolean;
  bytes: number;
  files: number;
  directories: number;
  truncated: boolean;
}

function storageStats(path: string, maxEntries = 20000): StorageStats {
  const stats: StorageStats = { path, exists: existsSync(path), bytes: 0, files: 0, directories: 0, truncated: false };
  if (!stats.exists) return stats;

  const stack = [path];
  while (stack.length) {
    if (stats.files + stats.directories >= maxEntries) {
      stats.truncated = true;
      break;
    }

    const current = stack.pop()!;
    let currentStat;
    try {
      currentStat = lstatSync(current);
    } catch {
      continue;
    }

    if (currentStat.isDirectory()) {
      stats.directories += 1;
      try {
        for (const entry of readdirSync(current)) stack.push(join(current, entry));
      } catch {
        continue;
      }
    } else {
      stats.files += 1;
      stats.bytes += currentStat.size;
    }
  }

  return stats;
}

export async function getDiagnosticsReport() {
  const [hardware, setup, readiness, media, launchProfile, runtime] = await Promise.all([
    detectHardware(),
    getSetupPreflight(),
    getReadinessReport(),
    getMediaRuntimePlan(),
    getLaunchProfile(),
    getRuntimeStatus(),
  ]);
  const settingsStatus = getSettingsStatus();

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: "Nipux Local AI",
      home: NIPUX_HOME,
      localUrl: `http://127.0.0.1:${PORT}`,
      bindHost: BIND_HOST,
      publicApi: PUBLIC_API,
      fakeLlm: IS_FAKE_LLM,
      devUi: IS_DEV_UI,
      auth: {
        required: settingsStatus.env.authRequired,
        configured: settingsStatus.env.authConfigured,
        keyCount: (settingsStatus.env.envKeyCount ?? API_KEYS.length) + (settingsStatus.env.storedKeyCount ?? 0),
        envKeyCount: settingsStatus.env.envKeyCount ?? API_KEYS.length,
        storedKeyCount: settingsStatus.env.storedKeyCount ?? 0,
      },
    },
    settings: settingsStatus.settings,
    hardware,
    setup,
    readiness,
    runtime,
    supervisor: getLocalSupervisorPlan(),
    exposure: getApiExposurePlan(),
    launch: {
      mode: launchProfile.mode,
      commands: launchProfile.commands,
      files: launchProfile.files,
    },
    media,
    models: listModels().map((model) => ({
      id: model.id,
      label: model.label,
      family: model.family,
      parametersB: model.parametersB,
      quant: model.quant,
      state: model.state,
      localPath: model.localPath,
      estimatedRamGb: model.estimatedRamGb,
    })),
    usage: {
      summary: getUsageSummary(),
      recent: getUsageTimeline(20),
    },
    storage: {
      home: storageStats(NIPUX_HOME),
      data: storageStats(DATA_DIR),
      models: storageStats(MODEL_DIR),
      runtimes: storageStats(RUNTIME_DIR),
      database: storageStats(DB_PATH),
    },
  };
}
