import { expect, test } from "bun:test";
import type { HardwareProfile } from "../src/types.ts";
import { buildCapabilityProfile } from "../src/services/capabilityProfile.ts";

function hardware(input: Partial<HardwareProfile>): HardwareProfile {
  return {
    os: "linux",
    arch: "x64",
    totalRamGb: 8,
    gpuVendors: [],
    accelerator: "cpu",
    recommendedPreset: "fast",
    notes: [],
    ...input,
  };
}

function lane(profile: ReturnType<typeof buildCapabilityProfile>, id: string) {
  const item = profile.lanes.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Missing lane ${id}`);
  return item;
}

test("capability profile keeps CPU-only machines on the simple path", () => {
  const profile = buildCapabilityProfile(hardware({ totalRamGb: 8, accelerator: "cpu", recommendedPreset: "fast" }));

  expect(profile.tier).toBe("minimal");
  expect(profile.recommendedPreset).toBe("fast");
  expect(profile.defaultLanes).toContain("chat");
  expect(profile.defaultLanes).toContain("search");
  expect(lane(profile, "image").status).toBe("blocked");
  expect(lane(profile, "video").status).toBe("blocked");
  expect(profile.assumptions.some((item) => item.includes("VRAM is not measured"))).toBe(true);
});

test("capability profile identifies high-memory GPU machines as workstation class", () => {
  const profile = buildCapabilityProfile(
    hardware({
      totalRamGb: 64,
      gpuVendors: ["NVIDIA"],
      accelerator: "cuda",
      recommendedPreset: "smart",
    }),
  );

  expect(profile.tier).toBe("workstation");
  expect(profile.recommendedPreset).toBe("smart");
  expect(lane(profile, "image").status).toBe("available");
  expect(lane(profile, "video").status).toBe("optional");
  expect(lane(profile, "chat").commands).toContain("bun run local --open");
  expect(profile.commands.startLocal).toBe("bun run local --open");
  expect(profile.commands.installModel).toBe("bun run model:install smart");
});

test("capability profile treats variable GPU backends as opt-in", () => {
  const profile = buildCapabilityProfile(
    hardware({
      totalRamGb: 32,
      gpuVendors: ["AMD"],
      accelerator: "vulkan",
      recommendedPreset: "balanced",
    }),
  );

  expect(profile.tier).toBe("accelerated");
  expect(lane(profile, "image").status).toBe("optional");
  expect(lane(profile, "image").defaultEnabled).toBe(false);
  expect(lane(profile, "video").status).toBe("slow");
});
