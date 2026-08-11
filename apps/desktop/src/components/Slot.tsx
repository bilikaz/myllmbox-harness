import { Fragment } from "react";

import { contributionsFor, type Region } from "../lib/registry.ts";
import { usePluginsConfig } from "../core/plugins/config.ts";
import { getContainer, useActiveContainerId } from "../core/containers.ts";

// Renders every contribution registered for a region, in order. A plugin-owned contribution (pluginId
// set) renders only while its plugin is enabled — disabling a plugin removes its side blocks live. A
// contribution with `containers` set renders only for the active session's container type (task4 self-gate):
// on chat/session select the active-container store notifies, so every Slot re-gates in one pass.
export function Slot({ region }: { region: Region }) {
  const plugins = usePluginsConfig();
  const type = getContainer(useActiveContainerId())?.type;
  return (
    <>
      {contributionsFor(region)
        .filter((c) => !c.pluginId || plugins[c.pluginId]?.enabled)
        .filter((c) => !c.containers || (type != null && c.containers.includes(type)))
        .map((c) => (
          <Fragment key={c.id}>{c.render()}</Fragment>
        ))}
    </>
  );
}
