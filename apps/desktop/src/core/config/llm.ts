// The LLM config — ONE derived, transient store: Settings resolves the per-service priority POOLS and writes
// them here; the concurrency runner leases over the pools, and the llm client reads each service's head
// (`config.llm[service]` = the pool's first slot). Never persisted (pure derived state from Settings), so it's
// a plain reactive module — not a storage consumer. (Was split across llm.ts + pools.ts; the head IS the pool
// head, so pools is the source and the head-list is derived from it — one store.)

import { useSyncExternalStore } from "react";

import type { ProviderKind, ReasoningEffort, ModelService } from "../../llm/types.ts";
import { createListeners } from "../storage/consumer.ts";

export interface LLMConfig {
  provider: {
    name: string;
    type: ProviderKind;
    baseUrl: string;
    apiKey?: string;
  };
  model: {
    id?: string;
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
    thinkingBudget?: number;
    contextLength?: number;
    // Media-generation descriptors (absent on text models).
    promptStyle?: string;
    maxImageSize?: string;
    maxVideoSize?: string;
  };
  // What the model accepts inline (the `text` chat pool). Each accepted input is explicit; gates the
  // media-load tools in canRun (image/video read the plain boolean). Absent on media-service targets.
  input?: { text?: boolean; image?: boolean; video?: boolean; audio?: boolean };
}

export type LLMConfigList = Partial<Record<ModelService, LLMConfig>>;

// One model in a service's priority pool. `c` is its max concurrent in-flight calls; `reserve` is the slice
// kept for foreground only (>0 only on the `text` pool — it sizes chat's headroom over background sub-agent
// runs sharing the same model). The model key for binding/affinity is `${providerId}:${modelId}`.
export interface RunnerSlot {
  providerId: string;
  modelId: string;
  config: LLMConfig;
  c: number;
  reserve: number;
}

export type RunnerPools = Partial<Record<ModelService, RunnerSlot[]>>;

export const modelKey = (s: { providerId: string; modelId: string }): string => `${s.providerId}:${s.modelId}`;

// Source of truth: the ordered pools. `heads` is derived from it (head = pools[service][0].config) and kept in
// sync on every write, so `config.llm[service]` stays a plain LLMConfig for the resolver.
let pools: RunnerPools = {};
let heads: LLMConfigList = {};
const { subscribe, notify } = createListeners();

function deriveHeads(): LLMConfigList {
  const out: LLMConfigList = {};
  for (const [svc, slots] of Object.entries(pools)) {
    const head = slots?.[0]?.config;
    if (head) out[svc as ModelService] = head;
  }
  return out;
}

// Settings writes the resolved pools here; the head-list is recomputed from them.
export function writeRunnerPools(next: RunnerPools): void {
  pools = next;
  heads = deriveHeads();
  notify();
}

// ── pools (the concurrency runner) ────────────────────────────────────────────
export function getRunnerPools(): RunnerPools {
  return pools;
}
export function getRunnerPool(service: ModelService): RunnerSlot[] {
  return pools[service] ?? [];
}
export function useRunnerPools(): RunnerPools {
  return useSyncExternalStore(subscribe, () => pools, () => pools);
}

// ── heads (the llm client) ────────────────────────────────────────────────────
export function getLLMConfigList(): LLMConfigList {
  return heads;
}
export function getLLMConfig(service: ModelService): LLMConfig | null {
  return heads[service] ?? null;
}
