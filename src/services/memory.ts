import { db } from "../db.ts";
import type { AgentMemory } from "../types.ts";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "what",
  "when",
  "where",
  "from",
  "into",
  "your",
  "have",
  "need",
  "use",
  "using",
  "about",
  "agent",
  "agents",
]);

function terms(query: string) {
  return [
    ...new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9_]{3,}/g)
        ?.filter((term) => !STOP_WORDS.has(term))
        .slice(0, 16) ?? [],
    ),
  ];
}

function rowToMemory(row: {
  id: string;
  agentId: string;
  kind: AgentMemory["kind"];
  content: string;
  importance: number;
  createdAt: string;
}): AgentMemory {
  return row;
}

export function createAgentMemory(input: {
  agentId: string;
  kind?: AgentMemory["kind"];
  content: string;
  importance?: number;
}) {
  const id = crypto.randomUUID();
  db.prepare(
    "INSERT INTO agent_memories (id, agent_id, kind, content, importance) VALUES (?, ?, ?, ?, ?)",
  ).run(id, input.agentId, input.kind ?? "fact", input.content.trim(), input.importance ?? 3);
  return getAgentMemory(id);
}

export function getAgentMemory(id: string): AgentMemory {
  const row = db
    .prepare(
      `SELECT id, agent_id AS agentId, kind, content, importance, created_at AS createdAt
       FROM agent_memories
       WHERE id = ?`,
    )
    .get(id) as ReturnType<typeof rowToMemory> | null;
  if (!row) throw new Error(`Memory ${id} was not found.`);
  return rowToMemory(row);
}

export function listAgentMemories(agentId: string, limit = 80) {
  return db
    .prepare(
      `SELECT id, agent_id AS agentId, kind, content, importance, created_at AS createdAt
       FROM agent_memories
       WHERE agent_id = ?
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(agentId, limit) as AgentMemory[];
}

export function updateAgentMemory(
  id: string,
  patch: Partial<Pick<AgentMemory, "kind" | "content" | "importance">>,
) {
  const current = getAgentMemory(id);
  db.prepare("UPDATE agent_memories SET kind = ?, content = ?, importance = ? WHERE id = ?").run(
    patch.kind ?? current.kind,
    patch.content?.trim() ?? current.content,
    patch.importance ?? current.importance,
    id,
  );
  return getAgentMemory(id);
}

export function deleteAgentMemory(id: string) {
  getAgentMemory(id);
  db.prepare("DELETE FROM agent_memories WHERE id = ?").run(id);
  return { deleted: true, id };
}

export function searchAgentMemoriesScored(agentId: string, query: string, limit = 8) {
  const tokens = terms(query);
  const memories = listAgentMemories(agentId, 500);
  if (!tokens.length) return memories.slice(0, limit);

  return memories
    .map((memory) => {
      const text = `${memory.kind} ${memory.content}`.toLowerCase();
      const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
      const score = hits * 10 + memory.importance;
      return { memory, score };
    })
    .filter((item) => item.score > item.memory.importance)
    .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
    .slice(0, limit)
    .map((item) => item.memory);
}
