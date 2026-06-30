import { platform } from "node:os";
import { PORT } from "../config.ts";
import { getImageBackendPlan } from "./imageSetup.ts";
import { getModel, llamaServeCommand } from "./modelRegistry.ts";
import { getMediaRuntimePlan, type MediaRuntimeCommand, type MediaRuntimePlan } from "./mediaRuntimes.ts";
import { getSetupPreflight, installGuidanceFor, type SetupCheck } from "./setupChecks.ts";

export type SetupActionStatus = "ready" | "recommended" | "optional" | "blocked";
export type SetupActionKind = "install" | "start" | "configure" | "open" | "verify";

export interface SetupActionCommand extends MediaRuntimeCommand {
  copyable: boolean;
}

export interface SetupAction {
  id: string;
  label: string;
  kind: SetupActionKind;
  status: SetupActionStatus;
  description: string;
  commands: SetupActionCommand[];
  related: string[];
  reason?: string;
}

export interface SetupActionsResult {
  platform: NodeJS.Platform;
  actions: SetupAction[];
  nextActions: SetupAction[];
  summary: Record<SetupActionStatus, number>;
}

function command(label: string, value: string, copyable = true): SetupActionCommand {
  return { label, command: value, copyable };
}

function action(input: Omit<SetupAction, "commands"> & { commands?: SetupActionCommand[] }): SetupAction {
  return { ...input, commands: input.commands ?? [] };
}

function countActions(actions: SetupAction[]) {
  return actions.reduce<Record<SetupActionStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { ready: 0, recommended: 0, optional: 0, blocked: 0 },
  );
}

const ACTION_PRIORITY = [
  "install-bun",
  "install-git",
  "install-llama",
  "install-chat-model",
  "start-local-supervisor",
  "open-local-app",
  "install-playwright",
  "start-llama",
  "verify-readiness",
  "configure-web-search",
  "media-transcription",
  "media-speech",
  "media-image",
  "choose-image-backend",
  "media-video",
  "run-dev",
  "review-capabilities",
];

function actionPriority(id: string) {
  const index = ACTION_PRIORITY.indexOf(id);
  return index === -1 ? ACTION_PRIORITY.length : index;
}

function statusPriority(status: SetupActionStatus) {
  if (status === "recommended") return 0;
  if (status === "blocked") return 1;
  if (status === "optional") return 2;
  return 3;
}

function selectNextActions(actions: SetupAction[], limit = 3) {
  return [...actions]
    .filter((item) => item.status !== "ready" && item.commands.some((itemCommand) => itemCommand.copyable))
    .sort((left, right) => statusPriority(left.status) - statusPriority(right.status) || actionPriority(left.id) - actionPriority(right.id) || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function byId(checks: SetupCheck[]) {
  return Object.fromEntries(checks.map((check) => [check.id, check])) as Record<string, SetupCheck | undefined>;
}

function statusForRuntime(runtime: MediaRuntimePlan): SetupActionStatus {
  if (runtime.status === "ready") return "ready";
  if (runtime.status === "invalid" || runtime.status === "offline") return "recommended";
  return runtime.recommended ? "recommended" : "optional";
}

function mediaAction(runtime: MediaRuntimePlan): SetupAction {
  const status = statusForRuntime(runtime);
  const installCommand = runtime.commands.find((item) => item.label.toLowerCase().includes("install"))?.command;
  const startCommand = runtime.commands.find((item) => item.label.toLowerCase().includes("start"))?.command;
  const commands =
    status === "ready"
      ? []
      : [
          ...(installCommand ? [command("Install model", installCommand)] : []),
          command("Persist default URL", runtime.recommended ? "bun run media:defaults" : "bun run media:defaults --include-optional"),
          command(
            ["image", "transcription", "video"].includes(runtime.kind) ? "Start bundled worker" : "Environment",
            startCommand || runtime.commands[0]?.command || `${runtime.envVar}=${runtime.defaultUrl} bun run start`,
          ),
          command("Worker contract", `POST ${runtime.defaultUrl}${runtime.endpoint}`, false),
          command("Refresh planner", "bun run media:runtimes"),
        ];
  const description =
    status === "ready"
      ? `${runtime.workerLabel} is ready.`
      : `${runtime.setup} ${runtime.hardwareFit}`;
  return action({
    id: `media-${runtime.kind}`,
    label: runtime.label,
    kind: runtime.status === "unconfigured" ? "configure" : "start",
    status,
    description,
    commands,
    related: [runtime.kind, runtime.envVar],
    reason: runtime.recommended ? "Recommended for this machine." : "Optional for this hardware profile.",
  });
}

export async function getSetupActions(): Promise<SetupActionsResult> {
  const [preflight, media, imageBackends] = await Promise.all([getSetupPreflight(), getMediaRuntimePlan(), getImageBackendPlan()]);
  const checks = byId(preflight.checks);
  const os = platform();
  const actions: SetupAction[] = [];

  for (const tool of [
    { id: "bun", label: "Install Bun", command: installGuidanceFor("bun", os) },
    { id: "git", label: "Install Git", command: installGuidanceFor("git", os) },
    { id: "playwright", label: "Install browser runtime", command: installGuidanceFor("playwright", os) },
  ]) {
    const check = checks[tool.id];
    actions.push(
      action({
        id: `install-${tool.id}`,
        label: tool.label,
        kind: "install",
        status: check?.status === "ok" ? "ready" : "recommended",
        description: check?.status === "ok" ? check.detail : check?.detail ?? `${tool.label} is needed for the local app.`,
        commands: check?.status === "ok" ? [] : [command("Command", tool.command)],
        related: [tool.id],
      }),
    );
  }

  const llama = checks.llama;
  const llamaMissing = llama?.detail.toLowerCase().includes("not installed");
  const recommendedModel = getModel(media.hardware.recommendedPreset);
  actions.push(
    action({
      id: "review-capabilities",
      label: "Review machine capability",
      kind: "verify",
      status: "ready",
      description: `This machine is classified for ${media.hardware.recommendedPreset} mode on ${media.hardware.accelerator}.`,
      commands: [command("Command", "bun run capabilities")],
      related: ["hardware", "capabilities", media.hardware.recommendedPreset],
      reason: "Use this before enabling heavier image or video workers.",
    }),
  );

  if (llamaMissing) {
    actions.push(
      action({
        id: "install-llama",
        label: "Install llama.cpp",
        kind: "install",
        status: "recommended",
        description: llama?.detail ?? "Install llama.cpp before live local chat is available.",
        commands: [command("Command", installGuidanceFor("llama", os))],
        related: ["chat", "llama.cpp"],
      }),
    );
  }

  actions.push(
    action({
      id: "install-chat-model",
      label: `Install ${recommendedModel.label} chat model`,
      kind: "install",
      status: recommendedModel.state === "available" ? "ready" : "recommended",
      description:
        recommendedModel.state === "available"
          ? `Local GGUF is installed at ${recommendedModel.localPath}.`
          : `Download the recommended ${recommendedModel.family} ${recommendedModel.quant} GGUF for this machine.`,
      commands:
        recommendedModel.state === "available"
          ? []
          : [
              command("Review download", `bun run model:plan ${recommendedModel.id}`),
              command("Install model", `bun run model:install ${recommendedModel.id}`),
            ],
      related: ["chat", "model", recommendedModel.id],
      reason: `${recommendedModel.estimatedRamGb}GB estimated RAM; this machine is in ${media.hardware.recommendedPreset} mode.`,
    }),
  );

  actions.push(
    action({
      id: "start-llama",
      label: "Start local chat backend",
      kind: "start",
      status: llama?.status === "ok" ? "ready" : llamaMissing ? "blocked" : "recommended",
      description:
        llama?.status === "ok"
          ? llama.detail
          : llamaMissing
            ? "Install llama.cpp first, then start the recommended local model server."
            : "Start the recommended local model server for live chat.",
      commands: [command("Command", llamaServeCommand(media.hardware.recommendedPreset))],
      related: ["chat", "llama.cpp"],
      reason: llamaMissing ? "Blocked until llama.cpp is installed." : undefined,
    }),
  );

  actions.push(
    action({
      id: "start-local-supervisor",
      label: "Start app and local backends",
      kind: "start",
      status: "recommended",
      description: "Starts the local UI, managed llama.cpp backend when a local GGUF model is available, and configured bundled media workers.",
      commands: [
        command("Command", "bun run local"),
        command("Dry run", "bun run src/cli.ts local --dry-run"),
      ],
      related: ["ui", "chat", "workers", "local"],
    }),
    action({
      id: "run-dev",
      label: "Try the app without a model",
      kind: "start",
      status: "optional",
      description: "Starts the local UI with the fake LLM backend so the product can be tested before models are installed.",
      commands: [command("Command", "bun run dev")],
      related: ["chat", "dev"],
    }),
    action({
      id: "open-local-app",
      label: "Open local app",
      kind: "open",
      status: "recommended",
      description: "Open the private local UI after the server is running.",
      commands: [
        command(os === "win32" ? "Windows" : os === "darwin" ? "macOS" : "Linux", `${os === "win32" ? "start" : os === "darwin" ? "open" : "xdg-open"} http://127.0.0.1:${PORT}`),
      ],
      related: ["ui"],
    }),
  );

  const searxng = checks.searxng;
  actions.push(
    action({
      id: "configure-web-search",
      label: "Configure local web search",
      kind: "configure",
      status: searxng?.status === "ok" ? "ready" : "optional",
      description: searxng?.status === "ok" ? searxng.detail : "Optional: point Settings at a local SearXNG instance for web search.",
      commands: [command("Setting", "NIPUX_SEARXNG_URL=http://127.0.0.1:8888")],
      related: ["search", "searxng"],
    }),
  );

  for (const runtime of media.runtimes) actions.push(mediaAction(runtime));

  const recommendedImageBackend = imageBackends.presets.find((preset) => preset.id === imageBackends.recommendedPresetId) ?? imageBackends.presets[0];
  actions.push(
    action({
      id: "choose-image-backend",
      label: "Choose local image backend",
      kind: "configure",
      status: recommendedImageBackend?.recommended ? "recommended" : "optional",
      description: recommendedImageBackend
        ? `${recommendedImageBackend.label}: ${recommendedImageBackend.description}`
        : "Review local image backend setup presets.",
      commands: [
        command("Review presets", "bun run image:backends"),
        ...(recommendedImageBackend ? [command("Select backend", `bun run image:select ${recommendedImageBackend.id}`)] : []),
        ...(recommendedImageBackend?.commands.filter((item) => item.copyable).slice(0, 2).map((item) => command(item.label, item.command)) ?? []),
      ],
      related: ["image", "backend", "local-only"],
      reason: "Image generation stays local-only and requires a loopback worker before it is ready.",
    }),
  );

  actions.push(
    action({
      id: "verify-readiness",
      label: "Verify setup",
      kind: "verify",
      status: "recommended",
      description: "Run the everyday readiness check after changing local runtimes or settings.",
      commands: [command("Command", "bun run ready")],
      related: ["readiness"],
    }),
  );

  return { platform: os, actions, nextActions: selectNextActions(actions), summary: countActions(actions) };
}

export function formatSetupActions(result: SetupActionsResult) {
  const lines = [`Platform: ${result.platform}`, ""];
  if (result.nextActions.length) {
    lines.push("Next setup actions:");
    for (const item of result.nextActions) {
      lines.push(`  [${item.status}] ${item.label}`);
      if (item.commands[0]) lines.push(`    ${item.commands[0].label}: ${item.commands[0].command}`);
    }
    lines.push("");
  }
  for (const item of result.actions) {
    lines.push(`[${item.status}] ${item.label}`);
    lines.push(`  ${item.description}`);
    if (item.reason) lines.push(`  ${item.reason}`);
    for (const itemCommand of item.commands) lines.push(`  ${itemCommand.label}: ${itemCommand.command}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
