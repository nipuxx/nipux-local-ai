import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const APP_NAME = "Nipux Local AI";
export const PORT = Number(process.env.NIPUX_PORT ?? 3434);
export const PUBLIC_API = process.env.NIPUX_PUBLIC_API === "1";
export const BIND_HOST = process.env.NIPUX_BIND_HOST ?? (PUBLIC_API ? "0.0.0.0" : "127.0.0.1");
export const LLAMA_BASE_URL = process.env.NIPUX_LLAMA_BASE_URL ?? "http://127.0.0.1:8080/v1";
export const SEARXNG_URL = process.env.NIPUX_SEARXNG_URL ?? "";
export const IS_FAKE_LLM = process.env.NIPUX_FAKE_LLM === "1";
export const IS_DEV_UI = process.env.NIPUX_DEV_UI === "1" || IS_FAKE_LLM;
export const API_KEYS = [
  ...(process.env.NIPUX_API_KEY ? [process.env.NIPUX_API_KEY] : []),
  ...(process.env.NIPUX_API_KEYS?.split(",") ?? []),
].map((key) => key.trim()).filter(Boolean);

export const NIPUX_HOME = resolve(process.env.NIPUX_HOME ?? join(homedir(), ".nipux-local-ai"));
export const DATA_DIR = join(NIPUX_HOME, "data");
export const MODEL_DIR = join(NIPUX_HOME, "models");
export const RUNTIME_DIR = join(NIPUX_HOME, "runtimes");
export const DB_PATH = join(DATA_DIR, "nipux.sqlite");
export const WEB_DIR = join(import.meta.dir, "..", "web");
