import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-browsers-"));
process.env.NIPUX_FAKE_LLM = "1";

const { createBrowserSession, listBrowserSessions, normalizeBrowserUrl } = await import("../src/services/browserBroker.ts");
const { route } = await import("../src/main.ts");

test("browser sessions are persisted before Chromium is launched", () => {
  const session = createBrowserSession(undefined, "Test Browser");
  expect(session.label).toBe("Test Browser");
  expect(listBrowserSessions().some((item) => item.id === session.id)).toBe(true);
});

test("browser URL normalization defaults to https for plain domains", () => {
  expect(normalizeBrowserUrl("example.com")).toBe("https://example.com");
  expect(normalizeBrowserUrl("http://example.com")).toBe("http://example.com");
  expect(normalizeBrowserUrl("about:blank")).toBe("about:blank");
});

test("browser API creates sessions without launching a browser", async () => {
  const res = await route(
    new Request("http://localhost/api/browsers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "API Browser" }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.session.label).toBe("API Browser");
});
