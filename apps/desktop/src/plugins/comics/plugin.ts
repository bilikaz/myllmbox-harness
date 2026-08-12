// The Comics plugin — serviceless. Its only main-side job is registering its generate tools; they read the
// comics generationJob off session.meta, so they need no live service state (no `this` injected).

import { BasePlugin } from "../../core/plugins/base.ts";
import { MascotGenerate } from "./tools/local/mascotGenerate.ts";
import { PanelGenerate } from "./tools/local/panelGenerate.ts";

export class ComicsPlugin extends BasePlugin {
  protected override registerTools(): void {
    this.registry.register(MascotGenerate.schema.function.name, (c, ct) => new MascotGenerate(c, ct), this.slug);
    this.registry.register(PanelGenerate.schema.function.name, (c, ct) => new PanelGenerate(c, ct), this.slug);
  }

  uninstall(): void {}
  readonly rpc = {};
}
