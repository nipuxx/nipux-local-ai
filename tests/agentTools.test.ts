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

  const runsRes = await route(new Request("http://localhost/api/agents"));
  const runsData = await runsRes.json();
  const persisted = runsData.runs.find((run: { id: string }) => run.id === data.runId);
  expect(persisted.toolEvents.some((event: { tool: string; mediaJobId?: string }) => event.tool === "image_generation" && event.mediaJobId === imageEvent.mediaJobId)).toBe(true);
  expect(persisted.mediaJobs.some((job: { id: string; status: string }) => job.id === imageEvent.mediaJobId && job.status === "failed")).toBe(true);
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

    const runsRes = await route(new Request("http://localhost/api/agents"));
    const runsData = await runsRes.json();
    const persisted = runsData.runs.find((run: { id: string }) => run.id === data.runId);
    expect(persisted.toolEvents.some((event: { tool: string; mediaJobId?: string }) => event.tool === "image_generation" && event.mediaJobId === imageEvent.mediaJobId)).toBe(true);
    expect(persisted.mediaJobs.some((job: { id: string; status: string }) => job.id === imageEvent.mediaJobId && job.status === "completed")).toBe(true);
  } finally {
    await patchSettings({ imageWorkerUrl: "" });
    server.stop(true);
  }
});

test("agent speech requests block external media APIs and record failed speech jobs", async () => {
  await patchSettings({ speechWorkerUrl: "https://api.openai.com/v1" });
  const createdAgent = await jsonRequest("/api/agents", { name: "Speech Safety Agent" });
  const { agent } = await createdAgent.json();

  try {
    const run = await jsonRequest("/api/agents/run", {
      agentId: agent.id,
      input: "Read aloud \"Local voice must stay private.\"",
    });
    expect(run.status).toBe(200);
    const data = await run.json();

    const speechEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "speech_generation");
    expect(speechEvent.status).toBe("error");
    expect(speechEvent.mediaJobId).toBeTruthy();
    expect(speechEvent.error).toContain("External media APIs are intentionally blocked");
    expect(data.mediaJobs.some((job: { id: string; kind: string; status: string }) => job.id === speechEvent.mediaJobId && job.kind === "speech" && job.status === "failed")).toBe(true);
    expect(data.output).toContain("speech_generation error");

    const runsRes = await route(new Request("http://localhost/api/agents"));
    const runsData = await runsRes.json();
    const persisted = runsData.runs.find((run: { id: string }) => run.id === data.runId);
    expect(persisted.toolEvents.some((event: { tool: string; mediaJobId?: string }) => event.tool === "speech_generation" && event.mediaJobId === speechEvent.mediaJobId)).toBe(true);
    expect(persisted.mediaJobs.some((job: { id: string; status: string }) => job.id === speechEvent.mediaJobId && job.status === "failed")).toBe(true);
  } finally {
    await patchSettings({ speechWorkerUrl: "" });
  }
});

test("agent speech requests can create local audio jobs through a loopback worker", async () => {
  let workerInput = "";
  let workerVoice = "";
  const speechBytes = Buffer.from("fake local speech");
  const speechDataUrl = `data:audio/wav;base64,${speechBytes.toString("base64")}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/audio/speech" && req.method === "POST") {
        const body = await req.json() as { input?: string; voice?: string };
        workerInput = body.input ?? "";
        workerVoice = body.voice ?? "";
        return new Response(speechBytes, { headers: { "content-type": "audio/wav" } });
      }
      return new Response("ok");
    },
  });

  try {
    await patchSettings({ speechWorkerUrl: `http://127.0.0.1:${server.port}` });
    const createdAgent = await jsonRequest("/api/agents", { name: "Speech Worker Agent" });
    const { agent } = await createdAgent.json();

    const run = await jsonRequest("/api/agents/run", {
      agentId: agent.id,
      input: "Read this aloud: \"Local agents can speak through the same media system.\"",
    });
    expect(run.status).toBe(200);
    const data = await run.json();

    const speechEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "speech_generation");
    expect(speechEvent.status).toBe("ok");
    expect(speechEvent.mediaJobId).toBeTruthy();
    expect(workerInput).toBe("Local agents can speak through the same media system.");
    expect(workerVoice).toBe("alloy");
    expect(
      data.mediaJobs.some(
        (job: { id: string; kind: string; status: string; output: { dataUrl?: string } }) =>
          job.id === speechEvent.mediaJobId &&
          job.kind === "speech" &&
          job.status === "completed" &&
          job.output.dataUrl === speechDataUrl,
      ),
    ).toBe(true);
    expect(data.output).toContain("speech_generation ok");

    const runsRes = await route(new Request("http://localhost/api/agents"));
    const runsData = await runsRes.json();
    const persisted = runsData.runs.find((run: { id: string }) => run.id === data.runId);
    expect(persisted.toolEvents.some((event: { tool: string; mediaJobId?: string }) => event.tool === "speech_generation" && event.mediaJobId === speechEvent.mediaJobId)).toBe(true);
    expect(persisted.mediaJobs.some((job: { id: string; status: string }) => job.id === speechEvent.mediaJobId && job.status === "completed")).toBe(true);
  } finally {
    await patchSettings({ speechWorkerUrl: "" });
    server.stop(true);
  }
});

test("agent video requests stay honest when no local video worker is configured", async () => {
  await patchSettings({ videoWorkerUrl: "" });
  const createdAgent = await jsonRequest("/api/agents", { name: "Video Setup Agent" });
  const { agent } = await createdAgent.json();

  const run = await jsonRequest("/api/agents/run", {
    agentId: agent.id,
    input: "Generate a video of \"a quiet local AI workspace loading screen\".",
  });
  expect(run.status).toBe(200);
  const data = await run.json();

  const videoEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "video_generation");
  expect(videoEvent.status).toBe("error");
  expect(videoEvent.mediaJobId).toBeTruthy();
  expect(videoEvent.error).toContain("local video worker");
  expect(data.mediaJobs.some((job: { id: string; kind: string; status: string }) => job.id === videoEvent.mediaJobId && job.kind === "video" && job.status === "failed")).toBe(true);
  expect(data.output).toContain("video_generation error");

  const runsRes = await route(new Request("http://localhost/api/agents"));
  const runsData = await runsRes.json();
  const persisted = runsData.runs.find((run: { id: string }) => run.id === data.runId);
  expect(persisted.toolEvents.some((event: { tool: string; mediaJobId?: string }) => event.tool === "video_generation" && event.mediaJobId === videoEvent.mediaJobId)).toBe(true);
  expect(persisted.mediaJobs.some((job: { id: string; status: string }) => job.id === videoEvent.mediaJobId && job.status === "failed")).toBe(true);
});

test("agent video requests can create local video jobs through a loopback worker", async () => {
  let workerPrompt = "";
  let workerSeconds = 0;
  const videoDataUrl = `data:video/mp4;base64,${Buffer.from("fake local video").toString("base64")}`;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/v1/video/generations" && req.method === "POST") {
        const body = await req.json() as { prompt?: string; seconds?: number };
        workerPrompt = body.prompt ?? "";
        workerSeconds = body.seconds ?? 0;
        return Response.json({
          created: Math.floor(Date.now() / 1000),
          data: [{ mime: "video/mp4", dataUrl: videoDataUrl }],
          model: "local-video",
        });
      }
      return new Response("ok");
    },
  });

  try {
    await patchSettings({ videoWorkerUrl: `http://127.0.0.1:${server.port}` });
    const createdAgent = await jsonRequest("/api/agents", { name: "Video Worker Agent" });
    const { agent } = await createdAgent.json();

    const run = await jsonRequest("/api/agents/run", {
      agentId: agent.id,
      input: "Generate a video of \"a compact local model dashboard animation\".",
    });
    expect(run.status).toBe(200);
    const data = await run.json();

    const videoEvent = data.toolEvents.find((event: { tool: string }) => event.tool === "video_generation");
    expect(videoEvent.status).toBe("ok");
    expect(videoEvent.mediaJobId).toBeTruthy();
    expect(workerPrompt).toBe("a compact local model dashboard animation");
    expect(workerSeconds).toBe(4);
    expect(
      data.mediaJobs.some(
        (job: { id: string; kind: string; status: string; output: { data?: Array<{ dataUrl?: string }> } }) =>
          job.id === videoEvent.mediaJobId &&
          job.kind === "video" &&
          job.status === "completed" &&
          job.output.data?.[0]?.dataUrl === videoDataUrl,
      ),
    ).toBe(true);
    expect(data.output).toContain("video_generation ok");

    const runsRes = await route(new Request("http://localhost/api/agents"));
    const runsData = await runsRes.json();
    const persisted = runsData.runs.find((run: { id: string }) => run.id === data.runId);
    expect(persisted.toolEvents.some((event: { tool: string; mediaJobId?: string }) => event.tool === "video_generation" && event.mediaJobId === videoEvent.mediaJobId)).toBe(true);
    expect(persisted.mediaJobs.some((job: { id: string; status: string }) => job.id === videoEvent.mediaJobId && job.status === "completed")).toBe(true);
  } finally {
    await patchSettings({ videoWorkerUrl: "" });
    server.stop(true);
  }
});
