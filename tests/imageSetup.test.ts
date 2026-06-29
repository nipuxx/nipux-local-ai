import { expect, test } from "bun:test";
import type { HardwareProfile } from "../src/types.ts";

const { DIFFUSERS_IMAGE_BACKEND_SCRIPT, buildImageBackendPlan, imageStartCommand, imageWorkerContract, installImageBackendPreset } = await import(
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
