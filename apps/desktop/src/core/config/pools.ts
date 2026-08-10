// The runner pools — per service, the ORDERED list of resolved models the concurrency
// runner leases over (priority = position). Passive + transient, exactly like llm.ts:
// Settings derives it and writes it in; the runner reads it. Never persisted.

import { useSyncExternalStore } from "react";

import type { LLMConfig } from "./llm.ts";
import type { ModelService } from "../../llm/types.ts";
import { createListeners } from "../storage/consumer.ts";

// One model in a service's priority pool. `c` is its max concurrent in-flight calls;
// `reserve` is the slice kept for foreground only (>0 only on the `text` pool — it sizes chat's
// headroom over background sub-agent runs sharing the same model). The model key for
// binding/affinity is `${providerId}:${modelId}`.
export interface RunnerSlot {
  providerId: string;
  modelId: string;
  config: LLMConfig;
  c: number;
  reserve: number;
}

export type RunnerPools = Partial<Record<ModelService, RunnerSlot[]>>;

export const modelKey = (s: { providerId: string; modelId: string }): string => `${s.providerId}:${s.modelId}`;

let pools: RunnerPools = {};
const { subscribe, notify } = createListeners();

export function getRunnerPools(): RunnerPools {
  return pools;
}

export function getRunnerPool(service: ModelService): RunnerSlot[] {
  return pools[service] ?? [];
}

export function useRunnerPools(): RunnerPools {
  return useSyncExternalStore(subscribe, () => pools, () => pools);
}

export function writeRunnerPools(next: RunnerPools): void {
  pools = next;
  notify();
}
