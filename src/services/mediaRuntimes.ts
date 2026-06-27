import type { HardwareProfile } from "../types.ts";
import { detectHardware } from "./hardware.ts";
import { getMediaCapabilities, type MediaKind } from "./media.ts";
import { getAppSettings, updateAppSettings, type AppSettings } from "./settings.ts";
import { imageStartCommand, imageWorkerContract } from "./imageSetup.ts";
import { whisperInstallCommand, whisperStartCommand } from "./transcriptionSetup.ts";

type RuntimeStatus = "ready" | "unconfigured" | "invalid" | "offline";
type MediaSettingKey = "imageWorkerUrl" | "speechWorkerUrl" | "transcriptionWorkerUrl" | "videoWorkerUrl";

export interface MediaRuntimeCommand {
  label: string;
  command: string;
}

export interface MediaRuntimePlan {
  id: string;
  kind: MediaKind;
  label: string;
  workerLabel: string;
  status: RuntimeStatus;
  source: "worker" | "builtin" | "none";
  recommended: boolean;
  localOnly: true;
  workerUrl: string;
  defaultUrl: string;
  defaultPort: number;
  endpoint: string;
  settingKey: MediaSettingKey;
  envVar: string;
  hardwareFit: string;
  setup: string;
  health: {
    checked: boolean;
    reachable: boolean;
    detail: string;
    statusCode?: number;
  };
  commands: MediaRuntimeCommand[];
  notes: string[];
}

export interface MediaRuntimePlannerResult {
  hardware: HardwareProfile;
  runtimes: MediaRuntimePlan[];
  nextSteps: string[];
}

export interface MediaRuntimeDefaultsResult {
  settings: AppSettings;
  applied: Array<{ kind: MediaKind; label: string; settingKey: MediaSettingKey; workerUrl: string }>;
  skipped: Array<{ kind: MediaKind; label: string; reason: string }>;
  plan: MediaRuntimePlannerResult;
}

const MEDIA_RUNTIME_CONFIG: Record<
  MediaKind,
  {
    id: string;
    label: string;
    workerLabel: string;
    defaultPort: number;
    endpoint: string;
    settingKey: MediaSettingKey;
    envVar: string;
    setup: string;
    notes: string[];
  }
> = {
  image: {
    id: "image-openai-worker",
    label: "Image Generation",
    workerLabel: "OpenAI-compatible local image worker",
    defaultPort: 8081,
    endpoint: "/v1/images/generations",
    settingKey: "imageWorkerUrl",
    envVar: "NIPUX_IMAGE_WORKER_URL",
    setup: "Start the bundled local image command worker, then configure its loopback URL before image generation is available.",
    notes: [
      imageWorkerContract(),
      "This is the adapter slot for Ideogram/Krea-quality local image models once local weights and redistribution terms are clear.",
      "Do not point this at external hosted image APIs; remote URLs are rejected.",
    ],
  },
  speech: {
    id: "speech-openai-worker",
    label: "Text to Speech",
    workerLabel: "Kokoro/Piper-style local speech worker",
    defaultPort: 8082,
    endpoint: "/v1/audio/speech",
    settingKey: "speechWorkerUrl",
    envVar: "NIPUX_SPEECH_WORKER_URL",
    setup: "Configure a loopback speech worker before text-to-speech is available.",
    notes: ["Speech is the best first bundled media runtime because it can be CPU-friendly."],
  },
  transcription: {
    id: "transcription-worker",
    label: "Speech to Text",
    workerLabel: "whisper.cpp-style local transcription worker",
    defaultPort: 8083,
    endpoint: "/v1/audio/transcriptions",
    settingKey: "transcriptionWorkerUrl",
    envVar: "NIPUX_TRANSCRIPTION_WORKER_URL",
    setup: "Configure a loopback transcription worker before speech-to-text is available.",
    notes: ["Small transcription models should stay available on CPU-only machines."],
  },
  video: {
    id: "video-worker",
    label: "Video Generation",
    workerLabel: "Queued local video worker",
    defaultPort: 8084,
    endpoint: "/v1/video/generations",
    settingKey: "videoWorkerUrl",
    envVar: "NIPUX_VIDEO_WORKER_URL",
    setup: "Configure a loopback video worker only on machines with enough GPU or unified memory.",
    notes: ["Video should remain opt-in and queued because runtime cost varies heavily by machine."],
  },
};

function defaultUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

function hardwareFit(kind: MediaKind, hardware: HardwareProfile) {
  const gpu = hardware.accelerator !== "cpu";
  const ram = hardware.totalRamGb;

  if (kind === "speech") {
    if (ram < 8) return "Usable with very small voices, but install should warn about low memory.";
    return "Good CPU-first fit; bundle this before heavier visual runtimes.";
  }

  if (kind === "transcription") {
    if (ram < 8) return "Use the smallest local transcription model and short clips.";
    if (gpu) return `Good fit with ${hardware.accelerator}; CPU fallback should still work.`;
    return "CPU fallback fit; prefer small or base transcription models.";
  }

  if (kind === "image") {
    if (hardware.accelerator === "cuda") return "Best visual-runtime target; tune worker defaults around available VRAM.";
    if (hardware.accelerator === "metal") {
      return ram >= 32
        ? "Good unified-memory target; use conservative image sizes by default."
        : "Possible on Apple unified memory, but default to smaller image sizes.";
    }
    if (["rocm", "vulkan", "directml"].includes(hardware.accelerator)) {
      return "Possible, but backend support is more variable than CUDA/Metal.";
    }
    return "CPU-only image generation is too slow for the default consumer path.";
  }

  if (gpu && ram >= 32) return `Experimental fit on ${hardware.accelerator}; keep jobs queued and cancellable.`;
  if (gpu) return "Experimental; likely constrained by memory and should stay dev-only.";
  return "Not a default CPU-only runtime; leave unconfigured unless the user installs a tiny worker.";
}

function recommended(kind: MediaKind, hardware: HardwareProfile) {
  if (kind === "speech") return hardware.totalRamGb >= 4;
  if (kind === "transcription") return hardware.totalRamGb >= 8;
  if (kind === "image") return hardware.accelerator !== "cpu" && hardware.totalRamGb >= 12;
  return hardware.accelerator !== "cpu" && hardware.totalRamGb >= 32;
}

function commandsFor(kind: MediaKind, config: (typeof MEDIA_RUNTIME_CONFIG)[MediaKind]): MediaRuntimeCommand[] {
  const url = defaultUrl(config.defaultPort);
  const startCommand = kind === "image"
    ? imageStartCommand()
    : kind === "transcription"
      ? whisperStartCommand()
      : `${config.envVar}=${url} bun run start`;
  const commands: MediaRuntimeCommand[] = [
    {
      label: ["image", "transcription"].includes(kind) ? "Start bundled worker" : "macOS/Linux environment",
      command: startCommand,
    },
    {
      label: "Persist in Settings",
      command: `${config.settingKey} = ${url}`,
    },
    {
      label: "Worker contract",
      command: `POST ${url}${config.endpoint}`,
    },
    {
      label: "Refresh planner",
      command: "bun run media:runtimes",
    },
  ];
  if (kind === "transcription") {
    commands.splice(0, 0, { label: "Install local model", command: whisperInstallCommand() });
  }
  return commands;
}

function startCommandFor(runtime: MediaRuntimePlan) {
  return runtime.commands.find((command) => command.label.toLowerCase().includes("start"))?.command ?? runtime.commands[0]?.command;
}

export async function getMediaRuntimePlan(): Promise<MediaRuntimePlannerResult> {
  const [hardware, capabilityResult] = await Promise.all([detectHardware(), getMediaCapabilities()]);
  const capabilities = capabilityResult.capabilities;
  const runtimes = (Object.keys(MEDIA_RUNTIME_CONFIG) as MediaKind[]).map((kind) => {
    const config = MEDIA_RUNTIME_CONFIG[kind];
    const capability = capabilities[kind];
    return {
      id: config.id,
      kind,
      label: config.label,
      workerLabel: capability.source === "builtin" ? "Built-in system speech" : config.workerLabel,
      status: capability.status,
      source: capability.source,
      recommended: recommended(kind, hardware),
      localOnly: true as const,
      workerUrl: capability.workerUrl,
      defaultUrl: defaultUrl(config.defaultPort),
      defaultPort: config.defaultPort,
      endpoint: config.endpoint,
      settingKey: config.settingKey,
      envVar: config.envVar,
      hardwareFit: hardwareFit(kind, hardware),
      setup: ["invalid", "offline"].includes(capability.status) || capability.source === "builtin" ? capability.setup : config.setup,
      health: capability.health ?? {
        checked: capability.source === "builtin",
        reachable: capability.status === "ready",
        detail: capability.source === "builtin" ? capability.setup : capability.setup,
      },
      commands: commandsFor(kind, config),
      notes: config.notes,
    };
  });

  const nextSteps = runtimes.flatMap((runtime) => {
    if (runtime.status === "invalid") {
      return [`Fix ${runtime.label}: ${runtime.envVar} must be a loopback URL such as ${runtime.defaultUrl}.`];
    }
    if (runtime.status === "offline") {
      return [`Start ${runtime.workerLabel} on ${runtime.workerUrl}, or clear ${runtime.envVar} to disable this lane.`];
    }
    if (runtime.source === "builtin") return [];
    if (runtime.status === "unconfigured" && runtime.recommended) {
      if (runtime.kind === "image") {
        return [`Run ${startCommandFor(runtime)}, then run bun run media:defaults.`];
      }
      if (runtime.kind === "transcription") {
        return [`Run ${whisperInstallCommand()}, then run ${startCommandFor(runtime)}, then run bun run media:defaults.`];
      }
      return [`Start ${runtime.workerLabel} on ${runtime.defaultUrl}, then set ${runtime.envVar}.`];
    }
    if (runtime.status === "unconfigured") {
      return [`Keep ${runtime.label} unconfigured on this hardware unless the user explicitly installs a local worker.`];
    }
    return [];
  });

  return { hardware, runtimes, nextSteps };
}

export async function applyRecommendedMediaRuntimeDefaults(input: {
  includeOptional?: boolean;
  overwrite?: boolean;
  kinds?: MediaKind[];
} = {}): Promise<MediaRuntimeDefaultsResult> {
  const before = await getMediaRuntimePlan();
  const settingsPatch: Partial<AppSettings> = {};
  const applied: MediaRuntimeDefaultsResult["applied"] = [];
  const skipped: MediaRuntimeDefaultsResult["skipped"] = [];
  const kindFilter = input.kinds?.length ? new Set(input.kinds) : null;
  const currentSettings = getAppSettings();

  for (const runtime of before.runtimes) {
    if (kindFilter && !kindFilter.has(runtime.kind)) {
      skipped.push({ kind: runtime.kind, label: runtime.label, reason: "Not requested." });
      continue;
    }
    if (runtime.source === "builtin") {
      skipped.push({ kind: runtime.kind, label: runtime.label, reason: "Built-in local runtime is already available." });
      continue;
    }
    if (!runtime.recommended && !input.includeOptional) {
      skipped.push({ kind: runtime.kind, label: runtime.label, reason: "Not recommended for this hardware profile." });
      continue;
    }
    if (currentSettings[runtime.settingKey] && !input.overwrite) {
      skipped.push({ kind: runtime.kind, label: runtime.label, reason: "A worker URL is already configured." });
      continue;
    }

    settingsPatch[runtime.settingKey] = runtime.defaultUrl;
    applied.push({
      kind: runtime.kind,
      label: runtime.label,
      settingKey: runtime.settingKey,
      workerUrl: runtime.defaultUrl,
    });
  }

  const settings = applied.length ? updateAppSettings(settingsPatch) : currentSettings;
  const plan = await getMediaRuntimePlan();
  return { settings, applied, skipped, plan };
}

export function formatMediaRuntimePlan(plan: MediaRuntimePlannerResult) {
  const lines = [
    `Hardware: ${plan.hardware.os} ${plan.hardware.arch}, ${plan.hardware.totalRamGb}GB RAM, ${plan.hardware.accelerator}`,
    "",
  ];
  for (const runtime of plan.runtimes) {
    lines.push(`${runtime.label} (${runtime.kind})`);
    lines.push(`  Status: ${runtime.status}${runtime.workerUrl ? ` at ${runtime.workerUrl}` : ""}`);
    lines.push(`  Worker: ${runtime.workerLabel}`);
    lines.push(`  Fit: ${runtime.hardwareFit}`);
    lines.push(`  Default URL: ${runtime.defaultUrl}`);
    lines.push(`  Env: ${runtime.envVar}`);
    lines.push(`  Contract: ${runtime.endpoint}`);
    lines.push(`  Health: ${runtime.health.detail}`);
    lines.push(`  Recommended now: ${runtime.recommended ? "yes" : "no"}`);
    lines.push("");
  }
  lines.push("Next steps:");
  for (const step of plan.nextSteps.length ? plan.nextSteps : ["All configured media workers are local loopback URLs."]) {
    lines.push(`  - ${step}`);
  }
  return lines.join("\n");
}
