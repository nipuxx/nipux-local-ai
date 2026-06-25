process.env.NIPUX_FAKE_LLM ??= "1";
process.env.NIPUX_DEV_UI ??= "1";
await import("./main.ts");

export {};
