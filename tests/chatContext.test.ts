import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-chat-context-"));
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

async function createChat() {
  const res = await jsonRequest("/api/chats", { modelPreset: "balanced" });
  const json = await res.json();
  return json.chat as { id: string };
}

test("native chat responder adds local search citations and persists messages", async () => {
  await jsonRequest("/api/search/documents", {
    title: "Chat Context Fixture Alpha",
    body: "Alpha launch requirements say normal chat should cite local indexed documents.",
    path: "/fixtures/chat-alpha.md",
  });
  const chat = await createChat();

  const res = await jsonRequest(`/api/chats/${chat.id}/respond`, {
    content: "Search local notes for alpha launch requirements.",
    modelPreset: "balanced",
    stream: false,
  });
  expect(res.status).toBe(200);
  const json = await res.json();

  expect(json.citations.some((citation: { title: string }) => citation.title === "Chat Context Fixture Alpha")).toBe(true);
  expect(json.output).toContain("Sources:");
  expect(json.output).toContain("[L1] Chat Context Fixture Alpha");

  const loaded = await route(new Request(`http://localhost/api/chats/${chat.id}`));
  const loadedJson = await loaded.json();
  expect(loadedJson.messages.map((message: { role: string }) => message.role)).toEqual(["user", "assistant"]);
  expect(loadedJson.messages[1].content).toContain("Sources:");
});

test("native chat responder streams cited output through the app endpoint", async () => {
  await jsonRequest("/api/search/documents", {
    title: "Chat Stream Fixture Beta",
    body: "Beta stream requirements say normal streamed chat should keep local source lines.",
    path: "/fixtures/chat-beta.md",
  });
  const chat = await createChat();

  const res = await jsonRequest(`/api/chats/${chat.id}/respond`, {
    content: "Find beta stream requirements in local notes.",
    modelPreset: "balanced",
    stream: true,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");

  const text = await res.text();
  expect(text).toContain("data: [DONE]");
  expect(text).toContain("Sources:");
  expect(text).toContain("Chat Stream Fixture Beta");

  const loaded = await route(new Request(`http://localhost/api/chats/${chat.id}`));
  const loadedJson = await loaded.json();
  expect(loadedJson.messages[1].content).toContain("Chat Stream Fixture Beta");
});
