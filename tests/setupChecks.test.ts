import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-setup-checks-"));
process.env.NIPUX_FAKE_LLM = "1";

const { formatSetupCheck, getSetupPreflight, installGuidanceFor } = await import("../src/services/setupChecks.ts");

test("setup guidance is platform specific", () => {
  expect(installGuidanceFor("git", "win32")).toContain("winget");
  expect(installGuidanceFor("git", "darwin")).toContain("xcode-select");
  expect(installGuidanceFor("llama", "linux")).toContain("llama.app");
  expect(installGuidanceFor("playwright", "win32")).toBe("bun run browsers:install");
});

test("setup check formatter includes repair hints", () => {
  const line = formatSetupCheck({
    id: "git",
    label: "Git",
    status: "error",
    detail: "git was not found.",
    fix: "winget install Git.Git",
  });
  expect(line).toContain("[error] Git");
  expect(line).toContain("Fix: winget install Git.Git");
});

test("preflight reports core install checks", async () => {
  const preflight = await getSetupPreflight();
  expect(preflight.checks.some((check) => check.id === "bun")).toBe(true);
  expect(preflight.checks.some((check) => check.id === "git")).toBe(true);
  expect(preflight.checks.some((check) => check.id === "llama")).toBe(true);
  expect(preflight.checks.some((check) => check.id === "playwright")).toBe(true);
  expect(preflight.checks.some((check) => check.id === "searxng")).toBe(true);
});
