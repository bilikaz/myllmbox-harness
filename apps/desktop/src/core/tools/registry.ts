// The tool registry: a folder of eager-globbed modules → pre-instantiated tools by name.
// Each process supplies its own glob (a literal path, so its bundle only pulls that folder).

import { BaseTool, type ToolCtor, type ToolFactory } from "./base.ts";
import { type ToolCallRequest, type ToolResult, type ToolFilterParams, type ToolFilterResult, type ToolFilterEntry } from "./types.ts";
import type { Config } from "../config/index.ts";
import type { Container } from "../containers.ts";
import { errorMessage } from "../../lib/errors.ts";

// A tool globbed from src/plugins/<slug>/tools/... is OWNED by that plugin; core tools have no owner.
// The owner is read off the glob path so the registry can drop a disabled plugin's tools.
function ownerFromPath(path: string): string | undefined {
  return /\/plugins\/([^/]+)\//.exec(path)?.[1];
}

export class ToolRegistry {
  readonly byName = new Map<string, ToolFactory>();
  readonly running = new Map<string, AbortController>();
  // tool name → owning plugin slug (only for plugin-contributed tools).
  private readonly owners = new Map<string, string>();
  // The active container for the in-flight filter()/run() — the registry OWNS it (assigned at resolution),
  // and hands its live getter to every tool (globbed below + runtime factories). `!`: a tool only reads
  // container() while serving a call (by which point it's assigned), never at build time.
  private current!: Container;
  // The one getter every tool gets — reads `current` lazily, so it resolves to the call's container.
  readonly container = (): Container => this.current;

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
        // runtime (MCP) tools share the SAME build path (resolution elsewhere). The name is derived from the
        // class STATIC schema (`ctor.schema.function.name`), never by constructing — no container here.
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

  // Runtime tool registration — the first dynamic tool source (MCP servers, discovered at connect).
  // Stores the FACTORY, not a built tool — resolution (calling `make`) happens per-call elsewhere, so the
  // container is bound at call time rather than captured here. Name is supplied by the caller (we no longer
  // build the tool to read `schema.function.name`). Owner-tagged so the disabled-plugin gate drops them.
  register(name: string, make: ToolFactory, ownerPluginId?: string): void {
    this.byName.set(name, make);
    if (ownerPluginId) this.owners.set(name, ownerPluginId);
  }

  unregister(name: string): void {
    this.byName.delete(name);
    this.owners.delete(name);
  }
/*
  those 2 exist in llm calls or other walker runner not here as registry is for registry not for runners. the running logic is for runners

  async run(call: ToolCallRequest): Promise<ToolResult | null> {
    const tool = this.byName.get(call.name);
    if (!tool) return null;
    if (!this.ownerEnabled(call.name)) return { ok: false, output: `tool "${call.name}" belongs to a disabled plugin.` };
    if (!tool.canRun()) return { ok: false, output: `tool "${call.name}" is not available for this model.` };
    const controller = new AbortController();
    if (call.id) this.running.set(call.id, controller);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch (e) {
      return {
        ok: false,
        output: [
          `tool call rejected: arguments are not valid JSON.`,
          `Tool: ${call.name}`,
          `Received arguments: ${call.arguments}`,
          `Parse error: ${errorMessage(e)}`,
          `Retry with a valid JSON object matching the tool's schema.`,
        ].join("\n"),
      };
    }
    try {
      return await tool.run(args, controller.signal, { imageOutputDir: call.imageOutputDir, mediaRefs: call.mediaRefs, sessionId: call.sessionId, meta: call.meta, target: call.target });
    } catch (e) {
      return { ok: false, output: `error running ${call.name}: ${errorMessage(e)}` };
    } finally {
      if (call.id) this.running.delete(call.id);
    }
  }

cancel(callId: string): void {
    this.running.get(callId)?.abort();
  }
*/

}
