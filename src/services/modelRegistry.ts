import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { MODEL_DIR } from "../config.ts";
import type { LocalModelRecord, ModelPreset } from "../types.ts";

export interface HuggingFaceModelFile {
  rfilename: string;
  size?: number;
}

export const DEFAULT_PRESETS: ModelPreset[] = [
  {
    id: "fast",
    label: "Fast",
    repo: "google/gemma-4-E4B-it-qat-q4_0-gguf",
    quant: "Q4_0",
    family: "Gemma 4",
    parametersB: 8,
    contextTokens: 128000,
    estimatedRamGb: 7,
    description: "Small on-device default for CPU-only machines and low-memory laptops.",
    llamaRef: "google/gemma-4-E4B-it-qat-q4_0-gguf:Q4_0",
  },
  {
    id: "balanced",
    label: "Balanced",
    repo: "google/gemma-4-12B-it-qat-q4_0-gguf",
    quant: "Q4_0",
    family: "Gemma 4",
    parametersB: 12,
    contextTokens: 256000,
    estimatedRamGb: 12,
    description: "The starting target: Gemma 12B instruction model in QAT Q4 GGUF format.",
    llamaRef: "google/gemma-4-12B-it-qat-q4_0-gguf:Q4_0",
  },
  {
    id: "smart",
    label: "Smart",
    repo: "google/gemma-4-26B-A4B-it-qat-q4_0-gguf",
    quant: "Q4_0",
    family: "Gemma 4",
    parametersB: 26,
    contextTokens: 256000,
    estimatedRamGb: 28,
    description: "Higher quality local mode for large unified-memory systems or strong GPUs.",
    llamaRef: "google/gemma-4-26B-A4B-it-qat-q4_0-gguf:Q4_0",
  },
];

export function seedModelRegistry() {
  const insert = db.prepare(`
    INSERT INTO models (
      id, label, repo, quant, family, parameters_b, context_tokens,
      estimated_ram_gb, description, llama_ref, state, backend
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'missing', 'llama.cpp')
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      repo = excluded.repo,
      quant = excluded.quant,
      family = excluded.family,
      parameters_b = excluded.parameters_b,
      context_tokens = excluded.context_tokens,
      estimated_ram_gb = excluded.estimated_ram_gb,
      description = excluded.description,
      llama_ref = excluded.llama_ref,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const preset of DEFAULT_PRESETS) {
    insert.run(
      preset.id,
      preset.label,
      preset.repo,
      preset.quant,
      preset.family,
      preset.parametersB,
      preset.contextTokens,
      preset.estimatedRamGb,
      preset.description,
      preset.llamaRef,
    );
  }
}

export function listModels(): LocalModelRecord[] {
  seedModelRegistry();
  return db
    .prepare(
      `SELECT id, label, repo, quant, family, parameters_b AS parametersB,
        context_tokens AS contextTokens, estimated_ram_gb AS estimatedRamGb,
        description, llama_ref AS llamaRef, state, local_path AS localPath,
        file_name AS fileName, backend
       FROM models
       ORDER BY CASE id WHEN 'fast' THEN 1 WHEN 'balanced' THEN 2 WHEN 'smart' THEN 3 ELSE 4 END, label`,
    )
    .all() as LocalModelRecord[];
}

export function getModel(id = "balanced"): LocalModelRecord {
  const model = listModels().find((item) => item.id === id) ?? listModels().find((item) => item.id === "balanced");
  if (!model) throw new Error("Model registry is empty.");
  return model;
}

function customModelId(repo: string, filename: string) {
  const safe = `${repo}-${filename}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return `hf-${safe || crypto.randomUUID()}`;
}

function inferQuant(filename: string) {
  const match = filename.match(/(?:^|[-_.])(Q\d(?:_[A-Z0-9]+)?|IQ\d_[A-Z0-9]+|F16|BF16|F32)(?:[-_.]|$)/i);
  return match?.[1]?.toUpperCase() ?? "GGUF";
}

function inferParametersB(repo: string, filename: string) {
  const match = `${repo} ${filename}`.match(/(\d+(?:\.\d+)?)\s*[bx]/i);
  return match ? Number(match[1]) : 0;
}

export function registerDownloadedModel(repo: string, filename: string, targetPath: string) {
  const preset = DEFAULT_PRESETS.find((item) => item.repo === repo);
  if (preset) return getModel(preset.id);

  const id = customModelId(repo, filename);
  const displayName = filename.split("/").pop()?.replace(/\.gguf$/i, "") || repo;
  const quant = inferQuant(filename);
  const sizeBytes = Bun.file(targetPath).size;
  const estimatedRamGb = sizeBytes ? Math.max(1, Math.ceil((sizeBytes / 1024 ** 3) * 1.25)) : 8;
  db.prepare(
    `INSERT INTO models (
      id, label, repo, quant, family, parameters_b, context_tokens,
      estimated_ram_gb, description, llama_ref, state, local_path, file_name, backend, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, 'llama.cpp', CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      repo = excluded.repo,
      quant = excluded.quant,
      family = excluded.family,
      parameters_b = excluded.parameters_b,
      estimated_ram_gb = excluded.estimated_ram_gb,
      description = excluded.description,
      llama_ref = excluded.llama_ref,
      state = 'available',
      local_path = excluded.local_path,
      file_name = excluded.file_name,
      updated_at = CURRENT_TIMESTAMP`,
  ).run(
    id,
    displayName,
    repo,
    quant,
    repo.split("/").pop() ?? repo,
    inferParametersB(repo, filename),
    32768,
    estimatedRamGb,
    `Custom local GGUF downloaded from ${repo}.`,
    `${repo}:${filename}`,
    targetPath,
    filename,
  );
  return getModel(id);
}

function shellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function llamaServeCommand(modelId = "balanced", port = 8080) {
  const model = getModel(modelId);
  const source = model.localPath ? `-m ${shellArg(model.localPath)}` : `-hf ${model.llamaRef}`;
  return `llama serve ${source} --port ${port} --ctx-size ${Math.min(model.contextTokens, 32768)}`;
}

export async function searchHuggingFace(query: string) {
  const q = query.trim();
  if (!q) return [];
  const url = new URL("https://huggingface.co/api/models");
  url.searchParams.set("search", q);
  url.searchParams.set("limit", "20");
  url.searchParams.set("filter", "gguf");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hugging Face search failed: ${res.status}`);
  return (await res.json()) as Array<{
    id: string;
    downloads?: number;
    likes?: number;
    tags?: string[];
    pipeline_tag?: string;
  }>;
}

export async function listHuggingFaceFiles(repo: string) {
  const res = await fetch(`https://huggingface.co/api/models/${repo}`);
  if (!res.ok) throw new Error(`Could not read model files for ${repo}: ${res.status}`);
  const data = (await res.json()) as { siblings?: HuggingFaceModelFile[] };
  return (data.siblings ?? []).filter((file) => file.rfilename.endsWith(".gguf"));
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function selectBestGgufFile(files: HuggingFaceModelFile[], quant: string) {
  const normalizedQuant = normalizeName(quant);
  const candidates = files
    .filter((file) => file.rfilename.toLowerCase().endsWith(".gguf"))
    .filter((file) => !file.rfilename.toLowerCase().includes("mmproj"))
    .map((file) => {
      const name = normalizeName(file.rfilename);
      const score = (name.includes(normalizedQuant) ? 10 : 0) + (file.size ? 1 : 0) - file.rfilename.split("/").length * 0.01;
      return { file, score };
    })
    .sort((a, b) => b.score - a.score || (b.file.size ?? 0) - (a.file.size ?? 0) || a.file.rfilename.localeCompare(b.file.rfilename));
  return candidates[0]?.file ?? null;
}

export async function downloadHuggingFaceFile(repo: string, filename: string) {
  mkdirSync(MODEL_DIR, { recursive: true });
  const targetDir = join(MODEL_DIR, repo.replaceAll("/", "__"));
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, filename.split("/").pop() ?? filename);
  const headers: string[] = [];
  if (process.env.HF_TOKEN) headers.push("-H", `Authorization: Bearer ${process.env.HF_TOKEN}`);
  const url = `https://huggingface.co/${repo}/resolve/main/${filename}?download=true`;

  db.prepare("UPDATE models SET state = 'downloading', updated_at = CURRENT_TIMESTAMP WHERE repo = ?").run(repo);
  const proc = Bun.spawn(["curl", "-L", ...headers, "-o", targetPath, url], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    db.prepare("UPDATE models SET state = 'error', updated_at = CURRENT_TIMESTAMP WHERE repo = ?").run(repo);
    throw new Error(`Download failed: ${stderr || stdout}`);
  }
  db.prepare(
    "UPDATE models SET state = 'available', local_path = ?, file_name = ?, updated_at = CURRENT_TIMESTAMP WHERE repo = ?",
  ).run(targetPath, filename, repo);
  const model = registerDownloadedModel(repo, filename, targetPath);
  return { targetPath, stdout, stderr, model };
}

export async function installModelPreset(modelId = "balanced", filename?: string) {
  const model = getModel(modelId);
  let selected = filename;
  let availableFiles: HuggingFaceModelFile[] | undefined;

  if (!selected) {
    availableFiles = await listHuggingFaceFiles(model.repo);
    selected = selectBestGgufFile(availableFiles, model.quant)?.rfilename;
  }

  if (!selected) {
    throw new Error(`No GGUF file matching ${model.quant} was found for ${model.repo}.`);
  }

  const { model: downloadedModel, ...downloaded } = await downloadHuggingFaceFile(model.repo, selected);
  return {
    model: getModel(model.id),
    downloadedModel,
    modelPreset: model.id,
    repo: model.repo,
    filename: selected,
    availableFiles,
    ...downloaded,
  };
}

seedModelRegistry();
