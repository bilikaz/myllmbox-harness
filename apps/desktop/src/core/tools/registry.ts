// The tool registry: a folder of eager-globbed modules → tool FACTORIES by name. It registers and resolves;
// it does NOT execute. Resolution (building a BaseTool for a container) happens in filter()/resolve();
// execution — the AbortController map, arg parsing, cancellation — lives in the runner, not here.
// Each process supplies its own glob (a literal path, so its bundle only pulls that folder).

import { BaseTool, type ToolCtor, type ToolFactory } from "./base.ts";
import type { ToolFilterParams } from "./types.ts";
import type { Config } from "../config/index.ts";
import type { Container } from "../containers.ts";

// A tool globbed from src/plugins/<slug>/tools/... is OWNED by that plugin; core tools have no owner.
// The owner is read off the glob path so the registry can drop a disabled plugin's tools.
function ownerFromPath(path: string): string | undefined {
  return /\/plugins\/([^/]+)\//.exec(path)?.[1];
}

export class ToolRegistry {
  readonly byName = new Map<string, ToolFactory>();
  // tool name → owning plugin slug (only for plugin-contributed tools).
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly config: () => Config,
    modules: Record<string, Record<string, unknown>>,
  ) {
    for (const [path, mod] of Object.entries(modules)) {
      if (path.endsWith("/base.ts")) continue; // abstract bases live in base.ts; skip by path
      const owner = ownerFromPath(path);
      for (const v of Object.values(mod)) {
        // Only concrete BaseTool subclasses are tools — a tool module may also export plain helpers
        // (e.g. a formatter), which must NOT be instantiated as tools.
        if (typeof v !== "function" || !(v.prototype instanceof BaseTool)) continue;

        const ctor = v as ToolCtor;
        // A globbed class is registered as a factory — the one `new` lives inside `make`, so globbed and
        // runtime (MCP) tools share the SAME build path (resolution in filter()/resolve()). The name is read
        // off the class STATIC schema (`ctor.schema.function.name`), never by constructing — no container here.
        this.register(ctor.schema.function.name, (config, container) => new ctor(config, container), owner);
      }
    }
  }

  // A plugin tool advertises/runs only while its plugin is enabled (config.plugins.<slug>.enabled).
  // Core tools (no owner) are never gated this way. Fail-closed: an unknown/absent entry hides the tool.
  private ownerEnabled(name: string): boolean {
    const owner = this.owners.get(name);
    return owner ? !!this.config().plugins[owner]?.enabled : true;
  }

  // Resolve every registered factory against the call's container, gate it (disabled-plugin, canRun,
  // permission), cache each survivor's currentPermission, and return them keyed by name. The returned tools
  // are live BaseTool instances bound to `params.container`; the runner invokes `tools[name].run(call)` and
  // the electron adapter re-wraps them into the serializable wire shape.
  filter(params: ToolFilterParams): Record<string, BaseTool> {
    const tools: Record<string, BaseTool> = {};
    for (const make of this.byName.values()) {
      const tool = make(this.config, params.container);
      const name = tool.schema.function.name;

      // disabled-plugin gate: a disabled plugin's tools never advertise (not even as "off")
      if (!this.ownerEnabled(name)) continue;

      // canRun gate
      if (params.checkCanRun && !tool.canRun()) continue;
      const agentCeiling = params.agentPermissions?.[name] ?? params.agentPermissions?.["*"] ?? 2;
      tool.calculatePermission(agentCeiling);
      // Drop disabled tools unless the caller wants them listed (the permissions UI shows them as "off").
      if (tool.currentPermission === 0 && !params.includeDisabled) continue;

      tools[name] = tool;
    }
    return tools;
  }

  // Build ONE tool for a container by name, without gating — the runner/adapter uses this to execute a call
  // whose permission was already decided at filter() time. Returns undefined for an unknown name.
  resolve(name: string, container: Container): BaseTool | undefined {
    return this.byName.get(name)?.(this.config, container);
  }

  // Runtime tool registration — the first dynamic tool source (MCP servers, discovered at connect).
  // Stores the FACTORY, not a built tool — resolution (calling `make`) happens per-call in filter()/resolve(),
  // so the container is bound at call time rather than captured here. Name is supplied by the caller (we no
  // longer build the tool to read `schema.function.name`). Owner-tagged so the disabled-plugin gate drops them.
  register(name: string, make: ToolFactory, ownerPluginId?: string): void {
    this.byName.set(name, make);
    if (ownerPluginId) this.owners.set(name, ownerPluginId);
  }

  unregister(name: string): void {
    this.byName.delete(name);
    this.owners.delete(name);
  }
}
