import { db } from "../db.ts";
import type { AgentMemory } from "../types.ts";

type AgentMemoryKind = AgentMemory["kind"];
type AgentMemorySource = AgentMemory["source"];

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

const MEMORY_KINDS: AgentMemoryKind[] = ["profile", "task", "procedure", "fact", "summary"];
const MEMORY_SOURCES: AgentMemorySource[] = ["manual", "agent_run", "compaction", "import"];

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

function truncate(value: string, max = 180) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1).trim()}...` : compact;
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function defaultSummary(content: string) {
  const firstUsefulLine =
    content
      .split("\n")
      .map((line) => line.replace(/^(User asked|Agent answered):\s*/i, "").trim())
      .find(Boolean) ?? content;
  return truncate(firstUsefulLine, 180);
}

function normalizeKind(kind?: string): AgentMemoryKind {
  return MEMORY_KINDS.includes(kind as AgentMemoryKind) ? (kind as AgentMemoryKind) : "fact";
}

function normalizeSource(source?: string): AgentMemorySource {
  return MEMORY_SOURCES.includes(source as AgentMemorySource) ? (source as AgentMemorySource) : "manual";
}

function parseSourceIds(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function rowToMemory(row: {
  id: string;
  agentId: string;
  kind: AgentMemoryKind;
  content: string;
  importance: number;
  source: AgentMemorySource;
  sourceId?: string | null;
  sourceIdsJson?: string | null;
  summary: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}): AgentMemory {
  return {
    ...row,
    sourceIds: parseSourceIds(row.sourceIdsJson),
    summary: row.summary || defaultSummary(row.content),
    tokenCount: row.tokenCount || estimateTokens(row.content),
  };
}

export function createAgentMemory(input: {
  agentId: string;
  kind?: AgentMemoryKind;
  content: string;
  importance?: number;
  source?: AgentMemorySource;
  sourceId?: string;
  sourceIds?: string[];
  summary?: string;
}) {
  const id = crypto.randomUUID();
  const content = input.content.trim();
  db.prepare(
    `INSERT INTO agent_memories (
      id, agent_id, kind, content, importance, source, source_id, source_ids_json, summary, token_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.agentId,
    normalizeKind(input.kind),
    content,
    input.importance ?? 3,
    normalizeSource(input.source),
    input.sourceId ?? null,
    JSON.stringify(input.sourceIds ?? []),
    input.summary?.trim() || defaultSummary(content),
    estimateTokens(content),
  );
  return getAgentMemory(id);
}

export function getAgentMemory(id: string): AgentMemory {
  const row = db
    .prepare(
      `SELECT id, agent_id AS agentId, kind, content, importance, source, source_id AS sourceId,
        source_ids_json AS sourceIdsJson, summary, token_count AS tokenCount,
        created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
       FROM agent_memories
       WHERE id = ?`,
    )
    .get(id) as ReturnType<typeof rowToMemory> | null;
  if (!row) throw new Error(`Memory ${id} was not found.`);
  return rowToMemory(row);
}

export function listAgentMemories(
  agentId: string,
  limit = 80,
  options: { includeArchived?: boolean; kind?: AgentMemoryKind } = {},
) {
  const filters = ["agent_id = ?"];
  const params: Array<string | number> = [agentId];
  if (!options.includeArchived) filters.push("archived_at IS NULL");
  if (options.kind) {
    filters.push("kind = ?");
    params.push(options.kind);
  }
  params.push(limit);
  return db
    .prepare(
      `SELECT id, agent_id AS agentId, kind, content, importance, source, source_id AS sourceId,
        source_ids_json AS sourceIdsJson, summary, token_count AS tokenCount,
        created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
       FROM agent_memories
       WHERE ${filters.join(" AND ")}
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
    )
    .all(...params)
    .map((row) => rowToMemory(row as Parameters<typeof rowToMemory>[0]));
}

export function updateAgentMemory(
  id: string,
  patch: Partial<Pick<AgentMemory, "kind" | "content" | "importance" | "summary">>,
) {
  const current = getAgentMemory(id);
  const content = patch.content?.trim() ?? current.content;
  db.prepare(
    `UPDATE agent_memories
     SET kind = ?, content = ?, importance = ?, summary = ?, token_count = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  ).run(
    patch.kind ? normalizeKind(patch.kind) : current.kind,
    content,
    patch.importance ?? current.importance,
    patch.summary?.trim() || (patch.content ? defaultSummary(content) : current.summary),
    estimateTokens(content),
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
      const text = `${memory.kind} ${memory.source} ${memory.summary} ${memory.content}`.toLowerCase();
      const hits = tokens.reduce((sum, token) => sum + (text.includes(token) ? 1 : 0), 0);
      const score = hits * 10 + memory.importance;
      return { memory, score };
    })
    .filter((item) => item.score > item.memory.importance)
    .sort((a, b) => b.score - a.score || b.memory.importance - a.memory.importance)
    .slice(0, limit)
    .map((item) => item.memory);
}

function compactableMemories(agentId: string, limit: number) {
  return db
    .prepare(
      `SELECT id, agent_id AS agentId, kind, content, importance, source, source_id AS sourceId,
        source_ids_json AS sourceIdsJson, summary, token_count AS tokenCount,
        created_at AS createdAt, updated_at AS updatedAt, archived_at AS archivedAt
       FROM agent_memories
       WHERE agent_id = ? AND kind = 'task' AND archived_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(agentId, limit)
    .map((row) => rowToMemory(row as Parameters<typeof rowToMemory>[0]));
}

function taskLine(memory: AgentMemory) {
  const asked = memory.content.match(/User asked:\s*([\s\S]*?)(?:\nAgent answered:|$)/i)?.[1];
  const answered = memory.content.match(/Agent answered:\s*([\s\S]*)/i)?.[1];
  const askText = truncate(asked ?? memory.summary ?? memory.content, 130);
  const answerText = answered ? ` | Answered: ${truncate(answered, 180)}` : "";
  return `Asked: ${askText}${answerText}`;
}

export function compactAgentMemories(agentId: string, maxSource = 30) {
  const sourceMemories = compactableMemories(agentId, Math.max(1, Math.min(maxSource, 100)));
  if (!sourceMemories.length) {
    return { memory: null, archived: 0, sourceIds: [] as string[] };
  }

  const sourceIds = sourceMemories.map((memory) => memory.id);
  const lines = sourceMemories.map((memory) => `- ${taskLine(memory)}`);
  const content = truncate(`Compacted agent history:\n${lines.join("\n")}`, 3600);
  const memory = createAgentMemory({
    agentId,
    kind: "summary",
    content,
    importance: 4,
    source: "compaction",
    sourceIds,
    summary: `${sourceMemories.length} task memories compacted into a reusable history summary.`,
  });

  const placeholders = sourceIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE agent_memories
     SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id IN (${placeholders})`,
  ).run(...sourceIds);

  return { memory, archived: sourceIds.length, sourceIds };
}

export function maybeCompactAgentMemories(agentId: string, threshold = 24) {
  const row = db
    .prepare("SELECT count(*) AS count FROM agent_memories WHERE agent_id = ? AND kind = 'task' AND archived_at IS NULL")
    .get(agentId) as { count: number };
  if (row.count <= threshold) return null;
  return compactAgentMemories(agentId, row.count - Math.floor(threshold / 2));
}
