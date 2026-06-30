import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-browsers-"));
process.env.NIPUX_FAKE_LLM = "1";

const { createBrowserSession, listBrowserSessions, normalizeBrowserUrl, storeBrowserSessionScreenshot } = await import("../src/services/browserBroker.ts");
const { assertBrowserActionAllowed, PermissionRequiredError, resolvePermissionRequest } = await import("../src/services/browserAudit.ts");
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

test("browser sessions persist the latest local screenshot preview", () => {
  const session = createBrowserSession(undefined, "Screenshot Browser");
  const stored = storeBrowserSessionScreenshot(session.id, Buffer.from("fake png bytes"));

  expect(stored.latestScreenshotAt).toBeTruthy();
  expect(stored.latestScreenshotDataUrl).toBe(`data:image/png;base64,${Buffer.from("fake png bytes").toString("base64")}`);

  const listed = listBrowserSessions().find((item) => item.id === session.id);
  expect(listed?.latestScreenshotDataUrl).toBe(stored.latestScreenshotDataUrl);
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

test("approved browser permissions only apply to exact action details", () => {
  const session = createBrowserSession("agent-1", "Exact Approval Browser");
  let requestId = "";
  try {
    assertBrowserActionAllowed({
      browserSessionId: session.id,
      agentId: "agent-1",
      action: "navigate",
      details: { url: "https://example.com" },
      context: { actor: "agent", agentId: "agent-1", reason: "Open requested page." },
    });
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionRequiredError);
    requestId = (error as { request: { id: string } }).request.id;
  }
  expect(requestId).toBeTruthy();
  resolvePermissionRequest(requestId, "approved");

  const allowed = assertBrowserActionAllowed({
    browserSessionId: session.id,
    agentId: "agent-1",
    action: "navigate",
    details: { url: "https://example.com" },
    context: { actor: "agent", agentId: "agent-1", permissionRequestId: requestId },
  });
  expect(allowed.permissionRequestId).toBe(requestId);

  try {
    assertBrowserActionAllowed({
      browserSessionId: session.id,
      agentId: "agent-1",
      action: "navigate",
      details: { url: "https://example.org" },
      context: { actor: "agent", agentId: "agent-1", permissionRequestId: requestId },
    });
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionRequiredError);
    const request = (error as { request: { id: string; details: { url?: string } } }).request;
    expect(request.id).not.toBe(requestId);
    expect(request.details.url).toBe("https://example.org");
    return;
  }
  throw new Error("Expected mismatched approval details to require a new permission.");
});

test("type permissions store a text fingerprint without exposing typed text", async () => {
  const session = createBrowserSession("agent-2", "Type Approval Browser");
  const blocked = await route(
    new Request(`http://localhost/api/browsers/${session.id}/type`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actor: "agent",
        agentId: "agent-2",
        text: "secret",
        reason: "Fill a focused field.",
      }),
    }),
  );
  expect(blocked.status).toBe(202);
  const blockedJson = await blocked.json();
  const expectedHash = createHash("sha256").update("secret").digest("hex");
  expect(blockedJson.request.details.textLength).toBe(6);
  expect(blockedJson.request.details.textSha256).toBe(expectedHash);
  expect(blockedJson.request.details.text).toBeUndefined();

  resolvePermissionRequest(blockedJson.request.id, "approved");
  const allowed = assertBrowserActionAllowed({
    browserSessionId: session.id,
    agentId: "agent-2",
    action: "type",
    details: { textLength: 6, textSha256: expectedHash },
    context: { actor: "agent", agentId: "agent-2", permissionRequestId: blockedJson.request.id },
  });
  expect(allowed.permissionRequestId).toBe(blockedJson.request.id);

  try {
    assertBrowserActionAllowed({
      browserSessionId: session.id,
      agentId: "agent-2",
      action: "type",
      details: { textLength: 6, textSha256: createHash("sha256").update("public").digest("hex") },
      context: { actor: "agent", agentId: "agent-2", permissionRequestId: blockedJson.request.id },
    });
  } catch (error) {
    expect(error).toBeInstanceOf(PermissionRequiredError);
    return;
  }
  throw new Error("Expected a different typed-text fingerprint to require a new permission.");
});
