import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-agent-tools-"));
process.env.NIPUX_FAKE_LLM = "1";

const { route } = await import("../src/main.ts");
const { listBrowserSessions } = await import("../src/services/browserBroker.ts");

async function jsonRequest(path: string, body?: unknown, method = "POST") {
  return route(
    new Request(`http://localhost${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function patchSettings(body: Record<string, unknown>) {
  return jsonRequest("/api/settings", body, "PATCH");
}

test("agent runs expose local search tool activity", async () => {
  const agentsRes = await route(new Request("http://localhost/api/agents"));
  const agents = await agentsRes.json();
  const agentId = agents.agents[0].id;

  const indexed = await jsonRequest("/api/search/documents", {
    title: "Orbital Orange Requirements",
    body: "The local agent tool layer must surface orbital orange requirements from indexed notes.",
    path: "/fixtures/orbital-orange.md",
  });
  expect(indexed.status).toBe(200);

  const run = await jsonRequest("/api/agents/run", {
    agentId,
    input: "Search local docs for orbital orange requirements.",
  });
  expect(run.status).toBe(200);
  const data = await run.json();

  expect(data.localResults.some((result: { title: string }) => result.title === "Orbital Orange Requirements")).toBe(true);
  expect(data.toolEvents.some((event: { tool: string; status: string }) => event.tool === "local_search" && event.status === "ok")).toBe(true);
  expect(data.output).toContain("Tool activity:");
  expect(data.output).toContain("local_search ok");
});

test("agent runs create assigned browser sessions and pending navigation approvals", async () => {
  const createdAgent = await jsonRequest("/api/agents", { name: "Browser Tool Agent" });
  const { agent } = await createdAgent.json();

  const run = await jsonRequest("/api/agents/run", {
    agentId: agent.id,
    input: "Open a browser and visit example.com.",
  });
  expect(run.status).toBe(200);
  const data = await run.json();

  const sessionEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "browser_session");
  const navigationEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "browser_navigation");
  expect(sessionEvent.status).toBe("ok");
  expect(navigationEvent.status).toBe("pending");
  expect(navigationEvent.permissionRequestId).toBeTruthy();
  expect(data.output).toContain("browser_navigation pending");

  const session = listBrowserSessions().find((item) => item.id === sessionEvent.browserSessionId);
  expect(session?.agentId).toBe(agent.id);

  const permissions = await route(new Request("http://localhost/api/permissions?status=pending"));
  const permissionsJson = await permissions.json();
  expect(
    permissionsJson.requests.some(
      (request: { id: string; browserSessionId: string; details: { url?: string } }) =>
        request.id === navigationEvent.permissionRequestId &&
        request.browserSessionId === sessionEvent.browserSessionId &&
        request.details.url === "https://example.com",
    ),
  ).toBe(true);
});

test("agent image requests stay honest when no local image worker is configured", async () => {
  await patchSettings({ imageWorkerUrl: "" });
  const createdAgent = await jsonRequest("/api/agents", { name: "Image Setup Agent" });
  const { agent } = await createdAgent.json();

  const run = await jsonRequest("/api/agents/run", {
    agentId: agent.id,
    input: "Generate an image of \"a quiet local AI workspace\".",
  });
  expect(run.status).toBe(200);
  const data = await run.json();

  const imageEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "image_generation");
  expect(imageEvent.status).toBe("error");
  expect(imageEvent.mediaJobId).toBeTruthy();
  expect(imageEvent.error).toContain("local OpenAI-compatible image worker");
  expect(data.mediaJobs.some((job: { id: string; kind: string; status: string }) => job.id === imageEvent.mediaJobId && job.kind === "image" && job.status === "failed")).toBe(true);
  expect(data.output).toContain("image_generation error");
});

test("agent image requests can create local image jobs through a loopback worker", async () => {
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
          data: [{ b64_json: Buffer.from("fake local image").toString("base64") }],
        });
      }
      return new Response("ok");
    },
  });

  try {
    await patchSettings({ imageWorkerUrl: `http://127.0.0.1:${server.port}` });
    const createdAgent = await jsonRequest("/api/agents", { name: "Image Worker Agent" });
    const { agent } = await createdAgent.json();

    const run = await jsonRequest("/api/agents/run", {
      agentId: agent.id,
      input: "Generate an image of \"a compact local model dashboard\".",
    });
    expect(run.status).toBe(200);
    const data = await run.json();

    const imageEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "image_generation");
    expect(imageEvent.status).toBe("ok");
    expect(imageEvent.mediaJobId).toBeTruthy();
    expect(workerPrompt).toBe("a compact local model dashboard");
    expect(data.mediaJobs.some((job: { id: string; kind: string; status: string }) => job.id === imageEvent.mediaJobId && job.kind === "image" && job.status === "completed")).toBe(true);
    expect(data.output).toContain("image_generation ok");
  } finally {
    await patchSettings({ imageWorkerUrl: "" });
    server.stop(true);
  }
});
