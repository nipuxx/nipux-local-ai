process.env.NIPUX_FAKE_LLM ??= "1";
process.env.NIPUX_DEV_UI ??= "1";

const { startServer } = await import("./main.ts");
startServer();

export {};
