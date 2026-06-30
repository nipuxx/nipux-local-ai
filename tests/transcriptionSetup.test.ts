import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-transcription-setup-"));

const {
  getConfiguredWhisperModelPath,
  getTranscriptionSetupPlan,
  getWhisperModelPreset,
  installWhisperModel,
  prepareTranscriptionSetup,
  whisperInstallCommand,
  whisperModelPath,
  whisperStartCommand,
  WHISPER_MODEL_PRESETS,
} = await import("../src/services/transcriptionSetup.ts");
const { getAppSettings, setRawSetting } = await import("../src/services/settings.ts");

test("whisper setup exposes small local transcription presets", () => {
  expect(WHISPER_MODEL_PRESETS.map((preset) => preset.id)).toEqual(["tiny.en", "base.en"]);
  expect(getWhisperModelPreset("missing").id).toBe("base.en");
  expect(whisperInstallCommand()).toBe("bun run transcription:install base.en");
  expect(whisperStartCommand()).toContain("bun run worker:transcription");
  expect(whisperStartCommand()).toContain("ggml-base.en.bin");
});

test("whisper setup downloads the selected model into the local model directory", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/ggml-tiny.en.bin");
      return new Response("fake whisper model");
    },
  });

  try {
    process.env.NIPUX_WHISPER_MODEL_BASE_URL = `http://127.0.0.1:${server.port}`;
    const result = await installWhisperModel("tiny.en");
    expect(result.downloaded).toBe(true);
    expect(result.targetPath).toBe(whisperModelPath("tiny.en"));
    expect(existsSync(result.targetPath)).toBe(true);
    expect(readFileSync(result.targetPath, "utf8")).toBe("fake whisper model");
    expect(result.configured).toBe(true);
    expect(result.localCommand).toBe("bun run local --open");
    expect(result.startCommand).toContain(result.targetPath);
    expect(getConfiguredWhisperModelPath()).toBe(result.targetPath);

    const second = await installWhisperModel("tiny.en");
    expect(second.downloaded).toBe(false);
    expect(second.configured).toBe(true);
  } finally {
    server.stop(true);
    delete process.env.NIPUX_WHISPER_MODEL_BASE_URL;
  }
});

test("transcription prepare stores the local worker URL without pretending the binary is ready", async () => {
  setRawSetting("whisper_model_path", "");
  const result = await prepareTranscriptionSetup({ presetId: "base.en" });

  expect(result.selectedPresetId).toBe("base.en");
  expect(result.settings.transcriptionWorkerUrl).toBe("http://127.0.0.1:8083");
  expect(getAppSettings().transcriptionWorkerUrl).toBe("http://127.0.0.1:8083");
  expect(result.installed).toBe(false);
  expect(result.plan.command.envVar).toBe("NIPUX_WHISPER_COMMAND");
  expect(result.nextSteps.some((step) => step.includes("transcription:prepare base.en --install"))).toBe(true);
});

test("transcription prepare can install and persist the selected model", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/ggml-base.en.bin");
      return new Response("fake base whisper model");
    },
  });

  try {
    process.env.NIPUX_WHISPER_MODEL_BASE_URL = `http://127.0.0.1:${server.port}`;
    const result = await prepareTranscriptionSetup({ presetId: "base.en", install: true });
    expect(result.installed).toBe(true);
    expect(result.install?.downloaded).toBe(true);
    expect(result.settings.transcriptionWorkerUrl).toBe("http://127.0.0.1:8083");
    expect(getConfiguredWhisperModelPath()).toBe(whisperModelPath("base.en"));

    const plan = getTranscriptionSetupPlan();
    expect(plan.modelInstalled).toBe(true);
    expect(plan.configuredModelPath).toBe(whisperModelPath("base.en"));
  } finally {
    server.stop(true);
    delete process.env.NIPUX_WHISPER_MODEL_BASE_URL;
  }
});
