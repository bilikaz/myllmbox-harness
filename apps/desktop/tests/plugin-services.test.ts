// Regression: invokePluginService dispatch contract. The glob resolves the real src/plugins/*/plugin.ts
// (database + mcp + comics have one; review is serviceless with no tools — graph/agents only, no plugin.ts).
// constructPlugins builds them (registering their tools into a throwaway registry) so a real plugin is
// present for the dispatch checks. Guards the boot crash where an enabled serviceless plugin's "install"
// lifecycle phase threw `unknown plugin` instead of no-opping.
import { beforeAll, describe, expect, it } from "vitest";

import { ToolRegistry } from "../src/core/tools/registry.ts";
import { getConfig } from "../src/core/config/index.ts";
import { initTestCtx } from "./ctx.ts";
import { constructPlugins, invokePluginService } from "../src/electron/pluginServices.ts";

initTestCtx();

let reg: ToolRegistry;
beforeAll(() => {
  reg = new ToolRegistry(() => getConfig(), {});
  constructPlugins(reg);
});

describe("plugin self-registration", () => {
  it("a plugin registers its OWN tools into the registry at construction", () => {
    // database (service plugin) + comics (serviceless, tools-only) both register via registerTools().
    expect(reg.byName.has("DatabaseQuery")).toBe(true);
    expect(reg.byName.has("DatabaseConnections")).toBe(true);
    expect(reg.byName.has("MascotGenerate")).toBe(true);
    expect(reg.byName.has("PanelGenerate")).toBe(true);
  });
});

describe("invokePluginService", () => {
  it("no-ops install/uninstall for a plugin with no plugin.ts instead of throwing", async () => {
    await expect(invokePluginService("review", "install", [])).resolves.toBeUndefined();
    await expect(invokePluginService("review", "uninstall", [])).resolves.toBeUndefined();
  });

  it("still throws on an rpc call to a plugin with no service", async () => {
    await expect(invokePluginService("review", "status", [])).rejects.toThrow(/unknown plugin "review"/);
  });

  it("still throws on an unknown method of a real service", async () => {
    await expect(invokePluginService("database", "nope", [])).rejects.toThrow(/unknown plugin service "database\.nope"/);
  });
});
