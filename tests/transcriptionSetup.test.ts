import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-transcription-setup-"));

const {
  getWhisperModelPreset,
  installWhisperModel,
  whisperInstallCommand,
  whisperModelPath,
  whisperStartCommand,
  WHISPER_MODEL_PRESETS,
} = await import("../src/services/transcriptionSetup.ts");

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
    expect(result.startCommand).toContain(result.targetPath);

    const second = await installWhisperModel("tiny.en");
    expect(second.downloaded).toBe(false);
  } finally {
    server.stop(true);
    delete process.env.NIPUX_WHISPER_MODEL_BASE_URL;
  }
});
