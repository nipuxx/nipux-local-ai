import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";

export interface LocalSpeechRuntime {
  available: boolean;
  engine: "macos-say" | "espeak" | "windows-sapi" | "unavailable";
  command: string;
  outputMime: string;
  outputFormat: "wav" | "aiff";
  setup: string;
}

export interface LocalSpeechResult extends Record<string, unknown> {
  mime: string;
  base64: string;
  dataUrl: string;
  engine: LocalSpeechRuntime["engine"];
  voice: string;
  format: LocalSpeechRuntime["outputFormat"];
}

const OPENAI_VOICES = new Set(["alloy", "ash", "ballad", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer", "verse"]);

function executableCandidates(command: string) {
  if (command.includes("/") || command.includes("\\")) return [command];
  const extensions = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((dir) => extensions.map((ext) => join(dir, command.endsWith(ext.toLowerCase()) ? command : `${command}${ext}`)));
}

function findExecutable(command: string) {
  return executableCandidates(command).find((candidate) => existsSync(candidate)) ?? "";
}

function commandName(path: string) {
  return path ? basename(path) : "";
}

export function getLocalSpeechRuntime(): LocalSpeechRuntime {
  if (process.env.NIPUX_DISABLE_BUILTIN_SPEECH === "1") {
    return {
      available: false,
      engine: "unavailable",
      command: "",
      outputMime: "",
      outputFormat: "wav",
      setup: "Built-in speech is disabled by NIPUX_DISABLE_BUILTIN_SPEECH=1.",
    };
  }

  if (process.platform === "darwin") {
    const say = findExecutable("say");
    if (say) {
      const ffmpeg = findExecutable("ffmpeg");
      return {
        available: true,
        engine: "macos-say",
        command: commandName(say),
        outputMime: ffmpeg ? "audio/wav" : "audio/aiff",
        outputFormat: ffmpeg ? "wav" : "aiff",
        setup: ffmpeg ? "Using macOS say with ffmpeg WAV conversion." : "Using macOS say with AIFF output.",
      };
    }
  }

  if (process.platform === "linux") {
    const espeak = findExecutable("espeak-ng") || findExecutable("espeak");
    if (espeak) {
      return {
        available: true,
        engine: "espeak",
        command: commandName(espeak),
        outputMime: "audio/wav",
        outputFormat: "wav",
        setup: "Using local espeak-compatible speech synthesis.",
      };
    }
  }

  if (process.platform === "win32") {
    const powershell = findExecutable("powershell.exe") || findExecutable("pwsh.exe");
    if (powershell) {
      return {
        available: true,
        engine: "windows-sapi",
        command: commandName(powershell),
        outputMime: "audio/wav",
        outputFormat: "wav",
        setup: "Using Windows System.Speech SAPI synthesis.",
      };
    }
  }

  return {
    available: false,
    engine: "unavailable",
    command: "",
    outputMime: "",
    outputFormat: "wav",
    setup: "Install a local Kokoro/Piper worker or a supported system speech command.",
  };
}

function systemVoice(voice?: string) {
  const normalized = voice?.trim();
  if (!normalized) return "";
  if (OPENAI_VOICES.has(normalized.toLowerCase())) return "";
  return normalized;
}

async function runCommand(command: string, args: string[], timeoutMs = 45000) {
  const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);
  if (exitCode !== 0) {
    const message = stderr.trim() || stdout.trim() || `${command} exited with ${exitCode}`;
    throw new Error(message);
  }
}

async function generateMacSpeech(runtime: LocalSpeechRuntime, input: string, voice: string, dir: string): Promise<{ path: string; mime: string; format: "wav" | "aiff" }> {
  const say = findExecutable("say") || "say";
  const aiffPath = join(dir, "speech.aiff");
  const args = ["-o", aiffPath];
  if (voice) args.push("-v", voice);
  args.push(input);
  await runCommand(say, args);

  if (runtime.outputFormat === "aiff") return { path: aiffPath, mime: "audio/aiff", format: "aiff" };

  const wavPath = join(dir, "speech.wav");
  const ffmpeg = findExecutable("ffmpeg") || "ffmpeg";
  await runCommand(ffmpeg, ["-y", "-loglevel", "error", "-i", aiffPath, wavPath]);
  return { path: wavPath, mime: "audio/wav", format: "wav" };
}

async function generateEspeakSpeech(input: string, voice: string, dir: string): Promise<{ path: string; mime: string; format: "wav" }> {
  const espeak = findExecutable("espeak-ng") || findExecutable("espeak") || "espeak";
  const wavPath = join(dir, "speech.wav");
  const args: string[] = [];
  if (voice) args.push("-v", voice);
  args.push("-w", wavPath, input);
  await runCommand(espeak, args);
  return { path: wavPath, mime: "audio/wav", format: "wav" };
}

async function generateWindowsSpeech(input: string, voice: string, dir: string): Promise<{ path: string; mime: string; format: "wav" }> {
  const powershell = findExecutable("powershell.exe") || findExecutable("pwsh.exe") || "powershell.exe";
  const wavPath = join(dir, "speech.wav");
  const script = [
    "Add-Type -AssemblyName System.Speech",
    "$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    voice ? `$speaker.SelectVoice(${JSON.stringify(voice)})` : "",
    `$speaker.SetOutputToWaveFile(${JSON.stringify(wavPath)})`,
    `$speaker.Speak(${JSON.stringify(input)})`,
    "$speaker.Dispose()",
  ].filter(Boolean).join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  await runCommand(powershell, ["-NoProfile", "-EncodedCommand", encoded]);
  return { path: wavPath, mime: "audio/wav", format: "wav" };
}

export async function generateLocalSpeech(input: string, voice?: string): Promise<LocalSpeechResult> {
  const runtime = getLocalSpeechRuntime();
  if (!runtime.available) throw new Error(runtime.setup);
  const text = input.trim();
  if (!text) throw new Error("input is required");
  if (text.length > 8000) throw new Error("Built-in speech input is limited to 8000 characters.");

  const dir = await mkdtemp(join(tmpdir(), "nipux-speech-"));
  try {
    const selectedVoice = systemVoice(voice);
    const output = runtime.engine === "macos-say"
      ? await generateMacSpeech(runtime, text, selectedVoice, dir)
      : runtime.engine === "espeak"
        ? await generateEspeakSpeech(text, selectedVoice, dir)
        : await generateWindowsSpeech(text, selectedVoice, dir);
    const audio = await readFile(output.path);
    const base64 = audio.toString("base64");
    return {
      mime: output.mime,
      base64,
      dataUrl: `data:${output.mime};base64,${base64}`,
      engine: runtime.engine,
      voice: selectedVoice || "system-default",
      format: output.format,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
