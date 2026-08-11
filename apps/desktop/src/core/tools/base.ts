import { createClient, type LLMClient } from "../../llm/index.ts";
import type { Config } from "../config/index.ts";
import type { Container } from "../containers.ts";
import { type ToolResult, type ToolSpec, type ToolPermission, type ToolRunCtx, type ToolCallRequest } from "./types.ts";
import { errorMessage } from "../../lib/errors.ts";

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
  // The tool default (mode when the workspace hasn't set one) and the resolved current permission. Plain
  // fields: tools are built fresh per call (registry.filter/resolve), so a dynamic default can be computed in
  // the constructor, and currentPermission is (re)set by calculatePermission before anything reads it.
  defaultPermission: ToolPermission = 2;
  currentPermission: ToolPermission = 0;

  // `config` is a getter (config is reactive — a snapshot would go stale); `container` is a direct value, the
  // one this tool was built for. Tools are no longer built once at boot: the registry builds a fresh instance
  // per call bound to that call's container, so there is no "no container" state to guard.
  constructor(protected readonly config: () => Config, protected readonly container: Container) {}

  // The active workspace root — the Local container's `config.root`; undefined for any other type.
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

  // The model-facing tool spec. Globbed tools declare it once as `static readonly schema` and inherit this
  // getter, which reads the static off the concrete class; a tool with a per-instance schema (e.g. MCP, whose
  // name is descriptor-derived) overrides this getter instead.
  get schema(): ToolSpec {
    return (this.constructor as unknown as ToolCtor).schema;
  }

  // The execution entrypoint the runner invokes as `tools[name].run(call)`. Parses the model's JSON args off
  // the call, builds the per-call ctx from it, runs the tool's work (`execute`), and wraps a bad-JSON or
  // thrown failure as a tool result. The AbortController and cancellation are the runner's — a signal can't
  // cross the bridge, so it rides in as a param.
  async run(call: ToolCallRequest, signal?: AbortSignal): Promise<ToolResult> {
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
      return await this.execute(args, signal, {
        imageOutputDir: call.imageOutputDir,
        mediaRefs: call.mediaRefs,
        sessionId: call.sessionId,
        meta: call.meta,
        target: call.target,
      });
    } catch (e) {
      return { ok: false, output: `error running ${call.name}: ${errorMessage(e)}` };
    }
  }

  // A tool's actual work — implemented by every concrete tool. Args are already parsed; ctx carries the
  // per-call extras (image output dir, media refs, session id/meta, model target). `run()` is the entrypoint.
  abstract execute(args: Record<string, unknown>, signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult>;

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
  // active container type (a workspace tool overrides to `this.container.type === "local"`). The
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
