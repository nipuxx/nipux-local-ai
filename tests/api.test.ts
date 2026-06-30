import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.NIPUX_HOME = mkdtempSync(join(tmpdir(), "nipux-api-"));
process.env.NIPUX_FAKE_LLM = "1";
const { authorizeRequest, route } = await import("../src/main.ts");

test("status route returns hardware and command metadata", async () => {
  const res = await route(new Request("http://localhost/api/status"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.app).toBe("Nipux Local AI");
  expect(json.serveCommands.balanced).toContain("Qwen3-8B-Q4_K_M.gguf");
  expect(json.settings.defaultModelPreset).toBe("balanced");
});

test("settings route persists app defaults", async () => {
  const updated = await route(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        searxngUrl: "http://127.0.0.1:8888",
        browserHeadless: false,
        devMode: false,
        defaultModelPreset: "smart",
      }),
    }),
  );
  expect(updated.status).toBe(200);
  const updatedJson = await updated.json();
  expect(updatedJson.settings.defaultModelPreset).toBe("smart");
  expect(updatedJson.settings.browserHeadless).toBe(false);

  const loaded = await route(new Request("http://localhost/api/settings"));
  const loadedJson = await loaded.json();
  expect(loadedJson.settings.searxngUrl).toBe("http://127.0.0.1:8888");

  const status = await route(new Request("http://localhost/api/status"));
  const statusJson = await status.json();
  expect(statusJson.settings.defaultModelPreset).toBe("smart");

  await route(
    new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        searxngUrl: "",
        browserHeadless: true,
        devMode: true,
        defaultModelPreset: "balanced",
      }),
    }),
  );
});

test("OpenAI models route returns model list", async () => {
  const res = await route(new Request("http://localhost/v1/models"));
  const json = await res.json();
  expect(json.data.length).toBeGreaterThanOrEqual(3);
});

test("model install dry run returns a download plan", async () => {
  const res = await route(
    new Request("http://localhost/api/models/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelPreset: "balanced", filename: "Qwen3-8B-Q4_K_M.gguf", dryRun: true, skipRemote: true }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.modelPreset).toBe("balanced");
  expect(json.selectedFilename).toBe("Qwen3-8B-Q4_K_M.gguf");
  expect(json.installCommand).toContain("bun run model:install balanced");
  expect(typeof json.resumable).toBe("boolean");
  expect(json.partialPath).toContain("Qwen3-8B-Q4_K_M.gguf.partial");
});

test("chat API persists conversations and messages", async () => {
  const created = await route(
    new Request("http://localhost/api/chats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ modelPreset: "balanced" }),
    }),
  );
  expect(created.status).toBe(200);
  const { chat } = await created.json();

  const posted = await route(
    new Request(`http://localhost/api/chats/${chat.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: "user", content: "Persist this message." }),
    }),
  );
  expect(posted.status).toBe(200);

  const loaded = await route(new Request(`http://localhost/api/chats/${chat.id}`));
  const data = await loaded.json();
  expect(data.messages[0].content).toBe("Persist this message.");
  expect(data.chat.title).toContain("Persist this message");
});

test("runtime status route returns backend state without starting a process", async () => {
  const res = await route(new Request("http://localhost/api/runtime/status"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.running).toBe(false);
  expect(json.port).toBeGreaterThan(0);
});

test("authorization accepts configured API keys and blocks public mode without keys", () => {
  const authed = authorizeRequest(
    new Request("http://localhost/v1/models", { headers: { "x-api-key": "secret" } }),
    "/v1/models",
    { apiKeys: ["secret"], publicApi: false },
  );
  expect(authed.ok).toBe(true);

  const missing = authorizeRequest(new Request("http://localhost/v1/models"), "/v1/models", {
    apiKeys: ["secret"],
    publicApi: false,
  });
  expect(missing.ok).toBe(false);
  expect(missing.status).toBe(401);

  const publicNoKey = authorizeRequest(new Request("http://localhost/v1/models"), "/v1/models", {
    apiKeys: [],
    publicApi: true,
  });
  expect(publicNoKey.status).toBe(403);
});

test("managed API keys can protect local routes and be revoked", async () => {
  const created = await route(
    new Request("http://localhost/api/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: "Test key" }),
    }),
  );
  expect(created.status).toBe(200);
  const createdJson = await created.json();
  expect(createdJson.key.startsWith("npx_")).toBe(true);
  expect(createdJson.record.label).toBe("Test key");

  const exposure = await route(new Request("http://localhost/api/exposure", { headers: { "x-api-key": createdJson.key } }));
  expect(exposure.status).toBe(200);
  const exposureJson = await exposure.json();
  expect(exposureJson.auth.configured).toBe(true);
  expect(exposureJson.commands.protectedLan).toContain("NIPUX_PUBLIC_API=1");
  expect(exposureJson.client.baseUrl).toContain("/v1");
  expect(exposureJson.client.chatCurl).toContain("/v1/chat/completions");
  expect(exposureJson.client.nativeToolsCurl).toContain("/api/chat/respond");
  expect(exposureJson.client.chatCurl).toContain("<api-key>");
  expect(JSON.stringify(exposureJson.client)).not.toContain(createdJson.key);

  const unauthenticatedClientPackage = await route(new Request("http://localhost/api/exposure/client"));
  expect(unauthenticatedClientPackage.status).toBe(401);

  const clientPackage = await route(new Request("http://localhost/api/exposure/client", { headers: { "x-api-key": createdJson.key } }));
  expect(clientPackage.status).toBe(200);
  const clientPackageJson = await clientPackage.json();
  expect(clientPackageJson.containsSecret).toBe(true);
  expect(clientPackageJson.env).toContain(createdJson.key);
  expect(clientPackageJson.modelsCurl).toContain(`x-api-key: ${createdJson.key}`);
  expect(clientPackageJson.nativeToolsCurl).toContain(`/api/chat/respond`);
  expect(clientPackageJson.nativeToolsCurl).toContain(`x-api-key: ${createdJson.key}`);
  expect(clientPackageJson.redacted.env).not.toContain(createdJson.key);
  expect(clientPackageJson.redacted.modelsCurl).not.toContain(createdJson.key);
  expect(clientPackageJson.redacted.nativeToolsCurl).not.toContain(createdJson.key);

  const authed = authorizeRequest(
    new Request("http://localhost/v1/models", { headers: { "x-api-key": createdJson.key } }),
    "/v1/models",
    { publicApi: true },
  );
  expect(authed.ok).toBe(true);

  const listed = await route(new Request("http://localhost/api/api-keys", { headers: { "x-api-key": createdJson.key } }));
  expect(listed.status).toBe(200);
  const listedJson = await listed.json();
  expect(listedJson.keys.some((key: { id: string; prefix: string }) => key.id === createdJson.record.id && key.prefix)).toBe(true);

  const revoked = await route(
    new Request(`http://localhost/api/api-keys/${createdJson.record.id}`, {
      method: "DELETE",
      headers: { "x-api-key": createdJson.key },
    }),
  );
  expect(revoked.status).toBe(200);
  expect((await revoked.json()).revoked).toBe(true);
});

test("API exposure route is safe discovery metadata", async () => {
  const res = await route(new Request("http://localhost/api/exposure"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.localUrl).toContain("127.0.0.1");
  expect(json.apiBaseUrl).toContain("/v1");
  expect(json.commands.privateLocal).toBe("bun run local");
  expect(json.commands.protectedLan).toContain("NIPUX_PUBLIC_API=1");
  expect(json.client.openaiCompatible).toBe(true);
  expect(json.client.baseUrl).toBe(json.apiBaseUrl);
  expect(json.client.env).toContain("OPENAI_BASE_URL=");
  expect(json.client.modelsCurl).toContain("/v1/models");
  expect(json.client.chatCurl).toContain("/v1/chat/completions");
  expect(json.client.nativeToolsCurl).toContain("/api/chat/respond");
  expect(json.auth).not.toHaveProperty("keys");
  expect(json.client).not.toHaveProperty("key");

  const clientPackage = await route(new Request("http://localhost/api/exposure/client"));
  expect(clientPackage.status).toBe(200);
  const clientPackageJson = await clientPackage.json();
  expect(clientPackageJson.containsSecret).toBe(false);
  expect(clientPackageJson.apiKey).toBe("not-required-for-private-local-mode");
  expect(clientPackageJson.env).toContain("OPENAI_BASE_URL=");
});

test("capability profile route returns machine defaults", async () => {
  const res = await route(new Request("http://localhost/api/capability-profile"));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.tierLabel).toBeTruthy();
  expect(json.recommendedPreset).toMatch(/fast|balanced|smart/);
  expect(json.lanes.some((lane: { id: string }) => lane.id === "chat")).toBe(true);
  expect(json.commands.startLocal).toBe("bun run local --open");
});

test("image backend route returns local-only setup presets", async () => {
  const res = await route(new Request("http://localhost/api/media/images/backends"));
  expect(res.status).toBe(200);
  const json = await res.json();
  const turbo = json.presets.find((preset: { id: string }) => preset.id === "diffusers-sdxl-turbo");
  expect(turbo).toBeTruthy();
  expect(turbo.install.command).toContain("bun run image:install diffusers-sdxl-turbo");
  expect(json.presets.every((preset: { localOnly: boolean }) => preset.localOnly)).toBe(true);
  expect(json.nextSteps.length).toBeGreaterThan(0);
});

test("image backend install route can return a dry-run plan", async () => {
  const res = await route(
    new Request("http://localhost/api/media/images/backends/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "diffusers-sdxl-turbo", dryRun: true }),
    }),
  );
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.presetId).toBe("diffusers-sdxl-turbo");
  expect(json.dryRun).toBe(true);
  expect(json.commands.some((item: string) => item.includes("pip install"))).toBe(true);
});

test("image backend prepare route selects the backend and returns next run steps", async () => {
  const prepared = await route(
    new Request("http://localhost/api/media/images/backends/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "diffusers-sdxl-turbo" }),
    }),
  );
  expect(prepared.status).toBe(200);
  const json = await prepared.json();
  expect(json.selectedPresetId).toBe("diffusers-sdxl-turbo");
  expect(json.settings.imageWorkerUrl).toBe("http://127.0.0.1:8081");
  expect(json.commands.local).toBe("bun run local --open");
  expect(json.nextSteps.some((step: string) => step.includes("bun run local --open"))).toBe(true);

  await route(new Request("http://localhost/api/media/images/backends/selection", { method: "DELETE" }));
});

test("image backend selection persists worker defaults", async () => {
  const selected = await route(
    new Request("http://localhost/api/media/images/backends/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ presetId: "diffusers-sdxl-turbo" }),
    }),
  );
  expect(selected.status).toBe(200);
  const selectedJson = await selected.json();
  expect(selectedJson.selectedPresetId).toBe("diffusers-sdxl-turbo");
  expect(selectedJson.settings.imageWorkerUrl).toBe("http://127.0.0.1:8081");
  expect(selectedJson.plan.selectedPresetId).toBe("diffusers-sdxl-turbo");

  const cleared = await route(new Request("http://localhost/api/media/images/backends/selection", { method: "DELETE" }));
  expect(cleared.status).toBe(200);
  const clearedJson = await cleared.json();
  expect(clearedJson.selectedPresetId).toBe("");
  expect(clearedJson.settings.imageWorkerUrl).toBe("");
});
