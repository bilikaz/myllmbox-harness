// The Select user-resolution bridge — the React-free graph engine raises a pending selection, the UI
// (SelectModal) renders it and settles the Promise. Reuses the approval bridge's machinery
// (core/approvals.ts, `createRequestBridge`): same transient-runtime-state shape, different payload/answer.
// Pattern/ai resolution don't come through here (the engine fills those itself); this is the `source: "user"` path.

import { createRequestBridge, type PendingRequest } from "../approvals.ts";
import type { SelectAnswer, SelectSpec } from "./types.ts";

export interface PendingSelect extends PendingRequest<SelectAnswer | null> {
  spec: SelectSpec;
}

const selects = createRequestBridge<PendingSelect, SelectAnswer | null>();

// Raise a selection for the user to answer; resolves with their picks (or null if cancelled).
export const requestSelect = (sessionId: string, spec: SelectSpec): Promise<SelectAnswer | null> => selects.request({ sessionId, spec });

export function resolveSelect(pendingId: string, selected: string[]): void {
  const p = selects.pending().find((x) => x.id === pendingId);
  if (p) selects.resolve(pendingId, { id: p.spec.id, selected });
}

// null = cancelled (turn stopped / session gone) — mirrors denyApprovalsForSession.
export const cancelSelectsForSession = (sessionId: string): void => selects.cancelForSession(sessionId, null);
export const getPendingSelects = (): PendingSelect[] => selects.pending();
export const usePendingSelects = (): PendingSelect[] => selects.usePending();

if (import.meta.hot) {
  import.meta.hot.dispose(() => selects.pending().forEach((p) => p.resolve(null)));
}
