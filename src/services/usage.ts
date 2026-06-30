import { db } from "../db.ts";
import type { UsageBreakdownItem, UsageDashboard, UsageEvent, UsageSummary } from "../types.ts";

export function recordUsage(input: {
  kind: "chat" | "agent" | "search" | "model" | "browser" | "image" | "audio" | "video";
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  status: "ok" | "error";
  meta?: Record<string, unknown>;
}) {
  db.prepare(
    `INSERT INTO usage_events
      (id, kind, model, tokens_in, tokens_out, latency_ms, status, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    crypto.randomUUID(),
    input.kind,
    input.model ?? null,
    input.tokensIn ?? 0,
    input.tokensOut ?? 0,
    input.latencyMs ?? 0,
    input.status,
    JSON.stringify(input.meta ?? {}),
  );
}

export function getUsageSummary(): UsageSummary {
  const row = db
    .prepare(
      `SELECT
        count(*) AS requests,
        coalesce(sum(tokens_in), 0) AS tokensIn,
        coalesce(sum(tokens_out), 0) AS tokensOut,
        coalesce(avg(latency_ms), 0) AS latencyMs,
        coalesce(sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors
       FROM usage_events`,
    )
    .get() as UsageSummary | null;
  return row ?? { requests: 0, tokensIn: 0, tokensOut: 0, latencyMs: 0, errors: 0 };
}

interface UsageGroupRow {
  key: string;
  label?: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  errors: number;
  lastEventAt?: string | null;
}

interface UsageEventRow {
  kind: string;
  model?: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: string;
  createdAt: string;
  metaJson: string;
}

function toNumber(value: unknown) {
  return Number(value ?? 0);
}

function parseMeta(metaJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(metaJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function groupRow(row: UsageGroupRow): UsageBreakdownItem {
  const requests = toNumber(row.requests);
  const errors = toNumber(row.errors);
  return {
    key: row.key,
    label: row.label ?? row.key,
    requests,
    tokensIn: toNumber(row.tokensIn),
    tokensOut: toNumber(row.tokensOut),
    latencyMs: toNumber(row.latencyMs),
    errors,
    errorRate: requests ? errors / requests : 0,
    lastEventAt: row.lastEventAt ?? null,
  };
}

function eventRow(row: UsageEventRow): UsageEvent {
  return {
    kind: row.kind,
    model: row.model ?? null,
    tokensIn: toNumber(row.tokensIn),
    tokensOut: toNumber(row.tokensOut),
    latencyMs: toNumber(row.latencyMs),
    status: row.status,
    createdAt: row.createdAt,
    meta: parseMeta(row.metaJson),
  };
}

export function getUsageByKind(): UsageBreakdownItem[] {
  return (
    db
      .prepare(
        `SELECT
          kind AS key,
          kind AS label,
          count(*) AS requests,
          coalesce(sum(tokens_in), 0) AS tokensIn,
          coalesce(sum(tokens_out), 0) AS tokensOut,
          coalesce(avg(latency_ms), 0) AS latencyMs,
          coalesce(sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
          max(created_at) AS lastEventAt
        FROM usage_events
        GROUP BY kind
        ORDER BY requests DESC, kind ASC`,
      )
      .all() as UsageGroupRow[]
  ).map(groupRow);
}

export function getUsageByModel(limit = 12): UsageBreakdownItem[] {
  return (
    db
      .prepare(
        `SELECT
          model AS key,
          model AS label,
          count(*) AS requests,
          coalesce(sum(tokens_in), 0) AS tokensIn,
          coalesce(sum(tokens_out), 0) AS tokensOut,
          coalesce(avg(latency_ms), 0) AS latencyMs,
          coalesce(sum(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS errors,
          max(created_at) AS lastEventAt
        FROM usage_events
        WHERE model IS NOT NULL AND model != ''
        GROUP BY model
        ORDER BY requests DESC, errors DESC, model ASC
        LIMIT ?`,
      )
      .all(limit) as UsageGroupRow[]
  ).map(groupRow);
}

export function getRecentUsageErrors(limit = 10): UsageEvent[] {
  return (
    db
      .prepare(
        `SELECT kind, model, tokens_in AS tokensIn, tokens_out AS tokensOut,
          latency_ms AS latencyMs, status, created_at AS createdAt, meta_json AS metaJson
        FROM usage_events
        WHERE status = 'error'
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .all(limit) as UsageEventRow[]
  ).map(eventRow);
}

export function getUsageTimeline(limit = 80): UsageEvent[] {
  return (
    db
      .prepare(
        `SELECT kind, model, tokens_in AS tokensIn, tokens_out AS tokensOut,
          latency_ms AS latencyMs, status, created_at AS createdAt, meta_json AS metaJson
        FROM usage_events
        ORDER BY created_at DESC
        LIMIT ?`,
      )
      .all(limit) as UsageEventRow[]
  ).map(eventRow);
}

export function getUsageDashboard(timelineLimit = 80): UsageDashboard {
  return {
    summary: getUsageSummary(),
    byKind: getUsageByKind(),
    byModel: getUsageByModel(),
    errors: getRecentUsageErrors(),
    timeline: getUsageTimeline(timelineLimit),
  };
}
