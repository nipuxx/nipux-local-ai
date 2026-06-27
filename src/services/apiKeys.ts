import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../db.ts";

export interface ApiKeyRecord {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

function rowToRecord(row: {
  id: string;
  label: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}): ApiKeyRecord {
  return row;
}

export function activeStoredApiKeyCount() {
  const row = db.prepare("SELECT count(*) AS count FROM api_keys WHERE revoked_at IS NULL").get() as { count: number };
  return row.count;
}

export function listApiKeys(includeRevoked = false): ApiKeyRecord[] {
  const rows = db
    .prepare(
      `SELECT id, label, prefix, created_at AS createdAt, last_used_at AS lastUsedAt, revoked_at AS revokedAt
       FROM api_keys
       WHERE ? OR revoked_at IS NULL
       ORDER BY created_at DESC`,
    )
    .all(includeRevoked ? 1 : 0) as ApiKeyRecord[];
  return rows.map(rowToRecord);
}

export function createApiKey(label = "Local API key") {
  const key = `npx_${randomBytes(24).toString("base64url")}`;
  const record = {
    id: randomUUID(),
    label: label.trim() || "Local API key",
    prefix: `${key.slice(0, 10)}...`,
    keyHash: hashKey(key),
  };
  db.prepare(
    `INSERT INTO api_keys (id, label, prefix, key_hash)
     VALUES (?, ?, ?, ?)`,
  ).run(record.id, record.label, record.prefix, record.keyHash);
  return { key, record: listApiKeys().find((item) => item.id === record.id)! };
}

export function verifyStoredApiKey(key: string) {
  if (!key) return false;
  const keyHash = hashKey(key);
  const row = db.prepare("SELECT id FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL").get(keyHash) as { id: string } | null;
  if (!row) return false;
  db.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  return true;
}

export function revokeApiKey(id: string) {
  const result = db.prepare("UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL").run(id);
  return { revoked: result.changes > 0, id };
}
