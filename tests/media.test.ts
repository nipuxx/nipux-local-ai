import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-media-"));
process.env.NIPUX_FAKE_LLM = "1";

const { route } = await import("../src/main.ts");

async function patchSettings(body: Record<string, unknown>) {
  return route(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

test("media capabilities report unconfigured local workers", async () => {
  const res = await route(new Request("http://localhost/api/media/capabilities"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.capabilities.image.status).toBe("unconfigured");
  expect(json.capabilities.speech.localOnly).toBe(true);
});

test("image generation returns an honest setup error when no local worker is configured", async () => {
  await patchSettings({ imageWorkerUrl: "" });
  const res = await route(
    new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "local image test" }),
    }),
  );
  expect(res.status).toBe(501);
  const json = await res.json();
  expect(json.error.message).toContain("local OpenAI-compatible image worker");
  expect(json.nipux.job.status).toBe("failed");
});

test("media worker URLs must be local loopback URLs", async () => {
  await patchSettings({ imageWorkerUrl: "https://api.openai.com/v1" });
  const res = await route(
    new Request("http://localhost/api/media/images/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "blocked external worker" }),
    }),
  );
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toContain("External media APIs are intentionally blocked");
});

test("media capabilities do not treat offline loopback workers as ready", async () => {
  await patchSettings({ imageWorkerUrl: "http://127.0.0.1:9" });

  try {
    const res = await route(new Request("http://localhost/api/media/capabilities"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.capabilities.image.status).toBe("offline");
    expect(json.capabilities.image.health.reachable).toBe(false);
  } finally {
    await patchSettings({ imageWorkerUrl: "" });
  }
});

test("media capabilities do not treat unhealthy loopback workers as ready", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response(null, { status: 503 });
    },
  });

  try {
    await patchSettings({ transcriptionWorkerUrl: `http://127.0.0.1:${server.port}` });
    const res = await route(new Request("http://localhost/api/media/capabilities"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.capabilities.transcription.status).toBe("offline");
    expect(json.capabilities.transcription.health.reachable).toBe(false);
    expect(json.capabilities.transcription.health.statusCode).toBe(503);
  } finally {
    server.stop(true);
    await patchSettings({ transcriptionWorkerUrl: "" });
  }
});

test("OpenAI-compatible image route proxies to a local worker", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/v1/images/generations");
      const body = await req.json();
      expect(body.prompt).toBe("draw a local robot");
      return Response.json({ created: 1, data: [{ b64_json: Buffer.from("png").toString("base64") }] });
    },
  });

  try {
    await patchSettings({ imageWorkerUrl: `http://127.0.0.1:${server.port}` });
    const res = await route(
      new Request("http://localhost/v1/images/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "draw a local robot", response_format: "b64_json" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data[0].b64_json).toBe(Buffer.from("png").toString("base64"));

    const jobs = await route(new Request("http://localhost/api/media/jobs"));
    const jobsJson = await jobs.json();
    expect(jobsJson.jobs.some((job: { status: string; kind: string }) => job.kind === "image" && job.status === "completed")).toBe(true);
  } finally {
    server.stop(true);
    await patchSettings({ imageWorkerUrl: "" });
  }
});

test("OpenAI-compatible transcription route reports setup error without a local worker", async () => {
  await patchSettings({ transcriptionWorkerUrl: "" });
  const form = new FormData();
  form.set("file", new File([Buffer.from("wav")], "sample.wav", { type: "audio/wav" }));

  const res = await route(
    new Request("http://localhost/v1/audio/transcriptions", {
      method: "POST",
      body: form,
    }),
  );
  expect(res.status).toBe(501);
  const json = await res.json();
  expect(json.error.message).toContain("local transcription worker");
  expect(json.nipux.job.kind).toBe("transcription");
  expect(json.nipux.job.input.audioBase64).toContain("omitted");
});

test("OpenAI-compatible transcription route translates multipart audio to a local worker", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/v1/audio/transcriptions");
      const body = await req.json();
      expect(body.audioBase64).toBe(Buffer.from("audio").toString("base64"));
      expect(String(body.mime)).toContain("webm");
      return Response.json({ text: "transcribed locally" });
    },
  });

  try {
    await patchSettings({ transcriptionWorkerUrl: `http://127.0.0.1:${server.port}` });
    const form = new FormData();
    form.set("file", new File([Buffer.from("audio")], "sample.webm", { type: "audio/webm" }));
    form.set("language", "en");

    const res = await route(
      new Request("http://localhost/v1/audio/transcriptions", {
        method: "POST",
        body: form,
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.text).toBe("transcribed locally");

    const jobs = await route(new Request("http://localhost/api/media/jobs"));
    const jobsJson = await jobs.json();
    expect(jobsJson.jobs.some((job: { status: string; kind: string }) => job.kind === "transcription" && job.status === "completed")).toBe(true);
  } finally {
    server.stop(true);
    await patchSettings({ transcriptionWorkerUrl: "" });
  }
});
