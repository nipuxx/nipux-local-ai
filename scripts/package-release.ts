import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_DIR = join(ROOT, "dist");

export const RELEASE_INCLUDE_PATHS = [
  ".github/workflows",
  "docs",
  "scripts",
  "src",
  "web",
  "GOAL.md",
  "LICENSE",
  "README.md",
  "bun.lock",
  "package.json",
  "tsconfig.json",
];

const EXCLUDED_DIRS = new Set([".git", "dist", "node_modules", "coverage", ".nipux-local-ai"]);
const EXCLUDED_FILES = new Set([".DS_Store", "bun.lockb"]);

export interface ReleaseFile {
  sourcePath: string;
  archivePath: string;
  size: number;
  sha256: string;
}

export interface ReleaseBuildOptions {
  root?: string;
  distDir?: string;
  version?: string;
  commit?: string;
  generatedAt?: string;
}

export interface ReleaseBuildResult {
  version: string;
  commit: string;
  archivePath: string;
  manifestPath: string;
  checksumsPath: string;
  archiveSha256: string;
  fileCount: number;
}

function sha256(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}

function packageVersion(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

async function gitCommit(root = ROOT) {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--short", "HEAD"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return exitCode === 0 ? stdout.trim() || "unknown" : "unknown";
  } catch {
    return "unknown";
  }
}

function toArchivePath(path: string) {
  return path.split(/[\\/]+/).join("/");
}

function shouldIncludeFile(path: string) {
  const parts = path.split(/[\\/]+/);
  if (parts.some((part) => EXCLUDED_DIRS.has(part))) return false;
  return !EXCLUDED_FILES.has(basename(path));
}

function walkFiles(root: string, absolutePath: string): string[] {
  const stat = statSync(absolutePath);
  if (stat.isFile()) return shouldIncludeFile(relative(root, absolutePath)) ? [absolutePath] : [];
  if (!stat.isDirectory()) return [];
  const name = basename(absolutePath);
  if (EXCLUDED_DIRS.has(name)) return [];
  return readdirSync(absolutePath)
    .flatMap((entry) => walkFiles(root, join(absolutePath, entry)))
    .sort();
}

export function collectReleaseFiles(root = ROOT, releaseRoot = `nipux-local-ai-${packageVersion(root)}`): ReleaseFile[] {
  const files = RELEASE_INCLUDE_PATHS.flatMap((path) => {
    const absolutePath = join(root, path);
    return existsSync(absolutePath) ? walkFiles(root, absolutePath) : [];
  });

  const uniqueFiles = [...new Set(files)].sort((a, b) => relative(root, a).localeCompare(relative(root, b)));
  return uniqueFiles.map((sourcePath) => {
    const buffer = readFileSync(sourcePath);
    return {
      sourcePath,
      archivePath: `${releaseRoot}/${toArchivePath(relative(root, sourcePath))}`,
      size: buffer.length,
      sha256: sha256(buffer),
    };
  });
}

const CRC_TABLE = new Uint32Array(256).map((_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date: Date) {
  const time = ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((Math.floor(date.getSeconds() / 2) & 0x1f));
  const year = Math.max(date.getFullYear(), 1980);
  const day = (((year - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0xf) << 5) | (date.getDate() & 0x1f);
  return { time, day };
}

function u16(value: number) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value & 0xffff, 0);
  return buffer;
}

function u32(value: number) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0, 0);
  return buffer;
}

function zipMode(archivePath: string) {
  const executable = archivePath.endsWith("/scripts/install.sh");
  return (executable ? 0o100755 : 0o100644) << 16;
}

export function createZipBuffer(entries: Array<{ archivePath: string; data: Buffer }>, generatedAt = new Date().toISOString()) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const date = dosDateTime(new Date(generatedAt));
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.archivePath, "utf8");
    const crc = crc32(entry.data);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(date.time),
      u16(date.day),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, entry.data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(date.time),
      u16(date.day),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(zipMode(entry.archivePath)),
      u32(offset),
      name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export function buildReleaseManifest(input: {
  version: string;
  commit: string;
  generatedAt: string;
  archiveName: string;
  archiveSha256: string;
  files: ReleaseFile[];
}) {
  return {
    name: "nipux-local-ai",
    version: input.version,
    commit: input.commit,
    generatedAt: input.generatedAt,
    archive: {
      file: input.archiveName,
      sha256: input.archiveSha256,
    },
    install: {
      unix: "curl -fsSL https://raw.githubusercontent.com/nipuxx/nipux-local-ai/main/scripts/install.sh | bash",
      windows: "irm https://raw.githubusercontent.com/nipuxx/nipux-local-ai/main/scripts/install.ps1 | iex",
      local: ["bun install --frozen-lockfile", "bun run setup", "bun run preflight"],
    },
    files: input.files.map((file) => ({
      path: file.archivePath,
      size: file.size,
      sha256: file.sha256,
    })),
  };
}

export async function buildRelease(options: ReleaseBuildOptions = {}): Promise<ReleaseBuildResult> {
  const root = resolve(options.root ?? ROOT);
  const distDir = resolve(options.distDir ?? DIST_DIR);
  const version = options.version ?? packageVersion(root);
  const commit = options.commit ?? (await gitCommit(root));
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const releaseRoot = `nipux-local-ai-${version}`;
  const archiveName = `${releaseRoot}.zip`;
  const archivePath = join(distDir, archiveName);
  const manifestPath = join(distDir, `${releaseRoot}-manifest.json`);
  const checksumsPath = join(distDir, "SHA256SUMS.txt");

  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  const files = collectReleaseFiles(root, releaseRoot);
  const zipEntries = files.map((file) => ({
    archivePath: file.archivePath,
    data: readFileSync(file.sourcePath),
  }));
  const archiveBuffer = createZipBuffer(zipEntries, generatedAt);
  const archiveSha256 = sha256(archiveBuffer);
  const manifest = buildReleaseManifest({ version, commit, generatedAt, archiveName, archiveSha256, files });
  const manifestBuffer = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);

  writeFileSync(archivePath, archiveBuffer);
  writeFileSync(manifestPath, manifestBuffer);
  writeFileSync(
    checksumsPath,
    [
      `${archiveSha256}  ${archiveName}`,
      `${sha256(manifestBuffer)}  ${basename(manifestPath)}`,
      "",
    ].join("\n"),
  );

  return {
    version,
    commit,
    archivePath,
    manifestPath,
    checksumsPath,
    archiveSha256,
    fileCount: files.length,
  };
}

if (import.meta.main) {
  const result = await buildRelease();
  console.log(JSON.stringify(result, null, 2));
}
