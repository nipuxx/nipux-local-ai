import { getDefaultAgent } from "../db.ts";
import { PermissionRequiredError } from "./browserAudit.ts";
import { createBrowserSession, navigateBrowserSession, type BrowserSessionRecord } from "./browserBroker.ts";

export type BrowserSessionToolName = "browser_session" | "browser_navigation";
export type BrowserSessionToolStatus = "ok" | "pending" | "error";

export interface BrowserSessionToolEvent {
  tool: BrowserSessionToolName;
  status: BrowserSessionToolStatus;
  summary: string;
  browserSessionId?: string;
  permissionRequestId?: string;
  url?: string;
  error?: string;
}

export interface BrowserSessionToolRun {
  browserSessions: BrowserSessionRecord[];
  events: BrowserSessionToolEvent[];
  contextBlock: string;
}

export interface BrowserSessionToolOptions {
  agentId?: string;
  agentName?: string;
  label?: string;
  reason?: string;
}

export function shouldUseBrowserSessionTool(input: string) {
  return (
    /\b(open|create|launch|start)\b.{0,40}\bbrowser\b/i.test(input) ||
    /\b(browser session|browse|visit|navigate|go to)\b/i.test(input) ||
    /\bopen\s+(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(input)
  );
}

export function extractRequestedBrowserUrl(input: string) {
  const explicit = input.match(/\bhttps?:\/\/[^\s<>"')]+/i)?.[0];
  if (explicit) return explicit.replace(/[.,;:!?]+$/, "");

  const phrase = input.match(
    /\b(?:visit|open|go to|navigate to|browse to)\s+((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<>"')]+)?)/i,
  )?.[1];
  if (!phrase || /\bbrowser\b/i.test(phrase)) return undefined;
  return phrase.replace(/[.,;:!?]+$/, "");
}

function formatBrowserSessions(sessions: BrowserSessionRecord[]) {
  if (!sessions.length) return "Browser sessions: none requested";
  return `Browser sessions:\n${sessions
    .map((session, index) => `${index + 1}. ${session.label} (${session.id})\nstatus=${session.status} url=${session.url ?? "about:blank"}`)
    .join("\n")}`;
}

export function formatBrowserSessionToolEvents(events: BrowserSessionToolEvent[]) {
  if (!events.length) return "";
  return `Tool activity:\n${events
    .map((event) => {
      const details = [
        event.browserSessionId ? `session=${event.browserSessionId}` : "",
        event.permissionRequestId ? `permission=${event.permissionRequestId}` : "",
        event.error ? `error=${event.error}` : "",
      ].filter(Boolean);
      const suffix = details.length ? ` ${details.join(" ")}` : "";
      return `- ${event.tool} ${event.status}: ${event.summary}${suffix}`;
    })
    .join("\n")}`;
}

export async function runBrowserSessionTools(input: string, options: BrowserSessionToolOptions = {}): Promise<BrowserSessionToolRun> {
  const browserSessions: BrowserSessionRecord[] = [];
  const events: BrowserSessionToolEvent[] = [];

  if (!shouldUseBrowserSessionTool(input)) {
    return {
      browserSessions,
      events,
      contextBlock: [formatBrowserSessionToolEvents(events) || "Tool activity: none requested", formatBrowserSessions(browserSessions)].join("\n\n"),
    };
  }

  const fallbackAgent = options.agentId ? null : getDefaultAgent();
  const agentId = options.agentId ?? fallbackAgent?.id;
  const agentName = options.agentName ?? fallbackAgent?.name ?? "Agent";
  const label = options.label ?? `${agentName} Browser`;

  try {
    const session = createBrowserSession(agentId, label);
    browserSessions.push(session);
    events.push({
      tool: "browser_session",
      status: "ok",
      browserSessionId: session.id,
      summary: `Created browser session "${session.label}" for ${agentName}.`,
    });

    const requestedUrl = extractRequestedBrowserUrl(input);
    if (requestedUrl) {
      try {
        const navigated = await navigateBrowserSession(session.id, requestedUrl, {
          actor: "agent",
          agentId,
          reason: options.reason ?? "Chat request asked for browser navigation.",
        });
        events.push({
          tool: "browser_navigation",
          status: "ok",
          browserSessionId: session.id,
          url: navigated.url ?? requestedUrl,
          summary: `Navigated browser to ${navigated.url ?? requestedUrl}.`,
        });
      } catch (error) {
        if (error instanceof PermissionRequiredError) {
          events.push({
            tool: "browser_navigation",
            status: "pending",
            browserSessionId: session.id,
            permissionRequestId: error.request.id,
            url: requestedUrl,
            summary: `Navigation to ${requestedUrl} is waiting for user approval.`,
          });
        } else {
          events.push({
            tool: "browser_navigation",
            status: "error",
            browserSessionId: session.id,
            url: requestedUrl,
            summary: `Navigation to ${requestedUrl} failed.`,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    events.push({
      tool: "browser_session",
      status: "error",
      summary: "Browser session creation failed.",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    browserSessions,
    events,
    contextBlock: [formatBrowserSessionToolEvents(events) || "Tool activity: none requested", formatBrowserSessions(browserSessions)].join("\n\n"),
  };
}
