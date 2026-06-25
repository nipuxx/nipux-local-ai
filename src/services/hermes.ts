import { LLAMA_BASE_URL } from "../config.ts";
import { getModel } from "./modelRegistry.ts";

async function run(command: string, args: string[], timeoutMs = 1600) {
  try {
    const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeoutMs);
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    clearTimeout(timer);
    return { ok: code === 0, stdout: stdout.trim(), stderr: stderr.trim(), code };
  } catch (error) {
    return { ok: false, stdout: "", stderr: error instanceof Error ? error.message : String(error), code: -1 };
  }
}

export async function getHermesStatus(modelPreset = "balanced") {
  const version = await run("hermes", ["--version"]);
  const model = getModel(modelPreset);
  return {
    installed: version.ok,
    version: version.stdout || version.stderr || null,
    engine: version.ok ? "hermes" : "internal-memory-agent",
    configCommands: [
      "hermes config set model.provider custom",
      `hermes config set model.base_url ${LLAMA_BASE_URL}`,
      `hermes config set model.default ${model.llamaRef}`,
    ],
    installCommands: {
      unix: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
      windows: "iex (irm https://hermes-agent.nousresearch.com/install.ps1)",
    },
  };
}
