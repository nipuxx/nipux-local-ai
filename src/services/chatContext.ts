import type { ChatMessage, SearchResult } from "../types.ts";
import { localSearch, webSearch } from "./search.ts";

export interface ChatCitation extends SearchResult {
  id: string;
}

export interface ChatContext {
  citations: ChatCitation[];
  messages: ChatMessage[];
  sourceAppendix: string;
}

export interface ChatContextOptions {
  useLocalSearch?: boolean;
  useWebSearch?: boolean;
  limit?: number;
}

function shouldUseWebSearch(input: string) {
  return /\b(web|internet|online|latest|current|today|news|recent|search web|google|site:)\b/i.test(input);
}

function citationId(prefix: "L" | "W", index: number) {
  return `${prefix}${index + 1}`;
}

function resultLocator(result: SearchResult) {
  return result.path || result.url || "local index";
}

function formatLocalContext(citations: ChatCitation[]) {
  if (!citations.length) return "";
  return `Local indexed context:
${citations
  .map((result) => `[${result.id}] ${result.title} (${resultLocator(result)})\n${result.snippet}`)
  .join("\n\n")}

Use this local context only when it is relevant. When you use it, cite sources with the bracketed ids.`;
}

function formatWebContext(citations: ChatCitation[]) {
  if (!citations.length) return "";
  const unavailable = citations.length === 1 && citations[0]?.title === "SearXNG is not configured";
  if (unavailable) {
    return `Web search status:
[${citations[0].id}] ${citations[0].title}
${citations[0].snippet}

Treat web search as unavailable unless SearXNG is configured.`;
  }
  return `Web search context:
${citations
  .map((result) => `[${result.id}] ${result.title} (${resultLocator(result)})\n${result.snippet}`)
  .join("\n\n")}

Use these web results only when they are relevant. When you use them, cite sources with the bracketed ids.`;
}

function formatAppendix(citations: ChatCitation[]) {
  if (!citations.length) return "";
  return `Sources:\n${citations
    .map((result) => {
      const detail = result.title === "SearXNG is not configured" ? result.snippet : resultLocator(result);
      return `[${result.id}] ${result.title} - ${detail}`;
    })
    .join("\n")}`;
}

export async function buildChatContext(input: string, messages: ChatMessage[], options: ChatContextOptions = {}): Promise<ChatContext> {
  const limit = options.limit ?? 4;
  const localCitations = options.useLocalSearch === false ? [] : localSearch(input, limit).map((result, index) => ({
    ...result,
    id: citationId("L", index),
  }));
  const useWebSearch = options.useWebSearch ?? shouldUseWebSearch(input);
  const webCitations = useWebSearch ? (await webSearch(input, limit)).map((result, index) => ({
    ...result,
    id: citationId("W", index),
  })) : [];
  const citations = [...localCitations, ...webCitations];
  const context = [formatLocalContext(localCitations), formatWebContext(webCitations)].filter(Boolean).join("\n\n");
  return {
    citations,
    messages: context ? [{ role: "system", content: context }, ...messages] : messages,
    sourceAppendix: formatAppendix(citations),
  };
}
