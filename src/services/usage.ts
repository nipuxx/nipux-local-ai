import { db } from "../db.ts";
import type { UsageSummary } from "../types.ts";

export function recordUsage(input: {
  kind: "chat" | "agent" | "search" | "model" | "browser";
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

export function getUsageTimeline(limit = 80) {
  return db
    .prepare(
      `SELECT kind, model, tokens_in AS tokensIn, tokens_out AS tokensOut,
        latency_ms AS latencyMs, status, created_at AS createdAt
       FROM usage_events
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit);
}
