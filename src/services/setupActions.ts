import { platform } from "node:os";
import { PORT } from "../config.ts";
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
            ["image", "transcription"].includes(runtime.kind) ? "Start bundled worker" : "Environment",
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
  const [preflight, media] = await Promise.all([getSetupPreflight(), getMediaRuntimePlan()]);
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
          : [command("Command", `bun run model:install ${recommendedModel.id}`)],
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

  return { platform: os, actions, summary: countActions(actions) };
}

export function formatSetupActions(result: SetupActionsResult) {
  const lines = [`Platform: ${result.platform}`, ""];
  for (const item of result.actions) {
    lines.push(`[${item.status}] ${item.label}`);
    lines.push(`  ${item.description}`);
    if (item.reason) lines.push(`  ${item.reason}`);
    for (const itemCommand of item.commands) lines.push(`  ${itemCommand.label}: ${itemCommand.command}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
