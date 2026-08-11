// The execution half the registry no longer owns. The registry registers and resolves; the runner projects
// resolved tools into the serializable wire shape and dispatches calls, owning the in-flight AbortControllers
// (a signal can't cross the bridge, so cancellation travels by call id). Both platform adapters — web
// in-process and electron main — use these.

import type { ToolRegistry } from "./registry.ts";
import type { BaseTool } from "./base.ts";
import type { Container } from "../containers.ts";
import type { ToolCallRequest, ToolResult, ToolFilterResult } from "./types.ts";

// Project resolved tool instances into the serializable entries the renderer consumes (a BaseTool can't cross
// the bridge). Permission fields are already computed on each tool by filter().
export function projectTools(tools: Record<string, BaseTool>): ToolFilterResult {
  const out: ToolFilterResult = {};
  for (const [name, tool] of Object.entries(tools)) {
    out[name] = {
      name,
      schema: tool.schema,
      permissioned: tool.isPermissioned(),
      single: tool.single(),
      defaultPermission: tool.defaultPermission,
      currentPermission: tool.currentPermission,
    };
  }
  return out;
}

// Resolves a call's tool against its container and dispatches, tracking the controller by call id so cancel()
// can abort it. `tool.run` already parses args and wraps failures, so this stays thin. Returns null for an
// unknown tool (the gate at filter() time is the real guard; this only executes what already passed).
export class ToolRunner {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly reg: ToolRegistry) {}

  async run(call: ToolCallRequest, container: Container): Promise<ToolResult | null> {
    const tool = this.reg.resolve(call.name, container);
    if (!tool) return null;
    const controller = new AbortController();
    if (call.id) this.running.set(call.id, controller);
    try {
      return await tool.run(call, controller.signal);
    } finally {
      if (call.id) this.running.delete(call.id);
    }
  }

  cancel(callId: string): void {
    this.running.get(callId)?.abort();
  }
}
