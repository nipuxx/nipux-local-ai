import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-setup-prepare-"));
process.env.NIPUX_FAKE_LLM = "1";

const { prepareFirstRunSetup } = await import("../src/services/setupPrepare.ts");
const { route } = await import("../src/main.ts");

test("first-run prepare writes launch files and returns refreshed local setup state", async () => {
  const result = await prepareFirstRunSetup({ prepareImage: false });

  expect(result.commands.prepare).toBe("bun run setup:prepare");
  expect(result.commands.startLocal).toBe("bun run local --open");
  expect(result.commands.installModel).toContain("bun run model:install");
  expect(result.launch.written.length).toBeGreaterThanOrEqual(9);
  expect(result.launch.written.every((file) => existsSync(file))).toBe(true);
  expect(result.readiness.items.some((item) => item.id === "chat" && item.status === "ready")).toBe(true);
  expect(result.setupActions.nextActions.length).toBeGreaterThan(0);
  expect(result.supervisor.ready.some((item) => item.kind === "app")).toBe(true);
  expect(result.skipped.some((item) => item.id === "image-backend")).toBe(true);
  expect(result.nextSteps.some((step) => step.includes("bun run local --open"))).toBe(true);
});

test("setup prepare API returns safe first-run preparation result", async () => {
  const res = await route(
    new Request("http://localhost/api/setup/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prepareImage: false }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();

  expect(json.commands.startLocal).toBe("bun run local --open");
  expect(json.launch.profile.files.profileJson).toContain(process.env.NIPUX_HOME!);
  expect(json.readiness.localUrl).toContain("127.0.0.1");
  expect(json.applied.some((item: { id: string }) => item.id === "launch-profile")).toBe(true);
});
