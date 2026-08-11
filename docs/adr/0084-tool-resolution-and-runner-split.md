# ADR-0084: The registry resolves; a runner executes; the container is a per-call value

Status: Proposed
Date: 2026-08-11
Amends [ADR-0048](0048-tool-ctx-config-carrier.md) (the config carrier — container joins config as a
constructor dependency) and the registry shape of [ADR-0033](0033-tools-registry-folder-by-permission.md) /
[ADR-0062](0062-runtime-registered-tools.md).
Present-tense map: [architecture/tools.md](../architecture/tools.md).

## Context

The `ToolRegistry` did three jobs at once: it **built** every tool once at boot, **advertised** them
(`filter`), and **executed** them (`run`/`cancel`, owning the in-flight `AbortController` map). To reach a
per-call workspace, the container was threaded as a *getter* (`() => Container | undefined`) re-seeded via a
mutable `this.current` on the registry — a shared, time-varying binding a tool read while serving a call.
That getter's `undefined` case leaked a "no container in context" state into every tool (`cwd()` via `?.`,
`canRun` guards), and the boot-time single instance meant the tool's schema and permission were computed
against whatever container happened to be seeded. Advertisement leaned on a raw `workspacePermissions` map
the callers built by casting `container.permissions` — the same blob, laundered through an unchecked `as`.

## Decision

**Split registration/resolution from execution, and bind the container per call as a direct value.**

- **The registry registers and resolves.** `byName` holds **factories** (`Map<string, ToolFactory>`), keyed
  by each class's **`static schema.function.name`** (read without constructing — there is no container at
  glob time). `filter(params)` builds every factory against `params.container`, gates it, and returns the
  resolved `BaseTool` instances; `resolve(name, container)` builds one. `register(name, make, ownerPluginId?)`
  takes the name explicitly. The registry no longer executes — no `run`, no `cancel`, no `AbortController`.
- **A `ToolRunner` executes** (`core/tools/runner.ts`): it owns the in-flight `AbortController` map,
  resolves a call's tool against its container, dispatches `tool.run(call, signal)`, and cancels by id.
  `projectTools` flattens resolved instances into the serializable wire entries. Both platform adapters
  (web in-process, electron main) use it.
- **The container is a direct per-call value.** `BaseTool`'s constructor takes `container: Container` (not a
  getter); tools are built **fresh per call** bound to that call's container, so there is no mutable
  `current` and no `undefined` "no container" state. It rides the electron bridge on `WireConfig.container`
  (plain data — a resolved instance can't cross IPC) and is passed to `run(call, container)`; a caller with
  no real container uses `ephemeralContainer(type)`.
- **`run` vs `execute`.** `BaseTool.run(call, signal?)` is the entrypoint (parse JSON args → build ctx →
  wrap failures); each tool implements `execute(args, signal?, ctx?)`. `schema` is a `static`; the instance
  getter delegates to it (MCP, with per-instance names, overrides the getter).
- **Permission, not "mode".** The `0|1|2` value is computed on the tool by
  `calculatePermission(agentCeiling)` and cached on `currentPermission` (with `defaultPermission` the tool
  default); the wire entry carries `currentPermission`/`defaultPermission`. The raw `container.permissions`
  blob is narrowed to `0|1|2` in one place, replacing the callers' unchecked `as` cast. The `needsWorkspace`
  axis is gone — a workspace tool gates on `canRun()` (`container.type === "local"`).

## Consequences

- The registry is a pure factory store + resolver; execution, cancellation, and arg-parsing live with the
  runner (the thing that actually runs tools), so the two concerns stop entangling.
- Tools are cheap to build (a `new` per call), and every tool reads a real, present container — the
  `undefined`-container guards are deleted, not maintained.
- `ToolCallRequest` stays llm-layer data (no core `Container` import); the container travels on the wire.
- `filter` requires a container; callers that have none pass `ephemeralContainer` (a chat type for baselines,
  a local type for the permission catalog). This also fixed a latent dead re-filter in `capabilitiesFor`
  (both passes were identical, so the fs-tool diff was always empty).
- Glossary: **tool permission** (mode retired), **tool runner**, **resolve (a tool)**.
