import { join } from "node:path";
import { NIPUX_HOME } from "../config.ts";
import { db } from "../db.ts";

export function createBrowserSession(agentId?: string, label = "Agent Browser") {
  const id = crypto.randomUUID();
  const userDataDir = join(NIPUX_HOME, "browsers", id);
  db.prepare(
    `INSERT INTO browser_sessions (id, agent_id, label, status, url, user_data_dir)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, agentId ?? null, label, "ready", "about:blank", userDataDir);
  return { id, agentId, label, status: "ready", url: "about:blank", userDataDir };
}

export function listBrowserSessions() {
  return db
    .prepare(
      `SELECT id, agent_id AS agentId, label, status, url, user_data_dir AS userDataDir,
        created_at AS createdAt, updated_at AS updatedAt
       FROM browser_sessions
       ORDER BY updated_at DESC`,
    )
    .all();
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
