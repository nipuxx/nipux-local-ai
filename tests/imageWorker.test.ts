import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const workerDir = mkdtempSync(join(tmpdir(), "nipux-image-worker-"));
const fakeImage = join(workerDir, "fake-image.js");
const previousCommand = process.env.NIPUX_IMAGE_COMMAND;
const previousArgs = process.env.NIPUX_IMAGE_ARGS;
writeFileSync(
  fakeImage,
  [
    "const inputPath = Bun.argv[2];",
    "const outputPath = Bun.argv[3];",
    "const input = await Bun.file(inputPath).json();",
    "if (input.prompt !== 'draw a local robot') process.exit(2);",
    "await Bun.write(outputPath, `png:${input.prompt}:${input.width}x${input.height}`);",
  ].join("\n"),
);

process.env.NIPUX_IMAGE_COMMAND = "bun";
process.env.NIPUX_IMAGE_ARGS = `${fakeImage} {input} {output}`;

const { route } = await import("../src/workers/imageWorker.ts");

afterAll(() => {
  if (previousCommand === undefined) delete process.env.NIPUX_IMAGE_COMMAND;
  else process.env.NIPUX_IMAGE_COMMAND = previousCommand;
  if (previousArgs === undefined) delete process.env.NIPUX_IMAGE_ARGS;
  else process.env.NIPUX_IMAGE_ARGS = previousArgs;
});

test("bundled image worker runs a local command and returns OpenAI-style b64_json", async () => {
  const res = await route(
    new Request("http://127.0.0.1:8081/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "draw a local robot", size: "512x768", response_format: "b64_json" }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.data[0].b64_json).toBe(Buffer.from("png:draw a local robot:512x768").toString("base64"));
  expect(json.model).toBe("local-image");
});

test("bundled image worker health requires a local command", async () => {
  const previous = process.env.NIPUX_IMAGE_COMMAND;
  delete process.env.NIPUX_IMAGE_COMMAND;
  try {
    const res = await route(new Request("http://127.0.0.1:8081"));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.ok).toBe(false);
  } finally {
    process.env.NIPUX_IMAGE_COMMAND = previous;
  }
});
