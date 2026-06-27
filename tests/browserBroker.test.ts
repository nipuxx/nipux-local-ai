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

test("agent browser navigation is blocked pending approval and logged", async () => {
  const created = await route(
    new Request("http://localhost/api/browsers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Approval Browser" }),
    }),
  );
  const { session } = await created.json();

  const blocked = await route(
    new Request(`http://localhost/api/browsers/${session.id}/navigate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        url: "example.com",
        reason: "Verify permission gate.",
      }),
    }),
  );
  expect(blocked.status).toBe(202);
  const blockedJson = await blocked.json();
  expect(blockedJson.permissionRequired).toBe(true);
  expect(blockedJson.request.status).toBe("pending");

  const permissions = await route(new Request("http://localhost/api/permissions?status=pending"));
  const permissionsJson = await permissions.json();
  expect(permissionsJson.requests.some((request: { id: string }) => request.id === blockedJson.request.id)).toBe(true);

  const actions = await route(new Request("http://localhost/api/browser-actions"));
  const actionsJson = await actions.json();
  expect(
    actionsJson.events.some(
      (event: { permissionRequestId?: string; status: string; action: string }) =>
        event.permissionRequestId === blockedJson.request.id && event.status === "blocked" && event.action === "navigate",
    ),
  ).toBe(true);

  const approved = await route(new Request(`http://localhost/api/permissions/${blockedJson.request.id}/approve`, { method: "POST" }));
  const approvedJson = await approved.json();
  expect(approvedJson.request.status).toBe("approved");
});
