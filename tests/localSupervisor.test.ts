import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const originalHome = process.env.NIPUX_HOME;
const originalFakeLlm = process.env.NIPUX_FAKE_LLM;
process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-local-supervisor-"));
process.env.NIPUX_FAKE_LLM = "1";

const previous = {
  imageCommand: process.env.NIPUX_IMAGE_COMMAND,
  imageArgs: process.env.NIPUX_IMAGE_ARGS,
  llamaCommand: process.env.NIPUX_LLAMA_COMMAND,
  llamaModelPath: process.env.NIPUX_LLAMA_MODEL_PATH,
  whisperModel: process.env.NIPUX_WHISPER_MODEL,
  whisperCommand: process.env.NIPUX_WHISPER_COMMAND,
  videoCommand: process.env.NIPUX_VIDEO_COMMAND,
};

const { formatLocalSupervisorPlan, getLocalSupervisorPlan, runLocalSupervisor } = await import("../src/services/localSupervisor.ts");

afterAll(() => {
  if (originalHome === undefined) delete process.env.NIPUX_HOME;
  else process.env.NIPUX_HOME = originalHome;
  if (originalFakeLlm === undefined) delete process.env.NIPUX_FAKE_LLM;
  else process.env.NIPUX_FAKE_LLM = originalFakeLlm;
  if (previous.imageCommand === undefined) delete process.env.NIPUX_IMAGE_COMMAND;
  else process.env.NIPUX_IMAGE_COMMAND = previous.imageCommand;
  if (previous.imageArgs === undefined) delete process.env.NIPUX_IMAGE_ARGS;
  else process.env.NIPUX_IMAGE_ARGS = previous.imageArgs;
  if (previous.llamaCommand === undefined) delete process.env.NIPUX_LLAMA_COMMAND;
  else process.env.NIPUX_LLAMA_COMMAND = previous.llamaCommand;
  if (previous.llamaModelPath === undefined) delete process.env.NIPUX_LLAMA_MODEL_PATH;
  else process.env.NIPUX_LLAMA_MODEL_PATH = previous.llamaModelPath;
  if (previous.whisperModel === undefined) delete process.env.NIPUX_WHISPER_MODEL;
  else process.env.NIPUX_WHISPER_MODEL = previous.whisperModel;
  if (previous.whisperCommand === undefined) delete process.env.NIPUX_WHISPER_COMMAND;
  else process.env.NIPUX_WHISPER_COMMAND = previous.whisperCommand;
  if (previous.videoCommand === undefined) delete process.env.NIPUX_VIDEO_COMMAND;
  else process.env.NIPUX_VIDEO_COMMAND = previous.videoCommand;
});

test("local supervisor plan starts app and skips unconfigured workers", () => {
  delete process.env.NIPUX_FAKE_LLM;
  delete process.env.NIPUX_LLAMA_COMMAND;
  delete process.env.NIPUX_LLAMA_MODEL_PATH;
  delete process.env.NIPUX_IMAGE_COMMAND;
  delete process.env.NIPUX_WHISPER_MODEL;
  delete process.env.NIPUX_VIDEO_COMMAND;

  const plan = getLocalSupervisorPlan();
  expect(plan.ready.map((item) => item.kind)).toEqual(["app"]);
  expect(plan.skipped.map((item) => item.kind)).toEqual(["llm", "image", "transcription", "video"]);
  expect(plan.nextSteps.some((step) => step.includes("llama.cpp") || step.includes("model:install"))).toBe(true);
  expect(plan.nextSteps.some((step) => step.includes("NIPUX_IMAGE_COMMAND"))).toBe(true);
  expect(plan.nextSteps.some((step) => step.includes("transcription:install"))).toBe(true);
  expect(plan.nextSteps.some((step) => step.includes("NIPUX_VIDEO_COMMAND"))).toBe(false);
});

test("local supervisor plan wires configured workers into the app environment", async () => {
  const fakeLlama = join(process.env.NIPUX_HOME!, "fake-llama");
  const fakeModel = join(process.env.NIPUX_HOME!, "fake-model.gguf");
  writeFileSync(fakeLlama, "");
  writeFileSync(fakeModel, "");
  delete process.env.NIPUX_FAKE_LLM;
  process.env.NIPUX_LLAMA_COMMAND = fakeLlama;
  process.env.NIPUX_LLAMA_MODEL_PATH = fakeModel;
  process.env.NIPUX_IMAGE_COMMAND = "fake-image";
  process.env.NIPUX_IMAGE_ARGS = "{input} {output}";
  process.env.NIPUX_WHISPER_MODEL = "/tmp/fake-whisper.bin";
  process.env.NIPUX_WHISPER_COMMAND = "fake-whisper";
  process.env.NIPUX_VIDEO_COMMAND = "fake-video";

  const plan = await runLocalSupervisor({ dryRun: true });
  expect(plan.ready.map((item) => item.kind)).toEqual(["llm", "image", "transcription", "video", "app"]);
  const app = plan.ready.find((item) => item.kind === "app");
  expect(app?.env.NIPUX_LLAMA_BASE_URL).toBe("http://127.0.0.1:8080/v1");
  expect(app?.env.NIPUX_IMAGE_WORKER_URL).toBe("http://127.0.0.1:8081");
  expect(app?.env.NIPUX_TRANSCRIPTION_WORKER_URL).toBe("http://127.0.0.1:8083");
  expect(app?.env.NIPUX_VIDEO_WORKER_URL).toBe("http://127.0.0.1:8084");
  expect(formatLocalSupervisorPlan(plan)).toContain("fake-model.gguf");
  expect(formatLocalSupervisorPlan(plan)).toContain("fake-image");
});
