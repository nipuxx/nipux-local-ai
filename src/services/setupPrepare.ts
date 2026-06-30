import { existsSync, mkdirSync } from "node:fs";
import { DATA_DIR, MODEL_DIR, NIPUX_HOME, RUNTIME_DIR } from "../config.ts";
import { detectHardware } from "./hardware.ts";
import { getImageBackendPlan, prepareImageBackendPreset, type ImageBackendPrepareResult } from "./imageSetup.ts";
import { getLaunchProfile, writeLaunchProfileFiles, type LaunchProfileWriteResult } from "./launchProfile.ts";
import { getLocalSupervisorPlan, type LocalSupervisorPlan } from "./localSupervisor.ts";
import { getReadinessReport, type ReadinessReport } from "./readiness.ts";
import { getSetupActions, type SetupActionsResult } from "./setupActions.ts";
import { getAppSettings, getRawSetting, updateAppSettings, type AppSettings } from "./settings.ts";

export interface SetupPrepareInput {
  overwrite?: boolean;
  alignModel?: boolean;
  prepareImage?: boolean;
  installImage?: boolean;
  writeLaunchers?: boolean;
}

export interface SetupPrepareStep {
  id: string;
  label: string;
  detail: string;
}

export interface SetupPrepareResult {
  generatedAt: string;
  applied: SetupPrepareStep[];
  skipped: SetupPrepareStep[];
  settings: AppSettings;
  image?: ImageBackendPrepareResult;
  launch: LaunchProfileWriteResult;
  readiness: ReadinessReport;
  setupActions: SetupActionsResult;
  supervisor: LocalSupervisorPlan;
  commands: {
    prepare: string;
    startLocal: string;
    installModel: string;
    readiness: string;
  };
  nextSteps: string[];
}

function step(id: string, label: string, detail: string): SetupPrepareStep {
  return { id, label, detail };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function ensureDirectories(applied: SetupPrepareStep[], skipped: SetupPrepareStep[]) {
  for (const dir of [NIPUX_HOME, DATA_DIR, MODEL_DIR, RUNTIME_DIR]) {
    const existed = existsSync(dir);
    mkdirSync(dir, { recursive: true });
    (existed ? skipped : applied).push(step(`dir:${dir}`, "Local folder", existed ? `${dir} already exists.` : `Created ${dir}.`));
  }
}

async function alignDefaultModel(input: SetupPrepareInput, applied: SetupPrepareStep[], skipped: SetupPrepareStep[]) {
  if (input.alignModel === false) {
    skipped.push(step("default-model", "Default model", "Model alignment was not requested."));
    return;
  }
  const hardware = await detectHardware();
  const storedDefault = getRawSetting("default_model_preset", "");
  const settings = getAppSettings();
  if (!input.overwrite && storedDefault) {
    skipped.push(step("default-model", "Default model", `Keeping existing default mode ${settings.defaultModelPreset}.`));
    return;
  }
  if (settings.defaultModelPreset === hardware.recommendedPreset) {
    skipped.push(step("default-model", "Default model", `Default mode is already ${settings.defaultModelPreset}.`));
    return;
  }
  updateAppSettings({ defaultModelPreset: hardware.recommendedPreset });
  applied.push(step("default-model", "Default model", `Set default mode to ${hardware.recommendedPreset} for this machine.`));
}

async function prepareImage(input: SetupPrepareInput, applied: SetupPrepareStep[], skipped: SetupPrepareStep[]) {
  if (input.prepareImage === false) {
    skipped.push(step("image-backend", "Image backend", "Image backend preparation was not requested."));
    return undefined;
  }
  const plan = await getImageBackendPlan();
  if (plan.selectedPresetId && !input.overwrite) {
    skipped.push(step("image-backend", "Image backend", `Keeping selected image backend ${plan.selectedPresetId}.`));
    return undefined;
  }
  if (plan.recommendedPresetId === "custom-command") {
    skipped.push(step("image-backend", "Image backend", "No managed image backend is recommended for this hardware; custom local commands remain available."));
    return undefined;
  }
  const result = await prepareImageBackendPreset({ presetId: plan.recommendedPresetId, install: input.installImage });
  applied.push(step("image-backend", "Image backend", `Prepared ${result.selectedPresetId} at ${result.settings.imageWorkerUrl}.`));
  return result;
}

export async function prepareFirstRunSetup(input: SetupPrepareInput = {}): Promise<SetupPrepareResult> {
  const applied: SetupPrepareStep[] = [];
  const skipped: SetupPrepareStep[] = [];

  ensureDirectories(applied, skipped);
  await alignDefaultModel(input, applied, skipped);
  const image = await prepareImage(input, applied, skipped);

  const launch = input.writeLaunchers === false
    ? { profile: await getLaunchProfile(), written: [] }
    : await writeLaunchProfileFiles();
  (launch.written.length ? applied : skipped).push(
    step(
      "launch-profile",
      "Launch profile",
      launch.written.length ? `Wrote ${launch.written.length} local launcher/profile files.` : "Launch file writing was not requested.",
    ),
  );

  const [readiness, setupActions] = await Promise.all([getReadinessReport(), getSetupActions()]);
  const settings = getAppSettings();
  const supervisor = getLocalSupervisorPlan();
  const nextSteps = unique([
    ...(image?.nextSteps ?? []),
    ...readiness.nextSteps.slice(0, 5),
    "Run bun run local --open.",
  ]);

  return {
    generatedAt: new Date().toISOString(),
    applied,
    skipped,
    settings,
    image,
    launch,
    readiness,
    setupActions,
    supervisor,
    commands: {
      prepare: "bun run setup:prepare",
      startLocal: "bun run local --open",
      installModel: `bun run model:install ${settings.defaultModelPreset}`,
      readiness: "bun run ready",
    },
    nextSteps,
  };
}
