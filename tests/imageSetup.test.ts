import { expect, test } from "bun:test";

const { imageStartCommand, imageWorkerContract } = await import("../src/services/imageSetup.ts");

test("image setup exposes the bundled image worker command", () => {
  expect(imageStartCommand()).toContain("bun run worker:image");
  expect(imageStartCommand()).toContain("NIPUX_IMAGE_COMMAND=");
  expect(imageWorkerContract()).toContain("{input} {output}");
});
