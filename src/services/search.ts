import { indexDocument, searchLocalDocuments } from "../db.ts";
import { getAppSettings } from "./settings.ts";
import { recordUsage } from "./usage.ts";
import type { SearchResult } from "../types.ts";

export function addLocalDocument(title: string, body: string, path?: string) {
  return indexDocument(title, body, path);
}

export function localSearch(query: string, limit = 8): SearchResult[] {
  const started = Date.now();
  const results = searchLocalDocuments(query, limit);
  recordUsage({ kind: "search", latencyMs: Date.now() - started, status: "ok", meta: { type: "local", count: results.length } });
  return results;
}

export async function webSearch(query: string, limit = 8): Promise<SearchResult[]> {
  const searxngUrl = getAppSettings().searxngUrl.trim();
  if (!searxngUrl) {
    return [
      {
        title: "SearXNG is not configured",
        snippet: "Set a local SearXNG URL in Settings, for example http://127.0.0.1:8888.",
        source: "web",
      },
    ];
  }
  const started = Date.now();
  const url = new URL("/search", searxngUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const res = await fetch(url);
  if (!res.ok) {
    recordUsage({ kind: "search", latencyMs: Date.now() - started, status: "error", meta: { type: "web", code: res.status } });
    throw new Error(`SearXNG search failed: ${res.status}`);
  }
  const payload = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  const results = (payload.results ?? []).slice(0, limit).map((item) => ({
    title: item.title ?? item.url ?? "Untitled result",
    url: item.url,
    snippet: item.content ?? "",
    source: "web" as const,
  }));
  recordUsage({ kind: "search", latencyMs: Date.now() - started, status: "ok", meta: { type: "web", count: results.length } });
  return results;
}
