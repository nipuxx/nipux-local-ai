import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-memory-index-"));
process.env.NIPUX_FAKE_LLM = "1";

const { route } = await import("../src/main.ts");

async function jsonRequest(path: string, body?: unknown, method = "POST") {
  return route(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

test("agent memories can be created, searched, and deleted through the API", async () => {
  const agentsRes = await route(new Request("http://localhost/api/agents"));
  const agents = await agentsRes.json();
  const agentId = agents.agents[0].id;

  const created = await jsonRequest(`/api/agents/${agentId}/memories`, {
    kind: "fact",
    content: "The preferred local search backend is SearXNG.",
    importance: 5,
  });
  expect(created.status).toBe(200);
  const { memory } = await created.json();
  expect(memory.source).toBe("manual");
  expect(memory.summary).toContain("preferred local search backend");
  expect(memory.tokenCount).toBeGreaterThan(0);

  const searched = await route(new Request(`http://localhost/api/agents/${agentId}/memories?q=search backend`));
  const data = await searched.json();
  expect(data.memories.some((item: { id: string }) => item.id === memory.id)).toBe(true);

  const deleted = await route(new Request(`http://localhost/api/memories/${memory.id}`, { method: "DELETE" }));
  expect(deleted.status).toBe(200);
});

test("agent memories can be compacted with provenance retained", async () => {
  const createdAgent = await jsonRequest("/api/agents", { name: "Compaction Agent" });
  const { agent } = await createdAgent.json();

  for (const index of [1, 2, 3]) {
    const created = await jsonRequest(`/api/agents/${agent.id}/memories`, {
      kind: "task",
      content: `User asked: Remember compaction item ${index}.\nAgent answered: Stored item ${index}.`,
      importance: 3,
    });
    expect(created.status).toBe(200);
  }

  const compacted = await jsonRequest(`/api/agents/${agent.id}/memories/compact`, { maxSource: 3 });
  expect(compacted.status).toBe(200);
  const compactedJson = await compacted.json();
  expect(compactedJson.archived).toBe(3);
  expect(compactedJson.memory.kind).toBe("summary");
  expect(compactedJson.memory.source).toBe("compaction");
  expect(compactedJson.memory.sourceIds.length).toBe(3);

  const active = await route(new Request(`http://localhost/api/agents/${agent.id}/memories`));
  const activeJson = await active.json();
  expect(activeJson.memories.some((item: { kind: string }) => item.kind === "summary")).toBe(true);
  expect(activeJson.memories.some((item: { kind: string }) => item.kind === "task")).toBe(false);

  const archived = await route(new Request(`http://localhost/api/agents/${agent.id}/memories?includeArchived=1`));
  const archivedJson = await archived.json();
  expect(archivedJson.memories.filter((item: { archivedAt?: string | null }) => item.archivedAt).length).toBe(3);
});

test("file path indexing adds searchable local documents", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nipux-index-fixture-"));
  const filePath = join(dir, "requirements.md");
  writeFileSync(filePath, "Nipux agents need editable memory and local file indexing.");

  const indexed = await jsonRequest("/api/search/index-path", { path: dir, maxFiles: 20, recursive: true });
  expect(indexed.status).toBe(200);
  const indexData = await indexed.json();
  expect(indexData.indexed).toBe(1);

  const searched = await jsonRequest("/api/search/local", { query: "editable memory indexing" });
  const searchData = await searched.json();
  expect(searchData.results.some((item: { path?: string }) => item.path === filePath)).toBe(true);

  const listed = await route(new Request("http://localhost/api/search/documents"));
  const listData = await listed.json();
  expect(listData.documents.some((item: { path?: string }) => item.path === filePath)).toBe(true);
});

test("bulk document import indexes browser-selected documents and reports skips", async () => {
  const bad = await jsonRequest("/api/search/documents/bulk", { documents: "not an array" });
  expect(bad.status).toBe(400);

  const imported = await jsonRequest("/api/search/documents/bulk", {
    maxBytes: 128,
    documents: [
      {
        title: "Browser Import Alpha",
        body: "Alpha browser import should make selected folder files searchable.",
        path: "research/alpha.md",
      },
      { title: "Empty Browser Import", body: "   ", path: "research/empty.txt" },
      { title: "Large Browser Import", body: "x".repeat(180), path: "research/large.txt" },
      { body: "Missing title should be skipped.", path: "research/untitled.txt" },
    ],
  });
  expect(imported.status).toBe(200);
  const importData = await imported.json();
  expect(importData.indexed).toHaveLength(1);
  expect(importData.skipped).toHaveLength(3);
  expect(importData.errors).toHaveLength(0);

  const searched = await jsonRequest("/api/search/local", { query: "browser import selected folder files" });
  const searchData = await searched.json();
  expect(searchData.results.some((item: { title: string; path?: string }) => item.title === "Browser Import Alpha" && item.path === "research/alpha.md")).toBe(true);
});
