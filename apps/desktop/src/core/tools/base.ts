import { createClient, type LLMClient } from "../../llm/index.ts";
import type { Config } from "../config/index.ts";
import type { Container } from "../containers.ts";
import { type ToolResult, type ToolSpec, type ToolPermission, type ToolRunCtx } from "./types.ts";

// Largest tool output handed back to the model — a runaway command can't blow its context.
export const OUTPUT_CAP = 64 * 1024;

// Cap tool output before it reaches the model — standalone because the session driver also trims with it.
export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}

// Every tool is constructed once with a getter onto the live app config — the one dependency common to
// all tools (a getter, since config is reactive; a snapshot would go stale). Not every tool calls a model
// or is a plugin, but every tool can read config: the model client is derived from config.llm on use (see
// `llm`), plugin tools read config.plugins.<slug>, others read config.app.
export abstract class BaseTool {

  defaultPermission: ToolPermission = 2;
  currentPermission: ToolPermission = 0;
  // Both are GETTERS re-seeded per call by the dispatcher (tools are built once at boot — no container
  // exists then). `container()` is undefined when nothing is in context (boot / between calls / a call
  // without one) — the no-workspace state: `canRun` gates off and `cwd()` is undefined via `?.`.
  constructor(protected readonly config: () => Config, protected readonly container: Container) {}

/// wtf is this?????? issue to inspect 
// undefined is a real, first-class case — and it's exactly why container must be a getter, not a direct value: tools are constructed once at boot, long before any session/container exists, and the getter is re-seeded per call. So container: Container can't work; it's container: () => Container | undefined.
// It returns undefined when: at boot / between calls (nothing seeded yet), or a call carried no container. And that state is meaningful — "no container in context" = no workspace:


  // The active workspace root — the Local container's `config.root`; undefined for any other/none.
  // Replaces the old `cwd` param threaded into every tool's run().
  protected cwd(): string | undefined {
    return (this.container.config as { root?: string } | undefined)?.root;
  }

  // The model client, derived from config.llm. createClient is a stateless wrapper over the resolver, so
  // building it per use is cheap and always reflects current config — tools that never call a model never build one.
  protected get llm(): LLMClient {
    const config = this.config;
    return createClient(
      { resolve: (service) => config().llm[service] ?? null },
      {
        get maxHeals() {
          return config().app.llm.maxHealAttempts;
        },
      },
    );
  }

  abstract get schema(): ToolSpec;

  abstract run(args: Record<string, unknown>, signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult>;

  // Resolve this tool's current permission and cache it on `currentPermission`. Workspace policy and the
  // tool default both live on `this` (container + defaultPermission); the agent ceiling is the one external
  // input, so the caller passes it. Permissionless tools take the ceiling as-is; permissioned tools clamp
  // the workspace grant by the ceiling — stricter wins.
  calculatePermission(agentPermission: ToolPermission): void {
    if (!this.isPermissioned()) {
      this.currentPermission = agentPermission;
      return;
    }
    // permissions is a raw JSON blob (Record<string, unknown>) — narrow to a real 0/1/2, else the default.
    const raw = this.container.permissions[this.schema.function.name];
    const wsPermission: ToolPermission = raw === 0 || raw === 1 || raw === 2 ? raw : this.defaultPermission;
    this.currentPermission = Math.min(wsPermission, agentPermission) as ToolPermission;
  }
  // Whether this tool is available in the current context — model capability / configured slot AND the
  // active container type (a workspace tool overrides to `this.container()?.type === "local"`). The
  // advertisement filter and run() both consult it; a container-gated tool is simply unavailable elsewhere.
  canRun(): boolean {
    return true;
  }

  // Whether this tool is subject to the workspace permission policy. Permissionless by default;
  // BaseWorkspaceTool overrides to true. The advertisement filter consults the policy only for these.
  isPermissioned(): boolean {
    return false;
  }

  // Whether at most ONE call to this tool runs per step. When the model emits several calls to a single tool
  // in one turn, only the first survives; the extras are dropped from the call set (never run, never answered).
  // For exclusive/expensive ops — e.g. image generation/compose — where parallel copies collide on output
  // names or hammer a shared server. The dispatcher enforces it via the filter entry.
  single(): boolean {
    return false;
  }

  protected cap(s: string): string {
    return cap(s);
  }
}

// What a tool module exports: a constructor the registry resolves by folder layout. It carries the tool's
// SCHEMA as a STATIC (`ToolCtor.schema`) so the registry can read it — and derive the name from
// `schema.function.name` — WITHOUT constructing; there's no container at glob time. Each concrete tool
// declares `static readonly schema: ToolSpec`.
export type ToolCtor = (new (config: () => Config, container: Container) => BaseTool) & {
  schema: ToolSpec;
};

// A runtime tool registration: an anonymous constructor the registry invokes with ITS getters (config +
// its live container getter). The tool is built by the registry, so it reads the same seeded container as
// a globbed one — nothing captures a container at registration time.
export type ToolFactory = (config: () => Config, container: Container) => BaseTool;
