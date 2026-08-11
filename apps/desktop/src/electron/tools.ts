// The Electron host's tool dispatch (runs in the main process). One registry over the main-process tiers
// (permissionless general/ + Node-capable local/), built with a getter onto the config snapshot re-seeded
// from each call's wire (functions/clients can't cross IPC — a tool derives its own client from config.llm).

import { getConfig, type Config } from "../core/config/index.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import { ToolRunner, projectTools } from "../core/tools/runner.ts";
import type { ToolCallRequest, ToolResult, ToolFilterParams, ToolFilterResult, WireConfig } from "../core/tools/types.ts";
import { setPageRenderer } from "../core/gallery/render.ts";
import { renderPageOffscreen } from "./pageRender.ts";

const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/local/*.ts", { eager: true }),
  // Plugin tools in the main-process tiers (general = permissionless, local = Node/fs-capable). A
  // plugin tool needing Node but not a workspace folder (e.g. MySQL) lives in local/ + sets needsWorkspace()=false.
  ...import.meta.glob<Record<string, unknown>>("../plugins/*/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../plugins/*/tools/local/*.ts", { eager: true }),
};

// Re-seeded from each call's wire before the registry touches it; the getter reads the current binding, so
// tools (and the clients they derive) see live config. The container rides on the wire (execTool) / params
// (toolFilter) and is passed to resolve(), so `this.container` in a tool is the active session's container.
let config: Config = getConfig();
// Exported so the host can hand it straight to plugin services (wirePluginTools) for runtime tool
// registration — plugins register into THIS registry, no separate registrar wrapper.
export const registry = new ToolRegistry(() => config, MODULES);
const runner = new ToolRunner(registry);
// Gallery pages render in main via an offscreen window — inject the platform muscle into the core port.
setPageRenderer(renderPageOffscreen);

export function toolFilter(wire: WireConfig, params: ToolFilterParams): ToolFilterResult {
  config = wire.config;
  return projectTools(registry.filter(params));
}

export async function execTool(call: ToolCallRequest, wire: WireConfig): Promise<ToolResult> {
  config = wire.config;
  if (!wire.container) return { ok: false, output: `tool call rejected: no container for "${call.name}".` };
  return (await runner.run(call, wire.container)) ?? { ok: false, output: `tool call rejected: unknown tool "${call.name}".` };
}

export function cancelTool(callId: string): void {
  runner.cancel(callId);
}
