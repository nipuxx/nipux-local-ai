import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-api-"));
process.env.NIPUX_FAKE_LLM = "1";
const { route } = await import("../src/main.ts");

test("status route returns hardware and command metadata", async () => {
  const res = await route(new Request("http://localhost/api/status"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.app).toBe("Nipux Local AI");
  expect(json.serveCommands.balanced).toContain("gemma-4-12B");
});

test("OpenAI models route returns model list", async () => {
  const res = await route(new Request("http://localhost/v1/models"));
  const json = await res.json();
  expect(json.data.length).toBeGreaterThanOrEqual(3);
});
