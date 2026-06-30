import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, MODEL_DIR, NIPUX_HOME, PORT, RUNTIME_DIR } from "./config.ts";
import { detectHardware } from "./services/hardware.ts";
import {
  downloadHuggingFaceFile,
  formatModelInstallPlan,
  getModelInstallPlan,
  installModelPreset,
  listHuggingFaceFiles,
  listModels,
  llamaServeCommand,
} from "./services/modelRegistry.ts";
import { testLlamaBackend } from "./providers/llamaCpp.ts";
import { getUsageSummary } from "./services/usage.ts";
import { formatSetupCheck, getSetupPreflight } from "./services/setupChecks.ts";
import { applyRecommendedMediaRuntimeDefaults, formatMediaRuntimePlan, getMediaRuntimePlan } from "./services/mediaRuntimes.ts";
import { formatReadinessReport, getReadinessReport } from "./services/readiness.ts";
import { formatSetupActions, getSetupActions } from "./services/setupActions.ts";
import { prepareFirstRunSetup } from "./services/setupPrepare.ts";
import { formatLaunchProfile, getLaunchProfile, writeLaunchProfileFiles } from "./services/launchProfile.ts";
import {
  clearImageBackendPreset,
  formatImageBackendPlan,
  getImageBackendPlan,
  imageStartCommand,
  installImageBackendPreset,
  prepareImageBackendPreset,
  selectImageBackendPreset,
} from "./services/imageSetup.ts";
import { formatLocalSupervisorPlan, getLocalSupervisorPlan, runLocalSupervisor } from "./services/localSupervisor.ts";
import {
  formatTranscriptionSetupPlan,
  getTranscriptionSetupPlan,
  installWhisperModel,
  prepareTranscriptionSetup,
  WHISPER_MODEL_PRESETS,
  whisperInstallCommand,
  whisperStartCommand,
} from "./services/transcriptionSetup.ts";
import { videoStartCommand } from "./services/videoSetup.ts";
import { formatCapabilityProfile, getCapabilityProfile } from "./services/capabilityProfile.ts";

const command = process.argv[2] ?? "help";

const BROWSERS_DIR = join(NIPUX_HOME, "browsers");

function printHelp() {
  console.log(`Nipux Local AI

Commands:
  bun run setup                   One-command setup: creates dirs, detects hardware, checks backends
  bun run src/cli.ts install      Prepare local folders and print runtime setup
  bun run local                   Start the app plus configured bundled local workers
  bun run local --open            Start the app and open the local UI in the browser
  bun run src/cli.ts local --dry-run
  bun run src/cli.ts preflight    Check install/runtime readiness with repair hints
  bun run ready                   Show everyday readiness summary
  bun run setup:actions           Show copyable setup actions
  bun run setup:prepare           Prepare safe first-run defaults and launcher files
  bun run media:runtimes          Show local media runtime setup plan
  bun run capabilities            Show this machine's consumer capability profile
  bun run image:backends          Show local image backend setup presets
  bun run image:prepare [preset]  Select local image backend and optionally install it
  bun run image:install <preset>  Install local image backend dependencies
  bun run image:select <preset>   Select a local image backend for bun run local
  bun run media:defaults          Persist recommended local media worker URLs
  bun run worker:image            Start bundled local image command worker
  bun run transcription:install   Download the default local Whisper transcription model
  bun run transcription:prepare   Save local transcription worker setup, optionally install model
  bun run transcription:setup     Show local transcription setup status
  bun run src/cli.ts transcription-presets
  bun run worker:transcription    Start bundled whisper.cpp-compatible transcription worker
  bun run worker:video            Start bundled local video command worker
  bun run launch:profile          Show this machine's launch profile
  bun run launch:write            Write launch profile, env, and launcher scripts
  bun run src/cli.ts doctor       Detect hardware and backend health
  bun run src/cli.ts models       List built-in model presets
  bun run model:plan [preset]     Preview the selected model download and start command
  bun run model:install [preset]  Download the GGUF file for a built-in preset
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
      "NIPUX_LLAMA_COMMAND=",
      "NIPUX_LLAMA_MODEL_PATH=",
      "NIPUX_SEARXNG_URL=",
      "NIPUX_IMAGE_WORKER_URL=",
      "NIPUX_IMAGE_COMMAND=",
      "NIPUX_IMAGE_ARGS=",
      "NIPUX_IMAGE_MODEL=",
      "NIPUX_SPEECH_WORKER_URL=",
      "NIPUX_TRANSCRIPTION_WORKER_URL=",
      "NIPUX_VIDEO_WORKER_URL=",
      "NIPUX_VIDEO_COMMAND=",
      "NIPUX_VIDEO_ARGS=",
      "NIPUX_VIDEO_MODEL=",
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

  step(8, "Preparing first-run defaults and launchers");
  const prepared = await prepareFirstRunSetup();
  for (const item of prepared.applied) console.log(`  ✓ ${item.label}: ${item.detail}`);
  for (const item of prepared.skipped) console.log(`  - ${item.label}: ${item.detail}`);
  console.log(`  Profile: ${prepared.launch.profile.files.profileJson}`);
  console.log(`  Env:     ${prepared.launch.profile.files.envFile}`);
  console.log(`  Dev:     ${prepared.launch.profile.files.startDevSh}`);
  console.log(`  Local:   ${prepared.launch.profile.files.startLocalSh}`);
  console.log(`  macOS:   ${prepared.launch.profile.files.startLocalCommand}`);
  console.log(`  Windows: ${prepared.launch.profile.files.startLocalCmd}`);
  console.log(`  Linux:   ${prepared.launch.profile.files.desktopFile}`);

  console.log(`\n✓ Setup complete.`);
  if (!preflight.ready) {
    console.log(`Some required checks still need attention. Run "bun run preflight" after fixing them.`);
  }
  console.log(`\nNext steps:`);
  console.log(`  Dev (no model):  bun run dev`);
  console.log(`  Production:      ${llamaServeCommand(hardware.recommendedPreset)}`);
  console.log(`                   bun run start`);
  console.log(`  Setup actions:   bun run setup:actions`);
  console.log(`  Image worker:    ${imageStartCommand()}`);
  console.log(`  Voice model:     ${whisperInstallCommand()}`);
  console.log(`  Voice input:     ${whisperStartCommand()}`);
  console.log(`  Video worker:    ${videoStartCommand()}`);
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
    console.log("  bun run setup:actions");
    return;
  }

  if (command === "local" || command === "run-local" || command === "run:local") {
    if (process.argv.includes("--open")) process.env.NIPUX_OPEN_BROWSER = "1";
    const dryRun = process.argv.includes("--dry-run") || process.argv.includes("--json");
    const plan = dryRun ? getLocalSupervisorPlan() : await runLocalSupervisor();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    if (dryRun) console.log(formatLocalSupervisorPlan(plan));
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

  if (command === "readiness" || command === "ready") {
    const report = await getReadinessReport();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    console.log(`\nNipux Local AI readiness`);
    console.log(formatReadinessReport(report));
    if (!report.usable) process.exitCode = 1;
    return;
  }

  if (command === "setup-actions" || command === "setup:actions") {
    const actions = await getSetupActions();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(actions, null, 2));
      return;
    }
    console.log(`\nNipux Local AI setup actions`);
    console.log(formatSetupActions(actions));
    return;
  }

  if (command === "setup-prepare" || command === "setup:prepare") {
    const result = await prepareFirstRunSetup({
      overwrite: process.argv.includes("--overwrite"),
      alignModel: !process.argv.includes("--no-model"),
      prepareImage: !process.argv.includes("--no-image"),
      installImage: process.argv.includes("--install-image"),
      writeLaunchers: !process.argv.includes("--no-launchers"),
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`\nNipux Local AI first-run preparation`);
    for (const item of result.applied) console.log(`  [set] ${item.label}: ${item.detail}`);
    for (const item of result.skipped) console.log(`  [skip] ${item.label}: ${item.detail}`);
    console.log(`\nCommands:`);
    console.log(`  Start: ${result.commands.startLocal}`);
    console.log(`  Model: ${result.commands.installModel}`);
    console.log(`  Ready: ${result.commands.readiness}`);
    console.log(`\nNext steps:`);
    for (const step of result.nextSteps) console.log(`  - ${step}`);
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

  if (command === "capabilities" || command === "capability-profile") {
    const profile = await getCapabilityProfile();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(profile, null, 2));
      return;
    }
    console.log(`\nNipux Local AI capability profile`);
    console.log(formatCapabilityProfile(profile));
    return;
  }

  if (command === "image-backends" || command === "image:backends") {
    const plan = await getImageBackendPlan();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`\nNipux Local AI image backend setup`);
    console.log(formatImageBackendPlan(plan));
    return;
  }

  if (command === "image-select" || command === "image:select") {
    const preset = process.argv[3];
    if (!preset) throw new Error("preset is required. Run bun run image:backends to list presets.");
    const result = await selectImageBackendPreset(preset);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Selected image backend: ${result.selectedPresetId}`);
    console.log(`Worker URL: ${result.settings.imageWorkerUrl}`);
    const selectedPreset = result.plan.presets.find((item) => item.id === result.selectedPresetId);
    console.log(
      selectedPreset?.install.command.includes("image:install")
        ? `Next: ${selectedPreset.install.command}`
        : "Next: set NIPUX_IMAGE_COMMAND to your local image backend command",
    );
    console.log("Then: bun run local");
    return;
  }

  if (command === "image-prepare" || command === "image:prepare") {
    const requestedPreset = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
    const result = await prepareImageBackendPreset({
      presetId: requestedPreset,
      install: process.argv.includes("--install"),
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(`\nNipux Local AI image backend prepared`);
    console.log(`  Preset:    ${result.selectedPresetId}`);
    console.log(`  Installed: ${result.installed ? "yes" : "no"}`);
    console.log(`  Worker:    ${result.settings.imageWorkerUrl}`);
    if (result.commands.install && !result.installed) console.log(`  Install:   ${result.commands.install}`);
    if (result.commands.start) console.log(`  Start:     ${result.commands.start}`);
    console.log("\nNext steps:");
    for (const step of result.nextSteps) console.log(`  ${step}`);
    return;
  }

  if (command === "image-install" || command === "image:install") {
    const plan = await getImageBackendPlan();
    const requestedPreset = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "";
    const installableRecommended = plan.presets.find((preset) => preset.id === plan.recommendedPresetId && preset.install.command.includes("image:install"));
    const installableFallback = plan.presets.find((preset) => preset.install.command.includes("image:install"));
    const preset = requestedPreset || installableRecommended?.id || installableFallback?.id;
    if (!preset) throw new Error("No automated local image backend installer is available.");

    const result = await installImageBackendPreset(preset, { dryRun: process.argv.includes("--dry-run") });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    console.log(result.dryRun ? "\nNipux Local AI image backend install plan" : "\nNipux Local AI image backend installed");
    console.log(`  Preset:  ${result.presetId}`);
    console.log(`  Runtime: ${result.runtimeDir}`);
    console.log(`  Python:  ${result.pythonPath}`);
    console.log(`  Status:  ${result.installed ? "installed" : result.dryRun ? "not installed yet" : "install command finished, runtime still missing"}`);
    console.log("\nCommands:");
    for (const item of result.commands) console.log(`  ${item}`);
    if (!result.dryRun) {
      console.log("\nNext steps:");
      console.log(`  bun run image:select ${result.presetId}`);
      console.log("  bun run local");
    }
    return;
  }

  if (command === "image-clear" || command === "image:clear") {
    const result = await clearImageBackendPreset();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log("Cleared selected image backend.");
    return;
  }

  if (command === "media-defaults") {
    const result = await applyRecommendedMediaRuntimeDefaults({
      includeOptional: process.argv.includes("--include-optional"),
      overwrite: process.argv.includes("--overwrite"),
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`\nNipux Local AI media defaults`);
    for (const item of result.applied) {
      console.log(`  [set] ${item.label}: ${item.settingKey}=${item.workerUrl}`);
    }
    for (const item of result.skipped) {
      console.log(`  [skip] ${item.label}: ${item.reason}`);
    }
    console.log("\nWorker readiness:");
    for (const runtime of result.plan.runtimes) {
      console.log(`  [${runtime.status}] ${runtime.label}: ${runtime.health.detail}`);
    }
    return;
  }

  if (command === "transcription-install" || command === "transcription:install") {
    const presetId = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
    const result = await installWhisperModel(presetId);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`\nNipux Local AI transcription model`);
    console.log(`  Model:      ${result.preset.label} (${result.preset.filename})`);
    console.log(`  Path:       ${result.targetPath}`);
    console.log(`  Size:       ${(result.sizeBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Status:     ${result.downloaded ? "downloaded" : "already installed"}`);
    console.log(`  Saved:      ${result.configured ? "yes" : "no"}`);
    console.log(`\nNext steps:`);
    console.log(`  Launch:     ${result.localCommand}`);
    console.log(`  Standalone: ${result.startCommand}`);
    console.log(`  Settings:   ${result.defaultsCommand}`);
    return;
  }

  if (command === "transcription-setup" || command === "transcription:setup") {
    const plan = getTranscriptionSetupPlan();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(formatTranscriptionSetupPlan(plan));
    return;
  }

  if (command === "transcription-prepare" || command === "transcription:prepare") {
    const presetId = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
    const result = await prepareTranscriptionSetup({
      presetId,
      install: process.argv.includes("--install"),
    });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`\nNipux Local AI transcription prepared`);
    console.log(`  Model:     ${result.installed ? "installed" : "not installed"}`);
    console.log(`  Worker:    ${result.settings.transcriptionWorkerUrl}`);
    console.log(`  Command:   ${result.plan.command.command} (${result.plan.command.installed ? "available" : "missing"})`);
    console.log("\nNext steps:");
    for (const step of result.nextSteps) console.log(`  ${step}`);
    return;
  }

  if (command === "transcription-presets") {
    console.log(JSON.stringify({ presets: WHISPER_MODEL_PRESETS }, null, 2));
    return;
  }

  if (command === "launch-profile") {
    const profile = await getLaunchProfile();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(profile, null, 2));
      return;
    }
    console.log(formatLaunchProfile(profile));
    return;
  }

  if (command === "launch-write") {
    const result = await writeLaunchProfileFiles();
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(formatLaunchProfile(result.profile));
    console.log("");
    console.log("Written:");
    for (const file of result.written) console.log(`  - ${file}`);
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

  if (command === "model-plan" || command === "model:plan") {
    const args = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
    const modelPreset = args[0] ?? (await detectHardware()).recommendedPreset;
    const filename = args[1];
    const plan = await getModelInstallPlan(modelPreset, { filename });
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(plan, null, 2));
      return;
    }
    console.log(`\nNipux Local AI model install plan`);
    console.log(formatModelInstallPlan(plan));
    return;
  }

  if (command === "model-install" || command === "model:install") {
    const args = process.argv.slice(3).filter((arg) => !arg.startsWith("--"));
    const modelPreset = args[0] ?? (await detectHardware()).recommendedPreset;
    const filename = args[1];
    if (process.argv.includes("--dry-run")) {
      const plan = await getModelInstallPlan(modelPreset, { filename });
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(plan, null, 2));
        return;
      }
      console.log(`\nNipux Local AI model install dry run`);
      console.log(formatModelInstallPlan(plan));
      return;
    }
    const result = await installModelPreset(modelPreset, filename);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`Installed ${result.model.label}`);
    console.log(`  Repo: ${result.repo}`);
    console.log(`  File: ${result.filename}`);
    console.log(`  Path: ${result.targetPath}`);
    console.log(`  Start: ${llamaServeCommand(result.modelPreset)}`);
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
