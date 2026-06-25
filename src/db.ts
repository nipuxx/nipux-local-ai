import { mkdirSync } from "node:fs";
import { Database } from "bun:sqlite";
import { DATA_DIR, DB_PATH } from "./config.ts";
import type { Agent, AgentMemory, SearchResult } from "./types.ts";

mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH, { create: true });
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
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  `);

  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS local_documents_fts USING fts5(title, path, body);");
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(agent_id, kind, content);");
  } catch {
    ftsAvailable = false;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function indexDocument(title: string, body: string, path?: string) {
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

export function upsertAgentMemory(memory: Omit<AgentMemory, "createdAt">) {
  db.prepare(
    "INSERT INTO agent_memories (id, agent_id, kind, content, importance) VALUES (?, ?, ?, ?, ?)",
  ).run(memory.id, memory.agentId, memory.kind, memory.content, memory.importance);
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
