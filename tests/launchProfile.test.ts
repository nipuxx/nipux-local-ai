import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const testHome = mkdtempSync(join(tmpdir(), "nipux-launch-profile-"));
process.env.NIPUX_HOME = testHome;
process.env.NIPUX_FAKE_LLM = "1";

const { getLaunchProfile, writeLaunchProfileFiles } = await import("../src/services/launchProfile.ts");
const { clearImageBackendPreset, selectImageBackendPreset } = await import("../src/services/imageSetup.ts");
const { route } = await import("../src/main.ts");

test("launch profile captures local run commands without API secrets", async () => {
  await clearImageBackendPreset();
  const profile = await getLaunchProfile();

  expect(profile.localUrl).toContain("127.0.0.1");
  expect(profile.apiBaseUrl).toContain("/v1");
  expect(profile.files.profileJson).toContain(profile.home);
  expect(profile.commands.oneCommandLocal).toBe("bun run setup && bun run local");
  expect(profile.commands.oneCommandDev).toBe("bun run setup && bun run dev");
  expect(profile.commands.appLocal).toBe("bun run local");
  expect(profile.commands.model).toContain("llama serve");
  expect(profile.model.llamaRef).toContain("gguf");
  expect(profile.env.local.NIPUX_API_KEY).toBeUndefined();
  expect(profile.env.local.NIPUX_FAKE_LLM).toBe("0");
  expect(profile.env.local.NIPUX_IMAGE_COMMAND).toBeDefined();
  expect(profile.env.local.NIPUX_VIDEO_COMMAND).toBeDefined();
  expect(profile.env.dev.NIPUX_FAKE_LLM).toBe("1");
  expect(profile.media.length).toBe(4);
});

test("launch profile includes selected image backend env", async () => {
  await selectImageBackendPreset("diffusers-sdxl-turbo");
  const profile = await getLaunchProfile();

  expect(profile.env.local.NIPUX_IMAGE_BACKEND_PRESET).toBe("diffusers-sdxl-turbo");
  expect(profile.env.local.NIPUX_IMAGE_ARGS).toContain("diffusers-image.py");
  expect(profile.env.local.NIPUX_IMAGE_MODEL).toBe("stabilityai/sdxl-turbo");

  await clearImageBackendPreset();
});

test("launch profile writer emits json, env, and local launcher files", async () => {
  const result = await writeLaunchProfileFiles();

  for (const file of result.written) expect(existsSync(file)).toBe(true);
  expect(result.written).toContain(result.profile.files.profileJson);
  expect(readFileSync(result.profile.files.envFile, "utf8")).toContain("NIPUX_BIND_HOST=127.0.0.1");
  expect(readFileSync(result.profile.files.envFile, "utf8")).toContain("NIPUX_LLAMA_COMMAND=");
  expect(readFileSync(result.profile.files.envFile, "utf8")).toContain("NIPUX_LLAMA_MODEL_PATH=");
  expect(readFileSync(result.profile.files.envFile, "utf8")).toContain("NIPUX_IMAGE_COMMAND=");
  expect(readFileSync(result.profile.files.envFile, "utf8")).toContain("NIPUX_VIDEO_COMMAND=");
  expect(readFileSync(result.profile.files.startDevSh, "utf8")).toContain("NIPUX_FAKE_LLM='1'");
  expect(readFileSync(result.profile.files.startDevSh, "utf8")).toContain("exec bun run local");
  expect(readFileSync(result.profile.files.startLocalPs1, "utf8")).toContain("$env:NIPUX_FAKE_LLM = '0'");
  expect(readFileSync(result.profile.files.startLocalPs1, "utf8")).toContain("bun run local");

  const parsed = JSON.parse(readFileSync(result.profile.files.profileJson, "utf8"));
  expect(parsed.files.envFile).toBe(result.profile.files.envFile);
});

test("launch profile API returns and writes the shared profile", async () => {
  const profileRes = await route(new Request("http://localhost/api/launch/profile"));
  expect(profileRes.status).toBe(200);
  const profile = await profileRes.json();
  expect(profile.commands.readiness).toBe("bun run ready");

  const supervisorRes = await route(new Request("http://localhost/api/launch/supervisor"));
  expect(supervisorRes.status).toBe(200);
  const supervisor = await supervisorRes.json();
  expect(supervisor.ready.some((item: { kind: string }) => item.kind === "app")).toBe(true);

  const writeRes = await route(new Request("http://localhost/api/launch/profile/write", { method: "POST" }));
  expect(writeRes.status).toBe(200);
  const written = await writeRes.json();
  expect(written.written.length).toBeGreaterThanOrEqual(4);
});
