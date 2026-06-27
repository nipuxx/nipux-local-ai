import { expect, test } from "bun:test";

process.env.NIPUX_FAKE_LLM = "1";

const { route } = await import("../src/main.ts");
const { getDiagnosticsReport } = await import("../src/services/diagnostics.ts");

test("diagnostics report gathers local setup state without secrets", async () => {
  const report = await getDiagnosticsReport();
  expect(report.app.name).toBe("Nipux Local AI");
  expect(report.app.auth).toEqual({ required: false, configured: false, keyCount: 0 });
  expect(report.hardware.totalRamGb).toBeGreaterThan(0);
  expect(report.setup.checks.some((check) => check.id === "bun")).toBe(true);
  expect(report.readiness.items.some((item) => item.id === "chat")).toBe(true);
  expect(report.supervisor.ready.some((item) => item.kind === "app")).toBe(true);
  expect(report.models.length).toBeGreaterThanOrEqual(3);
  expect(report.usage.summary.requests).toBeGreaterThanOrEqual(0);
  expect(report.storage.home.path).toBe(report.app.home);
});

test("diagnostics route returns the shared report", async () => {
  const res = await route(new Request("http://localhost/api/diagnostics"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.generatedAt).toBeTruthy();
  expect(json.runtime.running).toBe(false);
  expect(json.launch.commands.oneCommandLocal).toBe("bun run setup && bun run local");
});
