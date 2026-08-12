# task5 — `BasePlugin` implementation

Build guide for [task.md](task.md). Kept in sync as it lands.

## 1. `core/plugins/basePlugin.ts` (NEW)

```ts
import type { ToolRegistry } from "../tools/registry.ts";

export type Emit = (type: string, payload: unknown) => void;
export type Rpc = Record<string, (...args: never[]) => unknown>;

// A plugin's main-side object (plugin.ts exports the class; the host `new`s it at boot with the registry).
// The ctor runs registerTools() so the plugin's tools land in the registry.
export abstract class BasePlugin {
  abstract readonly slug: string;

  private readonly sinks = new Set<Emit>();
  subscribe(emit: Emit): void { this.sinks.add(emit); }
  protected emit(type: string, payload: unknown): void { for (const s of this.sinks) s(type, payload); }

  constructor(protected readonly registry: ToolRegistry) {
    this.registerTools();
  }

  // Register this plugin's STATIC tools into this.registry (owner = this.slug), injecting `this` where a tool
  // needs live service state. Default: none (runtime-only plugins like MCP register on connect instead).
  protected registerTools(): void {}

  install(): void {}
  abstract uninstall(): Promise<void> | void;
  abstract readonly rpc: Rpc;
}

// A plugin owning live connections keyed by name (MCP servers, DB pools).
export abstract class ConnectionPlugin<H> extends BasePlugin {
  protected readonly live = new Map<string, H>();

  protected notifyConnections(): void { this.emit("connections", [...this.live.keys()]); }
  status(): string[] { return [...this.live.keys()]; }

  protected abstract closeHandle(name: string, handle: H): Promise<void> | void;

  async disconnect(name: string): Promise<void> {
    const h = this.live.get(name);
    if (!h) return;
    this.live.delete(name);
    this.notifyConnections();
    await this.closeHandle(name, h);
  }
  async uninstall(): Promise<void> {
    await Promise.all([...this.live.keys()].map((n) => this.disconnect(n)));
  }
}
```

## 2. `plugins/mcp/plugin.ts` (git mv from `service.ts`)

`class McpPlugin extends ConnectionPlugin<Live>`:
- `readonly slug = MCP_SLUG`. No `registerTools` override (tools are runtime — registered in `connect`).
- Keep the file-private helpers (`transportFor`/`openConnectedClient`/`mapResult`/`callTool`/OAuth) as-is.
- `closeHandle(name, l)` = `for (const t of l.tools) this.registry.unregister(mcpToolName(name, t)); await l.client.close()`.
- `private async connect(server, override?)` — current body over `this.registry` / `this.live` /
  `this.notifyConnections()`; `sink("authorizing", …)` → `this.emit("authorizing", server.name)`.
- `readonly rpc = { connect, disconnect, refresh: connect, status: () => this.status(), tools: (n) => this.live.get(n)?.tools ?? [] }`.
- `export class McpPlugin` — the host `new`s it with the registry (see §6). Same export convention for every
  plugin.

## 3. `plugins/database/plugin.ts` (git mv from `service.ts`)

`class DbPlugin extends ConnectionPlugin<OpenConn>`:
- `readonly slug = DATABASE_SLUG`.
- `override registerTools()` — register the 3 db tools with `this` injected:
  ```ts
  const reg = (T: ToolCtor & { new (c, ct, p: DbPlugin): BaseTool }) =>
    this.registry.register(T.schema.function.name, (c, ct) => new T(c, ct, this), this.slug);
  reg(DatabaseQuery); reg(DatabaseTestConnection); reg(DatabaseConnections);
  ```
- `closeHandle(_n, conn)` = `conn.end()`.
- `private async resolve(c, pw?)` — current body over `this.live` + `this.notifyConnections()`.
- Public methods the tools call: `isConnected`, `liveConnections` (=`status()`), `connect`, `ping`, `query`.
- `readonly rpc = { connect, disconnect, status }`.

## 4. `plugins/database/tools/local/*` — take the plugin

- `BaseDatabaseTool` ctor gains the plugin: `constructor(config, container, protected readonly plugin: DbPlugin)`
  — the 3 subclasses inherit and pass it through. The tool-side config helpers `find`/`pick`/`connections`
  (they only read `config.plugins.database`, no live state) stay as pure helpers OR become `DbPlugin` methods
  — recommend pure helpers in `tools/local/base.ts`. The live ops call `this.plugin.query`/`.isConnected`/…
- Delete every `import … from "../../service.ts"`.

## 5. `plugins/comics/plugin.ts` (NEW — serviceless, tools only)

`class ComicsPlugin extends BasePlugin`:
- `readonly slug = COMICS_SLUG`; `override registerTools()` registers `MascotGenerate`/`PanelGenerate`
  (no `this` needed — comics tools read `session.meta`, not the plugin); `uninstall()` no-op;
  `readonly rpc = {}`.

## 6. `electron/pluginServices.ts` — construct + wire

- Glob `plugins/*/plugin.ts`; each exports a `BasePlugin` subclass. **Construct** each with the `registry`
  (this is where `registerTools` fires), holding `Map<slug, BasePlugin>`. This replaces `wirePluginTools`.
- `wirePluginEvents(send)` → `plugin.subscribe((type, payload) => send(slug, type, payload))`.
- `invokePluginService(slug, method, args)` → reserved `install`/`uninstall` → `plugin.install()` /
  `await plugin.uninstall()`; else `plugin.rpc[method]?.(…args)` (throw on unknown, as today).
- `electron/index.ts` — the old `wirePluginTools(registry)` becomes the construct step; ordering: create
  `registry` (tools.ts) → construct plugins (registers their tools) → `registerIpc` → hydrate → …

## 7. `electron/tools.ts` + `web/init.ts` — drop plugin-tool globs

- `electron/tools.ts` MODULES = `core/tools/general/*` + `core/tools/local/*` only (remove both
  `plugins/*/tools/**` lines).
- `web/init.ts` — remove the dead `plugins/*/tools/general/*` line.

## 8. `core/plugins/types.ts`

Remove `ServiceModule`/`bindRegistry`; `Emit`/`Rpc` live in basePlugin. Manifest types unchanged.

## Touched files

`core/plugins/basePlugin.ts` (new) · `core/plugins/types.ts` · `plugins/mcp/{service→plugin}.ts` ·
`plugins/database/{service→plugin}.ts` · `plugins/database/tools/local/{base,query,test,connections}.ts` ·
`plugins/comics/plugin.ts` (new) · `electron/pluginServices.ts` · `electron/tools.ts` · `web/init.ts` ·
`electron/index.ts`. **Untouched:** every `manifest.ts`, config store, boot manifest/graph/agent loaders,
`review`, core tool tiers.

## Verification

- `pnpm typecheck` green; `pnpm test` green (220+); add a small test that constructing `DbPlugin`/`ComicsPlugin`
  registers their tools into a fresh `ToolRegistry` (name present, owner = slug).
- Smoke: MCP connect (stdio + OAuth http) → tools appear + a call runs → disconnect removes them; DB connect →
  a `DatabaseQuery` runs; comics tools present under a comics session; toggle each plugin off → `uninstall`
  tears live handles down and `filter()` drops the tools.

## Notes / drift

- `git mv service.ts plugin.ts` in the same commit as the class change (preserve history).
- Graph + agent folder-globbing (boot.ts) is deliberately **out of scope** — a later task can move those onto
  the plugin object too (same "plugin owns its contributions" direction).
- Every `plugin.ts` uses the same export: `export class XPlugin extends BasePlugin` — the host globs and
  `new`s them uniformly with the registry.
</content>
