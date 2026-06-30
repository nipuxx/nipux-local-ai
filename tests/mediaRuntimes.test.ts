import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-media-runtimes-"));
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

test("media runtime planner exposes all local worker lanes", async () => {
  const res = await route(new Request("http://localhost/api/media/runtimes"));
  expect(res.status).toBe(200);
  const json = await res.json();
  const kinds = json.runtimes.map((runtime: { kind: string }) => runtime.kind);
  expect(kinds).toEqual(["image", "speech", "transcription", "video"]);

  const image = json.runtimes.find((runtime: { kind: string }) => runtime.kind === "image");
  expect(image.defaultPort).toBe(8081);
  expect(image.envVar).toBe("NIPUX_IMAGE_WORKER_URL");
  expect(image.localOnly).toBe(true);
  expect(image.endpoint).toBe("/v1/images/generations");
  expect(image.commands.some((item: { command: string }) => item.command.includes("bun run worker:image"))).toBe(true);
  const transcription = json.runtimes.find((runtime: { kind: string }) => runtime.kind === "transcription");
  expect(transcription.commands.some((item: { command: string }) => item.command.includes("bun run transcription:prepare"))).toBe(true);
  expect(transcription.commands.some((item: { command: string }) => item.command.includes("bun run worker:transcription"))).toBe(true);
  const video = json.runtimes.find((runtime: { kind: string }) => runtime.kind === "video");
  expect(video.commands.some((item: { command: string }) => item.command.includes("bun run worker:video"))).toBe(true);
  expect(json.nextSteps.some((step: string) => step.includes("Image Generation") || step.includes("bun run worker:image"))).toBe(true);
  expect(json.nextSteps.some((step: string) => step.toLowerCase().includes("transcription") || step.includes("8083") || step.includes("bun run local --open"))).toBe(true);
  expect(json.nextSteps.some((step: string) => step.includes("Video Generation") || step.includes("bun run worker:video"))).toBe(true);
  expect(json.hardware.totalRamGb).toBeGreaterThan(0);
});

test("media runtime planner reflects configured loopback workers", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return new Response("ok");
    },
  });

  try {
    await patchSettings({ speechWorkerUrl: `http://127.0.0.1:${server.port}` });

    const res = await route(new Request("http://localhost/api/media/runtimes"));
    const json = await res.json();
    const speech = json.runtimes.find((runtime: { kind: string }) => runtime.kind === "speech");

    expect(speech.status).toBe("ready");
    expect(speech.workerUrl).toBe(`http://127.0.0.1:${server.port}`);
    expect(speech.health.reachable).toBe(true);
  } finally {
    server.stop(true);
    await patchSettings({ speechWorkerUrl: "" });
  }
});

test("media runtime planner marks configured but unreachable workers offline", async () => {
  await patchSettings({ imageWorkerUrl: "http://127.0.0.1:9" });

  try {
    const res = await route(new Request("http://localhost/api/media/runtimes"));
    const json = await res.json();
    const image = json.runtimes.find((runtime: { kind: string }) => runtime.kind === "image");

    expect(image.status).toBe("offline");
    expect(image.health.reachable).toBe(false);
    expect(json.nextSteps.some((step: string) => step.includes("Start OpenAI-compatible local image worker"))).toBe(true);
  } finally {
    await patchSettings({ imageWorkerUrl: "" });
  }
});

test("recommended media defaults persist loopback URLs without marking workers ready", async () => {
  const res = await route(
    new Request("http://localhost/api/media/runtimes/defaults", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kinds: ["image"], includeOptional: true, overwrite: true }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.applied.some((item: { kind: string; workerUrl: string }) => item.kind === "image" && item.workerUrl === "http://127.0.0.1:8081")).toBe(true);
  const image = json.plan.runtimes.find((runtime: { kind: string }) => runtime.kind === "image");
  expect(image.status).toBe("offline");

  await patchSettings({ imageWorkerUrl: "" });
});
