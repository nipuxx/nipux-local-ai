import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-usage-"));
process.env.NIPUX_FAKE_LLM = "1";

const { route } = await import("../src/main.ts");
const { getUsageDashboard, recordUsage } = await import("../src/services/usage.ts");

const usageTestModel = `usage-test-${crypto.randomUUID()}`;
const usageTestImageModel = `${usageTestModel}-image`;
const usageTestReason = `unconfigured-${crypto.randomUUID()}`;

test("usage dashboard groups events by lane, model, and recent errors", () => {
  const before = getUsageDashboard();
  recordUsage({ kind: "chat", model: usageTestModel, tokensIn: 12, tokensOut: 18, latencyMs: 120, status: "ok", meta: { stream: false } });
  recordUsage({ kind: "browser", latencyMs: 40, status: "ok", meta: { action: "open" } });
  recordUsage({ kind: "image", model: usageTestImageModel, latencyMs: 55, status: "error", meta: { reason: usageTestReason } });

  const dashboard = getUsageDashboard();
  expect(dashboard.summary.requests - before.summary.requests).toBe(3);
  expect(dashboard.summary.errors - before.summary.errors).toBe(1);

  const chat = dashboard.byKind.find((item) => item.key === "chat");
  const image = dashboard.byKind.find((item) => item.key === "image");
  expect(chat?.requests).toBeGreaterThanOrEqual(1);
  expect(image?.errors).toBeGreaterThanOrEqual(1);

  expect(dashboard.byModel.some((item) => item.key === usageTestModel && item.tokensIn === 12)).toBe(true);
  expect(dashboard.byModel.some((item) => item.key === usageTestImageModel && item.errorRate === 1)).toBe(true);
  expect(dashboard.errors.some((event) => event.kind === "image" && event.meta.reason === usageTestReason)).toBe(true);
  expect(dashboard.timeline[0].meta).toBeTruthy();
});

test("usage route returns grouped dashboard data", async () => {
  const res = await route(new Request("http://localhost/api/usage/summary"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.summary.requests).toBeGreaterThanOrEqual(3);
  expect(json.byKind.some((item: { key: string }) => item.key === "chat")).toBe(true);
  expect(json.byModel.some((item: { key: string }) => item.key === usageTestModel)).toBe(true);
  expect(Array.isArray(json.errors)).toBe(true);
  expect(Array.isArray(json.timeline)).toBe(true);
});
