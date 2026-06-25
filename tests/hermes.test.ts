import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-hermes-"));
const { getHermesStatus } = await import("../src/services/hermes.ts");

test("Hermes status always returns local provider config", async () => {
  const status = await getHermesStatus("balanced");
  expect(status.configCommands.join("\n")).toContain("model.provider custom");
  expect(status.configCommands.join("\n")).toContain("gemma-4-12B");
});
