# Task 2 — implementation report

Unify providers into one "Providers" section with 7 named pools gated by input → output.
Worked on the current branch; nothing committed.

## Per-area summary

### llm/types.ts
- MEDIA_SERVICES = ["image","video","audio","imageRec","videoRec","audioRec"] (6 non-text pools).
- ModelService = "text" | MediaService (the 7 pools). main+subAgent->text, imageGen+imageEdit->image, videoGen->video, audioGen->audio.
- SERVICE_MODALITY rekeyed (text->text, recognition->text, image/video/audio->own).

### core/settings.ts
- Model drops capabilities; adds output: Modality + input: {text?,image?,video?,audio?} (all explicit). No role field.
- Added exported qualifies(m): ModelService[] — the gate (output=text->text if input.text, +imageRec/videoRec/audioRec per media input; else [output]).
- slotOptions, pruneServices derive from qualifies(). providerCaps(api) now returns allowed OUTPUT modalities (generate->["image"], else all four) — feeds the editor's Output choices.
- DEFAULTS = { providers: [], services: {} } (D1 — no seed).
- chatView/chatOrNull read the text pool head. Removed the chat write-path (editMain, setChat*) and their facades (saveProviderBlock/saveModelBlock/saveProvider/detectModels) — ProviderSection is gone.
- resolvePools: reserve applies on the text pool (foreground headroom over background sub-agent runs); 0 elsewhere.
- addModel seeds by dialect: generate->{output:"image"}, else {output:"text", input:{text:true}}. updateModel prunes only — pool membership is set explicitly in the Use-cases tab, never auto-joined.

### config/pools.ts + core/runner/engine.ts
- No separate subAgent pool. A sub-agent run is a background lease on the text pool: AcquireOpts.background, Lease.background, Waiter.background thread through acquire/grant/release/wait/pump. free(slot, background) caps background at the open band c-reserve. affinityDefault = service === "text". Removed the RunnerRole type + its re-export.
- loop/llm.ts openSegment: leases runner.acquire("text", sid, tokens, { background: isChild }) and calls llm.call({ service: "text", target }).

### config/llm.ts
- input type gains text?. LLMConfigList auto-rekeys off the new ModelService.

### Tools
- Renamed core/tools/general/imageCompose.ts -> imageEdit.ts (git mv); class ImageCompose->ImageEdit, schema.function.name "ImageCompose"->"ImageEdit", canRun resolves "image".
- ImageGenerate resolves "image"; VideoGenerate resolves "video" (+requireSlot("video",...), service:"video").
- helpers/imageGeneration.ts resolves the one "image" pool once; endpoint still chosen by inputs presence (cosmos upsample only on the no-inputs generate path).
- imageDescribe/videoDescribe unchanged keys (imageRec/videoRec); "Media models" copy -> "Providers".
- imageLoad/videoLoad canRun resolve "text".
- service:"main"->"text" in naming.ts, compaction.ts, upsampler/cosmos.ts. ImageCompose ref notes in loop/llm.ts + store.ts -> ImageEdit.

### Settings UI
- ModelsSection.tsx: Use-cases tab lists the 7 pools (text first). ModelRow is now two visually-separated sections — Input (Text/Image/Video/Audio checkboxes) and Output (radio of allowed modalities) — with the text knobs (reasoning, thinking budget, max output, context reserve, image-max-dim, context-window display) folded in when output=text, and max-size for image/video. All strings under one providers.* block.
- Detection folded: Settings.detect(id) now uses listProviderModels (yields context lengths) for every provider and sets detected/modelLimits/per-model contextLength — replaces the old mediaModels path so the unified section covers text providers too. detectProviderModels(id) dropped its ctx param.
- Deleted pages/settings/ProviderSection.tsx. register.tsx: dropped the "provider" tab; the former "media" tab is now id "providers", title "Providers", route settings/providers. Composer.tsx navigates to settings/providers and resolves "image" for the ref-only attach path.

### Locales
- en.json/lt.json: one providers.* block (title "Providers", uc = the 7 pools; the `image` pool label is **"Image"** — it does gen+edit, so not "Image edit"; Input/Output section labels; folded text-knob keys). Dropped the provider.* and media.* blocks. imageDirHint "ImageCompose"->"ImageEdit". en/lt key parity verified (0 keys only in one side).

### Tests
- runner.test.ts: main/subAgent pools -> the single text pool with foreground vs { background: true }; reserve/open-band assertions preserved.
- settings.test.ts: rewritten for output/input + qualifies gate, explicit assignment, prune-on-losing-qualification, empty-DEFAULTS malformed-row hydrate.
- client.test.ts, generate-image-wire.test.ts, single-tool-calls.test.ts: old service literals ("main"/"imageGen"/"videoGen") and ImageCompose updated.

## Deviations / decisions
- Detection unified into detect(id) via listProviderModels (not spelled out in the guide): the merged "Providers" section now edits text providers too, so the per-provider Detect must yield context lengths. The old mediaModels/ctx.api path is no longer called from settings (the RPC still exists, now unused by this screen).
- providerCaps now returns Modality[] (allowed outputs) rather than a service list — it feeds the editor's Output radio; generate->image only.
- No auto-join on updateModel (old behaviour auto-added a ticked capability to its pool). Pool membership is explicit in the Use-cases tab; updateModel only prunes what stopped qualifying. Matches D2 and the empty-seed model.
- Reserve now applies to any text-pool model (previously only when a model sat in both main and subAgent), since sub-agent runs always share the text pool.
- Residual "main" string literals in App.tsx/pages/agents/register.tsx/lib/registry.ts are the UI layout Region type, not a model service — left as-is.

## Verification (honest)
- pnpm typecheck — green (tsc --noEmit, whole workspace).
- pnpm test — green: 217 passed / 217, 32 files.
- Residual grep over apps/desktop/src: no "main"/"subAgent"/"imageGen"/"imageEdit"/"videoGen"/"audioGen" service literals (only the UI Region "main"), no ImageCompose, no .capabilities.
- NOT done: no manual/runtime run of the web or Electron app (acceptance #2/#8 "chat + a configured image model work in web + Electron" was not exercised live — verified via typecheck + unit tests only). Detection against a real provider endpoint was not exercised.

---

## Amendments (post-review, still uncommitted)

### A1 — Dropped the `generate` dialect; restored Anthropic + Gemini as selectable
- llm/types.ts: ProviderKind is now just TextProviderKind (openai|anthropic|gemini); removed MediaApiKind.
- Deleted llm/providers/image/generate.ts (folder-factory resolves by provider.type; no provider is ever generate). Deleted its two tests (generate-image-wire.test.ts, generate-image-payload.test.ts) — they tested the removed dialect.
- llm/index.ts: dropped the MediaApiKind re-export.
- core/settings.ts: providerCaps -> openai allows [text,image,video,audio], anthropic/gemini allow [text] only (media gen is the OpenAI Images/Videos API). Removed the generate collapse in updateProvider and the generate branch in addModel (every dialect seeds {output:"text", input:{text:true}}). Removed the MediaApiKind import + re-export.
- ModelsSection.tsx: FLAVORS = [openai,anthropic,gemini] (typed ProviderKind); FLAVOR_KEY -> apiOpenai/apiAnthropic/apiGemini; removed the bare/GenerateSeedRow/bareHint path — Detect + AddModelRow always show.
- Locales en+lt: dropped providers.apiGenerate, providers.bareHint, providers.addDefaultModel (now unused); added providers.apiAnthropic ("Anthropic") / providers.apiGemini ("Gemini") (+lt).

### A2 — Manual "Context length" field + confirmed detect pre-fill
- ModelsSection.tsx: added a "Context length" number input to the text-output knobs (before System reserve), bound to m.contextLength via updateModel. Once set, the existing minReserve hint + contextLimit's 10% floor engage automatically (no other reserve-logic change).
- Confirmed Settings.detect() attaches contextLength correctly: it maps each provider model to { ...m, contextLength: modelLimits[m.modelId] } when the endpoint reports max_model_len for that wire id — no bug found. Endpoints that omit max_model_len now have the manual field as the fallback.
- Locales en+lt: added providers.contextLength + providers.contextLengthPlaceholder.

### A3 — Fix the detect→add regression (context length dropped on add)
A2 said detect() attaches contextLength "correctly, no bug" — true for the *detect-then-model-already-exists* path, but it missed the natural flow. The old single screen set the length on the selected model; the merged flow is Detect (fills `p.detected`/`p.modelLimits`) → **Add** a listed model, and `addModel` seeded the new model WITHOUT copying `p.modelLimits[wireId]`. Result: the added model had no `contextLength`, so no window showed and the 10% reserve couldn't engage until a manual re-detect. **Fix:** `addModel` now carries `p.modelLimits[wireId]` onto the seed when present. Detect-then-add and add-then-detect both populate the window now; the manual field remains the fallback for endpoints that omit `max_model_len`.

### Amendment verification (honest)
- pnpm typecheck — green.
- pnpm test — green: 207 passed / 207, 30 files (down from 217/32: the 2 deleted generate-dialect test files carried 10 tests). A3 re-verified: typecheck green, 207/207.
- Residual grep over apps/desktop/src: no generate/MediaApiKind/GenerateSeedRow/apiGenerate/bareHint residue; no ImageCompose; no .capabilities; the only "main" literals are the unrelated UI Region type.
- en/lt locale parity: 0 keys only-in-one-side.
- NOT done: no live web/Electron run (verified via typecheck + unit tests only).
