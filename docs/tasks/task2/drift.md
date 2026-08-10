# Task 2 — drift review

Reviewed fresh against `task.md` · `implementation.md` · the settled context — the code diff as a
stranger, the surface as a user, and the docs as the "current truth" map. Verification was re-run
independently: `pnpm typecheck` green, `pnpm test` **207/207 green (30 files)**, en/lt locale
key parity **0 keys only-in-one-side**, and a residual grep over `apps/desktop/src` for
`main`/`subAgent`/`imageGen`/`imageEdit`/`videoGen`/`audioGen`/`ImageCompose`/`.capabilities`/
`MediaApiKind`/`generate` service residues is clean — the only `main` literals left are the unrelated UI
`Region` type. The core refactor is sound; the findings below are proposals, not commands.

No blocker.

## Findings (by severity)

### 1. (minor — test coverage) The A2/A3 context-length fix has no canary
**Files:** `core/settings.ts` (`detect`, `addModel`) · `tests/settings.test.ts`
The narrative of D9/A2/A3 is explicitly *the point* of the change — `detect()` attaches
`contextLength` from `/models` `max_model_len` into `provider.modelLimits`, and `addModel` carries
`p.modelLimits[wireId]` onto a freshly-added model so the window + 10% reserve work on the Detect→Add
flow. Both branches are implemented in code and read correctly, **but neither has a test**. A regression in
either (the exact bug A3 fixed) would pass CI silently. `tests/settings.test.ts` drives the
gate/qualifies/assign/prune paths well but nothing touches `contextLength`/`modelLimits`.
**Fix direction:** add a unit test that seeds `provider.modelLimits = { chat-1: 65536 }` and asserts
`addModel(pid, "chat-1")` yields a model with `contextLength: 65536`; optionally a canary that a
`detect()`-style attach maps the limit onto an existing model. Both are network-free (no `listProviderModels`
needed) and would guard the regression.

### 2. (minor — docs drift) The architecture map + ADRs still describe the old 9-service model / ImageCompose
**Files:** `docs/architecture/tools.md` (ImageCompose; `imageGen`/`imageEdit` slots) ·
`docs/architecture/runner.md` (`main`/`subAgent` pools, `role = isChild ? "subAgent" : "main"`,
reserve on both-list models) · `docs/architecture/llm.md` (service vocabulary with `main`/`imageGen`/
`imageEdit`/`videoGen`/`audioGen`) · `docs/adr/0065-per-service-priority-pools.md`
(`subAgent` as a `ModelService`, main/subAgent roles) · `docs/adr/0076-image-edit-service-and-referenceable-images.md`
(`imageEdit` as its own service, `ImageCompose` — **now fully superseded** by the `imageGen+imageEdit→image`
unification) · `docs/adr/0028-llm-client-service-calls.md` (`imageGen` service) ·
`docs/adr/0066-concurrency-runner.md` (role `main`/`subAgent` from `isChild`)
The code now ships 7 pools (`text`/`image`/`video`/`audio`/`imageRec`/`videoRec`/`audioRec`),
a background-vs-foreground reserve on the single `text` pool, and `ImageEdit`; `ImageCompose` is gone.
Substantive `subAgent`-the-*concept* references (ADR-0022/0058/0060/0061/0073, agents.md) are
correct about child *sessions* and should **not** change — only the ones that name the removed model-service /
pool / tool. Per the documentation convention ("the map is current truth — no transient scars", rule 2), ADR-0076
is a candidate for archive-with-a-stub (its `imageEdit`-service decision no longer exists), and the remaining
descriptions should be re-keyed to the 7 pools. Not in task2's coded scope, but this is the drift brief's
explicit docs-drift class.

### 3. (minor — design/UX) Fresh install lands on the "Use cases" tab with no way forward
**File:** `pages/settings/ModelsSection.tsx` (`const [tab, setTab] = useState<"useCases" | "providers">("useCases")`)
On a wiped store (the now-empty `DEFAULTS`, D1), the section opens on "Use cases": seven all-empty pools,
each showing `providers.noModels`, and **no add-provider affordance on that screen**. A first-run user must find
the "Providers" tab to begin. Given D1's "configure your box first" posture, defaulting to the **Providers**
tab (or adding an empty-state CTA on the Use-cases tab) matches the intended first-run flow better. The task
spec lists "Providers … and Use cases" without pinning the default, so this is a UX judgement call.

### 4. (minor — latent state) Switching a provider's dialect doesn't reconcile model output to the new caps
**File:** `core/settings.ts` (`updateProvider`, `providerCaps`)
`updateProvider` now maps `{ ...p, ...patch }` with no collapse, so a provider flipped openai → anthropic
keeps any `output:"image"` model. The Output radio for anthropic/gemini then offers only `text`, leaving that
model with **no radio selected** until the user re-picks. The UI can never *create* an image model on a
non-openai provider, so this is unreachable through the normal flow — latent inertia, not a live bug. The old
`generate` collapse was intentionally deleted (report: "no collapse"), which is right; consider instead an
`updateProvider` reconcile that clamps a model's `output` to the new dialect's caps (or a guard in the editor)
so the stored state can't disagree with the radios.

### 5. (note) D4's "a pool with several image models prefers one whose inputs support the operation" isn't implemented
**File:** `core/settings.ts` (`qualifies`) · `core/tools/helpers/imageGeneration.ts`
The `image` pool head is used for both `/images/generations` and `/images/edits` regardless of per-model
input declarations; there is no per-model preference by whether the operation's inputs are supported. In practice
this is moot — only `openai` providers can carry `output:"image"`, and every openai-image provider exposes both
endpoints — so it's recorded as a note, not a defect. If a future non-openai or edit-less image model appears,
D4 becomes load-bearing.

### 6. (note) `detect()` writes `contextLength` to media models too
**File:** `core/settings.ts` (`detect`)
It maps `modelLimits` onto **every** existing model whose wire id reports a length, including `output:"image"`/
`"video"` models, not just the text chat model. Harmless today (`contextLength` is only read for text-output
knobs), but it is slightly over-broad; scoping to the text chat model (or models with `output:"text"`) would
be tighter.

## Summary

| # | Severity | Area | Finding |
| --- | --- | --- | --- |
| 1 | minor | tests | A2/A3 context-length carry + detect-attach have no test canary (the exact regression A3 fixed) |
| 2 | minor | docs drift | architecture/tools·runner·llm + ADR-0065/0076/0028/0066 still describe `main`/`subAgent`/`imageGen`/`imageEdit`/`ImageCompose`; ADR-0076 superseded |
| 3 | minor | design | fresh install defaults to the empty Use-cases tab; Providers-tab-first fits D1 first-run |
| 4 | minor | code (latent) | dialect switch doesn't reconcile stored `output` to new caps — radios can disagree |
| 5 | note | code | D4 "prefer a model whose inputs support the op" not implemented (moot today) |
| 6 | note | code | `detect()` sets `contextLength` on media models too (harmless) |

Also of note: `report.md` says the locale `uc` block carries an **"Image edit"** label — the built label is
`"Image"` (verified; correct for the unified pool, and no "compose" label survives anywhere). Either adjust the
pool label to "Image edit" to match the report / D7 wording, or correct the report line; the built "Image" is the
better choice for a gen+edit pool.

---

## Adjudication (builder)

Findings handled per *Settle, then move* — re-verified after: `pnpm typecheck` green, `pnpm test` **209/209** (the 2 new canaries).

| # | Verdict | Action |
| --- | --- | --- |
| 1 | **applied** | Added `tests/settings.test.ts` → "context length + dialect reconcile": `addModel` carries `modelLimits[wireId]` (the A3 regression canary) + a wire id with no limit stays unset. |
| 2 | **deferred → docs pass** | Real, and it's the docs-drift class — but map/ADR updates run in the end-of-session docs pass, not mid-build. Queued: re-key `architecture/tools·runner·llm` + ADR-0028/0065/0066 to the 7 pools; **archive-with-stub ADR-0076** (its `imageEdit`-service decision is superseded); leave the `subAgent`-*session* references (ADR-0022/0058/0060/0061/0073, agents.md) untouched. |
| 3 | **applied** | `ModelsSection` opens on the **Providers** tab when there are no providers (first-run D1 flow); Use-cases otherwise. |
| 4 | **applied** | `updateProvider` clamps each model's `output` to the new dialect's `providerCaps` on an api change (openai→anthropic drops image→text) — stored state can't disagree with the Output radio. Canary added. |
| 5 | **recorded, no fix** | D4's per-model input-preference within the `image` pool is **moot by design**: `providerCaps` gates anthropic/gemini to text-only, so image output is OpenAI-dialect only and a non-OpenAI image model can't exist. The one residual trigger — a gen-only OpenAI image endpoint ranked *above* an edit-capable one in the same pool — takes a deliberately odd config (every real box does both). Revisit only if that arises. |
| 6 | **applied** | `detect()` now stamps `contextLength` only on `output==="text"` models. |

Also: corrected `report.md` — the `image` pool label is "Image" (not "Image edit"); "Image" is right for a gen+edit pool.
