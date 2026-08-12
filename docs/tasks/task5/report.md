# task5 — report

Running change + drift log for [task.md](task.md) / [implementation.md](implementation.md).

## What landed

- **`core/plugins/base.ts`** (named `base.ts`, not `basePlugin.ts` — matches the `core/tools/base.ts`
  convention) — `BasePlugin` + `ConnectionPlugin<H>`. `slug` and `registry` are **constructor params** the
  host hands in; the ctor calls `registerTools()`. `ConnectionPlugin` owns the live `Map` + `subscribe`/
  `notifyConnections` + `disconnect` + `uninstall`=disconnect-all + `status` + abstract `closeHandle`.
- **`plugins/mcp/{service→plugin}.ts`** — `McpPlugin extends ConnectionPlugin<Live>`. `connect` registers an
  `McpTool` per discovered tool into `this.registry` (owner `this.slug`); `closeHandle` unregisters + closes;
  `rpc` = connect/disconnect/refresh/status/tools. `bindRegistry` removed (registry is a ctor dep).
- **`plugins/database/{service→plugin}.ts`** — `DbPlugin extends ConnectionPlugin<OpenConn>`. `registerTools`
  registers the 3 db tools with `this` injected; `resolve`/`query`/`ping`/`isConnected`; `rpc` =
  connect/disconnect/status.
- **`plugins/comics/plugin.ts`** (new) — serviceless `ComicsPlugin extends BasePlugin`; `registerTools`
  registers Mascot/Panel (no `this` needed — they read `session.meta`); `rpc = {}`.
- **`plugins/database/tools/local/{base,query,test}.ts`** — constructor takes the `DbPlugin`; call
  `this.plugin.{isConnected,query,ping}`; the `service.ts` imports are gone.
- **`electron/pluginServices.ts`** — globs `plugins/*/plugin.ts`, finds the `BasePlugin` subclass by
  prototype, `constructPlugins(registry)` builds each (registering its tools), `wirePluginEvents` subscribes,
  `invokePluginService` dispatches install/uninstall/rpc off the instance. `wirePluginTools`/`bindRegistry`/
  `ServiceModule` removed.
- **`electron/index.ts`** — `constructPlugins(registry)` before `createWindow` (which wires plugin events).
- **`electron/tools.ts` + `web/init.ts`** — dropped the `plugins/*/tools/**` globs (plugins self-register);
  core tools only.

## Drift from the guide (decided during the build)

- **`slug` is a constructor param**, not a re-declared field. The manifest already owns the id (= folder
  name); re-declaring `readonly slug = X` on the plugin was a ghost ([reuse-core-types](../../instructions/reuse-core-types.md)).
  The host derives it from the `/plugins/<slug>/` path (same regex as the tool/graph owner-tagging). Because
  a param exists throughout construction, `registerTools()` is safely **auto-called in the base ctor**
  (rather than host-called as the guide first sketched — that was to dodge a field-init timing trap that the
  param form doesn't have).
- **No `PluginDeps`** — the ctor takes `registry` directly; add a bag only when a second dep lands.
- File is `core/plugins/base.ts`.

## Verification

- `pnpm typecheck` green; `pnpm test` **221 / 33 files** green — added a self-registration test:
  `constructPlugins` puts `DatabaseQuery`/`DatabaseConnections`/`MascotGenerate`/`PanelGenerate` in the
  registry.
- **Not yet smoke-tested in the running app** (MCP connect incl. OAuth, DB query, comics tools present,
  toggle-off tears down) — flagged for the manual pass before this is called done.

## Still open

- **ADR** for the plugin-owns-its-tools + registry-as-ctor-dep change (task.md "Needs an ADR").
- `implementation.md` reconciled to current truth (base.ts, slug-via-ctor) — this report is the delta.
- Graph + agent folder-globbing stays folder-based (out of scope; a later task could move those onto the plugin too).
</content>
