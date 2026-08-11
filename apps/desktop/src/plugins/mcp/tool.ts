// A single MCP tool as a regular BaseTool — constructed by the service at connect (NOT globbed by the tier
// scan, hence its home here outside tools/), one per tool the server advertised, and registered into the
// main registry. canRun()/defaultPermission() read config.plugins.mcp (the wire-seeded getter), so the
// per-server enable toggle and the card's per-tool default MODE govern it like any other tool. run()
// forwards to the live client via the descriptor's call closure.

import { BaseTool } from "../../core/tools/base.ts";
import type { Config } from "../../core/config/index.ts";
import type { Container } from "../../core/containers.ts";
import type { ToolResult, ToolSpec, ToolPermission } from "../../core/tools/types.ts";
import { MCP_SLUG, type McpSettings } from "./types.ts";

export interface McpToolDescriptor {
  server: string; // RAW server name (the config key) — looked up for canRun()/defaultPermission()
  tool: string; // the MCP tool name, verbatim — the toolDefaults key
  schema: ToolSpec; // function.name = MCP_<sanitized-server>_<tool>
  call: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
}

export class McpTool extends BaseTool {
  constructor(
    config: () => Config,
    container: Container,
    private readonly d: McpToolDescriptor,
  ) {
    super(config, container);
    // Default MODE from the server card (ask if unset). Computed HERE rather than as a static field because
    // it depends on live config; tools are built fresh per call, so this reflects the current settings.
    this.defaultPermission = (this.server()?.toolDefaults?.[this.d.tool] ?? 1) as ToolPermission;
  }

  // Per-instance schema (name = MCP_<server>_<tool>, from the descriptor) — overrides the static-delegating
  // base getter, since one McpTool class backs many differently-named tools.
  override get schema(): ToolSpec {
    return this.d.schema;
  }

  private server() {
    return (this.config().plugins[MCP_SLUG]?.settings as McpSettings | undefined)?.servers.find((s) => s.name === this.d.server);
  }

  override isPermissioned(): boolean {
    return true; // external — always governed; the MODE (off/ask/allow) is the policy, not this
  }

  // Available only while its server is enabled — toggling the server off hides the tool with no re-registration.
  // Not container-scoped: available in any conversation container.
  override canRun(): boolean {
    return !!this.server()?.enabled;
  }

  override execute(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    return this.d.call(args, signal);
  }
}
