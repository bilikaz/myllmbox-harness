# Similarity map — candidates for consolidation

A survey of classes/singletons that do structurally-similar things, grouped into **families**. Each family
names the shared shape (the candidate abstraction), lists members with declaration + key methods, and marks
where they genuinely diverge (the part an abstraction must keep pluggable). Ranked by consolidation payoff.

Legend: **✦** = near-identical twin (highest-value merge) · **⊕** = same shape, real divergence (extract a
base/helper, keep the differences) · **≈** = same idea, different enough that a shared *helper* (not a base)
is the win.

---

## Family 1 — The state-store idiom ✦ (BIGGEST repeat: ~15 copies, 2 templates + 2 exact twins)

Every reactive store wraps `createListeners()` (`core/storage/consumer.ts`). Two templates + a base class.
This is the loudest "doing the same thing many times" in the codebase.

### Template A1 — hand-rolled transient module singleton (no persistence)
Verbatim skeleton each file repeats:
```ts
let state = <initial>;
const { subscribe, notify } = createListeners();
export const getX = () => state;
export function mutateX(...) { state = next; notify(); }
export const useX = () => useSyncExternalStore(subscribe, () => state, () => state);
```
| Member | file | State | Notes |
|---|---|---|---|
| approvals | `core/approvals.ts:17` | `PendingApproval[]` | ✦ twin of select — `request→Promise / resolve / denyForSession / use / HMR-dispose` |
| select bridge | `core/graph/select.ts:18` | `PendingSelect[]` | ✦ twin of approvals — same 5 members, same HMR-dispose |
| llm config | `core/config/llm.ts:35` | `LLMConfigList` | ✦ twin of pools — `get / getOne(service) / write(patch) / use` |
| runner pools | `core/config/pools.ts:27` | `RunnerPools` | ✦ twin of llm — same 4 members |
| runner status | `core/runner/status.ts:10` | `Record<sid,leaseId>` | `applyRunnerEvent / getWaiting / useWaiting` |
| profile | `core/profile.ts:29` | `Profile` | diverges: **localStorage**-backed (sync read before ctx.storage) |
| ui (lightbox + pending) | `core/ui.ts:33,59` | url / attachment | two independent A1 stores in one file |

### Template A2 — engine-backed hydratable CRUD store
A1 + `let data: StorageEngine|null`, `setXStorage`/`initX`, `hydrateX()` (seed-on-empty), `createX/updateX/deleteX` (repo put/remove → splice array → notify), `getXHydrated`, hooks.
| Member | file | Divergence from canonical |
|---|---|---|
| containers | `core/containers.ts` | **the clean canonical form** |
| agents | `core/agents.ts` | adds a code-registry (`pluginAgents`); async persist via private `persist(id)` |
| sessions | `core/sessions/store.ts` (884 lines) | heavy outlier — commit-on-landing, media externalization, ~40 mutators, hooks split to `sessions/hooks.ts` |

### Template B — `Consumer<T>` subclass (persisted as one `settings` row)
`class X extends Consumer<State>` + `constructor(ctx){ super(ctx, KEY, DEFAULTS) }`, `override notify()` busting a `cached`, `effective()` = validate(deepMerge(defaults, state)), `commit()`-based commands, `initX(ctx)` news the singleton, no-instance-resilient facades.
| Member | file | Divergence |
|---|---|---|
| Settings | `core/settings.ts:160` | only one that **fans out** (`writeLLMConfig`+`writeRunnerPools`) + overrides `parse` |
| AppConfig | `core/config/app.ts:91` | `effective()`=validate(merge(CONFIG_DEFAULTS, overrides)) |
| PluginsConfigStore | `core/plugins/config.ts:18` | `effective()` iterates the **registry**, not stored rows; `setEnabled` side-effects `invokePlugin` |
| UiPanel | `core/ui.ts:13` | trivial (one bool, no cache) |

**Consolidation:** (1) merge the two exact twins first (`approvals`≡`select`; `config/llm`≡`config/pools`) into one generic factory. (2) A `createStore()` / `createCrudStore()` factory would collapse A1/A2. (3) `Consumer<T>` already exists as the base for Template B — the win there is only killing the boilerplate `cached`/`effective`/facades via a small helper. `sessions/store.ts` is the one that resists genericization — leave it.

---

## Family 2 — "The folder IS the registry" ⊕ (~6 copies + a literally-duplicated regex)

Everyone globs a folder and builds a map. The `/plugins\/([^/]+)\//` slug regex is **copy-pasted** into
`registry.ts:14`, `pluginServices.ts:20`, and all 3 boot loaders.
| Member | file | Keyed by | Value | Notes |
|---|---|---|---|---|
| `ToolRegistry` | `core/tools/registry.ts:17` | exported name (`schema.function.name`) | **factory** (deferred `new`) | only mutable one (`register`/`unregister`); `instanceof BaseTool` filter; skips `base.ts` |
| provider registry | `llm/client/index.ts` `PROVIDER_MODULES` | **file path** (`providers/<modality>/<type>`) | ctor | no class — glob map + 2 lookup fns; no gating |
| engine tools | `core/tools/engine/dispatch.ts:14` | `schema.function.name` | **singleton instance** (built once) | `instanceof BaseEngineTool` filter |
| plugin services | `electron/pluginServices.ts:18` | slug (path regex) | raw module | no instantiation |
| plugin manifests | `core/plugins/boot.ts:13` | slug | manifest | one-shot side-effecting registration |
| plugin graphs | `core/plugins/boot.ts:23` | `slug:file` | `BaseGraph` instance | `instanceof BaseGraph` filter, tags slug/file |
| plugin agents | `core/plugins/boot.ts:43` | ownerPluginId | agent rows | tags owner |
| graph registry | `core/graph/registry.ts` | id | `BaseGraph` | `registerGraph`/`getGraph`/`listGraphs` — "mirrors the tool registry" |

**Consolidation:** at minimum extract the slug regex to one helper (`ownerFromPath`). Bigger: a
`globModules(pattern, { key, filter?, build? })` primitive that all six call — differing only in key-fn,
instanceof filter, and build (factory vs singleton vs raw).

---

## Family 3 — Base hierarchies that re-derive each other's shape ⊕

Three parallel abstract-base trees with the **same conceptual shape** — *identity/schema + availability gate
+ a work method + a default permission* — but no shared root. `BaseEngineTool` most notably re-implements the
`BaseTool` shape without inheriting it.

| Base | file | Shape | Concrete leaves |
|---|---|---|---|
| `BaseTool` | `core/tools/base.ts:20` | `(config, container)`; `schema`(static)/`execute`/`canRun`/`isPermissioned`/`defaultPermission`/`calculatePermission` | 20+ leaves |
| ↳ `BaseWorkspaceTool` | `local/base.ts:42` | +permissioned +Local-only +path-confinement | Read/Write/Grep/… (15) |
| ↳ `BaseGeneralTool` | `general/base.ts:7` | +`requireSlot` helper | ImageGenerate/Edit, VideoGenerate |
| ↳ `BaseDatabaseTool` | `plugins/database/…/base.ts:11` | extends **BaseTool** to escape the Local gate | Query/Connections/Test |
| ↳ `ComicsGenerateBase` | `plugins/comics/…/base.ts:49` | workspace + budgeted-generation template (`kind`/`refsRule`/`arrange`) | Mascot/Panel |
| `BaseEngineTool` | `engine/base.ts:34` | **separate tree** — `(EngineCtx)` not config; `schema`/`run(call,ec)`/`available`/`defaultPermission`/`childSafe` | agents×6, browser×4 |
| `BaseProvider` | `llm/providers/base.ts:13` | `(target, callCtx)`; `call`/`defaultHandler`/`request`/`prompt` | — |
| ↳ `BaseTextProvider` | `text/base.ts:8` | +`stream`/`demuxInlineThink`/`tools` | anthropic/gemini/openai |
| ↳ `BaseImageProvider` | `image/base.ts:8` | +`generate`/`edit`/`inlineUrl` | openai-image |
| ↳ `BaseVideoProvider` | `video/base.ts:17` | +`submit`/`poll`/`content` | openai-video |
| `BaseGraph` | `core/graph/base.ts:44` | `getId`/`entry`/`nodes`/`needsWorkspace` | plugin graphs |

**Observation:** `BaseTool` and `BaseEngineTool` share "schema + work + availability gate + defaultPermission"
but are dispatched by two different mechanisms (registry+runner vs `dispatch.ts`+`runEngineTool`). Worth asking
whether the engine tier can become a `BaseTool` flavor whose "container" is the `EngineCtx` — collapsing two
dispatch paths into one. Provider bases are a healthy template-method tree; leave them.

**Observation 2 — two entangled axes in the tool tree.** `BaseWorkspaceTool` bundles *permissioned* + *Local-only*
+ *path-confinement* together, so any tool that wants "permissioned but runs in any container" has to skip it and
`extend BaseTool` directly, re-declaring `isPermissioned()→true` by hand: **`Fetch`** (general), **`McpTool`**,
**`DatabaseQuery`** all do exactly this. That's three tools opting out of the base because permission and
container-scope aren't separable. Candidate: make them **orthogonal** — an `isPermissioned` flag/mixin and a
container-gate (`requiresLocal`) that compose, instead of `BaseWorkspaceTool` being the only door to policy.

---

## Family 4 — The three text providers ⊕ (textbook template-method; already based)

`anthropic.ts:154` / `openai.ts:133` / `gemini.ts:122` — all `class Provider extends BaseTextProvider`, one
`stream()` forwarding to a module `stream<Name>()`, one static `listModels`. **Already** share the base;
what's still duplicated per file is a **same-named helper set with different bodies**: `reasoningFields(target)`,
`toXMessages/toXContents`, a url/version helper, and the SSE accumulate-loop skeleton.
**Diverge (must stay pluggable):** auth (header vs bearer vs query-param), URL/version, wire message format
(content-blocks vs flat vs parts), stream decode (event-typed vs delta-diff vs parts-array), tool-call ids
(server vs client-minted), reasoning encoding, usage field names, max_tokens policy, listModels response shape.
**Consolidation:** low — this is intended divergence. Only shared *helpers* (a common SSE-accumulate driver
parameterized by a small mapper) would pay off; don't force more.

---

## Family 5 — Plugin service singletons ⊕

`plugins/mcp/service.ts` and `plugins/database/service.ts` — both `ServiceModule`
(`pluginServices.ts:9`): a module-level `Map<name, liveHandle>`, `sinks: Set<Emit>` + `subscribe(emit)` +
private `notify()` emitting `("connections", [...keys])`, `rpc { connect, disconnect, status }`, `install()`
no-op + `uninstall()` disconnect-all, and one open-or-reuse funnel (`connect` / `resolve`).
**Diverge:** MCP adds `bindRegistry` (mutates the ToolRegistry at runtime) + `refresh`/`tools` rpc + OAuth;
DB has no registry (static-globbed tools) + drivers + `probe()`.
**Consolidation:** a `createConnectionService({ open, close })` base capturing the Map + sinks + notify +
lifecycle + the three rpc verbs; MCP/DB supply only `open`/`close` and their extra verbs.

---

## Family 6 — Promise-returning user-resolution bridges ✦ (subset of Family 1, but a distinct pattern)

`approvals.ts` and `graph/select.ts` are more than store-twins — both implement *"emit a pending request,
return a Promise the UI settles, cancel orphans on session stop, expose a `use*` hook, dispose on HMR."*
This is a reusable primitive (`createRequestBridge<Req,Res>()`) on its own.

---

## Family 7 — Feature engines ≈

`SessionEngine` (`sessions/engine.ts:71`) and `GraphEngine` (`graph/engine.ts:16`): both `constructor(ctx)`,
both hold a `Map<sid, live>` of loops, both `start/stop/kill` + "route command to resident-loop-or-construct".
`GraphEngine` is deliberately thin and delegates real turns back into `SessionEngine`. Shared *shape* but
very different weight — a shared base is probably not worth it; note the parallel and keep the thin/fat split.

---

## Family 8 — Dispatch/execute seams ≈

`ToolRunner.run` (`runner.ts` — resolve + track AbortController + run), `runEngineTool` (`dispatch.ts` —
childSafe + mode-0/1 approval + abort + run), and the loops' `dispatch()` (llm & graph). All are "run a resolved
call, emit the same `tool:calls`/`tool:result` bus events, return a result." The gating lives in different
places (registry `filter()` vs `runEngineTool` inline vs loop approvals). If Family 3's "engine tools become a
BaseTool flavor" lands, these two seams could become one.

---

## Family 9 — Small, mechanical dups ✦

- `imageHandler` ≡ `videoHandler` (`llm/responseHandlers/{image,video}.ts`) — byte-identical except the error
  string. One `mediaHandler(kind)`.
- The slug regex (see Family 2) copy-pasted 5×.
- `WireConfig`/gateway forwarding declared 3× across `bridge.ts`/`preload.ts`/`ipc.ts` per channel (inherent to
  the electron IPC split, but a codegen/helper could dedupe channel plumbing).

---

## Family 10 — Per-call context carriers ≈ (recognize, probably don't merge)

`Segment` (llm), `SessionCapabilities` (system), `NodeCtx`/`Step` (graph), `EngineCtx` (engine tools),
`LoopContext` (loop lifetime), `ToolRunCtx` (tool call). Same *idea* (short-lived resolved-binding bundle for
one unit of work), different shapes. Not a merge target; listed so the pattern is named.

---

## Family 11 — Media-generation tools ≈ (within-tools cluster)

`ImageGenerate` / `ImageEdit` / `VideoGenerate` (general), `GalleryCompose` (local), `MascotGenerate` /
`PanelGenerate` (comics). All resolve a media slot (`requireSlot` / pool check), most set **`single()=true`**
(exclusive per step — they collide on output names / hammer a server), return `images`/`videos` on the result,
and share `helpers/imageGeneration.ts` + `helpers/imageSave.ts`. **Diverge:** tier/base (general vs workspace),
input mode (text-only vs reference-edit vs budgeted-ledger), and destination (return-to-message vs file-ledger
promotion). The `single()` marker itself is a tiny cross-cut — its only members are these generators plus
`GalleryCompose` (`ImageGenerate`, `GalleryCompose`, `ComicsGenerateBase`). Consolidation is low (the divergence
is the point); listed so the "media tool" shape is named and the shared helpers are the real reuse surface.

## Suggested order of attack (payoff × mechanical-ness)

1. **Family 6 + Family 1's exact twins** — `approvals`≡`select`, `config/llm`≡`config/pools`: extract
   `createRequestBridge` + a generic derived-list store. Small, safe, deletes real duplication.
2. **Family 2** — the `globModules` primitive + one `ownerFromPath`. Mechanical, touches boot + both registries.
3. **Family 9** — `mediaHandler(kind)`, the shared regex. Trivial.
4. **Family 1 A1/A2** — a `createStore`/`createCrudStore` factory for the ~10 hand-rolled stores.
5. **Family 5** — `createConnectionService` for mcp/database.
6. **Family 3/8** (design call) — whether the engine tier folds into `BaseTool`, collapsing two dispatch paths.
   Biggest architectural payoff, biggest risk — needs its own ADR.
</content>
