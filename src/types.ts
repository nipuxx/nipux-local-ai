export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelPreset {
  id: "fast" | "balanced" | "smart" | string;
  label: string;
  repo: string;
  quant: string;
  family: string;
  parametersB: number;
  contextTokens: number;
  estimatedRamGb: number;
  description: string;
  llamaRef: string;
}

export interface LocalModelRecord extends ModelPreset {
  state: "available" | "missing" | "downloading" | "error";
  localPath?: string | null;
  fileName?: string | null;
  backend: "llama.cpp";
}

export interface HardwareProfile {
  os: NodeJS.Platform;
  arch: string;
  totalRamGb: number;
  gpuVendors: string[];
  accelerator: "cuda" | "rocm" | "metal" | "vulkan" | "directml" | "cpu";
  recommendedPreset: "fast" | "balanced" | "smart";
  notes: string[];
}

export interface UsageSummary {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  errors: number;
}

export interface UsageBreakdownItem extends UsageSummary {
  key: string;
  label: string;
  errorRate: number;
  lastEventAt?: string | null;
}

export interface UsageEvent {
  kind: string;
  model?: string | null;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  status: "ok" | "error" | string;
  createdAt: string;
  meta: Record<string, unknown>;
}

export interface UsageDashboard {
  summary: UsageSummary;
  byKind: UsageBreakdownItem[];
  byModel: UsageBreakdownItem[];
  errors: UsageEvent[];
  timeline: UsageEvent[];
}

export interface Agent {
  id: string;
  name: string;
  modelPreset: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
}

export interface AgentMemory {
  id: string;
  agentId: string;
  kind: "profile" | "task" | "procedure" | "fact" | "summary";
  content: string;
  importance: number;
  source: "manual" | "agent_run" | "compaction" | "import";
  sourceId?: string | null;
  sourceIds: string[];
  summary: string;
  tokenCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string | null;
}

export interface SearchResult {
  title: string;
  url?: string;
  path?: string;
  snippet: string;
  source: "local" | "web";
}
