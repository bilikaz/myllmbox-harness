// Web harness init — creates Ctx, installs the local per-entity persistence (IndexedDB) + tools +
// the browser host api. Called once from renderer/main.tsx.

import { Ctx } from "../core/ctx.ts";
import { hydrateConsumers } from "../core/storage/consumer.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import { ToolRunner, projectTools } from "../core/tools/runner.ts";
import { initAppConfig } from "../core/config/app.ts";
import { initSettings } from "../core/settings.ts";
import { initPluginsConfig, installEnabledPlugins } from "../core/plugins/config.ts";
import { initPluginData } from "../core/plugins/data.ts";
import { registerPluginManifests, registerPluginGraphs, registerPluginAgents } from "../core/plugins/boot.ts";
import { initAgents, hydrateAgents } from "../core/agents.ts";
import { initUi } from "../core/ui.ts";
import { initBrowser, browserFleet } from "../core/browser.ts";
import { initContainers, hydrateContainers } from "../core/containers.ts";
import { hydrate as hydrateSessions, setSessionStorage } from "../core/sessions/store.ts";
import { StorageEngine } from "../core/storage/engine.ts";
import { gateDataVersion } from "../core/storage/version.ts";
import { idbRepos } from "../core/storage/idb.ts";
import type { HostApi, MediaModelsResult, MediaEndpoint } from "../core/host.ts";
import { errorMessage } from "../lib/errors.ts";

// Web runs all in-process (renderer): core general tools only (no workspace/fs tier). Plugins register their
// own tools main-side (plugin.ts), and no plugin ships a renderer-side tool — so there's no plugin glob here.
const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
};
// The browser host api: save = download via an <a>, mediaModels = a direct fetch. No folder picker in the browser.
function browserHost(): HostApi {
  // The browser can't observe save vs. cancel — it triggers a download and resolves with the filename it used.
  const download = (dataUrl: string, suggestedName?: string): Promise<string | null> => {
    const name = suggestedName ?? "download";
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = name;
    document.body.appendChild(a); // some browsers only fire the download when the anchor is in the DOM
    a.click();
    a.remove();
    return Promise.resolve(name);
  };
  return {
    saveImage: download,
    saveVideo: download,
    async mediaModels(ep: MediaEndpoint): Promise<MediaModelsResult> {
      if (!ep.baseUrl) return { ok: false, models: [], error: "no base URL set" };
      try {
        const res = await fetch(`${ep.baseUrl.replace(/\/$/, "")}/models`, {
          headers: ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {},
        });
        if (!res.ok) return { ok: false, models: [], error: `${res.status} ${res.statusText}` };
        const data = (await res.json()) as { data?: Array<{ id?: string }> };
        const models = (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
        return { ok: true, models };
      } catch (e) {
        return { ok: false, models: [], error: errorMessage(e) };
      }
    },
  };
}

export async function init(): Promise<Ctx> {
  const ctx = new Ctx();
  // Persistence: per-entity repositories in IndexedDB.
  ctx.storage = new StorageEngine(await idbRepos());
  await gateDataVersion(ctx.storage); // wipe local data if it's from an older incompatible build (before anything reads it)
  setSessionStorage(ctx.storage); // inject into the session store (SessionEngine ran before ctx.storage existed)

  // Register plugin manifests before config derives config.plugins from them; graphs + agents alongside
  // (agents register before hydrate so hydrate can prune any earlier-seeded rows).
  registerPluginManifests();
  registerPluginGraphs();
  registerPluginAgents();

  // Construct the ctx-injected consumers, then load them all from the backend.
  initAppConfig(ctx);
  initSettings(ctx);
  initPluginsConfig(ctx);
  initPluginData(ctx);
  initAgents(ctx);
  initUi(ctx);
  initBrowser(ctx);
  initContainers(ctx);
  await hydrateConsumers();
  await hydrateContainers();
  await hydrateAgents();
  await hydrateSessions();

  // Web runs tools in-process: the registry resolves each factory against the call's container, the runner
  // dispatches, and projectTools flattens resolved instances to the serializable wire shape the UI reads.
  const reg = new ToolRegistry(() => ctx.config, MODULES);
  const runner = new ToolRunner(reg);
  ctx.tools = {
    filter: (params) => projectTools(reg.filter(params)),
    run: (call, container) => runner.run(call, container),
    cancel: (id) => runner.cancel(id),
  };
  ctx.api = browserHost();
  browserFleet().bindHostEvents(); // no-op on the web host (no fleet), kept symmetric with electron
  installEnabledPlugins(ctx);
  void ctx.sessions.reconcile(); // resume async sub-agent runs a restart interrupted (after the tool gateway is ready)
  return ctx;
}
