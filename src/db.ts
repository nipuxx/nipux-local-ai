import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { DATA_DIR, DB_PATH } from "./config.ts";
import type { Agent, AgentMemory, SearchResult } from "./types.ts";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA busy_timeout = 5000;");
let ftsAvailable = true;

export function migrate() {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      repo TEXT NOT NULL,
      quant TEXT NOT NULL,
      family TEXT NOT NULL,
      parameters_b REAL NOT NULL,
      context_tokens INTEGER NOT NULL,
      estimated_ram_gb REAL NOT NULL,
      description TEXT NOT NULL,
      llama_ref TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'missing',
      local_path TEXT,
      file_name TEXT,
      backend TEXT NOT NULL DEFAULT 'llama.cpp',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model_preset TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS usage_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      model TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      meta_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      model_preset TEXT NOT NULL DEFAULT 'balanced',
      system_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      source TEXT NOT NULL DEFAULT 'manual',
      source_id TEXT,
      source_ids_json TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      token_count INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      input TEXT NOT NULL,
      output TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS local_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      path TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS browser_sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      url TEXT,
      user_data_dir TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS permission_requests (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      browser_session_id TEXT,
      agent_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      risk TEXT NOT NULL,
      reason TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS browser_action_events (
      id TEXT PRIMARY KEY,
      browser_session_id TEXT,
      agent_id TEXT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      risk TEXT NOT NULL,
      status TEXT NOT NULL,
      url TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      permission_request_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS media_jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      input_json TEXT NOT NULL DEFAULT '{}',
      output_json TEXT NOT NULL DEFAULT '{}',
      error TEXT,
      worker_url TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT
    );
  `);

  ensureColumn("agent_memories", "source", "TEXT NOT NULL DEFAULT 'manual'");
  ensureColumn("agent_memories", "source_id", "TEXT");
  ensureColumn("agent_memories", "source_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  ensureColumn("agent_memories", "summary", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("agent_memories", "token_count", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn("agent_memories", "archived_at", "TEXT");
  ensureColumn("agent_memories", "updated_at", "TEXT NOT NULL DEFAULT ''");
  db.exec("UPDATE agent_memories SET summary = substr(content, 1, 180) WHERE summary = '';");
  db.exec("UPDATE agent_memories SET token_count = CAST((length(content) + 3) / 4 AS INTEGER) WHERE token_count = 0;");
  db.exec("UPDATE agent_memories SET updated_at = created_at WHERE updated_at = '';");

  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS local_documents_fts USING fts5(title, path, body);");
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(agent_id, kind, content);");
  } catch {
    ftsAvailable = false;
  }
}

function ensureColumn(table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function indexDocument(title: string, body: string, path?: string) {
  if (path) deleteDocumentByPath(path);
  const insert = db.prepare("INSERT INTO local_documents (title, path, body) VALUES (?, ?, ?)");
  const result = insert.run(title, path ?? null, body);
  if (ftsAvailable) {
    db.prepare("INSERT INTO local_documents_fts (rowid, title, path, body) VALUES (?, ?, ?, ?)").run(
      result.lastInsertRowid,
      title,
      path ?? "",
      body,
    );
  }
  return Number(result.lastInsertRowid);
}

export function listLocalDocuments(limit = 80) {
  return db
    .prepare(
      `SELECT id, title, path, substr(body, 1, 240) AS snippet, created_at AS createdAt
       FROM local_documents
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ id: number; title: string; path?: string | null; snippet: string; createdAt: string }>;
}

export function deleteDocument(id: number) {
  if (ftsAvailable) db.prepare("DELETE FROM local_documents_fts WHERE rowid = ?").run(id);
  db.prepare("DELETE FROM local_documents WHERE id = ?").run(id);
  return { deleted: true, id };
}

export function deleteDocumentByPath(path: string) {
  const rows = db.prepare("SELECT id FROM local_documents WHERE path = ?").all(path) as Array<{ id: number }>;
  for (const row of rows) deleteDocument(row.id);
}

function toFtsQuery(query: string) {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9_]{3,}/g)
    ?.filter((term) => !["the", "and", "for", "with", "use", "using", "what", "are", "from", "that", "this"].includes(term))
    .slice(0, 12);
  return terms?.map((term) => `${term}*`).join(" OR ") ?? query;
}

export function searchLocalDocuments(query: string, limit = 8): SearchResult[] {
  const q = query.trim();
  if (!q) return [];

  if (ftsAvailable) {
    try {
      const ftsQuery = toFtsQuery(q);
      const rows = db
        .prepare(
          `SELECT d.title, d.path, snippet(local_documents_fts, 2, '', '', '...', 18) AS snippet
           FROM local_documents_fts
           JOIN local_documents d ON d.id = local_documents_fts.rowid
           WHERE local_documents_fts MATCH ?
           ORDER BY bm25(local_documents_fts)
           LIMIT ?`,
        )
        .all(ftsQuery, limit) as Array<{ title: string; path?: string; snippet?: string }>;
      if (rows.length) {
        return rows.map((row) => ({
          title: row.title,
          path: row.path,
          snippet: row.snippet ?? "",
          source: "local",
        }));
      }
    } catch {
      // Fall through to LIKE search; FTS MATCH is intentionally strict.
    }
  }

  const like = `%${q}%`;
  const rows = db
    .prepare("SELECT title, path, substr(body, 1, 240) AS snippet FROM local_documents WHERE title LIKE ? OR body LIKE ? LIMIT ?")
    .all(like, like, limit) as Array<{ title: string; path?: string; snippet?: string }>;
  return rows.map((row) => ({ title: row.title, path: row.path, snippet: row.snippet ?? "", source: "local" }));
}

export function upsertAgentMemory(memory: Omit<AgentMemory, "createdAt" | "updatedAt">) {
  db.prepare(
    `INSERT INTO agent_memories (
      id, agent_id, kind, content, importance, source, source_id, source_ids_json, summary, token_count, archived_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    memory.id,
    memory.agentId,
    memory.kind,
    memory.content,
    memory.importance,
    memory.source,
    memory.sourceId ?? null,
    JSON.stringify(memory.sourceIds),
    memory.summary,
    memory.tokenCount,
    memory.archivedAt ?? null,
  );
  if (ftsAvailable) {
    db.prepare("INSERT INTO agent_memories_fts (agent_id, kind, content) VALUES (?, ?, ?)").run(
      memory.agentId,
      memory.kind,
      memory.content,
    );
  }
}

export function searchAgentMemories(agentId: string, query: string, limit = 8): AgentMemory[] {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT id, agent_id AS agentId, kind, content, importance, created_at AS createdAt
       FROM agent_memories
       WHERE agent_id = ? AND content LIKE ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(agentId, like, limit) as AgentMemory[];
}

export function getDefaultAgent(): Agent {
  const existing = db
    .prepare(
      "SELECT id, name, model_preset AS modelPreset, system_prompt AS systemPrompt, created_at AS createdAt, updated_at AS updatedAt FROM agents ORDER BY created_at LIMIT 1",
    )
    .get() as Agent | null;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const systemPrompt =
    "You are a local Hermes-style background agent. Use concise plans, remember durable user preferences, cite local/web search context when provided, and ask for approval before destructive or external side effects.";
  db.prepare("INSERT INTO agents (id, name, model_preset, system_prompt) VALUES (?, ?, ?, ?)").run(
    id,
    "Default Agent",
    "balanced",
    systemPrompt,
  );
  return getDefaultAgent();
}

migrate();
