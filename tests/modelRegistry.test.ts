import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-models-"));
const { db } = await import("../src/db.ts");
const { DEFAULT_PRESETS, getModel, llamaServeCommand, listModels, registerDownloadedModel, selectBestGgufFile } = await import("../src/services/modelRegistry.ts");
const { getAppSettings, updateAppSettings } = await import("../src/services/settings.ts");

test("model presets expose fast balanced smart", () => {
  expect(DEFAULT_PRESETS.map((preset) => preset.id)).toEqual(["fast", "balanced", "smart"]);
  expect(getModel("balanced").repo).toContain("gemma-4-12B");
});

test("llama command uses the selected preset", () => {
  expect(llamaServeCommand("fast")).toContain("gemma-4-E4B");
  expect(llamaServeCommand("smart")).toContain("gemma-4-26B");
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

test("llama command uses local GGUF path when a preset is installed", () => {
  const localPath = join(tmpdir(), "nipux local fast.gguf");
  db.prepare("UPDATE models SET state = 'available', local_path = ?, file_name = ? WHERE id = 'fast'").run(localPath, "fast.gguf");
  expect(llamaServeCommand("fast")).toContain(`-m '${localPath}'`);
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
