import { existsSync, mkdirSync } from "node:fs";
import { platform } from "node:os";
import { dirname, join } from "node:path";
import { NIPUX_HOME } from "../config.ts";
import type { HardwareProfile } from "../types.ts";
import { detectHardware } from "./hardware.ts";
import { getAppSettings, getRawSetting, setRawSetting, updateAppSettings } from "./settings.ts";

export const DEFAULT_IMAGE_COMMAND_PLACEHOLDER = "/path/to/local-image-command";
export const DIFFUSERS_IMAGE_BACKEND_SCRIPT = "scripts/image-backends/diffusers-image.py";
export const IMAGE_BACKEND_SETTING_KEY = "image_backend_preset";
const DIFFUSERS_PACKAGES = ["torch", "diffusers", "transformers", "accelerate", "safetensors", "pillow"];

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
  install: {
    installed: boolean;
    runtimeDir: string;
    pythonPath: string;
    command: string;
    detail: string;
  };
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

export interface ImageBackendInstallResult {
  presetId: string;
  installed: boolean;
  dryRun: boolean;
  runtimeDir: string;
  pythonPath: string;
  commands: string[];
  output: string[];
}

export interface ImageBackendPrepareResult {
  presetId: string;
  selectedPresetId: string;
  installed: boolean;
  install?: ImageBackendInstallResult;
  settings: ReturnType<typeof updateAppSettings>;
  plan: ImageBackendPlan;
  commands: {
    install?: string;
    start?: string;
    local: string;
    clear: string;
  };
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

function commandFor(preset: ImageBackendPreset, labelPart: string) {
  return preset.commands.find((item) => item.label.toLowerCase().includes(labelPart))?.command;
}

function diffusersRuntimeDir() {
  return join(NIPUX_HOME, "runtimes", "image-diffusers");
}

function diffusersPythonCommand() {
  const dir = diffusersRuntimeDir();
  if (platform() === "win32") return join(dir, "Scripts", "python.exe");
  return join(dir, "bin", "python");
}

function diffusersInstallCommand(presetId: string) {
  return `bun run image:install ${presetId}`;
}

function diffusersManualInstallCommand() {
  const dir = diffusersRuntimeDir();
  if (platform() === "win32") {
    const winDir = "%USERPROFILE%\\.nipux-local-ai\\runtimes\\image-diffusers";
    return `py -3 -m venv "${winDir}" && "${winDir}\\Scripts\\python.exe" -m pip install --upgrade pip ${DIFFUSERS_PACKAGES.join(" ")}`;
  }
  return `python3 -m venv ${shellArg(dir)} && ${shellArg(join(dir, "bin", "python"))} -m pip install --upgrade pip ${DIFFUSERS_PACKAGES.join(" ")}`;
}

function diffusersInstallStatus(presetId: string) {
  const runtimeDir = diffusersRuntimeDir();
  const pythonPath = diffusersPythonCommand();
  const installed = existsSync(pythonPath);
  return {
    installed,
    runtimeDir,
    pythonPath,
    command: diffusersInstallCommand(presetId),
    detail: installed
      ? "Local Diffusers Python runtime exists. Package imports are checked when the worker starts."
      : "Install needed before bun run local can start this selected image worker.",
  };
}

function customInstallStatus() {
  return {
    installed: Boolean(process.env.NIPUX_IMAGE_COMMAND),
    runtimeDir: "",
    pythonPath: process.env.NIPUX_IMAGE_COMMAND ?? "",
    command: imageStartCommand(),
    detail: process.env.NIPUX_IMAGE_COMMAND
      ? "Custom image command is configured in this environment."
      : "Set NIPUX_IMAGE_COMMAND or choose a managed local backend preset.",
  };
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
      install: diffusersInstallStatus("diffusers-sdxl-turbo"),
      commands: [
        command("Install backend", diffusersInstallCommand("diffusers-sdxl-turbo")),
        command("Start image worker", diffusersStartCommand("stabilityai/sdxl-turbo")),
        command("Persist worker URL", "bun run media:defaults --include-optional"),
        command("Manual install", diffusersManualInstallCommand(), false),
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
      install: diffusersInstallStatus("diffusers-sd15"),
      commands: [
        command("Install backend", diffusersInstallCommand("diffusers-sd15")),
        command("Start image worker", diffusersStartCommand("runwayml/stable-diffusion-v1-5")),
        command("Persist worker URL", "bun run media:defaults --include-optional"),
        command("Manual install", diffusersManualInstallCommand(), false),
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
      install: customInstallStatus(),
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
  const selectedPreset = presets.find((preset) => preset.id === selectedPresetId);
  const recommendedPreset = presets.find((preset) => preset.id === recommendedPresetId);
  const managedInstallPreset = presets.find((preset) => preset.install.command.includes("image:install"));
  const settings = getAppSettings();
  const installStep = selectedPreset?.install.installed
    ? "Selected backend runtime exists; bun run local can start the image worker."
    : selectedPreset?.install.command.includes("image:install")
      ? `Run ${selectedPreset.install.command} before starting bun run local.`
      : selectedPreset
        ? "Set NIPUX_IMAGE_COMMAND before starting bun run local."
        : recommendedPreset?.install.command.includes("image:install")
          ? `Run ${recommendedPreset.install.command} before starting bun run local.`
          : managedInstallPreset
            ? `For managed Diffusers, run ${managedInstallPreset.install.command}; custom backends need NIPUX_IMAGE_COMMAND.`
            : "Configure a local image command before starting bun run local.";
  const workerUrlStep = selectedPresetId && settings.imageWorkerUrl
    ? `Image worker URL is stored as ${settings.imageWorkerUrl}; rerun bun run local after installing the selected backend.`
    : "Run bun run media:defaults --include-optional to point Settings at the local worker URL.";
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
      installStep,
      workerUrlStep,
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
    lines.push(`  Install: ${preset.install.installed ? "installed" : "needed"} - ${preset.install.detail}`);
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

async function runProcess(commandParts: string[], cwd?: string) {
  const proc = Bun.spawn(commandParts, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (exitCode !== 0) throw new Error(stderr || stdout || `${commandParts.join(" ")} failed with exit code ${exitCode}`);
  return [stdout, stderr].filter((item) => item.trim()).join("\n").trim();
}

export async function installImageBackendPreset(presetId: string, input: { dryRun?: boolean } = {}): Promise<ImageBackendInstallResult> {
  if (!["diffusers-sdxl-turbo", "diffusers-sd15"].includes(presetId)) {
    throw new Error(`Image backend preset ${presetId} does not have an automated installer.`);
  }
  const runtimeDir = diffusersRuntimeDir();
  const pythonPath = diffusersPythonCommand();
  const venvCommand = platform() === "win32" ? ["py", "-3", "-m", "venv", runtimeDir] : ["python3", "-m", "venv", runtimeDir];
  const pipCommand = [pythonPath, "-m", "pip", "install", "--upgrade", "pip", ...DIFFUSERS_PACKAGES];
  const commands = [venvCommand.join(" "), pipCommand.join(" ")];
  if (input.dryRun) {
    return { presetId, installed: existsSync(pythonPath), dryRun: true, runtimeDir, pythonPath, commands, output: [] };
  }

  mkdirSync(dirname(runtimeDir), { recursive: true });
  const output = [await runProcess(venvCommand), await runProcess(pipCommand)];
  return { presetId, installed: existsSync(pythonPath), dryRun: false, runtimeDir, pythonPath, commands, output: output.filter(Boolean) };
}

export async function prepareImageBackendPreset(input: { presetId?: string; install?: boolean } = {}): Promise<ImageBackendPrepareResult> {
  const plan = await getImageBackendPlan();
  const presetId = input.presetId || plan.selectedPresetId || plan.recommendedPresetId;
  const preset = plan.presets.find((item) => item.id === presetId);
  if (!preset) throw new Error(`Unknown image backend preset: ${presetId}`);

  let install: ImageBackendInstallResult | undefined;
  if (input.install) install = await installImageBackendPreset(preset.id);

  const selected = await selectImageBackendPreset(preset.id);
  const selectedPreset = selected.plan.presets.find((item) => item.id === preset.id) ?? preset;
  const installCommand = commandFor(selectedPreset, "install");
  const startCommand = commandFor(selectedPreset, "start");
  const installed = selectedPreset.install.installed || Boolean(install?.installed);
  const nextSteps = [
    installed
      ? "Run bun run local --open to start the app and managed image worker."
      : installCommand
        ? `Run ${installCommand}, then run bun run local --open.`
        : "Set NIPUX_IMAGE_COMMAND to a local image backend command, then run bun run local --open.",
    "Open Chat or Media and ask for an image.",
  ];

  return {
    presetId: preset.id,
    selectedPresetId: selected.selectedPresetId,
    installed,
    install,
    settings: selected.settings,
    plan: selected.plan,
    commands: {
      install: installCommand,
      start: startCommand,
      local: "bun run local --open",
      clear: "bun run image:clear",
    },
    nextSteps,
  };
}
