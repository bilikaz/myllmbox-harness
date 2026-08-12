# task6 — implementation

Build guide for [task.md](task.md).

## 1. Runner — `core/runner/engine.ts`

`AcquireOpts` gains `pin`, and `acquire` searches a pinned-first copy of the pool. Nothing else in the lease
logic changes.

```ts
export interface AcquireOpts {
  affinity?: boolean;
  background?: boolean;
  signal?: AbortSignal;
  pin?: string; // a modelKey — vault this model to the top of THIS session's candidate order (per-session
                // sequence swap). Not a hard pin: if it's busy the search spills to the next like any head.
}

// pinned slot to the front, rest in original order (no-op if absent / already first).
function pinFirst(pool: RunnerSlot[], key: string): RunnerSlot[] {
  const i = pool.findIndex((s) => modelKey(s) === key);
  return i <= 0 ? pool : [pool[i], ...pool.slice(0, i), ...pool.slice(i + 1)];
}
```

In `acquire`, after `const basePool = this.poolFor(service)`:

```ts
const pool = opts.pin ? pinFirst(basePool, opts.pin) : basePool;
// A pin is the explicit per-session preference → skip the stored affinity short-circuit so the pin wins over
// a stale KV binding; the reordered priority-fill below does the rest.
const binding = affinity && !opts.pin ? this.bindings.get(id) : undefined;
```

Everything after (`warm` check, `pool.find(free)`, `grant`, `wait`) stays — it now runs over the reordered
`pool`. The granted slot is still affinity-bound, so a pinned session re-warms its pinned model each turn
(the pin keeps it on top); when busy it spills, no wait.

## 2. LLM loop — `core/sessions/loop/llm.ts` `openSegment`

```ts
import { modelKey } from "../../config/llm.ts";
// …
const pinned = getSession(sid)?.meta.pinnedModel;
const lease = await this.app.runner.acquire("text", sid, getSession(sid)?.meta.usedTokens ?? 0, {
  background: isChild,
  signal: controller.signal,
  pin: pinned ? modelKey(pinned) : undefined,
});
```

`seg.callTarget = lease?.config` already flows the leased (pinned-or-spilled) model to the wire — no other
change. `pinnedModel` is `{ providerId, modelId }` and `modelKey({providerId, modelId})` matches
`modelKey(slot)`.

## 3. Composer — `pages/workspace/Composer.tsx`

The **non-gen (chat)** branch (currently a bare redirect button, ~line 358) becomes a picker fed by the
**assigned Chat pool**, so every option is a reorderable sequence member.

- Import `useRunnerPools` from `../../core/config/index.ts`; derive the chat options reactively:
  ```ts
  const pools = useRunnerPools();
  const chatOpts = (pools.text ?? []).map((s) => ({
    ref: { providerId: s.providerId, modelId: s.modelId },
    label: s.config.model.id ? `${s.config.provider.name} : ${s.config.model.id}` : s.config.provider.name,
  }));
  const chatPinned = session.meta.pinnedModel;
  const chatPinnedRef = chatOpts.find((o) => o.ref.providerId === chatPinned?.providerId && o.ref.modelId === chatPinned?.modelId)?.ref;
  const chatLabel = chatOpts.find((o) => o.ref.providerId === chatPinnedRef?.providerId && o.ref.modelId === chatPinnedRef?.modelId)?.label;
  ```
- Replace the chat redirect button with:
  - `chatOpts.length === 0` → the existing redirect button (`navigate("settings/providers")`, label
    `props.modelLabel || t("session.selectModel")`).
  - `chatOpts.length >= 1` → the same dropdown shape as the gen picker over `chatOpts` (each `onClick` →
    `setPinnedModel(session.id, o.ref)`), the button label = `chatLabel || props.modelLabel ||
    t("session.selectModel")`, **plus an "Add another model" row at the bottom** of the dropdown:
    ```tsx
    <button type="button" onClick={() => { navigate("settings/providers"); setPickerOpen(false); }}
      className="mt-1 block w-full border-t border-neutral-100 px-3 py-1.5 text-left text-sm text-amber-600 hover:bg-neutral-100">
      {t("session.addAnotherModel")}
    </button>
    ```
- Add the i18n key `session.addAnotherModel` (en + lt), e.g. "Add another model…" / the lt parity.
- The gen picker is untouched (it can grow the same link later; out of scope here).

## Touched files

`core/runner/engine.ts` · `core/sessions/loop/llm.ts` · `pages/workspace/Composer.tsx` · locale files
(`session.addAnotherModel`). No store/schema/persistence change (`pinnedModel` already exists).

## Verification

- `pnpm typecheck` green; `pnpm test` green.
- New runner unit test: with a 2-model text pool, `acquire("text", id, 0, { pin: modelKey(second) })` grants
  the **second** model when free; with the second saturated (its `c` seats taken), it **spills to the first**
  (no wait, non-null lease).
- Manual: a chat session with a 2-model Chat pool — pick the non-head model → the next turn's wire model is
  the pinned one (llm debug "turn" model); saturate it → spills; empty the Chat pool → the control redirects;
  the pin survives a reload (persisted).
</content>
