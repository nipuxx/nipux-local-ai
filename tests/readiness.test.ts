import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-readiness-"));
process.env.NIPUX_FAKE_LLM = "1";

const { route } = await import("../src/main.ts");
const { getReadinessReport } = await import("../src/services/readiness.ts");

test("readiness report summarizes everyday local capabilities", async () => {
  const report = await getReadinessReport();
  expect(report.usable).toBe(true);
  expect(report.items.some((item) => item.id === "chat" && item.status === "ready")).toBe(true);
  expect(report.items.some((item) => item.id === "voice-output")).toBe(true);
  expect(report.items.some((item) => item.id === "api" && item.status === "ready")).toBe(true);
  expect(report.nextSteps.length).toBeGreaterThan(0);
});

test("readiness route returns the shared report", async () => {
  const res = await route(new Request("http://localhost/api/readiness"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.localUrl).toContain("127.0.0.1");
  expect(json.counts.ready).toBeGreaterThan(0);
  expect(json.items.map((item: { id: string }) => item.id)).toContain("browser");
});
