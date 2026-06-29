import { platform } from "node:os";
import { join } from "node:path";
import { NIPUX_HOME } from "../config.ts";
import type { HardwareProfile } from "../types.ts";
import { detectHardware } from "./hardware.ts";
import { getRawSetting, setRawSetting, updateAppSettings } from "./settings.ts";

export const DEFAULT_IMAGE_COMMAND_PLACEHOLDER = "/path/to/local-image-command";
export const DIFFUSERS_IMAGE_BACKEND_SCRIPT = "scripts/image-backends/diffusers-image.py";
export const IMAGE_BACKEND_SETTING_KEY = "image_backend_preset";

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
  selectedPresetId: string;
  nextSteps: string[];
}

export interface ImageBackendSelectionResult {
  selectedPresetId: string;
  plan: ImageBackendPlan;
  settings: ReturnType<typeof updateAppSettings>;
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

export function imageBackendWorkerEnv(presetId: string) {
  const model = presetId === "diffusers-sd15" ? "runwayml/stable-diffusion-v1-5" : presetId === "diffusers-sdxl-turbo" ? "stabilityai/sdxl-turbo" : "";
  if (!model) return null;
  return {
    NIPUX_IMAGE_COMMAND: diffusersPythonCommand(),
    NIPUX_IMAGE_ARGS: `${DIFFUSERS_IMAGE_BACKEND_SCRIPT} {input} {output}`,
    NIPUX_IMAGE_MODEL: model,
  };
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
  const selected = getRawSetting(IMAGE_BACKEND_SETTING_KEY, "");
  const selectedPresetId = presets.some((preset) => preset.id === selected) ? selected : "";
  return {
    hardware,
    presets,
    recommendedPresetId,
    selectedPresetId,
    nextSteps: [
      selectedPresetId
        ? `Selected image backend: ${presets.find((preset) => preset.id === selectedPresetId)?.label ?? selectedPresetId}.`
        : `Review presets with bun run image:backends.`,
      selectedPresetId ? "Run bun run image:clear to return to manual image worker configuration." : `Select one with bun run image:select ${recommendedPresetId}.`,
      `Install the selected local backend dependencies before starting bun run local.`,
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
    `Selected image backend: ${plan.selectedPresetId || "none"}`,
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

export async function selectImageBackendPreset(presetId: string): Promise<ImageBackendSelectionResult> {
  const plan = await getImageBackendPlan();
  if (!plan.presets.some((preset) => preset.id === presetId)) throw new Error(`Unknown image backend preset: ${presetId}`);
  setRawSetting(IMAGE_BACKEND_SETTING_KEY, presetId);
  const settings = updateAppSettings({ imageWorkerUrl: "http://127.0.0.1:8081" });
  return { selectedPresetId: presetId, plan: await getImageBackendPlan(), settings };
}

export async function clearImageBackendPreset(): Promise<ImageBackendSelectionResult> {
  setRawSetting(IMAGE_BACKEND_SETTING_KEY, "");
  const settings = updateAppSettings({ imageWorkerUrl: "" });
  return { selectedPresetId: "", plan: await getImageBackendPlan(), settings };
}
