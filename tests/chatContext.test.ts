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

async function patchSettings(body: Record<string, unknown>) {
  return jsonRequest("/api/settings", body, "PATCH");
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

test("native chat responder injects local SearXNG web results for current web requests", async () => {
  let searchedFor = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/search");
      expect(url.searchParams.get("format")).toBe("json");
      searchedFor = url.searchParams.get("q") ?? "";
      return Response.json({
        results: [
          {
            title: "Current Local AI Release Notes",
            url: "https://example.test/local-ai-release",
            content: "Current local AI release notes say web search should cite SearXNG results.",
          },
        ],
      });
    },
  });

  try {
    await patchSettings({ searxngUrl: `http://127.0.0.1:${server.port}` });
    const chat = await createChat();

    const res = await jsonRequest(`/api/chats/${chat.id}/respond`, {
      content: "Search web for current local AI release notes.",
      modelPreset: "balanced",
      stream: false,
      useLocalSearch: false,
      useWebSearch: true,
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(searchedFor).toBe("Search web for current local AI release notes.");
    expect(json.citations.some((citation: { id: string; title: string }) => citation.id === "W1" && citation.title === "Current Local AI Release Notes")).toBe(true);
    expect(json.output).toContain("Sources:");
    expect(json.output).toContain("[W1] Current Local AI Release Notes");

    const loaded = await route(new Request(`http://localhost/api/chats/${chat.id}`));
    const loadedJson = await loaded.json();
    expect(loadedJson.messages[1].content).toContain("[W1] Current Local AI Release Notes");
  } finally {
    await patchSettings({ searxngUrl: "" });
    server.stop(true);
  }
});

test("native chat responder reports web search setup when SearXNG is missing", async () => {
  await patchSettings({ searxngUrl: "" });
  const chat = await createChat();

  const res = await jsonRequest(`/api/chats/${chat.id}/respond`, {
    content: "Search web for current setup status.",
    modelPreset: "balanced",
    stream: false,
    useLocalSearch: false,
    useWebSearch: true,
  });
  expect(res.status).toBe(200);
  const json = await res.json();

  expect(json.citations.some((citation: { id: string; title: string }) => citation.id === "W1" && citation.title === "SearXNG is not configured")).toBe(true);
  expect(json.output).toContain("SearXNG is not configured");
  expect(json.output).toContain("Set a local SearXNG URL");
});

test("native chat media requests record honest setup failures", async () => {
  await patchSettings({ imageWorkerUrl: "" });
  const chat = await createChat();

  const res = await jsonRequest(`/api/chats/${chat.id}/respond`, {
    content: "Generate an image of \"a local dashboard with a calm setup state\".",
    modelPreset: "balanced",
    stream: false,
    useLocalSearch: false,
  });
  expect(res.status).toBe(200);
  const json = await res.json();

  const imageEvent = json.toolEvents.find((event: { tool: string }) => event.tool === "image_generation");
  expect(imageEvent.status).toBe("error");
  expect(imageEvent.mediaJobId).toBeTruthy();
  expect(json.output).toContain("image_generation error");
  expect(json.mediaJobs.some((job: { id: string; kind: string; status: string }) => job.id === imageEvent.mediaJobId && job.kind === "image" && job.status === "failed")).toBe(true);

  const loaded = await route(new Request(`http://localhost/api/chats/${chat.id}`));
  const loadedJson = await loaded.json();
  expect(loadedJson.messages[1].mediaJobs.some((job: { id: string; status: string }) => job.id === imageEvent.mediaJobId && job.status === "failed")).toBe(true);
});

test("native streamed chat media requests persist generated artifacts", async () => {
  let workerPrompt = "";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/images/generations" && req.method === "POST") {
        const body = await req.json() as { prompt?: string };
        workerPrompt = body.prompt ?? "";
        return Response.json({
          created: Math.floor(Date.now() / 1000),
          data: [{ b64_json: Buffer.from("fake chat image").toString("base64") }],
        });
      }
      return new Response("ok");
    },
  });

  try {
    await patchSettings({ imageWorkerUrl: `http://127.0.0.1:${server.port}` });
    const chat = await createChat();

    const res = await jsonRequest(`/api/chats/${chat.id}/respond`, {
      content: "Generate an image of \"a normal-user local AI chat surface\".",
      modelPreset: "balanced",
      stream: true,
      useLocalSearch: false,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const text = await res.text();
    expect(text).toContain("data: [DONE]");
    expect(text).toContain("image_generation ok");
    expect(workerPrompt).toBe("a normal-user local AI chat surface");

    const loaded = await route(new Request(`http://localhost/api/chats/${chat.id}`));
    const loadedJson = await loaded.json();
    const assistant = loadedJson.messages[1];
    expect(assistant.content).toContain("image_generation ok");
    expect(
      assistant.mediaJobs.some(
        (job: { kind: string; status: string; output: { data?: Array<{ b64_json?: string }> } }) =>
          job.kind === "image" &&
          job.status === "completed" &&
          job.output.data?.[0]?.b64_json === Buffer.from("fake chat image").toString("base64"),
      ),
    ).toBe(true);
  } finally {
    await patchSettings({ imageWorkerUrl: "" });
    server.stop(true);
  }
});
