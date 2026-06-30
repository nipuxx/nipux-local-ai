import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-models-"));
const { db } = await import("../src/db.ts");
const {
  DEFAULT_PRESETS,
  formatModelInstallPlan,
  getModel,
  getModelInstallPlan,
  llamaServeCommand,
  listModels,
  registerDownloadedModel,
  seedModelRegistry,
  selectBestGgufFile,
} = await import(
  "../src/services/modelRegistry.ts"
);
const { getAppSettings, updateAppSettings } = await import("../src/services/settings.ts");

test("model presets expose fast balanced smart", () => {
  expect(DEFAULT_PRESETS.map((preset) => preset.id)).toEqual(["fast", "balanced", "smart"]);
  expect(getModel("balanced").repo).toBe("Qwen/Qwen3-8B-GGUF");
  expect(getModel("balanced").llamaRef).toContain("Qwen3-8B-Q4_K_M.gguf");
});

test("llama command uses the selected preset", () => {
  expect(llamaServeCommand("fast")).toContain("Qwen/Qwen3-4B-GGUF:Qwen3-4B-Q4_K_M.gguf");
  expect(llamaServeCommand("smart")).toContain("Qwen/Qwen3-30B-A3B-GGUF:Qwen3-30B-A3B-Q4_K_M.gguf");
});

test("GGUF selector prefers matching quant files and skips mmproj files", () => {
  const selected = selectBestGgufFile(
    [
      { rfilename: "model-f16.gguf", size: 100 },
      { rfilename: "mmproj-model-Q4_0.gguf", size: 400 },
      { rfilename: "model-Q4_0.gguf", size: 200 },
    ],
    "Q4_0",
  );
  expect(selected?.rfilename).toBe("model-Q4_0.gguf");
});

test("GGUF selector handles Qwen Q4_K_M preset files", () => {
  const selected = selectBestGgufFile(
    [
      { rfilename: "Qwen3-8B-Q5_K_M.gguf", size: 900 },
      { rfilename: "mmproj-Qwen3-8B-Q4_K_M.gguf", size: 1200 },
      { rfilename: "Qwen3-8B-Q4_K_M.gguf", size: 800 },
    ],
    "Q4_K_M",
  );
  expect(selected?.rfilename).toBe("Qwen3-8B-Q4_K_M.gguf");
});

test("llama command uses local GGUF path when a preset is installed", () => {
  const localPath = join(tmpdir(), "nipux local fast.gguf");
  db.prepare("UPDATE models SET state = 'available', local_path = ?, file_name = ? WHERE id = 'fast'").run(localPath, "fast.gguf");
  expect(llamaServeCommand("fast")).toContain(`-m '${localPath}'`);
});

test("model install plan previews selected Qwen download", async () => {
  const plan = await getModelInstallPlan("balanced", {
    files: [
      { rfilename: "Qwen3-8B-Q5_K_M.gguf", size: 900 },
      { rfilename: "Qwen3-8B-Q4_K_M.gguf", size: 8 * 1024 ** 3 },
    ],
  });

  expect(plan.installed).toBe(false);
  expect(plan.selectedFilename).toBe("Qwen3-8B-Q4_K_M.gguf");
  expect(plan.selectedSizeLabel).toBe("8.0 GB");
  expect(plan.installCommand).toContain("bun run model:install balanced");
  expect(plan.startCommand).toContain("Qwen3-8B-Q4_K_M.gguf");
  expect(formatModelInstallPlan(plan)).toContain("Download size: 8.0 GB");
});

test("preset reseed clears stale local paths when repo changes", () => {
  const stalePath = join(tmpdir(), "old-gemma-balanced.gguf");
  db.prepare("UPDATE models SET repo = ?, state = 'available', local_path = ?, file_name = ? WHERE id = 'balanced'").run(
    "google/gemma-4-12B-it-qat-q4_0-gguf",
    stalePath,
    "old.gguf",
  );

  seedModelRegistry();
  const model = getModel("balanced");
  expect(model.repo).toBe("Qwen/Qwen3-8B-GGUF");
  expect(model.state).toBe("missing");
  expect(model.localPath).toBeNull();
  expect(model.fileName).toBeNull();
});

test("downloaded Hugging Face GGUF registers as a selectable custom model", () => {
  const localPath = join(process.env.NIPUX_HOME!, "models", "custom-q4_k_m.gguf");
  mkdirSync(join(process.env.NIPUX_HOME!, "models"), { recursive: true });
  writeFileSync(localPath, "fake gguf");

  const model = registerDownloadedModel("example/custom-7b-gguf", "custom-7b-Q4_K_M.gguf", localPath);
  expect(model.id.startsWith("hf-example-custom-7b-gguf")).toBe(true);
  expect(model.state).toBe("available");
  expect(model.localPath).toBe(localPath);
  expect(llamaServeCommand(model.id)).toContain(`-m '${localPath}'`);
  expect(listModels().some((item) => item.id === model.id)).toBe(true);

  updateAppSettings({ defaultModelPreset: model.id });
  expect(getAppSettings().defaultModelPreset).toBe(model.id);
  updateAppSettings({ defaultModelPreset: "balanced" });
});
