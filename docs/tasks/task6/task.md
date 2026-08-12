# task6 — Per-session model pin: swap the session's chat model

## Goal

Let a chat session **pick which model it runs on** from the composer, overriding the default. The pick is a
**per-session swap of the pool sequence** — the chosen model rides to the top of that session's `text` pool
priority; everything else (top-with-free-capacity, spill-down when busy, affinity/KV-warmth, backpressure) is
unchanged. It persists for the session.

## Why

Today a chat session always runs the **pool head** (the top model in Settings → Use cases → Chat), and the
composer's model control just **redirects to Settings**. A user who wants "run *this* session on the other
pool model" can't, without reordering the global pool for everyone. The pin is a *theoretical, per-session*
reorder: pick a pool model → it's virtually on top **for this session only** → the existing runner does the
rest.

## The model (already 80% built)

- `session.meta.pinnedModel: { providerId, modelId }` **already exists** and persists; `setPinnedModel(sid,
  ref)` sets it. It's currently honored only by **generation** sessions (engine.ts → `resolveModelRef` as the
  media target) and the composer picker is **gen-only**.
- The `text` pool is an ordered `RunnerSlot[]` (config/llm.ts); the concurrency **runner** leases over it —
  top slot with free capacity first, spilling down, with per-session affinity for KV warmth.
- **The pin is purely a reorder of that sequence for one session.** No hard pin, no waiting on the pinned
  model, no new lease path: if the pinned model is busy it spills to the next like any pool head. "No wait,
  no drama."

## Scope

- **Runner** (`core/runner/engine.ts`): `acquire` gains `pin?: string` (a `modelKey`). When set, the
  candidate pool is searched **pinned-slot-first** (a reordered copy); the stored affinity-binding
  short-circuit is skipped (the pin is the explicit preference). Everything else — `free()` capacity checks,
  spill, grant, the full-pool wait — is unchanged.
- **LLM loop** (`core/sessions/loop/llm.ts` `openSegment`): pass `pin: pinnedModel && modelKey(pinnedModel)`
  to `acquire`.
- **Composer** (`pages/workspace/Composer.tsx`): the chat (non-gen) model control becomes a **picker** fed by
  the **assigned Chat pool** (so every pick is in the sequence and reorders):
  - pool **empty** → the button redirects to Settings → Providers (today's behavior);
  - pool **≥1** → a dropdown of the pool's models (pick → `setPinnedModel`), with an **"Add another model"**
    link at the bottom → the same Settings redirect (a shortcut to today's behavior).
- **Persistence**: none new — `session.meta.pinnedModel` already persists per session.

## Out of scope

- Pinning a model **not** in the assigned pool (would need a resolve-and-prepend, and a stale-ref story) —
  the picker offers pool members only; "Add another model" grows the pool via Settings.
- Changing generation-session behavior (it keeps its direct-resolve path).

## Done-whens

1. Picking a chat model in the composer sets `session.meta.pinnedModel`; the session's next turns run on that
   model (verified: the runner leases the pinned slot when free).
2. When the pinned model is busy, the turn **spills to the next pool model** (no wait, no error).
3. Empty Chat pool → the control redirects to Settings; ≥1 → the picker lists them + "Add another model".
4. A pinned model removed from the pool falls back to the pool head (no crash; the picker shows the head).
5. Generation sessions unchanged. `pnpm typecheck` green; `pnpm test` green; a runner unit test covers
   "pin reorders the candidate order (pinned first, spills when busy)".
</content>
