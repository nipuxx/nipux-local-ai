import { expect, test } from "bun:test";

const { videoStartCommand, videoWorkerContract } = await import("../src/services/videoSetup.ts");

test("video setup exposes the bundled video worker command", () => {
  expect(videoStartCommand()).toContain("bun run worker:video");
  expect(videoStartCommand()).toContain("NIPUX_VIDEO_COMMAND=");
  expect(videoWorkerContract()).toContain("{input} {output}");
});
