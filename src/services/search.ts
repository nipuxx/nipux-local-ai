import { indexDocument, searchLocalDocuments } from "../db.ts";
import { getAppSettings } from "./settings.ts";
import { recordUsage } from "./usage.ts";
import type { SearchResult } from "../types.ts";

const DEFAULT_BULK_MAX_DOCUMENTS = 80;
const DEFAULT_BULK_MAX_BYTES = 2 * 1024 * 1024;

export interface BulkDocumentInput {
  title?: unknown;
  body?: unknown;
  path?: unknown;
}

export interface BulkDocumentImportOptions {
  maxDocuments?: number;
  maxBytes?: number;
}

export interface BulkDocumentImportResult {
  indexed: Array<{ id: number; title: string; path?: string }>;
  skipped: Array<{ index: number; title?: string; path?: string; reason: string }>;
  errors: Array<{ index: number; title?: string; path?: string; error: string }>;
  limits: { maxDocuments: number; maxBytes: number };
}

export function addLocalDocument(title: string, body: string, path?: string) {
  return indexDocument(title, body, path);
}

function positiveInteger(value: unknown, fallback: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function byteLength(input: string) {
  return new TextEncoder().encode(input).length;
}

export function addLocalDocumentsBulk(
  documents: BulkDocumentInput[],
  options: BulkDocumentImportOptions = {},
): BulkDocumentImportResult {
  const maxDocuments = positiveInteger(options.maxDocuments, DEFAULT_BULK_MAX_DOCUMENTS, 500);
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_BULK_MAX_BYTES, 20 * 1024 * 1024);
  const result: BulkDocumentImportResult = {
    indexed: [],
    skipped: [],
    errors: [],
    limits: { maxDocuments, maxBytes },
  };

  const selected = documents.slice(0, maxDocuments);
  documents.slice(maxDocuments).forEach((document, offset) => {
    result.skipped.push({
      index: maxDocuments + offset,
      title: cleanOptionalString(document.title),
      path: cleanOptionalString(document.path),
      reason: `Bulk import is limited to ${maxDocuments} documents per request.`,
    });
  });

  selected.forEach((document, index) => {
    const title = cleanOptionalString(document.title);
    const body = typeof document.body === "string" ? document.body : "";
    const path = cleanOptionalString(document.path);

    if (!title) {
      result.skipped.push({ index, path, reason: "Missing title." });
      return;
    }
    if (!body.trim()) {
      result.skipped.push({ index, title, path, reason: "Missing body text." });
      return;
    }
    if (byteLength(body) > maxBytes) {
      result.skipped.push({ index, title, path, reason: `Document is larger than ${maxBytes} bytes.` });
      return;
    }

    try {
      const id = addLocalDocument(title, body, path);
      result.indexed.push({ id, title, path });
    } catch (error) {
      result.errors.push({ index, title, path, error: error instanceof Error ? error.message : String(error) });
    }
  });

  return result;
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
