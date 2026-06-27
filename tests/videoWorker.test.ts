import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workerDir = mkdtempSync(join(tmpdir(), "nipux-video-worker-"));
const fakeVideo = join(workerDir, "fake-video.js");
const jsonVideo = join(workerDir, "json-video.js");
const previousCommand = process.env.NIPUX_VIDEO_COMMAND;
const previousArgs = process.env.NIPUX_VIDEO_ARGS;

writeFileSync(
  fakeVideo,
  [
    "const inputPath = Bun.argv[2];",
    "const outputPath = Bun.argv[3];",
    "const input = await Bun.file(inputPath).json();",
    "if (input.prompt !== 'make a local clip') process.exit(2);",
    "await Bun.write(outputPath, `mp4:${input.prompt}:${input.seconds}s:${input.width}x${input.height}:${input.fps}fps`);",
  ].join("\n"),
);
writeFileSync(
  jsonVideo,
  [
    "const payload = Buffer.from('json video').toString('base64');",
    "console.log(JSON.stringify({ data: [{ mime: 'video/mp4', base64: payload }] }));",
  ].join("\n"),
);

process.env.NIPUX_VIDEO_COMMAND = "bun";
process.env.NIPUX_VIDEO_ARGS = `${fakeVideo} {input} {output}`;

const { route } = await import("../src/workers/videoWorker.ts");

afterAll(() => {
  if (previousCommand === undefined) delete process.env.NIPUX_VIDEO_COMMAND;
  else process.env.NIPUX_VIDEO_COMMAND = previousCommand;
  if (previousArgs === undefined) delete process.env.NIPUX_VIDEO_ARGS;
  else process.env.NIPUX_VIDEO_ARGS = previousArgs;
});

test("bundled video worker runs a local command and returns a playable data URL", async () => {
  const res = await route(
    new Request("http://127.0.0.1:8084/v1/video/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "make a local clip", seconds: 3, width: 640, height: 360, fps: 8 }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  const expected = Buffer.from("mp4:make a local clip:3s:640x360:8fps").toString("base64");
  expect(json.data[0].mime).toBe("video/mp4");
  expect(json.data[0].base64).toBe(expected);
  expect(json.data[0].dataUrl).toBe(`data:video/mp4;base64,${expected}`);
  expect(json.model).toBe("local-video");
});

test("bundled video worker normalizes JSON stdout with base64 and mime", async () => {
  const previous = process.env.NIPUX_VIDEO_ARGS;
  process.env.NIPUX_VIDEO_ARGS = `${jsonVideo} {input} {output}`;
  try {
    const res = await route(
      new Request("http://127.0.0.1:8084/v1/video/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "make a local clip" }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    const expected = Buffer.from("json video").toString("base64");
    expect(json.data[0].dataUrl).toBe(`data:video/mp4;base64,${expected}`);
  } finally {
    process.env.NIPUX_VIDEO_ARGS = previous;
  }
});

test("bundled video worker health requires a local command", async () => {
  const previous = process.env.NIPUX_VIDEO_COMMAND;
  delete process.env.NIPUX_VIDEO_COMMAND;
  try {
    const res = await route(new Request("http://127.0.0.1:8084"));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
  } finally {
    process.env.NIPUX_VIDEO_COMMAND = previous;
  }
});
