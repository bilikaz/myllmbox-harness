import { mkdir } from "node:fs/promises";

import { type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { errorMessage } from "../../../lib/errors.ts";

export class CreateFolder extends BaseWorkspaceTool {
  static readonly schema: ToolSpec = {
      type: "function",
      function: {
        name: "CreateFolder",
        description: "Create a directory in the workspace (and any missing parents). Paths are under /workspace/ (the root), or relative.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Directory to create, e.g. /workspace/src/utils" } },
          required: ["path"],
        },
      },
    };

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const cwd = this.cwd() ?? "";
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `CreateFolder rejected: missing required "path".` };
    try {
      await mkdir(this.resolvePath(p, cwd), { recursive: true });
      return { ok: true, output: `created ${p}` };
    } catch (e) {
      return { ok: false, output: `error creating ${p}: ${errorMessage(e)}` };
    }
  }
}
