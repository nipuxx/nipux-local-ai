import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-setup-actions-"));
process.env.NIPUX_FAKE_LLM = "1";

const { route, startServer } = await import("../src/main.ts");
const { getSetupActions } = await import("../src/services/setupActions.ts");

test("setup actions expose copyable commands for local runtime setup", async () => {
  const result = await getSetupActions();
  expect(result.actions.some((action) => action.id === "install-chat-model" && action.commands.some((item) => item.command.includes("bun run model:install")))).toBe(true);
  expect(result.actions.some((action) => action.id === "media-transcription" && action.commands.some((item) => item.command.includes("bun run transcription:install")))).toBe(true);
  expect(result.actions.some((action) => action.id === "run-dev" && action.commands.some((item) => item.command === "bun run dev"))).toBe(true);
  expect(result.actions.some((action) => action.id === "start-llama" && action.commands.some((item) => item.command.includes("llama serve")))).toBe(true);
  expect(result.actions.some((action) => action.id === "verify-readiness" && action.commands.some((item) => item.command === "bun run ready"))).toBe(true);
});

test("setup actions route returns the shared action plan", async () => {
  const res = await route(new Request("http://localhost/api/setup/actions"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.actions.map((action: { id: string }) => action.id)).toContain("open-local-app");
  expect(json.summary.recommended + json.summary.optional + json.summary.ready + json.summary.blocked).toBe(json.actions.length);
});

test("shared server starter can serve the local API on a dynamic port", async () => {
  const server = startServer({ port: 0, hostname: "127.0.0.1", log: false });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/api/status`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.app).toBe("Nipux Local AI");
  } finally {
    server.stop(true);
  }
});
