# task5 — `BasePlugin`: a plugin's main-side object, owning its own tools

## Goal

Turn a plugin's loose `service.ts` (module of exports) into a **first-class object** — `plugin.ts`, a
`BasePlugin` subclass — that (1) receives the tool **registry as a constructor dependency**, (2) **registers
its own tools** instead of the host folder-globbing them on its behalf, and (3) inherits the shared
connection-service machinery (live-handle map + subscribe/notify + disconnect/uninstall + status) so `mcp`
and `database` stop duplicating it.

## Why

Two problems, one root:

- **Duplication.** `plugins/mcp/service.ts` and `plugins/database/service.ts` hand-roll the same connection
  plumbing — a `Map<name,handle>`, a `Set<Emit>` + `subscribe` + `notify("connections",…)`, `disconnect`
  (delete→notify→close), `install` no-op, `uninstall`=disconnect-all, `rpc {connect,disconnect,status}`. The
  teardown lifecycle — where leaks hide — is written twice.
- **Split ownership of a plugin's tools.** A plugin's tools are *registered for it* by the host: the electron
  registry globs `plugins/*/tools/local/*` and owner-tags by path, and the MCP runtime tools go in via an
  injected `bindRegistry`. So a plugin doesn't own its own tools, and to reach live service state a tool has
  to `import` the service **module singleton** (`database/tools/local/base.ts` → `import { isConnected } from
  "../../service.ts"`). That singleton (created at glob time) is the very reason the registry can't be a
  constructor arg.

Letting the plugin **register its own tools** dissolves both: it injects **itself** into its tool factories
(`registry.register(name, (cfg, ct) => new Tool(cfg, ct, this), this.slug)`), so tools reach service state by
closure — no singleton import — and the registry becomes an ordinary constructor dependency. `bindRegistry`
disappears.

## What makes it tractable

- **No plugin ships a `general` (renderer) tool today** — every plugin tool is `local` (main-side). A
  main-side plugin object can register all of them. (`plugins/*/tools/general/*` is a dead glob.)
- **`manifest.ts` stays a separate, renderer-safe file** (the config store + settings UI read manifests in
  the renderer). Because the renderer never imports `plugin.ts`, `plugin.ts` is **main-only** and may freely
  static-import the MCP SDK / DB drivers / its tool classes — no dynamic-import juggling. This is the reason
  we keep manifest split from plugin; merging them would drag Node deps into the web bundle.

## The shape

`core/plugins/basePlugin.ts`:

- **`BasePlugin` (abstract)** — the plugin's main-side object. Holds `slug`, a push channel
  (`subscribe(emit)` + protected `emit`), a `registry` (constructor dep), lifecycle `install()` (default
  no-op) + `uninstall()`, an `rpc` record, and a `registerTools()` hook (called at construction; default
  no-op) where a plugin registers its static tools into `this.registry`.
- **`ConnectionPlugin<H> extends BasePlugin`** — adds the live-connection machinery: `Map<string,H>`,
  `notifyConnections()`, `status()`, `disconnect(name)`, `uninstall()`=disconnect-all, abstract
  `closeHandle`. Subclasses own the *open* flow (it differs).

Plugins with a main-side presence export `export const plugin = new XPlugin(deps)` — the host constructs it.

## Scope — what changes, what doesn't

**Changes:**
- NEW `core/plugins/basePlugin.ts`.
- `plugins/mcp/service.ts` → `plugins/mcp/plugin.ts` (`class McpPlugin extends ConnectionPlugin<Live>`; open =
  OAuth + `listTools` + register `McpTool`s; `closeHandle` = unregister + `client.close`; rpc adds
  `refresh`/`tools`).
- `plugins/database/service.ts` → `plugins/database/plugin.ts` (`class DbPlugin extends
  ConnectionPlugin<OpenConn>`; open = `driver.open` + `probe`; `closeHandle` = `conn.end`;
  `resolve`/`query`/`ping`; `registerTools()` registers the 3 db tools with `this` injected).
- `plugins/comics` gains `plugin.ts` (`class ComicsPlugin extends BasePlugin`) whose only job is
  `registerTools()` for MascotGenerate/PanelGenerate — it's serviceless but now owns its tool registration.
- `plugins/database/tools/local/*` — constructor takes the `plugin` (via the factory) and calls
  `plugin.query(…)`/`plugin.isConnected(…)`; the `service.ts` import is gone.
- `electron/tools.ts` — MODULES drops the `plugins/*/tools/**` globs (core tools only); plugins self-register.
- `web/init.ts` — drops the dead `plugins/*/tools/general/*` glob.
- `electron/pluginServices.ts` — globs `plugins/*/plugin.ts` classes, **constructs** each with `{ registry }`
  (so `registerTools` runs), holds the instances, and wires `subscribe`/`install`/`uninstall`/`rpc`.
  `wirePluginTools`/`bindRegistry` are removed (registry is a constructor dep now).
- `core/plugins/types.ts` — `ServiceModule` → the `plugin`-instance shape; `bindRegistry` gone.

**Unchanged:** `manifest.ts` (all plugins), the manifest registry + `config.plugins` store, `systemPrompt`
prompts, **graph + agent folder-globbing** (boot loaders — out of scope; a later task may move those onto the
plugin too), `review` (no tools/service — stays manifest+graph+agents only), the core tool tiers.

## Boot / gating note

The host constructs **every** plugin object at boot (enabled or not) so each registers its tools — the
enabled-gate stays where it is (`ToolRegistry.ownerEnabled` drops a disabled plugin's tools at `filter()`).
Construction ≠ connect: connections still open on demand (`rpc.connect` / `install`), and `install`/`uninstall`
lifecycle stays gated by `enabled` exactly as today.

## Done-whens

1. `core/plugins/basePlugin.ts` holds `BasePlugin` + `ConnectionPlugin<H>`; the connection machinery lives
   there once.
2. `mcp`/`database`/`comics` are `plugin.ts` classes; none re-implements the shared machinery, and each
   registers its own tools.
3. `electron/tools.ts` no longer globs plugin tools; a disabled plugin's tools still don't advertise.
4. `bindRegistry` is gone; the registry is a constructor dep.
5. `review` still loads (manifest + graph + agents); serviceless with no tools.
6. `pnpm typecheck` green; `pnpm test` green (220+); manual smoke: MCP connect/disconnect/refresh, a DB
   query, comics tools present, toggling a plugin off tears its service down and drops its tools.

## Needs an ADR

This changes plugin identity + loading (plugins own their tools; registry is a constructor dep; `service.ts`
→ `plugin.ts`). Propose an ADR amending [ADR-0062](../../adr/0062-runtime-registered-tools.md) (registrar) and
the folder-glob half of [ADR-0033](../../adr/0033-tools-registry-folder-by-permission.md) /
[ADR-0034](../../adr/0034-platform-hosts-over-agnostic-core.md).

## Open decision

- **D-branch** — new `task5` branch off `main`, or continue on the current `task4` branch? Your call.
</content>
