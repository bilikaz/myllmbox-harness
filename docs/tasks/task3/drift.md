# Task 3 — drift review (`drift.md`)

Reviewer: independent drift reviewer, fresh context. Reviewed the completed work (working tree on `task3`,
uncommitted, off `4a808a9`) against the settled context — `task.md`, `implementation.md`, `report.md`,
the ADRs/conventions the checklist names — and read the whole diff as a code/design review. Findings are
proposals for the builder to adjudicate (*Settle, then move*); ordered by severity. A couple were found
only by tracing the committed code paths (concurrency, stop, persistence), not the diff alone.

## Findings

### 1. [High — done-when 3 not met] No elapsed-time / typical-duration indicator for generation
- **Files:** `apps/desktop/src/pages/workspace/Message.tsx`, `apps/desktop/src/core/sessions/engine.ts`
- **Why it matters:** `task.md` AC3 / `implementation.md` require video generation to show *"an elapsed-time /
  typical-duration indicator … **not a hung spinner**."* A generation turn only sets the generic `streaming` flag;
  the empty assistant placeholder (`text:""`) renders as an empty `<Markdown>` with a single `animate-pulse`
  cursor. A sweep of `src` finds zero timers/elapsed logic. This is the hung-spinner case AC3 forbids; with a
  multi-minute video the user can't tell it's alive. `report.md` doesn't disclose the drop.
- **Fix direction:** render an elapsed-time counter (+ a "typical ~N s" hint from `cfg.videoGen/defaultDurationS`)
  on the streaming generation placeholder — a tiny timer component, not the bare pulse. Decide the image case (fast,
  optional).

### 2. [Medium — concurrency] `generate()`'s one-at-a-time guard is racy (double-submit corruption)
- **Files:** `apps/desktop/src/core/sessions/engine.ts`
- **Why it matters:** the overlap guard `if (getStreamingIds().has(sid)) return;` runs **before** `await
  ensureLoaded(sid)`, and `setStreaming(sid, true)` is set only **after** that await. Two `submit()` calls that
  both pass the guard before the first sets streaming (two keydown/click events in the same frame see the same
  `streaming=false` closure) start **two parallel generations**, each `pushTurn`-ing a user+placeholder pair and
  each `completeGeneration`/`failGeneration` targeting `messages.length - 1` — so whichever tool resolves first can
  fill or fail the *other* turn's placeholder, leaving a blank first placeholder and a mangled transcript.
- **Fix direction:** make the claim atomic — check *and* set a synchronous in-flight marker (e.g. read `setStreaming`
  before the first `await`, or `if (streamingIds.has(sid)) return; streamingIds.add(sid)` up front) so the second
  caller is rejected before it can interleave.

### 3. [Minor — persistence] In-flight generation turn is never committed until the tool resolves
- **Files:** `apps/desktop/src/core/sessions/engine.ts`, `apps/desktop/src/core/sessions/store.ts`
- **Why it matters:** `pushTurn` adds the user prompt + blank placeholder but only `completeGeneration`/`failGeneration`
  call `commitMessages`. A reload/crash during the (long) video tool call loses the **whole turn including the user's
  prompt** — chat commits the user message early, so this is a much longer exposure on the generation path and undercuts
  "persists like a chat" (AC2).
- **Fix direction:** commit the user turn as soon as it lands; on reload, drop a still-blank generation placeholder
  (it has no error and no media) rather than persisting nothing / a stray blank.

### 4. [Minor — stop semantics] A user Stop is recorded as a failure
- **Files:** `apps/desktop/src/core/sessions/engine.ts`, `store.ts`
- **Why it matters:** `stopGeneration` → `ctx.tools.cancel` aborts the tool; `tools.run` returns a non-ok
  `ToolResult` (never throws), so `generate()` falls into `failGeneration(sid, output)`, writing a "cancelled"
  message and `meta.errorKind = "other"`. A user-initiated Stop is thus indistinguishable from an error in the
  roster/resume affordances ([ADR-0014 stop semantics]).
- **Fix direction:** distinguish cancel from failure — on abort, write the turn as stopped (no `errorKind`) or drop the
  placeholder, rather than flagging "other".

### 5. [Minor — spec drift] Generation attach gating keys on the pool, not the pinned model's capability
- **Files:** `apps/desktop/src/pages/workspace/Composer.tsx`
- **Why it matters:** `task.md`/`implementation.md`: attach gated by the pinned (target) model's `input`, "hidden for a
  text→image model, shown for edit-capable / i2v-capable." The code gates on `pool === "image"` and never reads
  `model.input`; a pure text→image model pinned to an image session still shows attach and routes to ImageEdit it can't
  accept — an offered-but-impossible action (the `canRun()`-at-both-boundaries lens).
- **Fix direction:** gate `addAttachments` + the attach button on the pinned-or-pool-head image model's `input.image`.

### 6. [Minor — spec drift] `sendMediaToChat` targets the first chat, not the active chat
- **File:** `apps/desktop/src/core/ui.ts`
- **Why it matters:** `task.md` contract: "defaults to the active chat". Code uses `getContainersByType("chat")[0]`
  — always the first chat, never the active one.
- **Fix direction:** prefer the `active` chat container before the first-chat fallback, then create.

### 7. [Minor — verification gap] No test exercises the engine's `generate()` turn
- **Files:** `apps/desktop/tests/generation-turn.test.ts`, `tests/containers.test.ts`, `tests/settings.test.ts`
- **Why it matters:** new tests are store-level canaries; the engine's `generate()` — tool selection, `pinnedModel →
  request.target` threading, the `mediaRefs` edit lane, `stopGeneration` → `tools.cancel` — is untested, so the
  highest-risk wiring (and the race in finding 2) has no guard.
- **Fix direction:** an engine-level test with a fake `ctx.tools.run` (assert chosen tool name, `target`, `mediaRefs`,
  and that the result message lands), plus a stop test asserting `cancel` is called; ideally a double-submit test that
  proves only one generation runs.

## Summary

| # | Sev | Area | Finding |
| --- | --- | --- | --- |
| 1 | High | AC3 | No elapsed-time/typical-duration indicator — bare `animate-pulse` (the "not a hung spinner" done-when) |
| 2 | Medium | engine | One-generation guard racy (guard before `await`): double-submit can run two parallel generations & corrupt the tail placeholder |
| 3 | Minor | engine/store | In-flight turn uncommitted until completion — reload mid-video loses the user prompt |
| 4 | Minor | engine/store | User Stop recorded as `errorKind other` (cancel ≠ failure) |
| 5 | Minor | Composer | Attach gating by pool, not pinned model's `input` capability (spec drift) |
| 6 | Minor | ui.ts | `sendMediaToChat` targets first chat, not active chat (contract drift) |
| 7 | Minor | tests | `generate()` engine branch untested; #2's race has no guard |

No hard blockers (no path is fully broken), but #2 is a real corruption risk on double-submit and worth fixing
before commit. Findings are proposals — a no-history reviewer can be wrong; the builder adjudicates each.

## Builder adjudication (Settle, then move)

All 7 APPLIED (none reversed a settled decision → no `fix-` docs). Verified: typecheck + 219 tests +
web build green.

- **#1** — `GenerationProgress` elapsed-time indicator (Message.tsx) for streaming generation
  placeholders; video carries a slow-hint. SessionView passes `generating`.
- **#2** — `generate()` now claims synchronously: `setStreaming(sid, true)` immediately after the guard,
  before any `await`, so a same-frame second submit bails. Guarded by a double-submit test.
- **#3** — `generate()` calls `commitMessages(sid)` right after `pushTurn` (persists the prompt at turn
  start, like chat). The blank placeholder isn't committable, so a reload leaves no stray blank.
- **#4** — `stopGeneration` marks `genCancelled`; the aborted tool result drops the placeholder
  (`dropGenerationPlaceholder`, no `errorKind`) instead of `failGeneration`. Stop ≠ error.
- **#5** — Composer gates the ImageEdit attach on the resolved image model's `input.image` (`canRef`).
- **#6** — `sendMediaToChat` prefers the active chat container, then first chat, then creates.
- **#7** — added `tests/generation-engine.test.ts` (tool selection + `target` threading + edit lane +
  stop/cancel + double-submit guard).
