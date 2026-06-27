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

  const searched = await route(new Request(`http://localhost/api/agents/${agentId}/memories?q=search backend`));
  const data = await searched.json();
  expect(data.memories.some((item: { id: string }) => item.id === memory.id)).toBe(true);

  const deleted = await route(new Request(`http://localhost/api/memories/${memory.id}`, { method: "DELETE" }));
  expect(deleted.status).toBe(200);
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
