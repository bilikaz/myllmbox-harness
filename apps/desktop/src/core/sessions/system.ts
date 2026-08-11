// The session's SYSTEM PROMPT — the ONE owner of what the model receives, shared by the engine
// (the wire call) and the SystemBanner (display) so neither can drift: base resolution
// (baseSystemFor), capability derivation (capabilitiesFor), and block assembly (composeSystem).
// The engine derives capabilities once per segment (it needs the tool specs for the call anyway)
// and composes per step; the banner recomposes from session state when no live capture exists.

import type { Ctx } from "../ctx.ts";
import { getContainer, ephemeralContainer, type Container } from "../containers.ts";
import { getAgent, type Agent } from "../agents.ts";
import { getAppConfig } from "../config/index.ts";
import { fill, pt } from "../prompts.ts";
import { enabledPluginPrompts } from "../plugins/config.ts";
import { supportedCounts } from "../gallery/catalog.ts";
import { browserFleet } from "../browser.ts";
import { engineToolSchemas } from "../tools/engine/dispatch.ts";
import type { EngineCtx } from "../tools/engine/base.ts";
import { RUN_AGENT } from "../tools/helpers/agents/catalog.ts";
import type { ToolFilterResult, ToolSpec } from "../tools/types.ts";
import type { Session } from "./types.ts";

export function baseSystemFor(session: Session | undefined): string {
  const containerMessage = getContainer(session?.containerId)?.config.instructions as string | undefined;
  return fill(session?.system || containerMessage || getAppConfig().systemPrompt || pt("defaultChat.system"));
}

// Which workspace + agent identity a session runs under. The workspace is purely the container type now
// (a Local container is the workspace); the old agent workspace opt-out is gone — a conversation agent run
// in a Local session gets the fs tools, like any other conversation session.
export function capabilityContext(session: Session | undefined): { ws: Container | undefined; agent: Agent | undefined } {
  const agent = session?.agentId ? getAgent(session.agentId) : undefined;
  const container = getContainer(session?.containerId);
  const ws = container?.type === "local" ? container : undefined;
  return { ws, agent };
}

// Everything capability-shaped a model step (or its display) derives from the session: the filtered
// registry tools + ceiling-clamped engine specs, and the access flags the capability blocks gate on.
export interface SessionCapabilities {
  ws?: Container;
  container: Container; // the session's container (or an ephemeral chat fallback) — passed to tools.run()
  agent?: Agent;
  isChild: boolean;
  filtered: ToolFilterResult;
  toolSpecs: ToolSpec[];
  fsAccess: boolean;
  wsToolNames: string[]; // the workspace (fs) tool names, for the workspace system-prompt block
  browserAccess: boolean;
}

export async function capabilitiesFor(app: Ctx, session: Session | undefined, signal?: AbortSignal): Promise<SessionCapabilities> {
  const { ws, agent } = capabilityContext(session);
  const isChild = !!session?.parentId;
  const container = getContainer(session?.containerId) ?? ephemeralContainer();
  const filtered = await app.tools.filter({ checkCanRun: true, container, agentPermissions: agent?.tools });
  // Workspace (fs) tools (for the prompt block) = those a non-workspace container wouldn't advertise. Isolate
  // the container-gate effect by re-filtering under a chat container (same permissions) and diffing — canRun
  // is the gate now.
  const baseline = ws ? await app.tools.filter({ checkCanRun: true, container: ephemeralContainer("chat", container.permissions), agentPermissions: agent?.tools }) : undefined;
  const wsToolNames = baseline ? Object.keys(filtered).filter((n) => !(n in baseline)) : [];
  const ceiling = (n: string): number => (agent?.tools ? (agent.tools[n] ?? agent.tools["*"] ?? 2) : 2);
  const ec: EngineCtx = { ctx: app, sessionId: session?.id ?? "", workspace: ws, signal: signal ?? new AbortController().signal, isChild, engine: app.sessions };
  const engineSpecs = engineToolSchemas(ec).filter((t) => ceiling(t.function.name) > 0);
  return {
    ws,
    container,
    agent,
    isChild,
    filtered,
    toolSpecs: [...Object.values(filtered).map((e) => e.schema as ToolSpec), ...engineSpecs],
    fsAccess: wsToolNames.length > 0,
    wsToolNames,
    browserAccess: !isChild && browserFleet().available(),
  };
}

// The FULL system prompt — base + plugin prompts + capability blocks. Every block is gated on the
// capability actually being CALLABLE (its tool in the specs / its access flag): prose naming a tool a
// session doesn't have gets that tool fabricated from the description in grounded sub chats. This list
// exists ONCE — the wire and the banner both render it.
export function composeSystem(session: Session | undefined, caps: SessionCapabilities): string | undefined {
  const has = (n: string): boolean => caps.toolSpecs.some((t) => t.function.name === n);
  const wsTools = caps.wsToolNames;
  return (
    [
      baseSystemFor(session),
      ...enabledPluginPrompts(),
      caps.fsAccess ? pt("workspace.system", { tools: wsTools.join(", ") }) : undefined,
      caps.browserAccess ? pt("browser.system") : undefined,
      has("GalleryCompose") ? pt("gallery.system", { counts: supportedCounts().join("/") }) : undefined,
      has(RUN_AGENT) ? pt("agents.system") : undefined,
      has(RUN_AGENT) ? pt("agents.async") : undefined,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined
  );
}

// Recompose for a caller without a live segment (the banner after a relaunch). Graph sessions never
// run model turns — their banner shows the base resolution only.
export async function fullSystemFor(app: Ctx, session: Session): Promise<string | undefined> {
  if (session.graphId) return baseSystemFor(session);
  return composeSystem(session, await capabilitiesFor(app, session));
}
