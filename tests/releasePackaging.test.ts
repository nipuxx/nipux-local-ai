import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { buildRelease, buildReleaseManifest, collectReleaseFiles, createZipBuffer } = await import("../scripts/package-release.ts");

test("release file collection includes app sources and excludes local artifacts", () => {
  const files = collectReleaseFiles();
  const archivePaths = files.map((file) => file.archivePath);
  expect(archivePaths.some((path) => path.endsWith("/package.json"))).toBe(true);
  expect(archivePaths.some((path) => path.includes("/src/main.ts"))).toBe(true);
  expect(archivePaths.some((path) => path.includes("/scripts/image-backends/diffusers-image.py"))).toBe(true);
  expect(archivePaths.some((path) => path.includes("/web/index.html"))).toBe(true);
  expect(archivePaths.some((path) => path.includes("/node_modules/"))).toBe(false);
  expect(archivePaths.some((path) => path.includes("/dist/"))).toBe(false);
  expect(archivePaths.some((path) => path.includes("/tests/"))).toBe(false);
});

test("release manifest records archive checksum and install commands", () => {
  const manifest = buildReleaseManifest({
    version: "0.0.0-test",
    commit: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
    archiveName: "nipux-local-ai-0.0.0-test.zip",
    archiveSha256: "abc123",
    files: [],
  });
  expect(manifest.archive.sha256).toBe("abc123");
  expect(manifest.install.unix).toContain("install.sh");
  expect(manifest.install.windows).toContain("install.ps1");
  expect(manifest.install.local).toContain("bun run local --open");
});

test("install scripts surface capability and readiness commands", () => {
  const unix = readFileSync("scripts/install.sh", "utf8");
  const windows = readFileSync("scripts/install.ps1", "utf8");

  for (const script of [unix, windows]) {
    expect(script).toContain("bun run capabilities");
    expect(script).toContain("bun run ready");
    expect(script).toContain("bun run local --open");
    expect(script).toContain("bun run setup:actions");
  }
});

test("zip builder emits a valid zip header", () => {
  const zip = createZipBuffer([{ archivePath: "nipux-local-ai-test/README.md", data: Buffer.from("hello") }], "2026-01-01T00:00:00.000Z");
  expect(zip.subarray(0, 4).toString("hex")).toBe("504b0304");
  expect(zip.includes(Buffer.from("nipux-local-ai-test/README.md"))).toBe(true);
});

test("release packaging writes archive, manifest, and checksums", async () => {
  const distDir = mkdtempSync(join(tmpdir(), "nipux-release-"));
  const result = await buildRelease({
    distDir,
    version: "0.0.0-test",
    commit: "test",
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  expect(existsSync(result.archivePath)).toBe(true);
  expect(existsSync(result.manifestPath)).toBe(true);
  expect(existsSync(result.checksumsPath)).toBe(true);
  expect(result.fileCount).toBeGreaterThan(10);
  const checksums = readFileSync(result.checksumsPath, "utf8");
  expect(checksums).toContain("nipux-local-ai-0.0.0-test.zip");
  expect(checksums).toContain("nipux-local-ai-0.0.0-test-manifest.json");
});
