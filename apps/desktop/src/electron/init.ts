// Electron harness init — creates Ctx, installs the local per-entity persistence (SQLite, IndexedDB
// fallback) + the bridge-backed tool gateway + host api. Called from main.tsx. Tools run in MAIN
// (workspace tools need node:fs, unreachable under contextIsolation), so ctx.tools forwards everything
// over the bridge; the config snapshot rides on each call.

import { Ctx } from "../core/ctx.ts";
import { hydrateConsumers } from "../core/storage/consumer.ts";
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
import { sqliteRepos } from "./sqliteRepos.ts";
import { api } from "./bridge.ts";

export async function init(): Promise<Ctx> {
  const ctx = new Ctx();
  // Persistence: main-process SQLite (falls back to IndexedDB if node:sqlite can't open).
  const local = (await api!.storage.available()) ? sqliteRepos() : await idbRepos();
  ctx.storage = new StorageEngine(local);
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
  // Order matters: consumers + containers first, THEN sessions (a session resolves its
  // placement from its container, and a fresh profile binds a starter session to the default).
  await hydrateConsumers();
  await hydrateContainers();
  await hydrateAgents();
  await hydrateSessions();

  // All tools run in MAIN, over the bridge; the config snapshot rides on each call.
  ctx.tools = {
    filter: (params) => api!.tools.filter({ config: ctx.config }, params),
    run: (call) => api!.tools.exec(call, { config: ctx.config }),
    cancel: (id) => api!.tools.cancel(id),
  };
  // Desktop services come straight off the bridge (present because boot chose electron).
  ctx.api = {
    pickFolder: () => api!.pickFolder(),
    saveImage: (dataUrl, name) => api!.saveImage(dataUrl, name),
    saveVideo: (dataUrl, name) => api!.saveVideo(dataUrl, name),
    mediaModels: (ep) => api!.media.models(ep),
    readClipboardImage: () => api!.clipboardImage(),
    browser: api!.browser,
    invokePlugin: (slug, method, args) => api!.plugins.invoke(slug, method, args),
    onPluginEvent: (cb) => api!.plugins.onEvent(cb),
  };
  // ctx.api is now installed — subscribe the fleet to the host's browser load-state pushes.
  browserFleet().bindHostEvents();
  installEnabledPlugins(ctx);
  void ctx.sessions.reconcile(); // resume async sub-agent runs a restart interrupted (after the tool gateway is ready)
  return ctx;
}
