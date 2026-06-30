import { db } from "../db.ts";

export type BrowserAction = "open" | "navigate" | "screenshot" | "click" | "type" | "key" | "close";
export type BrowserActor = "user" | "agent";
export type BrowserRisk = "low" | "medium" | "high";
export type PermissionStatus = "pending" | "approved" | "denied";

export interface BrowserActionContext {
  actor?: BrowserActor;
  agentId?: string | null;
  reason?: string;
  permissionRequestId?: string;
}

export interface PermissionRequestRecord {
  id: string;
  kind: string;
  status: PermissionStatus;
  browserSessionId?: string | null;
  agentId?: string | null;
  actor: BrowserActor;
  action: BrowserAction;
  risk: BrowserRisk;
  reason?: string | null;
  details: Record<string, unknown>;
  createdAt: string;
  resolvedAt?: string | null;
}

export class PermissionRequiredError extends Error {
  request: PermissionRequestRecord;

  constructor(request: PermissionRequestRecord) {
    super(`Permission required for agent browser action: ${request.action}`);
    this.name = "PermissionRequiredError";
    this.request = request;
  }
}

function parseDetails(detailsJson: string) {
  try {
    return JSON.parse(detailsJson) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]),
  );
}

function detailsMatch(left: Record<string, unknown> = {}, right: Record<string, unknown> = {}) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function permissionRow(row: {
  id: string;
  kind: string;
  status: PermissionStatus;
  browserSessionId?: string | null;
  agentId?: string | null;
  actor: BrowserActor;
  action: BrowserAction;
  risk: BrowserRisk;
  reason?: string | null;
  detailsJson: string;
  createdAt: string;
  resolvedAt?: string | null;
}): PermissionRequestRecord {
  const { detailsJson, ...rest } = row;
  return { ...rest, details: parseDetails(detailsJson) };
}

export function classifyBrowserRisk(action: BrowserAction, details: Record<string, unknown> = {}): BrowserRisk {
  if (action === "open" || action === "screenshot" || action === "close") return "low";
  if (action === "navigate") {
    const url = String(details.url ?? "");
    if (/^(file|ftp|chrome|chrome-extension):/i.test(url)) return "high";
    return "medium";
  }
  return "medium";
}

export function createPermissionRequest(input: {
  browserSessionId: string;
  agentId?: string | null;
  actor: BrowserActor;
  action: BrowserAction;
  risk: BrowserRisk;
  reason?: string;
  details?: Record<string, unknown>;
}) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO permission_requests
      (id, kind, status, browser_session_id, agent_id, actor, action, risk, reason, details_json)
     VALUES (?, 'browser-action', 'pending', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.browserSessionId,
    input.agentId ?? null,
    input.actor,
    input.action,
    input.risk,
    input.reason ?? null,
    JSON.stringify(input.details ?? {}),
  );
  return getPermissionRequest(id);
}

export function getPermissionRequest(id: string) {
  const row = db
    .prepare(
      `SELECT id, kind, status, browser_session_id AS browserSessionId, agent_id AS agentId,
        actor, action, risk, reason, details_json AS detailsJson,
        created_at AS createdAt, resolved_at AS resolvedAt
       FROM permission_requests
       WHERE id = ?`,
    )
    .get(id) as Parameters<typeof permissionRow>[0] | null;
  if (!row) throw new Error(`Permission request ${id} was not found.`);
  return permissionRow(row);
}

export function listPermissionRequests(status?: PermissionStatus, limit = 80) {
  const sql =
    status ?
      `SELECT id, kind, status, browser_session_id AS browserSessionId, agent_id AS agentId,
        actor, action, risk, reason, details_json AS detailsJson,
        created_at AS createdAt, resolved_at AS resolvedAt
       FROM permission_requests
       WHERE status = ?
       ORDER BY created_at DESC
       LIMIT ?`
    : `SELECT id, kind, status, browser_session_id AS browserSessionId, agent_id AS agentId,
        actor, action, risk, reason, details_json AS detailsJson,
        created_at AS createdAt, resolved_at AS resolvedAt
       FROM permission_requests
       ORDER BY created_at DESC
       LIMIT ?`;
  const rows = (status ? db.prepare(sql).all(status, limit) : db.prepare(sql).all(limit)) as Parameters<typeof permissionRow>[0][];
  return rows.map(permissionRow);
}

export function resolvePermissionRequest(id: string, status: Exclude<PermissionStatus, "pending">) {
  getPermissionRequest(id);
  db.prepare("UPDATE permission_requests SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
  return getPermissionRequest(id);
}

export function recordBrowserAction(input: {
  browserSessionId: string;
  agentId?: string | null;
  actor?: BrowserActor;
  action: BrowserAction;
  risk?: BrowserRisk;
  status: "ok" | "error" | "blocked";
  url?: string | null;
  details?: Record<string, unknown>;
  permissionRequestId?: string | null;
  error?: string | null;
}) {
  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO browser_action_events
      (id, browser_session_id, agent_id, actor, action, risk, status, url, details_json, permission_request_id, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.browserSessionId,
    input.agentId ?? null,
    input.actor ?? "user",
    input.action,
    input.risk ?? classifyBrowserRisk(input.action, input.details),
    input.status,
    input.url ?? null,
    JSON.stringify(input.details ?? {}),
    input.permissionRequestId ?? null,
    input.error ?? null,
  );
  return id;
}

export function listBrowserActionEvents(input: { browserSessionId?: string; limit?: number } = {}) {
  const limit = input.limit ?? 120;
  const sql =
    input.browserSessionId ?
      `SELECT id, browser_session_id AS browserSessionId, agent_id AS agentId, actor, action, risk,
        status, url, details_json AS detailsJson, permission_request_id AS permissionRequestId,
        error, created_at AS createdAt
       FROM browser_action_events
       WHERE browser_session_id = ?
       ORDER BY created_at DESC
       LIMIT ?`
    : `SELECT id, browser_session_id AS browserSessionId, agent_id AS agentId, actor, action, risk,
        status, url, details_json AS detailsJson, permission_request_id AS permissionRequestId,
        error, created_at AS createdAt
       FROM browser_action_events
       ORDER BY created_at DESC
       LIMIT ?`;
  const rows = (input.browserSessionId ? db.prepare(sql).all(input.browserSessionId, limit) : db.prepare(sql).all(limit)) as Array<{
    id: string;
    browserSessionId: string;
    agentId?: string | null;
    actor: BrowserActor;
    action: BrowserAction;
    risk: BrowserRisk;
    status: string;
    url?: string | null;
    detailsJson: string;
    permissionRequestId?: string | null;
    error?: string | null;
    createdAt: string;
  }>;
  return rows.map((row) => {
    const { detailsJson, ...rest } = row;
    return { ...rest, details: parseDetails(detailsJson) };
  });
}

export function assertBrowserActionAllowed(input: {
  browserSessionId: string;
  agentId?: string | null;
  action: BrowserAction;
  details?: Record<string, unknown>;
  context?: BrowserActionContext;
}) {
  const actor = input.context?.actor ?? "user";
  const risk = classifyBrowserRisk(input.action, input.details);
  if (actor !== "agent" || risk === "low") return { actor, risk, permissionRequestId: input.context?.permissionRequestId ?? null };

  if (input.context?.permissionRequestId) {
    const request = getPermissionRequest(input.context.permissionRequestId);
    const agentId = input.context?.agentId ?? input.agentId ?? null;
    if (
      request.status === "approved" &&
      request.browserSessionId === input.browserSessionId &&
      request.action === input.action &&
      (request.agentId ?? null) === agentId &&
      detailsMatch(request.details, input.details)
    ) {
      return { actor, risk, permissionRequestId: request.id };
    }
  }

  const request = createPermissionRequest({
    browserSessionId: input.browserSessionId,
    agentId: input.context?.agentId ?? input.agentId,
    actor,
    action: input.action,
    risk,
    reason: input.context?.reason,
    details: input.details,
  });
  recordBrowserAction({
    browserSessionId: input.browserSessionId,
    agentId: input.context?.agentId ?? input.agentId,
    actor,
    action: input.action,
    risk,
    status: "blocked",
    url: String(input.details?.url ?? ""),
    details: input.details,
    permissionRequestId: request.id,
  });
  throw new PermissionRequiredError(request);
}
