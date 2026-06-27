import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-search-"));
const { updateAppSettings } = await import("../src/services/settings.ts");
const { addLocalDocument, localSearch, webSearch } = await import("../src/services/search.ts");

test("local search indexes documents", () => {
  const marker = `nipux-${crypto.randomUUID()}`;
  addLocalDocument("Search fixture", `This document contains ${marker}.`);
  const results = localSearch(marker);
  expect(results.some((result) => result.title === "Search fixture")).toBe(true);
});

test("web search reads SearXNG URL from persisted settings", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      expect(url.pathname).toBe("/search");
      expect(url.searchParams.get("format")).toBe("json");
      return Response.json({
        results: [{ title: "Settings search result", url: "https://example.com", content: url.searchParams.get("q") }],
      });
    },
  });

  try {
    updateAppSettings({ searxngUrl: `http://127.0.0.1:${server.port}` });
    const results = await webSearch("dynamic searxng");
    expect(results[0].title).toBe("Settings search result");
    expect(results[0].snippet).toBe("dynamic searxng");
  } finally {
    server.stop(true);
    updateAppSettings({ searxngUrl: "" });
  }
});
