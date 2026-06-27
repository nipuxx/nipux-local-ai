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
  expect(json.hardware.totalRamGb).toBeGreaterThan(0);
});

test("media runtime planner reflects configured loopback workers", async () => {
  await patchSettings({ speechWorkerUrl: "http://127.0.0.1:8082" });

  const res = await route(new Request("http://localhost/api/media/runtimes"));
  const json = await res.json();
  const speech = json.runtimes.find((runtime: { kind: string }) => runtime.kind === "speech");

  expect(speech.status).toBe("ready");
  expect(speech.workerUrl).toBe("http://127.0.0.1:8082");

  await patchSettings({ speechWorkerUrl: "" });
});
