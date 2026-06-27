import type { HardwareProfile } from "../types.ts";
import { detectHardware } from "./hardware.ts";

export type CapabilityTier = "minimal" | "cpu-standard" | "accelerated" | "workstation";
export type CapabilityLaneStatus = "default" | "available" | "slow" | "optional" | "blocked";

export interface CapabilityLane {
  id: string;
  label: string;
  status: CapabilityLaneStatus;
  defaultEnabled: boolean;
  summary: string;
  limits: string[];
  commands: string[];
}

export interface CapabilityProfile {
  tier: CapabilityTier;
  tierLabel: string;
  headline: string;
  hardware: HardwareProfile;
  recommendedPreset: HardwareProfile["recommendedPreset"];
  defaultLanes: string[];
  optionalLanes: string[];
  blockedLanes: string[];
  lanes: CapabilityLane[];
  assumptions: string[];
  commands: {
    startLocal: string;
    startDev: string;
    installModel: string;
    mediaDefaults: string;
    mediaDefaultsOptional: string;
  };
}

function hasGpu(hardware: HardwareProfile) {
  return hardware.accelerator !== "cpu";
}

function isVariableGpu(hardware: HardwareProfile) {
  return ["rocm", "vulkan", "directml"].includes(hardware.accelerator);
}

function tierFor(hardware: HardwareProfile): CapabilityTier {
  if (hasGpu(hardware) && hardware.totalRamGb >= 40) return "workstation";
  if (hasGpu(hardware) && hardware.totalRamGb >= 12) return "accelerated";
  if (hardware.totalRamGb >= 16) return "cpu-standard";
  return "minimal";
}

function tierLabel(tier: CapabilityTier) {
  if (tier === "workstation") return "High-memory workstation";
  if (tier === "accelerated") return "GPU-accelerated machine";
  if (tier === "cpu-standard") return "CPU-standard machine";
  return "Minimal CPU machine";
}

function headlineFor(tier: CapabilityTier, hardware: HardwareProfile) {
  if (tier === "workstation") return `Use Smart mode for chat and keep image/video jobs opt-in on ${hardware.accelerator}.`;
  if (tier === "accelerated") return `Use ${hardware.recommendedPreset} mode and enable visual workers only after local backend setup.`;
  if (tier === "cpu-standard") return "Use Balanced chat, local search, agents, and voice; keep image/video off by default.";
  return "Use Fast chat and local search first; heavy media should stay hidden or queued.";
}

function lane(input: CapabilityLane): CapabilityLane {
  return input;
}

export function buildCapabilityProfile(hardware: HardwareProfile): CapabilityProfile {
  const tier = tierFor(hardware);
  const gpu = hasGpu(hardware);
  const variableGpu = isVariableGpu(hardware);
  const ram = hardware.totalRamGb;
  const recommendedPreset = hardware.recommendedPreset;
  const visualDefault = gpu && ram >= 16 && !variableGpu;
  const visualOptional = gpu && ram >= 12;
  const videoOptional = gpu && ram >= 32;
  const videoWorkstation = gpu && ram >= 40;

  const lanes = [
    lane({
      id: "chat",
      label: "Local Chat",
      status: ram < 6 ? "slow" : "default",
      defaultEnabled: true,
      summary: `${recommendedPreset[0].toUpperCase()}${recommendedPreset.slice(1)} mode is the default LLM target for this machine.`,
      limits: ram < 8 ? ["Use small GGUF models and shorter context windows."] : ["Model size still depends on installed local weights."],
      commands: [`bun run model:install ${recommendedPreset}`, "bun run local"],
    }),
    lane({
      id: "search",
      label: "Local Search",
      status: "default",
      defaultEnabled: true,
      summary: "Local file indexing and citations are safe defaults on every supported machine.",
      limits: ["Large folders should be imported in bounded batches."],
      commands: ["bun run ready"],
    }),
    lane({
      id: "agents",
      label: "Agents",
      status: ram < 8 ? "slow" : "default",
      defaultEnabled: true,
      summary: "Agents can use memory, local search, web search, and browser sessions with permission gates.",
      limits: ram < 8 ? ["Keep agent tasks short and avoid multiple browser sessions."] : ["Background runs still share the same local model budget."],
      commands: ["bun run browsers:install"],
    }),
    lane({
      id: "browser",
      label: "Browser Control",
      status: ram < 8 ? "optional" : "default",
      defaultEnabled: ram >= 8,
      summary: "Playwright browser sessions are useful for agents and user takeover.",
      limits: ram < 8 ? ["Browser sessions may compete with local models for memory."] : ["Visible browser mode costs more memory than screenshot mode."],
      commands: ["bun run browsers:install"],
    }),
    lane({
      id: "speech",
      label: "Voice Output",
      status: "default",
      defaultEnabled: true,
      summary: "Built-in OS speech can work without a model worker; higher-quality voices remain replaceable.",
      limits: ["Voice quality depends on the OS speech engine unless a local speech worker is configured."],
      commands: ["bun run ready"],
    }),
    lane({
      id: "transcription",
      label: "Voice Input",
      status: ram >= 8 ? "available" : ram >= 4 ? "slow" : "blocked",
      defaultEnabled: ram >= 8,
      summary: ram >= 8 ? "Small Whisper models are a reasonable local setup target." : "Voice transcription needs a very small model or should stay off.",
      limits: ram >= 8 ? ["Long recordings should stay queued and chunked."] : ["Use short clips only; skip this on very low-memory machines."],
      commands: ["bun run transcription:install base.en", "bun run worker:transcription", "bun run media:defaults"],
    }),
    lane({
      id: "image",
      label: "Image Generation",
      status: visualDefault ? "available" : visualOptional ? "optional" : "blocked",
      defaultEnabled: false,
      summary: visualDefault
        ? "Image generation can be offered after a local image backend is installed."
        : visualOptional
          ? "Image generation may work, but should stay opt-in on this accelerator."
          : "Image generation should stay off by default on CPU-only or low-memory machines.",
      limits: [
        "Keep this as a simple prompt UI, not a node graph.",
        "Do not call hosted image APIs from the local-only path.",
      ],
      commands: ["NIPUX_IMAGE_COMMAND=/path/to/local-image-command bun run worker:image", "bun run media:defaults"],
    }),
    lane({
      id: "video",
      label: "Video Generation",
      status: videoWorkstation ? "optional" : videoOptional ? "slow" : "blocked",
      defaultEnabled: false,
      summary: videoWorkstation
        ? "Video can be offered as an opt-in queued worker on this class of machine."
        : videoOptional
          ? "Video may run slowly and should stay queued, cancellable, and dev-gated."
          : "Video generation should stay hidden unless the user installs a tiny local worker.",
      limits: ["Never make local video part of first-run setup.", "Use queued jobs and clear progress/error states."],
      commands: ["NIPUX_VIDEO_COMMAND=/path/to/local-video-command bun run worker:video", "bun run media:defaults --include-optional"],
    }),
    lane({
      id: "api",
      label: "Local/Public API",
      status: "default",
      defaultEnabled: true,
      summary: "OpenAI-compatible local APIs can run on every machine; LAN/public mode needs an API key.",
      limits: ["Keep localhost private by default.", "Expose LAN mode only after creating a server key."],
      commands: ["bun run local", "NIPUX_PUBLIC_API=1 bun run local"],
    }),
  ];

  return {
    tier,
    tierLabel: tierLabel(tier),
    headline: headlineFor(tier, hardware),
    hardware,
    recommendedPreset,
    defaultLanes: lanes.filter((item) => item.defaultEnabled).map((item) => item.id),
    optionalLanes: lanes.filter((item) => ["available", "optional", "slow"].includes(item.status) && !item.defaultEnabled).map((item) => item.id),
    blockedLanes: lanes.filter((item) => item.status === "blocked").map((item) => item.id),
    lanes,
    assumptions: [
      "VRAM is not measured yet; GPU decisions are conservative and based on detected accelerator plus system RAM.",
      "Closed hosted models such as Ideogram cannot be bundled locally unless local weights and license terms exist.",
      "Media lanes stay local-only and require loopback workers before they are marked ready.",
    ],
    commands: {
      startLocal: "bun run local",
      startDev: "bun run dev",
      installModel: `bun run model:install ${recommendedPreset}`,
      mediaDefaults: "bun run media:defaults",
      mediaDefaultsOptional: "bun run media:defaults --include-optional",
    },
  };
}

export async function getCapabilityProfile() {
  return buildCapabilityProfile(await detectHardware());
}

export function formatCapabilityProfile(profile: CapabilityProfile) {
  const lines = [
    `${profile.tierLabel}`,
    profile.headline,
    `Hardware: ${profile.hardware.os} ${profile.hardware.arch}, ${profile.hardware.totalRamGb}GB RAM, ${profile.hardware.accelerator}`,
    `Recommended mode: ${profile.recommendedPreset}`,
    "",
    "Capabilities:",
  ];
  for (const item of profile.lanes) {
    lines.push(`  [${item.status}] ${item.label}`);
    lines.push(`    ${item.summary}`);
    for (const limit of item.limits) lines.push(`    Limit: ${limit}`);
    for (const command of item.commands) lines.push(`    Command: ${command}`);
  }
  lines.push("");
  lines.push("Assumptions:");
  for (const assumption of profile.assumptions) lines.push(`  - ${assumption}`);
  return lines.join("\n");
}
