# Task 2 — Unify providers: 7 named pools, membership gated by input → output

## Goal

Collapse the two model-settings screens — **Provider** (chat/text) and **Media models**
(image/video/audio) — into **one "Providers" section**, and fix the capability model: a
model declares **what it outputs and what it accepts as input**, and that **gates which
use-case pools it can join**. Drop the hardcoded default model. Rename `ImageCompose` →
`ImageEdit`.

## Why

The split is a UI accident — the chat model is already a service in the same
`providers`/`services` registry as the media ones
([ADR-0042](../../adr/0042-unified-settings-registry.md)), just edited on its own screen in
a different shape. And the capability list conflated three axes into flat checkboxes
("Image generation / Image compose / Image recognition"). The clean model is **two axes —
output and input** — and the use-cases are **named pools** a model *qualifies* for based on
those axes. That's plain **capability gating**
([capability-gating](../../conventions/capability-gating.md)): the in/out declaration is
the capability, **pool membership is the gate** — enforced where you assign a model (it
only appears as an option in pools it qualifies for) and where a tool resolves one.

## The 7 pools

The pools are the assignable use-cases (each a priority-ordered list). A model declares
**output** (text/image/video/audio) and **inputs accepted** (each of text/image/video/audio,
**explicit — nothing assumed**: a transcriber may take only audio, a pure i2v model only
image). Its in/out then **filters** it into the pools it qualifies for — no role flag, no
`main`/`subAgent`: "chat" just means output=text and accepts text input, and **sub-agents
ride the same `text` pool** (the concurrency runner still reserves foreground capacity over
background sub-agent runs).

| Pool | Output | Inputs that qualify a model | Behavior by inputs at call time |
| --- | --- | --- | --- |
| **`text`** | text | text | — (sub-agent runs share this pool) |
| **`image`** | image | text (+image) | no image → generate · +image → **edit** (`/images/edits`) |
| **`video`** | video | text (+image / +video) | text → t2v · +image → **i2v** · +video → **v2v** |
| **`audio`** | audio | text | — |
| **`image-recognition`** | text | image (±text prompt) | image → text (describe) |
| **`video-recognition`** | text | video | — |
| **`audio-recognition`** | text | audio | transcriber — often audio-only |

**Gen-vs-edit and t2v/i2v/v2v are not pools** — they're endpoint/param choices driven by
the inputs present at call time. **Recognition is text-output + a media input**, kept as its
own pool so a dedicated describe model can differ from the chat one. A model qualifies for
several (a vision chat model → `text` *and* `image-recognition`).

## Scope

- **One "Providers" section**, tabs **Providers** (add providers + models) and **Use cases**
  (the 7 priority pools above).
- **Per-model editor becomes two visually-separated sections — Input and Output** (what it
  takes vs what it makes, at a glance): Input = Text · Image · Video · Audio (all explicit),
  Output = the produced modality. No role toggle. Text output reveals the **text knobs**
  (reasoning, thinking budget, max output, context reserve, image-max-dim) folded in from the
  old `ProviderSection`; image/video reveal max-size. Which pools a model can be assigned to
  is **derived** (gated) from its input/output.
- **Service/pool enum reorg** — `main`+`subAgent` → one **`text`** pool; `imageGen`+`imageEdit`
  → one **`image`** pool (the provider already picks the endpoint by whether references are
  passed); `videoGen`→`video`, `audioGen`→`audio`; the three recognition pools keep their
  role. `config.llm`, `resolveMediaProvider`, the concurrency runner, and each tool's service
  resolution follow the new keys.
- **Delete `ProviderSection`** + its "Provider" settings tab; rename the section to
  **"Providers."**
- **Drop the hardcoded default** — remove the seeded `"Default"`/`Holo-3.1-35B`/`"/llm"`/
  `services.main` from `DEFAULTS` in `settings.ts`. Top model per pool is the default; a
  fresh install has none → "configure a model."
- **Rename `ImageCompose` → `ImageEdit`** — tool file/class/advertised name (the **agent**
  sees this) + the label; both `ImageGenerate` and `ImageEdit` resolve the one `image` pool
  (Edit passes references → edit endpoint).
- **Provider dialects** — drop the bare `/generate` image dialect (obsolete; the boxes serve
  the OpenAI Images/Videos API) and **restore Anthropic + Gemini** as selectable (the merge
  had regressed the dropdown to openai/generate). `ProviderKind` = `openai | anthropic |
  gemini`; `providerCaps` gates the Output choices by dialect — **openai** → text/image/
  video/audio, **anthropic/gemini** → text only (media generation is OpenAI-API only).
- **Context length is settable + auto-carried** — the text knobs include a manual **Context
  length** input; `Detect` reads `max_model_len` from the `/models` card into
  `provider.modelLimits`, and **`addModel` carries that length onto a newly-added model** so
  the window (and the 10% reserve floor) works on the Detect→Add flow, not only after a
  re-detect. The manual field is the fallback for endpoints that omit the length.

## Decisions (settled in discussion — recorded)

- **D1 — Fresh install has no text model** (drop the `/llm`+Holo seed; configure your box
  first). Correct for bring-your-own-box.
- **D2 — Editor = two sections, Input + Output** (no role); pool membership derived (gated)
  from them. This is the heart of the unify.
- **D3 — Section name "Providers."**
- **D4 — `image` pool unifies gen + edit**; endpoint by input presence; a pool with several
  image models prefers one whose inputs support the operation.
- **D5 — Recognition kept as 3 pools** (image/video/audio → text).
- **D6 — `subAgent` folded into `text`** (no separate pool; sub-agents use the chat model;
  runner reserves foreground capacity over background runs).
- **D7 — `ImageCompose → ImageEdit`** changes the agent's toolset (renamed tool the LLM sees).
- **D8 — Drop the `/generate` dialect, restore Anthropic/Gemini** (surfaced in live review). Dialects
  are `openai | anthropic | gemini`; `providerCaps` gates outputs by dialect (openai → all,
  anthropic/gemini → text). The `generate.ts` image provider + its two dialect-only tests are deleted.
- **D9 — Context length settable + carried** (fixes a merge regression). Manual field + `Detect`
  pre-fill + `addModel` carries `modelLimits[wireId]`, so the window/10%-reserve works without a
  re-detect.

## Acceptance criteria (done-whens)

1. One "Providers" section, Providers + Use-cases tabs, the **7 pools**; no separate
   "Provider" tab, `ProviderSection.tsx` deleted.
2. The per-model editor is **two sections (Input / Output)**; a text model added under a
   provider, joined to the `text` pool, with its text knobs editable, drives chat as before
   (`config.llm` still derived from the pools; sub-agent runs use the `text` pool).
3. `imageGen`+`imageEdit` unified to `image`; no references → `/images/generations`, references
   → `/images/edits`, from the one pool.
4. `settings.ts` `DEFAULTS` has **no seeded provider/model/assignment**; a wiped install shows
   empty pools + "configure a model."
5. Recognition works from its own pools; `ImageDescribe`/`VideoDescribe` resolve them.
6. `ImageCompose` gone; `ImageEdit` everywhere (tool, registry, grounding, prompts, tests).
7. A model only appears as an option in pools its input/output qualifies it for (the gate).
8b. API dropdown offers **OpenAI / Anthropic / Gemini** (no `/generate`); a bare `/generate` provider
   can't be created; `generate.ts` deleted.
9b. Detecting a provider populates each model's **Context length** from the `/models` card, and adding
   a listed model keeps that length (window shows, 10% reserve engages); a manual field overrides.
8. `pnpm typecheck` + `pnpm test` green; chat + a configured image model work in web + Electron.
9. en/lt locale parity for all renamed/added strings.

## Out of scope (→ task 3)

- The **composer inline model picker** (pick a pool model at the input) and the
  **right-panel capabilities view** — they consume task 2's pools + capability model but
  ship with the generator.
- The generation sessions (Images/Videos sidebar sections, pinned target, Send-to-chat).
- Any new backend, sync, or gallery store.
