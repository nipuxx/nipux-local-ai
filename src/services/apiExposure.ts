import { networkInterfaces } from "node:os";
import { API_KEYS, BIND_HOST, PORT, PUBLIC_API } from "../config.ts";
import { activeStoredApiKeyCount } from "./apiKeys.ts";

function isLoopbackHost(host: string) {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

function lanAddresses() {
  const addresses: string[] = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== "IPv4") continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].sort();
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function clientExamples(apiBaseUrl: string, requiresKey: boolean) {
  const authHeader = requiresKey ? ` \\\n  -H 'x-api-key: <api-key>'` : "";
  const apiKeyValue = requiresKey ? "<api-key>" : "not-required-for-private-local-mode";
  const chatPayload = JSON.stringify({
    model: "balanced",
    messages: [{ role: "user", content: "Say hello from Nipux." }],
    stream: false,
  });

  return {
    openaiCompatible: true,
    baseUrl: apiBaseUrl,
    apiKey: apiKeyValue,
    authHeader: requiresKey ? "x-api-key: <api-key>" : "",
    env: `OPENAI_BASE_URL=${apiBaseUrl}\nOPENAI_API_KEY=${apiKeyValue}`,
    modelsCurl: `curl ${shellQuote(`${apiBaseUrl}/models`)}${authHeader}`,
    chatCurl: `curl ${shellQuote(`${apiBaseUrl}/chat/completions`)}${authHeader} \\\n  -H 'content-type: application/json' \\\n  --data ${shellQuote(chatPayload)}`,
  };
}

export function getApiExposurePlan() {
  const envKeyCount = API_KEYS.length;
  const storedKeyCount = activeStoredApiKeyCount();
  const totalKeyCount = envKeyCount + storedKeyCount;
  const exposedOnLan = BIND_HOST === "0.0.0.0" || (!isLoopbackHost(BIND_HOST) && BIND_HOST !== "");
  const localUrl = `http://127.0.0.1:${PORT}`;
  const lanUrls = lanAddresses().map((address) => `http://${address}:${PORT}`);
  const protectedMode = totalKeyCount > 0 || PUBLIC_API;
  const locked = PUBLIC_API && totalKeyCount === 0;
  const warnings = [
    ...(locked ? ["Public API mode is enabled but no server API key exists. Protected routes are locked."] : []),
    ...(exposedOnLan && totalKeyCount === 0 ? ["The server is bound beyond localhost without an API key. Create a managed server key before sharing this address."] : []),
    ...(!exposedOnLan ? ["LAN/public access is off. The server is bound to localhost only."] : []),
  ];

  return {
    localUrl,
    apiBaseUrl: `${localUrl}/v1`,
    bindHost: BIND_HOST,
    port: PORT,
    publicApi: PUBLIC_API,
    exposedOnLan,
    protected: protectedMode && !locked,
    locked,
    auth: {
      required: protectedMode,
      configured: totalKeyCount > 0,
      envKeyCount,
      storedKeyCount,
      totalKeyCount,
    },
    lanUrls,
    commands: {
      privateLocal: "bun run local",
      protectedLan: "NIPUX_PUBLIC_API=1 bun run local",
      protectedLanWithEnvKey: "NIPUX_PUBLIC_API=1 NIPUX_API_KEY='<set-a-long-random-key>' bun run local",
    },
    client: clientExamples(`${localUrl}/v1`, protectedMode),
    nextSteps: locked
      ? ["Stop public mode, run bun run local, create a managed server key in Settings, then start public mode again.", "Alternatively set NIPUX_API_KEY before starting public mode."]
      : exposedOnLan
        ? ["Use an API key with every LAN/public client request.", "Return to private mode with bun run local."]
        : ["Create a managed server key first, then start with NIPUX_PUBLIC_API=1 bun run local to expose a protected LAN API."],
    warnings,
  };
}
