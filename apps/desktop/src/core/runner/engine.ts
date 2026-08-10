// The concurrency runner — leases live slots over the per-service priority pools, with
// reserve headroom, provider affinity (binding) for KV warmth, a wait queue, and a TTL.
// Framework-free: the clock, id source, pool snapshot, settings, and event sink are all
// injected, so it unit-tests without React or a real bus. See implementation.md.
//
// Two acquisition shapes share ONE per-model in-flight counter (the universal `c`):
//   • text turns (the `text` pool — foreground chat + background sub-agent runs) — affinity on,
//     held across the whole turn (KV-warm); a background run is capped at the open band (c − reserve);
//   • everything else (media gen/rec, naming, compaction) — affinity off, held for the single call.
//     Both priority-fill their service's pool, top tier first.

import type { LLMConfig } from "../config/llm.ts";
import type { ModelService } from "../../llm/types.ts";
import { modelKey, type RunnerPools, type RunnerSlot } from "../config/pools.ts";

// A held slot: identity (`id` — the surfaced slot token), the model it pins to, and the
// resolved target to call. `background` marks a sub-agent run (counts against the open band, frees a
// child seat on release). A text turn reuses it across steps; a call holds it once.
export interface Lease {
  id: string;
  sessionId: string;
  service: ModelService;
  modelKey: string;
  config: LLMConfig;
  background: boolean;
}

export type RunnerEvent =
  | { type: "waiting"; sessionId: string; leaseId: string }
  | { type: "granted"; sessionId: string; leaseId: string; modelKey: string }
  | { type: "released"; sessionId: string; leaseId: string };

export interface AcquireOpts {
  affinity?: boolean; // keep a provider binding for KV warmth (text turns); default by service
  background?: boolean; // a background sub-agent run on the `text` pool — capped at the open band (c − reserve)
  signal?: AbortSignal;
}

export interface RunnerDeps {
  pools: () => RunnerPools;
  ttlMs: () => number;
  kvThreshold: () => number;
  now?: () => number;
  emit?: (e: RunnerEvent) => void;
  newId?: () => string;
  // When set, a periodic pump so a warm waiter past its binding TTL roams even with no release
  // event in flight. Omitted in tests (which drive pump() by hand against a fake clock).
  reaperMs?: number;
}

interface Binding {
  modelKey: string;
  expiresAt: number;
}
interface Counts {
  total: number;
  child: number;
}
interface Waiter {
  id: string;
  service: ModelService;
  affinity: boolean;
  background: boolean;
  contextSize: number;
  preferredKey?: string; // a warm bound provider to wait on (favored); undefined = roam any
  deadline: number; // past this, a warm waiter roams freely (its binding TTL)
  leaseId: string;
  resolve: (lease: Lease | null) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const affinityDefault = (service: ModelService): boolean => service === "text";

export class RunnerEngine {
  private readonly counts = new Map<string, Counts>(); // modelKey → live in-flight
  private readonly bindings = new Map<string, Binding>(); // acquirer id → provider affinity
  private readonly live = new Map<string, Lease>(); // acquirer id → currently held lease
  private readonly queue: Waiter[] = [];
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly reaper?: ReturnType<typeof setInterval>;

  constructor(private readonly deps: RunnerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    if (deps.reaperMs) this.reaper = setInterval(() => this.tick(), deps.reaperMs);
  }

  // The reaper tick: drop dead bindings, then re-pump so deadline-expired waiters roam.
  private tick(): void {
    this.sweepBindings();
    this.pump();
  }

  // Expired affinity bindings are already ignored by acquire(), but they linger forever for a session that
  // ran once and was never deleted (drop() removes them on delete; nothing else does). Prune them so the
  // map stays bounded over a long-running app. (Map deletion mid-iteration is well-defined.)
  private sweepBindings(): void {
    const now = this.now();
    for (const [id, b] of this.bindings) if (b.expiresAt <= now) this.bindings.delete(id);
  }

  // Stop the TTL reaper AND settle anything still queued — a dispose (tests / HMR teardown) must not strand
  // callers on an acquire() Promise that never resolves.
  dispose(): void {
    if (this.reaper) clearInterval(this.reaper);
    for (const w of this.queue.splice(0)) {
      if (w.signal && w.onAbort) w.signal.removeEventListener("abort", w.onAbort);
      w.resolve(null);
    }
  }

  private emit(e: RunnerEvent): void {
    this.deps.emit?.(e);
  }
  private poolFor(service: ModelService): RunnerSlot[] {
    return this.deps.pools()[service] ?? [];
  }
  private cnt(key: string): Counts {
    return this.counts.get(key) ?? { total: 0, child: 0 };
  }

  // A slot has a free seat: under its cap, and for a background run under its open band (c − reserve).
  private free(slot: RunnerSlot, background: boolean): boolean {
    const cur = this.cnt(modelKey(slot));
    if (cur.total >= slot.c) return false;
    // clamp: a stored reserve > c would make the band negative and silently block every child on this model.
    if (background && cur.child >= Math.max(0, slot.c - slot.reserve)) return false;
    return true;
  }

  // Acquire a slot for `id` on `service`'s pool. Reuses a still-held lease; otherwise runs the
  // warm/cold placement (see the acquire flowchart). Resolves null when aborted while queued, or
  // when the pool is empty (caller falls back). `contextSize` gates warm-wait vs roam;
  // `opts.background` marks a sub-agent run (capped at the open band on the `text` pool).
  acquire(service: ModelService, id: string, contextSize = 0, opts: AcquireOpts = {}): Promise<Lease | null> {
    const held = this.live.get(id);
    if (held) return Promise.resolve(held);

    const affinity = opts.affinity ?? affinityDefault(service);
    const background = opts.background ?? false;
    const pool = this.poolFor(service);
    if (!pool.length) return Promise.resolve(null);

    const binding = affinity ? this.bindings.get(id) : undefined;
    const warm = binding && binding.expiresAt > this.now() ? binding.modelKey : undefined;

    if (warm) {
      const bound = pool.find((s) => modelKey(s) === warm);
      if (bound) {
        if (this.free(bound, background)) return Promise.resolve(this.grant(bound, id, service, affinity, background));
        // bound full: a big context waits on it (KV worth protecting); a small one roams.
        if (contextSize >= this.deps.kvThreshold()) return this.wait(service, id, affinity, background, contextSize, warm, binding!.expiresAt, opts.signal);
      }
    }

    // Cold, or a small warm session that's roaming: priority-fill, top of the pool first.
    const slot = pool.find((s) => this.free(s, background));
    if (slot) return Promise.resolve(this.grant(slot, id, service, affinity, background));
    return this.wait(service, id, affinity, background, contextSize, undefined, this.now(), opts.signal);
  }

  // Release a held slot (turn end / parking, or a call settling). A text binding is kept and its
  // TTL refreshed so a return re-warms the same provider; then the queue is pumped.
  release(id: string): void {
    const lease = this.live.get(id);
    if (!lease) return;
    this.live.delete(id);
    const cur = this.cnt(lease.modelKey);
    this.counts.set(lease.modelKey, { total: Math.max(0, cur.total - 1), child: Math.max(0, cur.child - (lease.background ? 1 : 0)) });
    if (this.bindings.has(id)) this.bindings.set(id, { modelKey: lease.modelKey, expiresAt: this.now() + this.deps.ttlMs() });
    this.emit({ type: "released", sessionId: lease.sessionId, leaseId: lease.id });
    this.pump();
  }

  // Acquirer gone: drop its live lease, binding, and any queued waiter.
  drop(id: string): void {
    this.bindings.delete(id);
    // Resolve any queued waiter(s) for this id BEFORE releasing: release() pumps the queue, and a
    // still-queued same-id waiter (e.g. a double-acquire) could otherwise be granted a fresh lease
    // that then escapes this cleanup, leaking a slot.
    for (const w of this.queue.filter((x) => x.id === id)) {
      this.removeWaiter(w);
      w.resolve(null);
    }
    this.release(id);
  }

  // Try to satisfy waiters against current free capacity. A warm waiter holds out for its bound
  // provider until its deadline, then roams. The TTL reaper calls this so deadline-expired waiters
  // roam even with no release event.
  pump(): void {
    for (;;) {
      const now = this.now();
      const boundFree = (w: Waiter): RunnerSlot | undefined => {
        if (!(w.preferredKey && now < w.deadline)) return undefined;
        const bound = this.poolFor(w.service).find((s) => modelKey(s) === w.preferredKey);
        return bound && this.free(bound, w.background) ? bound : undefined;
      };
      // Pass 1 — a warm waiter whose bound provider is free wins, wherever it sits (favoring).
      let idx = this.queue.findIndex((w) => boundFree(w));
      // Pass 2 — FIFO over the rest, but a warm waiter still within its deadline keeps holding
      // out for its (busy) bound provider rather than roaming.
      if (idx < 0)
        idx = this.queue.findIndex((w) => {
          const pool = this.poolFor(w.service);
          if (w.preferredKey && now < w.deadline && pool.some((s) => modelKey(s) === w.preferredKey)) return false;
          return pool.some((s) => this.free(s, w.background));
        });
      if (idx < 0) return;
      const w = this.queue[idx];
      const slot = boundFree(w) ?? this.poolFor(w.service).find((s) => this.free(s, w.background));
      if (!slot) return;
      this.queue.splice(idx, 1);
      if (w.signal && w.onAbort) w.signal.removeEventListener("abort", w.onAbort);
      w.resolve(this.grant(slot, w.id, w.service, w.affinity, w.background, w.leaseId));
    }
  }

  // ── introspection (UI + tests) ──────────────────────────────────────────────
  inflight(key: string): Counts {
    return this.cnt(key);
  }
  waitingCount(): number {
    return this.queue.length;
  }
  isWaiting(id: string): boolean {
    return this.queue.some((w) => w.id === id);
  }

  private grant(slot: RunnerSlot, id: string, service: ModelService, affinity: boolean, background: boolean, leaseId?: string): Lease {
    const key = modelKey(slot);
    const cur = this.cnt(key);
    this.counts.set(key, { total: cur.total + 1, child: cur.child + (background ? 1 : 0) });
    const lease: Lease = { id: leaseId ?? this.newId(), sessionId: id, service, modelKey: key, config: slot.config, background };
    this.live.set(id, lease);
    if (affinity) this.bindings.set(id, { modelKey: key, expiresAt: this.now() + this.deps.ttlMs() });
    this.emit({ type: "granted", sessionId: id, leaseId: lease.id, modelKey: key });
    return lease;
  }

  private wait(service: ModelService, id: string, affinity: boolean, background: boolean, contextSize: number, preferredKey: string | undefined, deadline: number, signal?: AbortSignal): Promise<Lease | null> {
    return new Promise<Lease | null>((resolve) => {
      if (signal?.aborted) return resolve(null);
      const leaseId = this.newId();
      const w: Waiter = { id, service, affinity, background, contextSize, preferredKey, deadline, leaseId, resolve, signal };
      w.onAbort = () => {
        this.removeWaiter(w);
        resolve(null);
      };
      signal?.addEventListener("abort", w.onAbort, { once: true });
      this.queue.push(w);
      this.emit({ type: "waiting", sessionId: id, leaseId });
    });
  }

  private removeWaiter(w: Waiter): void {
    const i = this.queue.indexOf(w);
    if (i >= 0) this.queue.splice(i, 1);
    if (w.signal && w.onAbort) w.signal.removeEventListener("abort", w.onAbort);
  }
}
