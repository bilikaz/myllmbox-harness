import { useSyncExternalStore } from "react";

import type { ToolCallRequest } from "../llm/types.ts";
import { createListeners } from "./storage/consumer.ts";

// The user-resolution bridge between the (React-free) driver/engine and the UI: raise a pending request,
// hand back a Promise, let the UI settle it — transient runtime state, never persisted. Tool approvals are
// the core case; the graph's Select bridge (core/graph/select.ts) reuses `createRequestBridge` with its own
// payload/answer types. (Folds into the session engine eventually — it's per-session-turn runtime.)

// The shape every pending request shares: an id, the owning session, and the resolver for its Promise. The
// concrete payload (a tool call, a selection spec) rides alongside on the subtype.
export interface PendingRequest<A> {
  id: string;
  sessionId: string;
  resolve: (answer: A) => void;
}

export interface RequestBridge<T extends PendingRequest<A>, A> {
  request(fields: Omit<T, "id" | "resolve">): Promise<A>;
  resolve(id: string, answer: A): void;
  // A queued Promise nobody can answer anymore must settle, or the awaiter hangs forever. Called on
  // Stop / session delete with the "cancelled" answer (false for approvals, null for selects).
  cancelForSession(sessionId: string, cancelled: A): void;
  pending(): T[];
  usePending(): T[];
}

// One reactive pending-list + promise-lifecycle, generic over the payload subtype `T` and the answer `A`.
export function createRequestBridge<T extends PendingRequest<A>, A>(): RequestBridge<T, A> {
  let state: T[] = [];
  const { subscribe, notify } = createListeners();
  const set = (next: T[]): void => {
    state = next;
    notify();
  };
  return {
    request(fields) {
      return new Promise<A>((resolve) => set([...state, { ...fields, id: crypto.randomUUID(), resolve } as unknown as T]));
    },
    resolve(id, answer) {
      const p = state.find((x) => x.id === id);
      if (!p) return;
      p.resolve(answer);
      set(state.filter((x) => x.id !== id));
    },
    cancelForSession(sessionId, cancelled) {
      const mine = state.filter((p) => p.sessionId === sessionId);
      if (!mine.length) return;
      mine.forEach((p) => p.resolve(cancelled));
      set(state.filter((p) => p.sessionId !== sessionId));
    },
    pending: () => state,
    usePending: () => useSyncExternalStore(subscribe, () => state, () => state),
  };
}

// ── Tool approvals — the core instance ────────────────────────────────────────

export interface PendingApproval extends PendingRequest<boolean> {
  call: ToolCallRequest;
}

const approvals = createRequestBridge<PendingApproval, boolean>();

export const requestApproval = (sessionId: string, call: ToolCallRequest): Promise<boolean> => approvals.request({ sessionId, call });
export const resolveApproval = (id: string, ok: boolean): void => approvals.resolve(id, ok);
export const denyApprovalsForSession = (sessionId: string): void => approvals.cancelForSession(sessionId, false);
export const getPendingApprovals = (): PendingApproval[] => approvals.pending();
export const usePendingApprovals = (): PendingApproval[] => approvals.usePending();

// HMR: resolvers belong to the old module instance and would otherwise leak as forever-pending Promises.
if (import.meta.hot) {
  import.meta.hot.dispose(() => approvals.pending().forEach((p) => p.resolve(false)));
}
