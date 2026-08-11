# task4 — implementation report

Capability-gate every element by `container.type`. Built on the `task4` branch (off `main` `6724c27`);
nothing committed. Log written as work lands.

## Landed

### Phase A — UI self-gate (registry + Slot) · green
- `lib/registry.ts`: `Contribution.containers?: ContainerType[]` (unset = all types).
- `components/Slot.tsx`: filters contributions by the active session's `container.type` (via
  `useActiveContainerId()` → `getContainer()?.type`). The active-container store's `notify()` re-gates every
  Slot in one pass on chat/session select.
- Declared `containers: ["chat", "local"]` on the conversation-only right-panel contributions: `agents`,
  `sub-agent-cleanup`, `agent-permissions` (pages/agents/register), `graphs`, `browser-fleet`, and the plugin
  panels `database-connections` / `mcp-servers`. `progress` stays ungated (it already renders context vs.
  capabilities by type).

### Phase B — unified turn dispatch + banner gate · green
- `core/sessions/engine.ts`: added `dispatch(text, atts)` — routes on the active session's
  `container.type` (`image`/`video` → `generate`, else `send` → `drive()`). One composer entry point.
- `pages/workspace/SessionView.tsx`: `submit` → `ctx.sessions.dispatch`; the `SystemBanner` renders only for
  `chat`/`local` (media sessions have no LLM/system prompt).

### Phase C — tool context by container (constructor injection) · green
- `BaseTool` constructor gains `container: () => Container | undefined` (a getter beside `config`), plus a
  `this.cwd()` helper (`container().config.root`). `needsWorkspace()` **removed** — the gate folds into
  `canRun()`: `BaseWorkspaceTool.canRun()` = `container?.type === "local"`; the five model-checking local
  tools compose it (`super.canRun() && <model check>`). `run()` **dropped its `cwd` param** — 20 tools
  updated to read `this.cwd()`.
- `ToolCallRequest.cwd` → `container`; `ToolFilterParams.hasWorkspace` → `container`; `ToolFilterEntry`
  dropped `needsWorkspace`. Both dispatchers (`web/init.ts`, `electron/tools.ts`) re-seed a module
  `container` getter from the call/params before the registry runs — same rail as `config`. `ToolRegistry`
  ctor + `ToolCtor` + `PluginToolRegistrar` + `McpTool` thread the getter. Call-builders (loop, engine,
  graph/loop, providers, UI test buttons) stamp `container` instead of `cwd`.
- `system.ts`: `capabilityContext` derives `ws` purely from `container.type === "local"`; the filter is
  called with the container; the workspace-prompt tool list is derived by diffing the local vs. no-container
  filter (`canRun` is the gate). `sessionToolModes` now passes `checkCanRun` so the container gate applies.

### Phase D — agents by container type · green
- `Agent.workspace: boolean` → `Agent.containers?: ContainerType[]` (undefined = any conversation;
  `["local"]` = needs a workspace). `agentsForContext(type)`, `catalog.catalogAgents/resolveAgent/
  listAgentsOutput(type)`, `RunAgent`/`ListAgents` (pass `ec.workspace?.type`). AgentsPanel / AgentRunView /
  AgentPermissionsPanel / AgentEditView read `containers` (the edit checkbox toggles `["local"]`/undefined).

### Phase E — runAgent routing · green
- `runAgent` resolves the target container; if it's `image`/`video` it routes the agent session to a `chat`
  container (creating/activating as needed) — an agent is never created inside a generation container.

### Phase F — verification
- `pnpm typecheck` green; `pnpm test` **220 / 33 files** green; `pnpm build` (web) green.
- New tests: container-type tool gating (`tools-dispatcher` — fs tool surfaces only in a Local container);
  agent catalog by type + `session-permissions` rewritten to the new grant model. (A `runAgent` E2E was
  dropped — it needs the whole turn machinery stubbed; the panel-hiding in Phase A is the real user-facing
  guard, and the routing is covered by inspection.)

## Bug found + fixed while building

**`renderer/gatedTools.ts` dropped the fs tools from the permission editors.** It filtered
`{ checkCanRun: true, includeDisabled: true }` with **no container**; under task4 `canRun()` gates a
workspace tool on `container?.type === "local"`, so `undefined` excluded Read/Write/Delete/… — the agent
& container permission grids lost every fs tool. Fixed by filtering the *catalog* under a synthetic Local
container (`CATALOG_CONTAINER`), so all gated tools list while `checkCanRun` still drops model-incapable
ones. (Audit also confirmed the only other container-less `tools.run` callers — GallerySection,
DatabaseTestConnection — are benign: those tools aren't container-gated.)

## Behaviour change to flag

**The agent workspace opt-out is gone, and "placement is never a grant" is reversed.** Previously an
`agent.workspace === false` agent got **no** fs tools even in a Local workspace (placement granted nothing;
the agent flag was the grant). task4 makes **`container.type` the grant**: any session in a Local container
gets the fs tools, gated only by the agent's tool ceiling. A general agent run in a Local session now has
the fs tools. This is the intended consequence of "gate by container type" — surfaced here because it
undoes the old placement-vs-capability rule (`session-permissions.test` was rewritten accordingly).

## Deferred (unchanged, noted)
- Graph-def `needsWorkspace()` (on `core/graph/base.ts` + plugin graphs) is a **separate** flag consumed
  only by `GraphsPanel`, which already gates on `activeType === "local"` — left as-is (not the tool/agent
  workspace boolean). `ToolRunCtx` does **not** carry the container (the constructor container replaced that
  need); the whole-container-in-ctx idea is moot.

## Round 2 — tool resolution & runner split ([ADR-0084](../../adr/0084-tool-resolution-and-runner-split.md))

The task4 container-gate exposed that the `ToolRegistry` was doing three jobs (build-once + advertise +
execute) and reached the per-call workspace through a *mutable getter* (`this.current`, `() => Container |
undefined`) — the source of the `undefined`-container guards everywhere. Split it:

- **Registry registers + resolves, never executes.** `byName` holds **factories** (`Map<string,
  ToolFactory>`) keyed by each class's **`static schema.function.name`** (no construction at glob time — the
  key insight, since there's no container then). `filter(params.container)` builds + gates + returns resolved
  `BaseTool` instances; `resolve(name, container)` builds one; `register(name, make, owner)` takes the name.
  `run`/`cancel`/the `AbortController` map are **gone** from the registry.
- **`ToolRunner`** (`core/tools/runner.ts`) executes: owns the running-map, resolves against the call's
  container, dispatches `tool.run(call, signal)`, cancels by id. `projectTools` flattens instances → wire
  entries. Both adapters (web in-process, electron main) use it.
- **Container is a per-call direct value** on `BaseTool` (not a getter) — tools built fresh per call. It
  rides the electron bridge on `WireConfig.container` and is passed to `run(call, container)`; no real one →
  `ephemeralContainer(type)`. `ToolCallRequest` stays llm-layer (no `Container` import).
- **`run` → `execute` split**: `BaseTool.run(call)` parses/wraps; each tool implements `execute(args, …)`.
  `schema` moved to `static` (base getter delegates; MCP overrides for its per-instance name). Swept 26 tool
  files with a string-safe script; MCP by hand (dynamic `defaultPermission` in its constructor).
- **Permission, not "mode"**: `calculatePermission(agentCeiling)` on `BaseTool` sets `currentPermission`
  (was `effectiveMode`, computed inside `filter`); `defaultPermission` a field; the raw
  `container.permissions` blob narrowed to `0|1|2` in one place (replacing an unchecked `as` cast). Wire
  entry carries `currentPermission`/`defaultPermission`. Glossary rows added.

**Also fixed:** a *second* dead re-filter — `capabilitiesFor`'s `baseline` passed the same params as
`filtered`, so the fs-tool diff was always `[]`; it now baselines under a chat-type `ephemeralContainer`.

**Verification:** `pnpm typecheck` green (0 errors); `pnpm test` **220 / 33 files** green. Tests updated to
the new contract (tool unit tests call `execute` with a direct container; `filter`/`execTool` take a
container) — the contract genuinely changed, so the tests moved with it, not weakened.

**Judgment call flagged:** `defaultPermission` is a **field** (dynamic cases compute it in the constructor,
valid now that tools build per call), not a getter — keeps a plain property read in `calculatePermission`.

**Follow-up — `PluginToolRegistrar` removed.** It was a wrapper interface structurally identical to the
`ToolRegistry`'s `register`/`unregister` subset (electron-only; MCP the sole user). Deleted it: `electron/
tools.ts` exports the `registry` instance, `wirePluginTools(registry)` hands it straight to a service's
`bindRegistry(registry)` (renamed from `bindRegistrar`). One fewer type, no behavioural change; amends
ADR-0062. typecheck + 220 tests still green.
