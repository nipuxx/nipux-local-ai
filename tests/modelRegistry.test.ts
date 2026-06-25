import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-models-"));
const { DEFAULT_PRESETS, getModel, llamaServeCommand } = await import("../src/services/modelRegistry.ts");

test("model presets expose fast balanced smart", () => {
  expect(DEFAULT_PRESETS.map((preset) => preset.id)).toEqual(["fast", "balanced", "smart"]);
  expect(getModel("balanced").repo).toContain("gemma-4-12B");
});

test("llama command uses the selected preset", () => {
  expect(llamaServeCommand("fast")).toContain("gemma-4-E4B");
  expect(llamaServeCommand("smart")).toContain("gemma-4-26B");
});
