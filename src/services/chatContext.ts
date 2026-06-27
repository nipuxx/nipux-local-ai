import type { ChatMessage, SearchResult } from "../types.ts";
import { localSearch } from "./search.ts";

export interface ChatCitation extends SearchResult {
  id: string;
}

export interface ChatContext {
  citations: ChatCitation[];
  messages: ChatMessage[];
  sourceAppendix: string;
}

function citationId(index: number) {
  return `L${index + 1}`;
}

function resultLocator(result: SearchResult) {
  return result.path || result.url || "local index";
}

function formatContext(citations: ChatCitation[]) {
  if (!citations.length) return "";
  return `Local indexed context:
${citations
  .map((result) => `[${result.id}] ${result.title} (${resultLocator(result)})\n${result.snippet}`)
  .join("\n\n")}

Use this local context only when it is relevant. When you use it, cite sources with the bracketed ids.`;
}

function formatAppendix(citations: ChatCitation[]) {
  if (!citations.length) return "";
  return `Sources:\n${citations.map((result) => `[${result.id}] ${result.title} - ${resultLocator(result)}`).join("\n")}`;
}

export function buildChatContext(input: string, messages: ChatMessage[], limit = 4): ChatContext {
  const citations = localSearch(input, limit).map((result, index) => ({
    ...result,
    id: citationId(index),
  }));
  const context = formatContext(citations);
  return {
    citations,
    messages: context ? [{ role: "system", content: context }, ...messages] : messages,
    sourceAppendix: formatAppendix(citations),
  };
}
