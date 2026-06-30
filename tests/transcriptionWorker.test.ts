import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workerDir = mkdtempSync(join(tmpdir(), "nipux-transcription-worker-"));
const fakeWhisper = join(workerDir, "fake-whisper.js");
writeFileSync(
  fakeWhisper,
  [
    "#!/usr/bin/env bun",
    "const output = Bun.argv[Bun.argv.length - 1];",
    "await Bun.write(`${output}.txt`, 'local transcript from fake whisper');",
  ].join("\n"),
);
chmodSync(fakeWhisper, 0o755);

process.env.NIPUX_WHISPER_COMMAND = "bun";
process.env.NIPUX_WHISPER_ARGS = `${fakeWhisper} {model} {audio} {output}`;
process.env.NIPUX_WHISPER_MODEL = join(workerDir, "ggml-base.en.bin");

const { route } = await import("../src/workers/transcriptionWorker.ts");

test("bundled transcription worker health requires the whisper command", async () => {
  const previous = process.env.NIPUX_WHISPER_COMMAND;
  process.env.NIPUX_WHISPER_COMMAND = join(workerDir, "missing-whisper-command");
  try {
    const res = await route(new Request("http://127.0.0.1:8083"));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.missing).toContain(process.env.NIPUX_WHISPER_COMMAND);
  } finally {
    process.env.NIPUX_WHISPER_COMMAND = previous;
  }
});

test("bundled transcription worker runs a whisper.cpp-compatible command", async () => {
  const res = await route(
    new Request("http://127.0.0.1:8083/v1/audio/transcriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audioBase64: Buffer.from("fake audio").toString("base64"), mime: "audio/wav" }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.text).toBe("local transcript from fake whisper");
  expect(json.source).toBe("whisper.cpp");
});
