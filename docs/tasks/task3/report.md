# Task 3 — implementation report

Human-facing media generation as chat-like Images/Videos sidebar sections. Each turn produces media via
the media tools (not the LLM); results land in the transcript, walled from agent context, with
Send-to-chat as the one bridge. Per-session pinned model + generation knobs. Worked on the `task3`
branch (off main `4a808a9`); nothing committed.

## Process note — built by the session holder, no sub-agents

A first attempt delegated the implementation to a sub-agent; it lost the session's settled context and
left a broken, un-typechecked tree (Composer never touched, `target` passed to a prop it didn't accept).
That attempt was stopped and `git restore`d, and CLAUDE.md gained the rule "Implementation is the
holder's job — never delegated to a sub-agent." This entire task was then hand-built and verified at
milestones.

## Scope trimmed for v1

- **video = text→video only.** VideoGenerate has no reference parameter, so image-to-video / video-to-
  video are deferred. The video composer takes no attachment.
- **audio deferred** — no audio model to test yet; it's the natural 5th container type later (the pools
  and `containerTarget` already leave room for it).

## Per-area summary

### core/containers.ts
- `ContainerType` gained `"image" | "video"` (was `chat | local`).
- `containerTarget(type): ModelService` — total map: `image`→image, `video`→video, everything else
  (chat/local/undefined)→text. The composer's router; undefined→text so a session never mis-routes
  before its container resolves.

### llm/types.ts + core/tools
- `ToolCallRequest.target?: LLMConfig` — an explicit per-call model override, same plain-data lane as
  `mediaRefs`/`meta` (crosses IPC). `ToolRunCtx.target?` mirrors it; `registry.run()` threads
  `call.target` into the ctx.
- `runImageGeneration`/ImageGenerate/ImageEdit/VideoGenerate honour `ctx.target ?? this.requireSlot(...)`
  and pass `target` into `llm.call({...})` — so a pinned model runs instead of the pool head.

### core/settings.ts
- `resolveByRef(ref)` method + `resolveModelRef(ref)` facade — resolves a `{providerId, modelId}` pick
  directly to an `LLMConfig`, independent of pool priority (the pinned pick must run even if it isn't
  first in the pool, or isn't assigned at all).

### core/sessions
- `SessionRuntime` gained `pinnedModel?: {providerId, modelId}` and `gen?: {aspect?, quality?, duration?}`.
- store: `completeGeneration(sid, {images, videos})` (stamp aliases → fill the assistant placeholder →
  commit) and `failGeneration(sid, message)` (write reason into placeholder + `errorKind="other"` →
  commit); `setPinnedModel`/`setGen` (patch meta **and** notify so the composer re-renders).
- engine: `generate(text, atts)` — pushes the turn, sets streaming, picks the tool by pool
  (`VideoGenerate` | `ImageEdit` when refs present | `ImageGenerate`), builds args from `meta.gen`,
  resolves `meta.pinnedModel` to a call `target`, runs the tool directly (no LLM loop), then
  complete/fail; `stopGeneration(sid)` cancels the in-flight call. `genCalls` maps sid→callId.

### UI
- **SessionView**: `submit` branches on `containerTarget` — text → `sessions.send`, image/video →
  `sessions.generate`; stop routes to `stopGeneration` for gen sessions. Passes `target` +
  `consumesPending={!isGen}` to the main composer.
- **Composer**: generation mode (inline pool-model picker → `setPinnedModel`; aspect/quality/(video)
  duration knob bar → `setGen`, defaults from `getAppConfig()`); attach gating (image pool = ImageEdit
  reference, video = none); `canSend` needs a prompt + a configured model; consumes the Send-to-chat
  pending attachment (main chat composer only, avoiding a race with the child/agent/browser composers).
- **Sidebar**: Images + Videos blocks (network feature — available on web too, not gated on the
  filesystem), with image/video icons and add handlers.
- **ProgressPanel**: generation sessions show a CapabilitiesPanel (pinned model, output modality,
  accepted inputs, knob hint) instead of the token meter.
- **Message**: assistant-message media now renders (generation output is stamped there, not on a tool
  card) with Send-to-chat enabled.
- **SavableMedia**: optional `sendToChat` action.
- **core/ui.ts**: `sendMediaToChat` — reuse/create a chat container + session, stash a transient
  `PendingAttachment`, navigate; `consumePendingAttachment`/`usePendingAttachment`. The single seam out
  of a walled generation session — the user adds a prompt and sends, so media enters LLM context
  deliberately.

### locales
- en + lt, key-parallel: `gen.*` (knobs + placeholders), `capabilities.*`, `modality.*`, `sidebar.images/
  videos/newImages/newVideos`, `session.imageRefEdit/noGenRef`, `common.sendToChat`.

## Drift review — adjudication

The independent reviewer's [drift.md](drift.md) raised 7 findings (a strengthened re-review). Adjudicated
against the settled spec — all APPLIED; none reversed an approved decision, so no `fix-` docs (the fixes
align code TO the ACs / close real defects):

- **#1 (High, AC3 — no elapsed indicator): APPLIED.** A generation placeholder rendered a bare pulse —
  the "not a hung spinner" done-when was unmet and undisclosed. Added a `GenerationProgress` component
  (elapsed seconds ticking; video carries a "can take several minutes" hint), rendered by Message for a
  streaming generation placeholder; SessionView passes `generating`.
- **#2 (Medium — racy one-at-a-time guard): APPLIED.** The overlap guard ran before `await ensureLoaded`
  and `setStreaming` after it, so two same-frame submits could both pass and start parallel generations
  that corrupt each other's tail placeholder. `generate()` now claims **synchronously** —
  `setStreaming(sid, true)` immediately after the guard, before any await — so the second caller bails.
  Guarded by a double-submit test.
- **#3 (Minor — in-flight turn uncommitted, loses the prompt): APPLIED.** `generate()` now calls
  `commitMessages(sid)` right after `pushTurn`, persisting the user prompt at turn start (like chat) —
  AC2. The blank assistant placeholder is not committable, so a mid-video reload leaves the prompt with
  no stray blank bubble; no separate reload reconciliation is needed. (This supersedes my earlier
  rejection of the weaker v1 framing.)
- **#4 (Minor — Stop recorded as a failure): APPLIED.** `stopGeneration` now marks the session
  (`genCancelled`); on the aborted tool result `generate()` drops the blank placeholder via
  `dropGenerationPlaceholder` (prompt stays, no `errorKind`) instead of `failGeneration`. A user Stop is
  no longer indistinguishable from an error. Asserted in the stop test.
- **#5 (attach gating by pool, not model input): APPLIED.** The composer gates the ImageEdit attach on
  the resolved image model's `input.image` (`canRef`), not `pool === "image"`.
- **#6 (sendMediaToChat → first chat, not active): APPLIED.** Prefers the active chat container (when its
  type is `chat`), then the first chat, then creates one.
- **#7 (no engine generate() test): APPLIED.** Added `tests/generation-engine.test.ts` — a fake
  `ctx.tools` records the dispatched call: asserts ImageGenerate/ImageEdit/VideoGenerate selection, the
  pinned model threaded into `target`, the `references`/`mediaRefs` edit lane, result landing via
  completeGeneration, stop → `cancel(callId)` with no error, and the double-submit guard (only one
  generation runs).

## Verification

- `pnpm typecheck` — green.
- `pnpm test` — 218 tests / 33 files, green. New: `tests/containers.test.ts` (containerTarget mapping),
  `tests/generation-turn.test.ts` (completeGeneration lands media + stamps aliases; failGeneration
  records reason + flags error), `tests/generation-engine.test.ts` (engine `generate()` tool selection +
  target threading + edit lane + stop), and a `resolveModelRef` canary in `tests/settings.test.ts`
  (pinned pick resolves by ref, independent of pool membership).
- `pnpm build` (web) — green.
