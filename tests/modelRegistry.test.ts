import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-models-"));
const { db } = await import("../src/db.ts");
const { DEFAULT_PRESETS, getModel, llamaServeCommand, selectBestGgufFile } = await import("../src/services/modelRegistry.ts");

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
