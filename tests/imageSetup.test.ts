import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HardwareProfile } from "../src/types.ts";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-image-setup-"));

const {
  DIFFUSERS_IMAGE_BACKEND_SCRIPT,
  buildImageBackendPlan,
  clearImageBackendPreset,
  imageStartCommand,
  imageWorkerContract,
  installImageBackendPreset,
  prepareImageBackendPreset,
} = await import(
  "../src/services/imageSetup.ts"
);

test("image setup exposes the bundled image worker command", () => {
  expect(imageStartCommand()).toContain("bun run worker:image");
  expect(imageStartCommand()).toContain("NIPUX_IMAGE_COMMAND=");
  expect(imageWorkerContract()).toContain("{input} {output}");
});

function hardware(input: Partial<HardwareProfile>): HardwareProfile {
  return {
    os: "linux",
    arch: "x64",
    totalRamGb: 16,
    gpuVendors: [],
    accelerator: "cpu",
    recommendedPreset: "balanced",
    notes: [],
    ...input,
  };
}

test("image backend plan exposes local Diffusers presets", () => {
  const plan = buildImageBackendPlan(hardware({ accelerator: "cuda", gpuVendors: ["NVIDIA"], totalRamGb: 32 }));
  const turbo = plan.presets.find((preset) => preset.id === "diffusers-sdxl-turbo");

  expect(plan.recommendedPresetId).toBe("diffusers-sdxl-turbo");
  expect(turbo?.recommended).toBe(true);
  expect(typeof turbo?.install.installed).toBe("boolean");
  expect(turbo?.install.command).toContain("bun run image:install diffusers-sdxl-turbo");
  expect(turbo?.commands.some((item) => item.command.includes(DIFFUSERS_IMAGE_BACKEND_SCRIPT))).toBe(true);
  expect(turbo?.commands.some((item) => item.command.includes("bun run image:install diffusers-sdxl-turbo"))).toBe(true);
  expect(turbo?.commands.some((item) => item.command.includes("bun run worker:image"))).toBe(true);
  expect(plan.presets.every((preset) => preset.localOnly)).toBe(true);
});

test("image backend plan stays opt-in on CPU-only machines", () => {
  const plan = buildImageBackendPlan(hardware({ accelerator: "cpu", totalRamGb: 8, recommendedPreset: "fast" }));

  expect(plan.recommendedPresetId).toBe("custom-command");
  expect(plan.presets.find((preset) => preset.id === "diffusers-sdxl-turbo")?.recommended).toBe(false);
  expect(plan.nextSteps.some((step) => step.includes("image:install custom-command"))).toBe(false);
  expect(plan.nextSteps.some((step) => step.includes("NIPUX_IMAGE_COMMAND"))).toBe(true);
});

test("image backend installer exposes a dry-run plan", async () => {
  const result = await installImageBackendPreset("diffusers-sdxl-turbo", { dryRun: true });

  expect(result.presetId).toBe("diffusers-sdxl-turbo");
  expect(result.dryRun).toBe(true);
  expect(result.pythonPath).toBeTruthy();
  expect(result.commands.some((item) => item.includes("venv"))).toBe(true);
  expect(result.commands.some((item) => item.includes("pip install"))).toBe(true);
});

test("image backend prepare selects a local backend without installing by default", async () => {
  const result = await prepareImageBackendPreset({ presetId: "diffusers-sdxl-turbo" });

  expect(result.selectedPresetId).toBe("diffusers-sdxl-turbo");
  expect(result.settings.imageWorkerUrl).toBe("http://127.0.0.1:8081");
  expect(result.install).toBeUndefined();
  expect(result.commands.local).toBe("bun run local --open");
  expect(result.commands.install).toContain("bun run image:install diffusers-sdxl-turbo");
  expect(result.nextSteps.some((step) => step.includes("bun run local --open"))).toBe(true);

  await clearImageBackendPreset();
});
