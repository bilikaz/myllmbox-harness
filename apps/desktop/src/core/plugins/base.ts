// A plugin's main-side object. Each plugin ships plugin.ts exporting a BasePlugin subclass; the host globs
// and `new`s it with the tool registry, so the ctor runs registerTools() and the plugin's tools land in the
// registry (owner-tagged by slug). manifest.ts stays a separate, renderer-safe file (this file is main-only,
// so it may static-import the SDK/drivers/tool classes).

import type { ToolRegistry } from "../tools/registry.ts";

export type Emit = (type: string, payload: unknown) => void;
export type Rpc = Record<string, (...args: never[]) => unknown>;

export abstract class BasePlugin {
  private readonly sinks = new Set<Emit>();
  // The host subscribes and forwards to the renderer, so a panel reflects every state change.
  subscribe(emit: Emit): void {
    this.sinks.add(emit);
  }
  protected emit(type: string, payload: unknown): void {
    for (const s of this.sinks) s(type, payload);
  }

  // `slug` (the plugin's id) and `registry` are handed in by the host — slug is the plugin's folder name
  // (the same identity the manifest declares and tools are owner-tagged by), derived from the glob path, not
  // re-declared here. Both are constructor params so they're set before registerTools() runs.
  constructor(
    readonly slug: string,
    protected readonly registry: ToolRegistry,
  ) {
    this.registerTools();
  }

  // Register this plugin's STATIC tools into the registry (owner = slug), injecting `this` where a tool needs
  // live service state. Default: none — a runtime-only plugin (MCP) registers on connect instead.
  protected registerTools(): void {}

  // Lifecycle. install: nothing eager by default (connections open on demand). uninstall: tear down.
  install(): void {}
  abstract uninstall(): Promise<void> | void;

  abstract readonly rpc: Rpc;
}

// A plugin that owns live connections keyed by name (MCP servers, DB pools). Owns the map + the shared
// teardown/notify; subclasses provide the open flow (it differs) and closeHandle.
export abstract class ConnectionPlugin<H> extends BasePlugin {
  protected readonly live = new Map<string, H>();

  protected notifyConnections(): void {
    this.emit("connections", [...this.live.keys()]);
  }
  status(): string[] {
    return [...this.live.keys()];
  }

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
