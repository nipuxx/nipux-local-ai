import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { addLocalDocument } from "./search.ts";

const DEFAULT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".json",
  ".jsonl",
  ".csv",
  ".tsv",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".env",
]);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  ".nuxt",
  "dist",
  "build",
  "coverage",
  ".cache",
  ".turbo",
  ".venv",
  "venv",
  "__pycache__",
  ".nipux-local-ai",
]);

export interface IndexPathOptions {
  maxFiles?: number;
  maxBytes?: number;
  recursive?: boolean;
}

export interface IndexPathResult {
  indexed: number;
  skipped: number;
  errors: Array<{ path: string; error: string }>;
  files: Array<{ path: string; title: string }>;
}

function isAllowedFile(path: string) {
  const ext = extname(path).toLowerCase();
  return DEFAULT_EXTENSIONS.has(ext) || basename(path).startsWith(".env");
}

async function collectFiles(path: string, options: Required<IndexPathOptions>, result: IndexPathResult) {
  const info = await stat(path);
  if (info.isFile()) {
    if (result.files.length >= options.maxFiles) {
      result.skipped++;
      return;
    }
    if (!isAllowedFile(path) || info.size > options.maxBytes) {
      result.skipped++;
      return;
    }
    result.files.push({ path, title: basename(path) });
    return;
  }

  if (!info.isDirectory()) {
    result.skipped++;
    return;
  }

  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    if (result.files.length >= options.maxFiles) {
      result.skipped++;
      continue;
    }
    if (entry.isDirectory() && (SKIP_DIRS.has(entry.name) || !options.recursive)) {
      result.skipped++;
      continue;
    }
    await collectFiles(resolve(path, entry.name), options, result);
  }
}

export async function indexPath(pathInput: string, options: IndexPathOptions = {}) {
  const path = resolve(pathInput);
  const resolved: Required<IndexPathOptions> = {
    maxFiles: options.maxFiles ?? 500,
    maxBytes: options.maxBytes ?? 1024 * 1024,
    recursive: options.recursive ?? true,
  };
  const result: IndexPathResult = { indexed: 0, skipped: 0, errors: [], files: [] };
  await collectFiles(path, resolved, result);

  for (const file of result.files) {
    try {
      const body = await readFile(file.path, "utf8");
      addLocalDocument(file.title, body, file.path);
      result.indexed++;
    } catch (error) {
      result.errors.push({ path: file.path, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
