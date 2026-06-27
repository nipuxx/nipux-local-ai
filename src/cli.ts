import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, MODEL_DIR, NIPUX_HOME, PORT, RUNTIME_DIR } from "./config.ts";
import { detectHardware } from "./services/hardware.ts";
import { downloadHuggingFaceFile, listHuggingFaceFiles, listModels, llamaServeCommand } from "./services/modelRegistry.ts";
import { testLlamaBackend } from "./providers/llamaCpp.ts";
import { getUsageSummary } from "./services/usage.ts";
import { formatSetupCheck, getSetupPreflight } from "./services/setupChecks.ts";
import { formatMediaRuntimePlan, getMediaRuntimePlan } from "./services/mediaRuntimes.ts";

const command = process.argv[2] ?? "help";

const BROWSERS_DIR = join(NIPUX_HOME, "browsers");

function printHelp() {
  console.log(`Nipux Local AI

Commands:
  bun run setup                   One-command setup: creates dirs, detects hardware, checks backends
  bun run src/cli.ts install      Prepare local folders and print runtime setup
  bun run src/cli.ts preflight    Check install/runtime readiness with repair hints
  bun run media:runtimes          Show local media runtime setup plan
  bun run src/cli.ts doctor       Detect hardware and backend health
  bun run src/cli.ts models       List built-in model presets
  bun run src/cli.ts llama-command [id]   Print the llama.cpp serve command
  bun run src/cli.ts files <repo> List GGUF files from Hugging Face
  bun run src/cli.ts download <repo> <file>
`);
}

function step(n: number, label: string) {
  console.log(`\n[${n}] ${label}`);
}

async function setup() {
  console.log(`\nNipux Local AI — Setup`);
  console.log(`Home: ${NIPUX_HOME}`);

  step(1, "Creating directories");
  const dirs = [NIPUX_HOME, DATA_DIR, MODEL_DIR, RUNTIME_DIR, BROWSERS_DIR];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
    console.log(`  ✓ ${dir}`);
  }

  step(2, "Detecting hardware");
  const hardware = await detectHardware();
  console.log(`  OS:          ${hardware.os} (${hardware.arch})`);
  console.log(`  RAM:         ${hardware.totalRamGb} GB`);
  console.log(`  GPUs:        ${hardware.gpuVendors.join(", ") || "none detected"}`);
  console.log(`  Accelerator: ${hardware.accelerator}`);
  console.log(`  Recommended: ${hardware.recommendedPreset} mode`);
  for (const note of hardware.notes) console.log(`  ⚠ ${note}`);

  step(3, "Seeding model registry");
  const models = listModels();
  for (const model of models) {
    console.log(`  ${model.label}: ${model.llamaRef} ${model.state}`);
  }

  step(4, "Checking llama.cpp backend");
  const llama = await testLlamaBackend();
  if (llama.ok) {
    console.log(`  ✓ Backend available (${llama.mode})`);
  } else {
    console.log(`  ✗ Backend not reachable`);
    console.log(`  llama.cpp not running. Install and serve a model to use live inference:`);
    console.log(`    macOS/Linux: curl -LsSf https://llama.app/install.sh | sh`);
    console.log(`    Windows:     winget install llama.cpp`);
    console.log(`    Then:        ${llamaServeCommand(hardware.recommendedPreset)}`);
    console.log(`  Dev mode (no model needed): bun run dev`);
  }

  step(5, "Writing .env example");
  const envPath = join(NIPUX_HOME, ".env.example");
  writeFileSync(
    envPath,
    [
      "NIPUX_PORT=3434",
      "NIPUX_BIND_HOST=127.0.0.1",
      "NIPUX_PUBLIC_API=0",
      "NIPUX_API_KEY=",
      "NIPUX_API_KEYS=",
      `NIPUX_HOME=${NIPUX_HOME}`,
      "NIPUX_LLAMA_BASE_URL=http://127.0.0.1:8080/v1",
      "NIPUX_SEARXNG_URL=",
      "NIPUX_IMAGE_WORKER_URL=",
      "NIPUX_SPEECH_WORKER_URL=",
      "NIPUX_TRANSCRIPTION_WORKER_URL=",
      "NIPUX_VIDEO_WORKER_URL=",
      "NIPUX_FAKE_LLM=0",
      "NIPUX_BROWSER_HEADLESS=1",
      "HF_TOKEN=",
    ].join("\n") + "\n",
  );
  console.log(`  ✓ ${envPath}`);

  step(6, "Media runtime plan");
  const mediaPlan = await getMediaRuntimePlan();
  for (const runtime of mediaPlan.runtimes) {
    console.log(`  ${runtime.label}: ${runtime.status} (${runtime.hardwareFit})`);
  }
  console.log(`  Full plan: bun run media:runtimes`);

  step(7, "Install preflight");
  const preflight = await getSetupPreflight();
  for (const check of preflight.checks) console.log(`  ${formatSetupCheck(check).replaceAll("\n", "\n  ")}`);

  console.log(`\n✓ Setup complete.`);
  if (!preflight.ready) {
    console.log(`Some required checks still need attention. Run "bun run preflight" after fixing them.`);
  }
  console.log(`\nNext steps:`);
  console.log(`  Dev (no model):  bun run dev`);
  console.log(`  Production:      ${llamaServeCommand(hardware.recommendedPreset)}`);
  console.log(`                   bun run start`);
  console.log(`  Health check:    bun run doctor`);
  console.log(`  Open:            http://127.0.0.1:${PORT}`);
}

async function main() {
  if (command === "setup") {
    await setup();
    return;
  }

  if (command === "install") {
    mkdirSync(NIPUX_HOME, { recursive: true });
    mkdirSync(MODEL_DIR, { recursive: true });
    mkdirSync(RUNTIME_DIR, { recursive: true });
    console.log(`Prepared ${NIPUX_HOME}`);
    console.log("No Docker is required.");
    console.log("Recommended llama.cpp install:");
    console.log("  macOS/Linux: curl -LsSf https://llama.app/install.sh | sh");
    console.log("  Windows:     winget install llama.cpp");
    console.log(`Then start the default model server:\n  ${llamaServeCommand("balanced")}`);
    console.log("Run a readiness check:");
    console.log("  bun run preflight");
    return;
  }

  if (command === "preflight") {
    const preflight = await getSetupPreflight();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(preflight, null, 2));
      return;
    }
    console.log("\nNipux Local AI preflight");
    for (const check of preflight.checks) console.log(formatSetupCheck(check));
    console.log("\nNext steps:");
    for (const step of preflight.nextSteps) console.log(`  ${step}`);
    if (!preflight.ready) process.exitCode = 1;
    return;
  }

  if (command === "media-runtimes") {
    const plan = await getMediaRuntimePlan();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`\nNipux Local AI media runtime plan`);
    console.log(formatMediaRuntimePlan(plan));
    return;
  }

  if (command === "doctor") {
    const [hardware, llama, preflight, mediaRuntimes] = await Promise.all([
      detectHardware(),
      testLlamaBackend(),
      getSetupPreflight(),
      getMediaRuntimePlan(),
    ]);
    console.log(JSON.stringify({ home: NIPUX_HOME, port: PORT, hardware, llama, preflight, mediaRuntimes, usage: getUsageSummary() }, null, 2));
    return;
  }

  if (command === "models") {
    console.table(
      listModels().map((model) => ({
        id: model.id,
        repo: model.repo,
        quant: model.quant,
        ram: `${model.estimatedRamGb} GB`,
        state: model.state,
      })),
    );
    return;
  }

  if (command === "llama-command") {
    console.log(llamaServeCommand(process.argv[3] ?? "balanced"));
    return;
  }

  if (command === "files") {
    const repo = process.argv[3];
    if (!repo) throw new Error("repo is required");
    console.table(await listHuggingFaceFiles(repo));
    return;
  }

  if (command === "download") {
    const repo = process.argv[3];
    const file = process.argv[4];
    if (!repo || !file) throw new Error("repo and file are required");
    console.log(await downloadHuggingFaceFile(repo, file));
    return;
  }

  printHelp();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
