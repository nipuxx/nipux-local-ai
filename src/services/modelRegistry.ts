import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.ts";
import { MODEL_DIR } from "../config.ts";
import type { LocalModelRecord, ModelPreset } from "../types.ts";

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

export function llamaServeCommand(modelId = "balanced", port = 8080) {
  const model = getModel(modelId);
  return `llama serve -hf ${model.llamaRef} --port ${port} --ctx-size ${Math.min(model.contextTokens, 32768)}`;
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
  const data = (await res.json()) as { siblings?: Array<{ rfilename: string; size?: number }> };
  return (data.siblings ?? []).filter((file) => file.rfilename.endsWith(".gguf"));
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
  return { targetPath, stdout, stderr };
}

seedModelRegistry();
