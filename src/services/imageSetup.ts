import { platform } from "node:os";
import { join } from "node:path";
import { NIPUX_HOME } from "../config.ts";
import type { HardwareProfile } from "../types.ts";
import { detectHardware } from "./hardware.ts";

export const DEFAULT_IMAGE_COMMAND_PLACEHOLDER = "/path/to/local-image-command";
export const DIFFUSERS_IMAGE_BACKEND_SCRIPT = "scripts/image-backends/diffusers-image.py";

export interface ImageBackendCommand {
  label: string;
  command: string;
  copyable: boolean;
}

export interface ImageBackendPreset {
  id: string;
  label: string;
  model: string;
  recommended: boolean;
  localOnly: true;
  hardwareFit: string;
  description: string;
  commands: ImageBackendCommand[];
  notes: string[];
}

export interface ImageBackendPlan {
  hardware: HardwareProfile;
  presets: ImageBackendPreset[];
  recommendedPresetId: string;
  nextSteps: string[];
}

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function imageStartCommand(command = process.env.NIPUX_IMAGE_COMMAND || DEFAULT_IMAGE_COMMAND_PLACEHOLDER) {
  return `NIPUX_IMAGE_COMMAND=${shellArg(command)} bun run worker:image`;
}

export function imageWorkerContract() {
  return "Command receives a JSON request path and output image path: {input} {output}. Override with NIPUX_IMAGE_ARGS.";
}

function command(label: string, value: string, copyable = true): ImageBackendCommand {
  return { label, command: value, copyable };
}

function diffusersRuntimeDir() {
  return join(NIPUX_HOME, "runtimes", "image-diffusers");
}

function diffusersPythonCommand() {
  const dir = diffusersRuntimeDir();
  if (platform() === "win32") return join(dir, "Scripts", "python.exe");
  return join(dir, "bin", "python");
}

function diffusersInstallCommands() {
  const dir = diffusersRuntimeDir();
  if (platform() === "win32") {
    const winDir = "%USERPROFILE%\\.nipux-local-ai\\runtimes\\image-diffusers";
    return [
      command(
        "Install backend",
        `py -3 -m venv "${winDir}" && "${winDir}\\Scripts\\python.exe" -m pip install --upgrade pip torch diffusers transformers accelerate safetensors pillow`,
      ),
    ];
  }
  return [
    command(
      "Install backend",
      `python3 -m venv ${shellArg(dir)} && ${shellArg(join(dir, "bin", "python"))} -m pip install --upgrade pip torch diffusers transformers accelerate safetensors pillow`,
    ),
  ];
}

function diffusersStartCommand(model: string) {
  return [
    `NIPUX_IMAGE_COMMAND=${shellArg(diffusersPythonCommand())}`,
    `NIPUX_IMAGE_ARGS=${shellArg(`${DIFFUSERS_IMAGE_BACKEND_SCRIPT} {input} {output}`)}`,
    `NIPUX_IMAGE_MODEL=${shellArg(model)}`,
    "bun run worker:image",
  ].join(" ");
}

function imageFit(hardware: HardwareProfile, kind: "fast" | "fallback" | "custom") {
  if (kind === "custom") return "Use any local image backend that can write an image file from the Nipux JSON request.";
  if (hardware.accelerator === "cuda") return "Best fit; CUDA is the cleanest path for Diffusers image generation.";
  if (hardware.accelerator === "metal") return hardware.totalRamGb >= 16
    ? "Good Apple unified-memory fit, but keep default image sizes conservative."
    : "Possible on Apple unified memory, but use smaller images and expect slower runs.";
  if (["rocm", "vulkan", "directml"].includes(hardware.accelerator)) {
    return "Opt-in; backend support varies more than CUDA or Apple Metal.";
  }
  return "CPU-only image generation is very slow and should stay opt-in.";
}

function recommendedFast(hardware: HardwareProfile) {
  return hardware.accelerator !== "cpu" && hardware.totalRamGb >= 16;
}

export function buildImageBackendPlan(hardware: HardwareProfile): ImageBackendPlan {
  const fastRecommended = recommendedFast(hardware);
  const fallbackRecommended = !fastRecommended && hardware.totalRamGb >= 12 && hardware.accelerator !== "cpu";
  const presets: ImageBackendPreset[] = [
    {
      id: "diffusers-sdxl-turbo",
      label: "Diffusers SDXL Turbo",
      model: "stabilityai/sdxl-turbo",
      recommended: fastRecommended,
      localOnly: true,
      hardwareFit: imageFit(hardware, "fast"),
      description: "Fast local Diffusers path for GPU or strong unified-memory machines.",
      commands: [
        ...diffusersInstallCommands(),
        command("Start image worker", diffusersStartCommand("stabilityai/sdxl-turbo")),
        command("Persist worker URL", "bun run media:defaults --include-optional"),
      ],
      notes: [
        "Downloads model weights locally through Diffusers on first use.",
        "Good first target when the user wants a simple prompt-to-image lane.",
      ],
    },
    {
      id: "diffusers-sd15",
      label: "Diffusers SD 1.5",
      model: "runwayml/stable-diffusion-v1-5",
      recommended: fallbackRecommended,
      localOnly: true,
      hardwareFit: imageFit(hardware, "fallback"),
      description: "Older, lighter Diffusers fallback when SDXL-class models are too heavy.",
      commands: [
        ...diffusersInstallCommands(),
        command("Start image worker", diffusersStartCommand("runwayml/stable-diffusion-v1-5")),
        command("Persist worker URL", "bun run media:defaults --include-optional"),
      ],
      notes: ["Use smaller sizes on low-memory systems.", "CPU runs can take a long time."],
    },
    {
      id: "custom-command",
      label: "Custom Local Command",
      model: "local-image",
      recommended: false,
      localOnly: true,
      hardwareFit: imageFit(hardware, "custom"),
      description: "Adapter for any local image runtime that can read the Nipux request JSON and write an output image.",
      commands: [
        command("Start image worker", imageStartCommand()),
        command("Worker contract", imageWorkerContract(), false),
        command("Persist worker URL", "bun run media:defaults --include-optional"),
      ],
      notes: ["Use this for MLX, Comfy-free Diffusers scripts, Invoke, or a hand-written backend command.", "Remote hosted image APIs remain blocked."],
    },
  ];
  const recommendedPresetId = presets.find((preset) => preset.recommended)?.id ?? "custom-command";
  return {
    hardware,
    presets,
    recommendedPresetId,
    nextSteps: [
      `Review presets with bun run image:backends.`,
      `Start a local image worker with the ${presets.find((preset) => preset.id === recommendedPresetId)?.label ?? "custom"} command.`,
      "Run bun run media:defaults --include-optional to point Settings at the local worker URL.",
    ],
  };
}

export async function getImageBackendPlan() {
  return buildImageBackendPlan(await detectHardware());
}

export function formatImageBackendPlan(plan: ImageBackendPlan) {
  const lines = [
    `Hardware: ${plan.hardware.os} ${plan.hardware.arch}, ${plan.hardware.totalRamGb}GB RAM, ${plan.hardware.accelerator}`,
    `Recommended image backend: ${plan.recommendedPresetId}`,
    "",
  ];
  for (const preset of plan.presets) {
    lines.push(`${preset.label}${preset.recommended ? " (recommended)" : ""}`);
    lines.push(`  Model: ${preset.model}`);
    lines.push(`  Fit: ${preset.hardwareFit}`);
    lines.push(`  ${preset.description}`);
    for (const item of preset.commands) lines.push(`  ${item.label}: ${item.command}`);
    lines.push("");
  }
  lines.push("Next steps:");
  for (const step of plan.nextSteps) lines.push(`  - ${step}`);
  return lines.join("\n").trimEnd();
}
