import { API_KEYS, BIND_HOST, IS_FAKE_LLM, PORT, PUBLIC_API } from "../config.ts";
import { getMediaRuntimePlan } from "./mediaRuntimes.ts";
import { getSetupPreflight, type SetupCheck } from "./setupChecks.ts";

export type ReadinessStatus = "ready" | "needs_setup" | "optional" | "blocked";

export interface ReadinessItem {
  id: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
  fix?: string;
}

export interface ReadinessReport {
  usable: boolean;
  headline: string;
  localUrl: string;
  publicApi: boolean;
  bindHost: string;
  counts: Record<ReadinessStatus, number>;
  items: ReadinessItem[];
  nextSteps: string[];
}

function checkById(checks: SetupCheck[], id: string) {
  return checks.find((check) => check.id === id);
}

function itemFromCheck(id: string, label: string, check: SetupCheck | undefined, optional = false): ReadinessItem {
  if (!check) {
    return { id, label, status: optional ? "optional" : "needs_setup", detail: "Status was not reported." };
  }
  if (check.status === "ok") return { id, label, status: "ready", detail: check.detail };
  return {
    id,
    label,
    status: optional ? "optional" : "needs_setup",
    detail: check.detail,
    fix: check.fix,
  };
}

function countItems(items: ReadinessItem[]) {
  return items.reduce<Record<ReadinessStatus, number>>(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { ready: 0, needs_setup: 0, optional: 0, blocked: 0 },
  );
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function mediaDetail(runtime: { status: string; workerLabel: string; workerUrl: string; health?: { detail: string } } | undefined, ready: string, missing: string) {
  if (!runtime) return missing;
  if (runtime.status === "ready") return ready;
  if (runtime.status === "offline") {
    const health = runtime.health?.detail ? ` ${runtime.health.detail}` : "";
    return `${runtime.workerLabel} is configured at ${runtime.workerUrl}, but it is not ready.${health}`;
  }
  if (runtime.status === "invalid") return "Configured worker URL is not a local loopback URL.";
  return missing;
}

function mediaFix(runtime: { status: string; setup: string; commands?: Array<{ command: string }> } | undefined) {
  if (!runtime || runtime.status === "ready") return undefined;
  const startCommand = runtime.commands?.find((item) => item.command.includes("worker:transcription"))?.command;
  const installCommand = runtime.commands?.find((item) => item.command.includes("transcription:install"))?.command;
  if (startCommand?.includes("worker:transcription")) {
    return installCommand
      ? `Run ${installCommand}, then run ${startCommand}, then run bun run media:defaults.`
      : `Run ${startCommand}, then run bun run media:defaults.`;
  }
  return runtime.setup;
}

export async function getReadinessReport(): Promise<ReadinessReport> {
  const [preflight, media] = await Promise.all([getSetupPreflight(), getMediaRuntimePlan()]);
  const checks = preflight.checks;
  const llama = checkById(checks, "llama");
  const playwright = checkById(checks, "playwright");
  const searxng = checkById(checks, "searxng");
  const speech = media.runtimes.find((runtime) => runtime.kind === "speech");
  const transcription = media.runtimes.find((runtime) => runtime.kind === "transcription");
  const image = media.runtimes.find((runtime) => runtime.kind === "image");
  const video = media.runtimes.find((runtime) => runtime.kind === "video");

  const chatReady = IS_FAKE_LLM || llama?.status === "ok";
  const publicApiLocked = PUBLIC_API && API_KEYS.length === 0;
  const items: ReadinessItem[] = [
    {
      id: "chat",
      label: "Chat",
      status: chatReady ? "ready" : "needs_setup",
      detail: IS_FAKE_LLM
        ? "Dev local backend is enabled."
        : llama?.status === "ok"
          ? "Local llama.cpp backend is reachable."
          : "Install/start llama.cpp for live local inference.",
      fix: chatReady ? undefined : llama?.fix,
    },
    itemFromCheck("browser", "Browser Agents", playwright, false),
    {
      id: "voice-output",
      label: "Voice Output",
      status: speech?.status === "ready" ? "ready" : "needs_setup",
      detail: mediaDetail(speech, speech ? `${speech.workerLabel} is available.` : "Voice output is available.", "Configure a local speech worker or supported built-in speech engine."),
      fix: mediaFix(speech),
    },
    {
      id: "voice-input",
      label: "Voice Input",
      status: transcription?.status === "ready" ? "ready" : "needs_setup",
      detail: mediaDetail(transcription, "Local transcription worker is configured and reachable.", "Configure a local transcription worker for microphone input."),
      fix: mediaFix(transcription),
    },
    {
      id: "image",
      label: "Image Generation",
      status: image?.status === "ready" ? "ready" : "needs_setup",
      detail: mediaDetail(image, "Local image worker is configured and reachable.", "Configure a local OpenAI-compatible image worker."),
      fix: mediaFix(image),
    },
    {
      id: "video",
      label: "Video Generation",
      status: video?.status === "ready" ? "ready" : "optional",
      detail: mediaDetail(video, "Local video worker is configured and reachable.", "Video remains optional and hardware-sensitive."),
      fix: mediaFix(video),
    },
    itemFromCheck("web-search", "Web Search", searxng, true),
    {
      id: "local-search",
      label: "Local Search",
      status: "ready",
      detail: "SQLite local document index is available.",
    },
    {
      id: "api",
      label: "API",
      status: publicApiLocked ? "blocked" : "ready",
      detail: publicApiLocked
        ? "Public API mode is enabled without an API key."
        : API_KEYS.length > 0
          ? "Protected API key mode is enabled."
          : "Local private API mode is enabled.",
      fix: publicApiLocked ? "Set NIPUX_API_KEY or NIPUX_API_KEYS before using public mode." : undefined,
    },
  ];

  const counts = countItems(items);
  const usable = counts.blocked === 0 && items.find((item) => item.id === "chat")?.status === "ready";
  const headline = usable
    ? "Ready for local chat. Some optional capabilities may still need setup."
    : "Setup needs attention before the main local AI experience is ready.";
  const nextSteps = unique([
    ...items.filter((item) => item.status === "blocked" || item.status === "needs_setup").map((item) => item.fix || item.detail),
    ...preflight.nextSteps,
    ...media.nextSteps,
  ]);

  return {
    usable,
    headline,
    localUrl: `http://127.0.0.1:${PORT}`,
    publicApi: PUBLIC_API,
    bindHost: BIND_HOST,
    counts,
    items,
    nextSteps,
  };
}

export function formatReadinessReport(report: ReadinessReport) {
  const lines = [
    report.headline,
    `Local URL: ${report.localUrl}`,
    `Bind: ${report.bindHost}${report.publicApi ? " public-api" : ""}`,
    "",
    "Capabilities:",
  ];
  for (const item of report.items) {
    lines.push(`  [${item.status}] ${item.label}: ${item.detail}`);
    if (item.fix) lines.push(`    Fix: ${item.fix}`);
  }
  lines.push("", "Next steps:");
  for (const step of report.nextSteps) lines.push(`  - ${step}`);
  return lines.join("\n");
}
