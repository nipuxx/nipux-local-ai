import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NIPUX_HOME } from "../config.ts";
import { db } from "../db.ts";
import { assertBrowserActionAllowed, type BrowserActionContext, recordBrowserAction } from "./browserAudit.ts";
import { getAppSettings } from "./settings.ts";
import { recordUsage } from "./usage.ts";

export interface BrowserSessionRecord {
  id: string;
  agentId?: string | null;
  label: string;
  status: "ready" | "open" | "closed" | "error";
  url?: string | null;
  userDataDir: string;
  latestScreenshotDataUrl?: string | null;
  latestScreenshotAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BrowserSessionRow {
  id: string;
  agentId?: string | null;
  label: string;
  status: BrowserSessionRecord["status"];
  url?: string | null;
  userDataDir: string;
  latestScreenshotPath?: string | null;
  latestScreenshotAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface RuntimeSession {
  context: {
    pages(): Array<RuntimePage>;
    newPage(): Promise<RuntimePage>;
    close(): Promise<void>;
  };
  page: RuntimePage;
}

interface RuntimePage {
  url(): string;
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  screenshot(options?: Record<string, unknown>): Promise<Buffer>;
  mouse: {
    click(x: number, y: number): Promise<void>;
  };
  keyboard: {
    type(text: string): Promise<void>;
    press(key: string): Promise<void>;
  };
  on(event: string, listener: () => void): void;
}

const activeSessions = new Map<string, RuntimeSession>();

function screenshotDataUrl(path?: string | null) {
  if (!path || !existsSync(path)) return null;
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

function browserSessionRow(row: BrowserSessionRow): BrowserSessionRecord {
  const { latestScreenshotPath, ...session } = row;
  return {
    ...session,
    latestScreenshotDataUrl: screenshotDataUrl(latestScreenshotPath),
  };
}

export function createBrowserSession(agentId?: string, label = "Agent Browser"): BrowserSessionRecord {
  const id = crypto.randomUUID();
  const userDataDir = join(NIPUX_HOME, "browsers", id);
  db.prepare(
    `INSERT INTO browser_sessions (id, agent_id, label, status, url, user_data_dir)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, agentId ?? null, label, "ready", "about:blank", userDataDir);
  return { id, agentId: agentId ?? null, label, status: "ready", url: "about:blank", userDataDir };
}

export function listBrowserSessions(): BrowserSessionRecord[] {
  const rows = db
    .prepare(
      `SELECT id, agent_id AS agentId, label, status, url, user_data_dir AS userDataDir,
        latest_screenshot_path AS latestScreenshotPath, latest_screenshot_at AS latestScreenshotAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM browser_sessions
       ORDER BY updated_at DESC`,
    )
    .all() as BrowserSessionRow[];
  return rows.map(browserSessionRow);
}

export function getBrowserSession(id: string): BrowserSessionRecord {
  const session = db
    .prepare(
      `SELECT id, agent_id AS agentId, label, status, url, user_data_dir AS userDataDir,
        latest_screenshot_path AS latestScreenshotPath, latest_screenshot_at AS latestScreenshotAt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM browser_sessions
       WHERE id = ?`,
    )
    .get(id) as BrowserSessionRow | null;
  if (!session) throw new Error(`Browser session ${id} was not found.`);
  return browserSessionRow(session);
}

function updateBrowserSession(id: string, patch: Partial<Pick<BrowserSessionRecord, "status" | "url">>) {
  const current = getBrowserSession(id);
  db.prepare("UPDATE browser_sessions SET status = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(
    patch.status ?? current.status,
    patch.url ?? current.url ?? "about:blank",
    id,
  );
  return getBrowserSession(id);
}

export function storeBrowserSessionScreenshot(id: string, buffer: Buffer) {
  const session = getBrowserSession(id);
  mkdirSync(session.userDataDir, { recursive: true });
  const screenshotPath = join(session.userDataDir, "latest-screenshot.png");
  writeFileSync(screenshotPath, buffer);
  db.prepare(
    `UPDATE browser_sessions
     SET latest_screenshot_path = ?, latest_screenshot_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(screenshotPath, id);
  return getBrowserSession(id);
}

export async function isPlaywrightAvailable() {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    await dynamicImport("playwright");
    return true;
  } catch {
    return false;
  }
}

async function loadChromium() {
  const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
    chromium?: {
      launchPersistentContext(userDataDir: string, options?: Record<string, unknown>): Promise<RuntimeSession["context"]>;
    };
  }>;
  const mod = await dynamicImport("playwright");
  if (!mod.chromium) throw new Error("Playwright Chromium is not available.");
  return mod.chromium;
}

export function normalizeBrowserUrl(input: string) {
  const value = input.trim();
  if (!value) return "about:blank";
  if (value === "about:blank") return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
  return `https://${value}`;
}

async function ensureRuntimeSession(id: string): Promise<RuntimeSession> {
  const existing = activeSessions.get(id);
  if (existing) return existing;

  const session = getBrowserSession(id);
  const chromium = await loadChromium();
  const context = await chromium.launchPersistentContext(session.userDataDir, {
    headless: getAppSettings().browserHeadless,
    viewport: { width: 1280, height: 820 },
  });
  const page = context.pages()[0] ?? (await context.newPage());
  page.on("framenavigated", () => {
    updateBrowserSession(id, { status: "open", url: page.url() });
  });
  const runtime = { context, page };
  activeSessions.set(id, runtime);
  updateBrowserSession(id, { status: "open", url: page.url() || session.url || "about:blank" });
  return runtime;
}

function actionAgentId(session: BrowserSessionRecord, context?: BrowserActionContext) {
  return context?.agentId ?? session.agentId ?? null;
}

function typedTextDetails(text: string) {
  return {
    textLength: text.length,
    textSha256: createHash("sha256").update(text).digest("hex"),
  };
}

export async function openBrowserSession(id: string, context: BrowserActionContext = {}) {
  const started = Date.now();
  const sessionRecord = getBrowserSession(id);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "open",
    context,
  });
  try {
    const runtime = await ensureRuntimeSession(id);
    const session = updateBrowserSession(id, { status: "open", url: runtime.page.url() || "about:blank" });
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "open",
      risk: permission.risk,
      status: "ok",
      url: session.url,
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "open", id } });
    return session;
  } catch (error) {
    updateBrowserSession(id, { status: "error" });
    const message = error instanceof Error ? error.message : String(error);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "open",
      risk: permission.risk,
      status: "error",
      error: message,
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "error", meta: { action: "open", id, error: message } });
    throw new Error(`${message} Run "bun run browsers:install" if Chromium has not been installed yet.`);
  }
}

export async function navigateBrowserSession(id: string, url: string, context: BrowserActionContext = {}) {
  const started = Date.now();
  const target = normalizeBrowserUrl(url);
  const sessionRecord = getBrowserSession(id);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "navigate",
    details: { url: target },
    context,
  });
  try {
    const runtime = await ensureRuntimeSession(id);
    await runtime.page.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
    const session = updateBrowserSession(id, { status: "open", url: runtime.page.url() || target });
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "navigate",
      risk: permission.risk,
      status: "ok",
      url: session.url,
      details: { url: target },
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "navigate", id, url: target } });
    return session;
  } catch (error) {
    updateBrowserSession(id, { status: "error", url: target });
    const message = error instanceof Error ? error.message : String(error);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "navigate",
      risk: permission.risk,
      status: "error",
      url: target,
      details: { url: target },
      permissionRequestId: permission.permissionRequestId,
      error: message,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "error", meta: { action: "navigate", id, url: target, error: message } });
    throw error;
  }
}

export async function screenshotBrowserSession(id: string, context: BrowserActionContext = {}) {
  const started = Date.now();
  const sessionRecord = getBrowserSession(id);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "screenshot",
    context,
  });
  try {
    const runtime = await ensureRuntimeSession(id);
    const buffer = await runtime.page.screenshot({ type: "png", fullPage: false });
    updateBrowserSession(id, { status: "open", url: runtime.page.url() || "about:blank" });
    const session = storeBrowserSessionScreenshot(id, buffer);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "screenshot",
      risk: permission.risk,
      status: "ok",
      url: session.url,
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "screenshot", id } });
    return {
      session,
      mime: "image/png",
      base64: buffer.toString("base64"),
      dataUrl: `data:image/png;base64,${buffer.toString("base64")}`,
    };
  } catch (error) {
    updateBrowserSession(id, { status: "error" });
    const message = error instanceof Error ? error.message : String(error);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "screenshot",
      risk: permission.risk,
      status: "error",
      error: message,
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "error", meta: { action: "screenshot", id, error: message } });
    throw new Error(`${message} Run "bun run browsers:install" if Chromium has not been installed yet.`);
  }
}

export async function clickBrowserSession(id: string, x: number, y: number, context: BrowserActionContext = {}) {
  const started = Date.now();
  const sessionRecord = getBrowserSession(id);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "click",
    details: { x, y },
    context,
  });
  try {
    const runtime = await ensureRuntimeSession(id);
    await runtime.page.mouse.click(x, y);
    const session = updateBrowserSession(id, { status: "open", url: runtime.page.url() || "about:blank" });
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "click",
      risk: permission.risk,
      status: "ok",
      url: session.url,
      details: { x, y },
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "click", id, x, y } });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "click",
      risk: permission.risk,
      status: "error",
      details: { x, y },
      permissionRequestId: permission.permissionRequestId,
      error: message,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "error", meta: { action: "click", id, x, y, error: message } });
    throw error;
  }
}

export async function typeInBrowserSession(id: string, text: string, context: BrowserActionContext = {}) {
  const started = Date.now();
  const sessionRecord = getBrowserSession(id);
  const details = typedTextDetails(text);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "type",
    details,
    context,
  });
  try {
    const runtime = await ensureRuntimeSession(id);
    await runtime.page.keyboard.type(text);
    const session = updateBrowserSession(id, { status: "open", url: runtime.page.url() || "about:blank" });
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "type",
      risk: permission.risk,
      status: "ok",
      url: session.url,
      details,
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "type", id, length: text.length } });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "type",
      risk: permission.risk,
      status: "error",
      details,
      permissionRequestId: permission.permissionRequestId,
      error: message,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "error", meta: { action: "type", id, length: text.length, error: message } });
    throw error;
  }
}

export async function pressBrowserKey(id: string, key: string, context: BrowserActionContext = {}) {
  const started = Date.now();
  const sessionRecord = getBrowserSession(id);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "key",
    details: { key },
    context,
  });
  try {
    const runtime = await ensureRuntimeSession(id);
    await runtime.page.keyboard.press(key);
    const session = updateBrowserSession(id, { status: "open", url: runtime.page.url() || "about:blank" });
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "key",
      risk: permission.risk,
      status: "ok",
      url: session.url,
      details: { key },
      permissionRequestId: permission.permissionRequestId,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "key", id, key } });
    return session;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordBrowserAction({
      browserSessionId: id,
      agentId: actionAgentId(sessionRecord, context),
      actor: permission.actor,
      action: "key",
      risk: permission.risk,
      status: "error",
      details: { key },
      permissionRequestId: permission.permissionRequestId,
      error: message,
    });
    recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "error", meta: { action: "key", id, key, error: message } });
    throw error;
  }
}

export async function closeBrowserSession(id: string, context: BrowserActionContext = {}) {
  const started = Date.now();
  const sessionRecord = getBrowserSession(id);
  const permission = assertBrowserActionAllowed({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    action: "close",
    context,
  });
  const runtime = activeSessions.get(id);
  if (runtime) {
    await runtime.context.close();
    activeSessions.delete(id);
  }
  const session = updateBrowserSession(id, { status: "closed" });
  recordBrowserAction({
    browserSessionId: id,
    agentId: actionAgentId(sessionRecord, context),
    actor: permission.actor,
    action: "close",
    risk: permission.risk,
    status: "ok",
    url: session.url,
    permissionRequestId: permission.permissionRequestId,
  });
  recordUsage({ kind: "browser", latencyMs: Date.now() - started, status: "ok", meta: { action: "close", id } });
  return session;
}
