import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-local-speech-"));
process.env.NIPUX_FAKE_LLM = "1";

const { getLocalSpeechRuntime } = await import("../src/services/localSpeech.ts");
const { route } = await import("../src/main.ts");

const runtime = getLocalSpeechRuntime();

test("local speech runtime detection is explicit", () => {
  expect(typeof runtime.available).toBe("boolean");
  expect(runtime.engine).toBeTruthy();
  if (runtime.available) expect(runtime.outputMime.startsWith("audio/")).toBe(true);
});

if (runtime.available) {
  test("OpenAI-compatible speech route returns local audio bytes", async () => {
    const res = await route(
      new Request("http://localhost/v1/audio/speech", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "Local speech works.", voice: "alloy" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")?.startsWith("audio/")).toBe(true);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);

    const jobs = await route(new Request("http://localhost/api/media/jobs"));
    const jobsJson = await jobs.json();
    expect(jobsJson.jobs.some((job: { kind: string; status: string; workerUrl: string }) => (
      job.kind === "speech" && job.status === "completed" && job.workerUrl === "builtin://system-speech"
    ))).toBe(true);
  }, 15000);
}
