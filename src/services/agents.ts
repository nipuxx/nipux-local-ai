import { db, getDefaultAgent } from "../db.ts";
import { chatText, estimateMessageTokens } from "../providers/llamaCpp.ts";
import { formatAgentToolEvents, runAgentTools } from "./agentTools.ts";
import { getMediaJob } from "./media.ts";
import { createAgentMemory, maybeCompactAgentMemories, searchAgentMemoriesScored } from "./memory.ts";
import { getModel } from "./modelRegistry.ts";
import { recordUsage } from "./usage.ts";
import type { Agent, ChatMessage } from "../types.ts";

export function listAgents(): Agent[] {
  getDefaultAgent();
  return db
    .prepare(
      `SELECT id, name, model_preset AS modelPreset, system_prompt AS systemPrompt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM agents
       ORDER BY created_at`,
    )
    .all() as Agent[];
}

export function createAgent(name: string, modelPreset = "balanced") {
  const id = crypto.randomUUID();
  const prompt =
    "You are a local Hermes-style agent with persistent memory, search tools, and browser-session metadata. Keep answers direct, remember durable preferences, and produce action logs.";
  db.prepare("INSERT INTO agents (id, name, model_preset, system_prompt) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    modelPreset,
    prompt,
  );
  return listAgents().find((agent) => agent.id === id);
}

function readAgent(agentId?: string): Agent {
  if (!agentId) return getDefaultAgent();
  const agent = db
    .prepare(
      `SELECT id, name, model_preset AS modelPreset, system_prompt AS systemPrompt,
        created_at AS createdAt, updated_at AS updatedAt
       FROM agents WHERE id = ?`,
    )
    .get(agentId) as Agent | null;
  return agent ?? getDefaultAgent();
}

function createAgentToolInstructions() {
  return [
    "Treat the tool activity above as the authoritative record of what actually happened.",
    "Treat web search as unavailable if the tool activity or result says SearXNG is not configured.",
    "Store only durable, reusable facts in memory.",
    "Do not claim browser actions were executed unless a browser session event exists.",
    "Do not claim an image was generated unless image_generation is ok and a completed media job exists.",
  ].map((line) => `- ${line}`).join("\n");
}

function safeJsonArray<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

function mediaJobsForRun(value: string | null | undefined) {
  return safeJsonArray<string>(value)
    .map((id) => {
      try {
        return getMediaJob(id);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function runAgent(input: string, agentId?: string, forcedPreset?: string) {
  const agent = readAgent(agentId);
  const runId = crypto.randomUUID();
  const started = Date.now();
  db.prepare("INSERT INTO agent_runs (id, agent_id, input, status) VALUES (?, ?, ?, 'running')").run(runId, agent.id, input);

  try {
    const memories = searchAgentMemoriesScored(agent.id, input, 8);
    const toolRun = await runAgentTools(input, agent);
    const model = getModel(forcedPreset ?? agent.modelPreset);

    const memoryBlock =
      memories
        .map((memory) => {
          const provenance = memory.source === "manual" ? "manual" : `${memory.source}${memory.sourceId ? `:${memory.sourceId}` : ""}`;
          return `- [${memory.kind} | ${provenance}] ${memory.summary || memory.content}\n  ${memory.content}`;
        })
        .join("\n") || "No relevant memories yet.";
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: `${agent.systemPrompt}

Persistent memory:
${memoryBlock}

Available tool context:
${toolRun.contextBlock}

Rules:
${createAgentToolInstructions()}`,
      },
      { role: "user", content: input },
    ];

    const output = await chatText(messages, model.id);
    const activity = formatAgentToolEvents(toolRun.events);
    const finalOutput = activity ? `${output}\n\n${activity}` : output;
    db.prepare(
      `UPDATE agent_runs
       SET output = ?, status = 'completed', tool_events_json = ?, media_job_ids_json = ?, completed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      finalOutput,
      JSON.stringify(toolRun.events),
      JSON.stringify(toolRun.mediaJobs.map((job) => job.id)),
      runId,
    );
    createAgentMemory({
      agentId: agent.id,
      kind: "task",
      content: `User asked: ${input}\nAgent answered: ${finalOutput.slice(0, 900)}`,
      importance: 3,
      source: "agent_run",
      sourceId: runId,
      summary: `Task: ${input.slice(0, 160)}`,
    });
    const compaction = maybeCompactAgentMemories(agent.id);
    recordUsage({
      kind: "agent",
      model: model.id,
      tokensIn: estimateMessageTokens(messages),
      tokensOut: Math.ceil(finalOutput.length / 4),
      latencyMs: Date.now() - started,
      status: "ok",
      meta: {
        runId,
        agentId: agent.id,
        compacted: compaction?.archived ?? 0,
        tools: toolRun.events.map((event) => ({ tool: event.tool, status: event.status })),
      },
    });
    return {
      runId,
      agent,
      output: finalOutput,
      localResults: toolRun.localResults,
      webResults: toolRun.webResults,
      browserSessions: toolRun.browserSessions,
      mediaJobs: toolRun.mediaJobs,
      toolEvents: toolRun.events,
      memories,
      compaction,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare("UPDATE agent_runs SET output = ?, status = 'failed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(message, runId);
    recordUsage({ kind: "agent", latencyMs: Date.now() - started, status: "error", meta: { runId, error: message } });
    throw error;
  }
}

export function listAgentRuns(limit = 40) {
  const rows = db
    .prepare(
      `SELECT r.id, r.agent_id AS agentId, a.name AS agentName, r.input, r.output,
        r.status, r.tool_events_json AS toolEventsJson, r.media_job_ids_json AS mediaJobIdsJson,
        r.created_at AS createdAt, r.completed_at AS completedAt
       FROM agent_runs r
       JOIN agents a ON a.id = r.agent_id
       ORDER BY r.created_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{
      id: string;
      agentId: string;
      agentName: string;
      input: string;
      output?: string | null;
      status: string;
      toolEventsJson?: string | null;
      mediaJobIdsJson?: string | null;
      createdAt: string;
      completedAt?: string | null;
    }>;
  return rows.map(({ toolEventsJson, mediaJobIdsJson, ...row }) => ({
    ...row,
    toolEvents: safeJsonArray(toolEventsJson),
    mediaJobs: mediaJobsForRun(mediaJobIdsJson),
  }));
}
