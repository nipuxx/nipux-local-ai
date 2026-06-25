import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-search-"));
const { addLocalDocument, localSearch } = await import("../src/services/search.ts");

test("local search indexes documents", () => {
  const marker = `nipux-${crypto.randomUUID()}`;
  addLocalDocument("Search fixture", `This document contains ${marker}.`);
  const results = localSearch(marker);
  expect(results.some((result) => result.title === "Search fixture")).toBe(true);
});
