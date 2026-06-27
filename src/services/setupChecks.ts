import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { platform } from "node:os";
import { DATA_DIR, MODEL_DIR, NIPUX_HOME, RUNTIME_DIR } from "../config.ts";
import { testLlamaBackend } from "../providers/llamaCpp.ts";
import { detectHardware } from "./hardware.ts";
import { getAppSettings } from "./settings.ts";
import { llamaServeCommand } from "./modelRegistry.ts";

export type SetupCheckStatus = "ok" | "warning" | "error";

export interface SetupCheck {
  id: string;
  label: string;
  status: SetupCheckStatus;
  detail: string;
  fix?: string;
}

export interface SetupPreflight {
  ready: boolean;
  checks: SetupCheck[];
  nextSteps: string[];
}

type ToolName = "bun" | "git" | "llama" | "playwright" | "searxng";

type Platform = NodeJS.Platform;

function currentPlatform(os: Platform = platform()) {
  if (os === "win32") return "windows";
  if (os === "darwin") return "macOS";
  if (os === "linux") return "Linux";
  return os;
}

export function installGuidanceFor(tool: ToolName, os: Platform = platform()) {
  if (tool === "bun") {
    return os === "win32"
      ? 'powershell -c "irm bun.sh/install.ps1 | iex"'
      : "curl -fsSL https://bun.sh/install | bash";
  }
  if (tool === "git") {
    if (os === "win32") return "winget install Git.Git";
    if (os === "darwin") return "xcode-select --install";
    return "sudo apt install git";
  }
  if (tool === "llama") {
    return os === "win32" ? "winget install llama.cpp" : "curl -LsSf https://llama.app/install.sh | sh";
  }
  if (tool === "playwright") return "bun run browsers:install";
  return "Set SearXNG URL in Settings, for example http://127.0.0.1:8888";
}

async function run(command: string, args: string[], timeoutMs = 2000) {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: exitCode === 0, text: `${stdout}\n${stderr}`.trim(), exitCode };
  } catch (error) {
    return { ok: false, text: error instanceof Error ? error.message : String(error), exitCode: -1 };
  }
}

async function checkCommand(id: string, label: string, command: string, args: string[], fix: string): Promise<SetupCheck> {
  const result = await run(command, args);
  if (result.ok) {
    const version = result.text.split(/\r?\n/).find(Boolean)?.trim();
    return { id, label, status: "ok", detail: version ? `Found ${version}` : "Found on PATH" };
  }
  return { id, label, status: "error", detail: `${command} was not found or did not run.`, fix };
}

function checkWritableDir(dir: string): SetupCheck {
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, `.nipux-write-test-${process.pid}`);
    writeFileSync(probe, "ok");
    rmSync(probe, { force: true });
    return { id: `dir:${dir}`, label: dir, status: "ok", detail: "Writable" };
  } catch (error) {
    return {
      id: `dir:${dir}`,
      label: dir,
      status: "error",
      detail: error instanceof Error ? error.message : String(error),
      fix: "Choose a writable NIPUX_HOME or fix directory permissions.",
    };
  }
}

async function checkPlaywright(): Promise<SetupCheck> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<{
      chromium?: { executablePath(): string };
    }>;
    const mod = await dynamicImport("playwright");
    const executablePath = mod.chromium?.executablePath();
    if (executablePath && existsSync(executablePath)) {
      return { id: "playwright", label: "Playwright Chromium", status: "ok", detail: executablePath };
    }
    return {
      id: "playwright",
      label: "Playwright Chromium",
      status: "warning",
      detail: "Playwright is installed, but Chromium is not downloaded.",
      fix: installGuidanceFor("playwright"),
    };
  } catch {
    return {
      id: "playwright",
      label: "Playwright Chromium",
      status: "warning",
      detail: "Playwright package is not installed.",
      fix: "Run bun install, then bun run browsers:install.",
    };
  }
}

export async function getSetupPreflight(): Promise<SetupPreflight> {
  const os = platform();
  const hardware = await detectHardware();
  const [bun, git, llamaCommand, llamaBackend, playwright] = await Promise.all([
    checkCommand("bun", "Bun runtime", "bun", ["--version"], installGuidanceFor("bun", os)),
    checkCommand("git", "Git", "git", ["--version"], installGuidanceFor("git", os)),
    checkCommand("llama", "llama.cpp command", "llama", ["--help"], installGuidanceFor("llama", os)),
    testLlamaBackend(),
    checkPlaywright(),
  ]);

  if (llamaCommand.status === "error") {
    llamaCommand.status = "warning";
    llamaCommand.detail = "llama.cpp is not installed on PATH. Dev mode still works.";
  } else if (!llamaBackend.ok) {
    llamaCommand.status = "warning";
    llamaCommand.detail = `llama.cpp command is installed, but the local server is not reachable.`;
    llamaCommand.fix = llamaServeCommand(hardware.recommendedPreset);
  } else {
    llamaCommand.detail = `Command found and backend reachable (${llamaBackend.mode}).`;
  }

  const settings = getAppSettings();
  const searxng: SetupCheck = settings.searxngUrl
    ? { id: "searxng", label: "SearXNG", status: "ok", detail: settings.searxngUrl }
    : {
        id: "searxng",
        label: "SearXNG",
        status: "warning",
        detail: "Web search is optional and not configured.",
        fix: installGuidanceFor("searxng", os),
      };

  const checks = [
    { id: "platform", label: "Platform", status: "ok" as const, detail: `${currentPlatform(os)} ${hardware.arch}` },
    { id: "hardware", label: "Hardware", status: "ok" as const, detail: `${hardware.accelerator}, ${hardware.totalRamGb}GB RAM, ${hardware.recommendedPreset} mode` },
    bun,
    git,
    checkWritableDir(NIPUX_HOME),
    checkWritableDir(DATA_DIR),
    checkWritableDir(MODEL_DIR),
    checkWritableDir(RUNTIME_DIR),
    llamaCommand,
    playwright,
    searxng,
  ];

  const nextSteps = [
    "Run bun run dev for the fake local backend.",
    `For live inference, run: ${llamaServeCommand(hardware.recommendedPreset)}`,
    `Open http://127.0.0.1:${process.env.NIPUX_PORT ?? 3434}`,
  ];

  return {
    ready: checks.every((check) => check.status !== "error"),
    checks,
    nextSteps,
  };
}

export function formatSetupCheck(check: SetupCheck) {
  const prefix = check.status === "ok" ? "[ok]" : check.status === "warning" ? "[warn]" : "[error]";
  return `${prefix} ${check.label}: ${check.detail}${check.fix ? `\n       Fix: ${check.fix}` : ""}`;
}
