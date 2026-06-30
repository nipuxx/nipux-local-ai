import type { Agent, SearchResult } from "../types.ts";
import { type BrowserSessionRecord } from "./browserBroker.ts";
import { runBrowserSessionTools } from "./browserSessionTools.ts";
import { type MediaJob } from "./media.ts";
import { runMediaGenerationTools, type MediaGenerationToolName } from "./mediaGenerationTools.ts";
import { localSearch, webSearch } from "./search.ts";

export type AgentToolName =
  | "local_search"
  | "web_search"
  | "browser_session"
  | "browser_navigation"
  | MediaGenerationToolName;
export type AgentToolStatus = "ok" | "pending" | "error";

export interface AgentToolEvent {
  tool: AgentToolName;
  status: AgentToolStatus;
  summary: string;
  resultCount?: number;
  browserSessionId?: string;
  mediaJobId?: string;
  permissionRequestId?: string;
  url?: string;
  error?: string;
}

export interface AgentToolRun {
  localResults: SearchResult[];
  webResults: SearchResult[];
  browserSessions: BrowserSessionRecord[];
  mediaJobs: MediaJob[];
  events: AgentToolEvent[];
  contextBlock: string;
}

function shouldUseLocalSearch(input: string) {
  return /\b(search|find|lookup|look up|local|file|files|folder|folders|doc|docs|document|documents|note|notes|indexed|index|rag|cite|citation|reference|knowledge)\b/i.test(
    input,
  );
}

function shouldUseWebSearch(input: string) {
  return /\b(web|internet|online|latest|current|today|news|recent|search web|google|site:)\b/i.test(input);
}

function formatResults(title: string, results: SearchResult[]) {
  if (!results.length) return `${title}: none`;
  return `${title}:\n${results
    .map((result, index) => {
      const locator = result.url ? ` (${result.url})` : result.path ? ` (${result.path})` : "";
      return `${index + 1}. ${result.title}${locator}\n${result.snippet}`;
    })
    .join("\n")}`;
}

function formatBrowserSessions(sessions: BrowserSessionRecord[]) {
  if (!sessions.length) return "Browser sessions: none requested";
  return `Browser sessions:\n${sessions
    .map((session, index) => `${index + 1}. ${session.label} (${session.id})\nstatus=${session.status} url=${session.url ?? "about:blank"}`)
    .join("\n")}`;
}

function formatMediaJobs(jobs: MediaJob[]) {
  if (!jobs.length) return "Media jobs: none requested";
  return `Media jobs:\n${jobs
    .map((job, index) => `${index + 1}. ${job.kind} (${job.id})\nstatus=${job.status}${job.error ? ` error=${job.error}` : ""}`)
    .join("\n")}`;
}

export function formatAgentToolEvents(events: AgentToolEvent[]) {
  if (!events.length) return "";
  return `Tool activity:\n${events
    .map((event) => {
      const details = [
        event.browserSessionId ? `session=${event.browserSessionId}` : "",
        event.mediaJobId ? `job=${event.mediaJobId}` : "",
        event.permissionRequestId ? `permission=${event.permissionRequestId}` : "",
        event.error ? `error=${event.error}` : "",
      ].filter(Boolean);
      const suffix = details.length ? ` ${details.join(" ")}` : "";
      return `- ${event.tool} ${event.status}: ${event.summary}${suffix}`;
    })
    .join("\n")}`;
}

export async function runAgentTools(input: string, agent: Agent): Promise<AgentToolRun> {
  const localResults: SearchResult[] = [];
  const webResults: SearchResult[] = [];
  const browserSessions: BrowserSessionRecord[] = [];
  const mediaJobs: MediaJob[] = [];
  const events: AgentToolEvent[] = [];

  if (shouldUseLocalSearch(input)) {
    try {
      const results = localSearch(input, 5);
      localResults.push(...results);
      events.push({
        tool: "local_search",
        status: "ok",
        resultCount: results.length,
        summary: results.length ? `Found ${results.length} indexed local result${results.length === 1 ? "" : "s"}.` : "No indexed local results matched.",
      });
    } catch (error) {
      events.push({
        tool: "local_search",
        status: "error",
        summary: "Local search failed.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (shouldUseWebSearch(input)) {
    try {
      const results = await webSearch(input, 5);
      webResults.push(...results);
      const needsSetup = results.length === 1 && results[0]?.title === "SearXNG is not configured";
      events.push({
        tool: "web_search",
        status: needsSetup ? "error" : "ok",
        resultCount: needsSetup ? 0 : results.length,
        summary: needsSetup ? "Local SearXNG is not configured." : `Found ${results.length} web result${results.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      events.push({
        tool: "web_search",
        status: "error",
        summary: "Web search failed.",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const mediaRun = await runMediaGenerationTools(input);
  mediaJobs.push(...mediaRun.mediaJobs);
  events.push(...mediaRun.events);

  const browserRun = await runBrowserSessionTools(input, {
    agentId: agent.id,
    agentName: agent.name,
    reason: "Agent task requested browser navigation.",
  });
  browserSessions.push(...browserRun.browserSessions);
  events.push(...browserRun.events);

  const contextParts = [
    formatAgentToolEvents(events) || "Tool activity: none requested",
    formatResults("Local search", localResults),
    formatResults("Web search", webResults),
    formatBrowserSessions(browserSessions),
    formatMediaJobs(mediaJobs),
  ];

  return {
    localResults,
    webResults,
    browserSessions,
    mediaJobs,
    events,
    contextBlock: contextParts.join("\n\n"),
  };
}
