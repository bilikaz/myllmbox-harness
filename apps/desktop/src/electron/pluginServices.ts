// Main-side plugin objects — each src/plugins/<slug>/plugin.ts exports a BasePlugin subclass. The host globs
// them, constructs each with the tool registry (its ctor registers the plugin's tools), and wires its event
// push + rpc + lifecycle. A plugin with neither tools nor a service has no plugin.ts (graph/agents-only, e.g.
// review). Runs in the main bundle, so these ARE the singletons the plugin's own tools reach.

import { BasePlugin } from "../core/plugins/base.ts";
import type { ToolRegistry } from "../core/tools/registry.ts";

type PluginClass = new (slug: string, registry: ToolRegistry) => BasePlugin;

const MODULES = import.meta.glob<Record<string, unknown>>("../plugins/*/plugin.ts", { eager: true });

// slug → the BasePlugin subclass each plugin.ts exports (found by prototype, like the tool/graph globs).
const classes = new Map<string, PluginClass>();
for (const [path, mod] of Object.entries(MODULES)) {
  const slug = /\/plugins\/([^/]+)\//.exec(path)?.[1];
  if (!slug) continue;
  for (const v of Object.values(mod)) {
    if (typeof v === "function" && v.prototype instanceof BasePlugin) classes.set(slug, v as PluginClass);
  }
}

// slug → constructed instance (populated by constructPlugins at boot).
const plugins = new Map<string, BasePlugin>();

// Construct every plugin with the tool registry — its ctor calls registerTools(), so a plugin owns its own
// tool registration. Called once at startup, after the registry exists and before any wiring / connect.
export function constructPlugins(registry: ToolRegistry): void {
  for (const [slug, Cls] of classes) plugins.set(slug, new Cls(slug, registry));
}

// Wire each plugin's event channel to the renderer push channel — so plugin UIs reflect live service state.
// Called once with a sender (electron/index.ts → win.webContents.send), after constructPlugins.
export function wirePluginEvents(send: (slug: string, type: string, payload: unknown) => void): void {
  for (const [slug, p] of plugins) p.subscribe((type, payload) => send(slug, type, payload));
}

// Dispatch one service call. "install"/"uninstall" are reserved lifecycle phases (no-op for a plugin with no
// plugin.ts); any other method is an rpc call. Throws (crossing the bridge as the renderer's error) on
// unknown plugin/method or whatever the rpc throws.
export async function invokePluginService(slug: string, method: string, args: unknown[]): Promise<unknown> {
  const p = plugins.get(slug);
  if (method === "install") {
    p?.install();
    return;
  }
  if (method === "uninstall") {
    await p?.uninstall();
    return;
  }
  if (!p) throw new Error(`unknown plugin "${slug}"`);
  const fn = p.rpc[method];
  if (typeof fn !== "function") throw new Error(`unknown plugin service "${slug}.${method}"`);
  return await (fn as (...a: unknown[]) => unknown)(...args);
}
