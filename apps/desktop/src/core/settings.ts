// Unified model settings — ONE provider registry (providers → models) plus the
// per-pool "active model" selection (services). A model declares what it OUTPUTS
// and what INPUTS it accepts; that in/out gates which of the 7 use-case pools it may
// join (see `qualifies`). config.llm is derived purely from `services`. The one
// "Providers" settings screen is a view onto this: the Providers tab manages the
// registry, the Use-cases tab orders the pools.

import { Consumer } from "./storage/consumer.ts";
import type { Ctx } from "./ctx.ts";
import {
  MEDIA_SERVICES,
  type MediaService,
  type Modality,
  type ModelService,
  type ProviderKind,
  type ReasoningEffort,
  type TextProviderKind,
} from "../llm/types.ts";
import { writeLLMConfig, type LLMConfig, type LLMConfigList } from "./config/llm.ts";
import { writeRunnerPools, type RunnerPools, type RunnerSlot } from "./config/pools.ts";
import { listProviderModels } from "../llm/index.ts";
import { errorMessage } from "../lib/errors.ts";

const KEY = "myllmbox-harness:settings";

const ALL_SERVICES: readonly ModelService[] = ["text", ...MEDIA_SERVICES];

// Per-model concurrency defaults — a model omits these until tuned.
const DEFAULT_C = 5;
const DEFAULT_RESERVE = 2;

export type MediaPromptStyle = "plain" | "cosmos-json";

// A model under a provider. It declares two axes — `output` (the modality it produces) and `input`
// (each modality it accepts, ALL explicit — nothing assumed). Those gate which pools it can join
// (`qualifies`). Chat knobs apply when output==="text"; media knobs when it outputs image/video.
export interface Model {
  id: string; // registry id
  modelId: string; // wire id
  output: Modality; // what it produces: text | image | video | audio
  input?: { text?: boolean; image?: boolean; video?: boolean; audio?: boolean }; // accepted inputs (explicit)
  // concurrency
  c?: number; // max concurrent in-flight calls (default 5)
  reserve?: number; // foreground-held slots on the text model (background sub-agent runs get the rest; default 2)
  rating?: number; // priority hint for ordering within a service pool (higher first)
  // chat knobs (output==="text")
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget?: number;
  contextLength?: number;
  imageMaxDim?: number;
  contextReserve?: number;
  // media knobs
  promptStyle?: MediaPromptStyle;
  maxImageSize?: string;
  maxVideoSize?: string;
}

// The gate: a model's output + accepted inputs decide which use-case pools it may join. A text-output
// model that accepts text is a chat model (`text` pool); accepting a media input adds the matching
// recognition pool. A media-output model joins its one output pool. Used to filter the assign UI (a
// model only appears as an option in pools it qualifies for) and to prune stale assignments.
export function qualifies(m: Model): ModelService[] {
  if (m.output === "text") {
    const out: ModelService[] = [];
    if (m.input?.text) out.push("text"); // chat (+ sub-agent runs)
    if (m.input?.image) out.push("imageRec");
    if (m.input?.video) out.push("videoRec");
    if (m.input?.audio) out.push("audioRec");
    return out;
  }
  return [m.output as ModelService]; // "image" | "video" | "audio"
}

export interface Provider {
  id: string;
  name: string;
  api: ProviderKind; // dialect: openai | anthropic | gemini | generate
  baseUrl: string;
  apiKey?: string;
  detected?: string[];
  modelLimits?: Record<string, number>; // detected wire id → max context length
  models: Model[];
}

export interface ModelAssignment {
  providerId: string;
  modelId: string; // Model.id (registry id)
}

export interface SettingsState {
  providers: Provider[];
  // Per service, the ORDERED priority pool (position = priority). Absent = empty.
  services: Partial<Record<ModelService, ModelAssignment[]>>;
}

// Compatibility aliases so the media screen keeps its vocabulary.
export type MediaProvider = Provider;
export type MediaModel = Model;
export type MediaRegistry = { providers: Provider[]; assignments: Partial<Record<ModelService, ModelAssignment[]>> };

// The flat chat-config view the sessions engine + chat UI consume (the `text` pool head).
export interface ChatModelSettings extends LLMConfig {
  input?: { text?: boolean; image?: boolean; video?: boolean; audio?: boolean };
  imageMaxDim?: number;
  contextReserve?: number;
  models?: string[];
  modelLimits?: Record<string, number>;
}

// Fresh install has NO seeded provider/model/assignment (D1 — bring-your-own-box: configure it first).
// A wiped store hydrates to empty pools; config.llm is {} until the user assigns models.
const DEFAULTS: SettingsState = { providers: [], services: {} };

// A stored row must match the current SettingsState shape or we discard it for DEFAULTS —
// resolvePools/chatView index `services[svc]` as arrays, so a legacy/corrupt shape would throw.
function isModelAssignment(x: unknown): boolean {
  return !!x && typeof x === "object" && typeof (x as ModelAssignment).providerId === "string" && typeof (x as ModelAssignment).modelId === "string";
}
function isValidSettings(s: unknown): s is SettingsState {
  if (!s || typeof s !== "object") return false;
  const { providers, services } = s as SettingsState;
  if (!Array.isArray(providers)) return false;
  if (!providers.every((p) => p && typeof p === "object" && typeof p.id === "string" && Array.isArray(p.models))) return false;
  if (!services || typeof services !== "object" || Array.isArray(services)) return false;
  return Object.values(services).every((pool) => Array.isArray(pool) && pool.every(isModelAssignment));
}

const newId = (): string => crypto.randomUUID();

// The output modalities a provider's models may declare (the model editor's Output choices). Media
// generation is the OpenAI Images/Videos API only, so anthropic/gemini providers are text-output only.
export function providerCaps(api: ProviderKind): readonly Modality[] {
  return api === "openai" ? ["text", "image", "video", "audio"] : ["text"];
}

function findModel(providers: Provider[], ref: ModelAssignment | undefined): { p: Provider; m: Model } | null {
  if (!ref) return null;
  const p = providers.find((x) => x.id === ref.providerId);
  const m = p?.models.find((x) => x.id === ref.modelId);
  return p && m ? { p, m } : null;
}

function pruneServices(
  services: SettingsState["services"],
  providers: Provider[],
): SettingsState["services"] {
  const out: SettingsState["services"] = {};
  for (const svc of ALL_SERVICES) {
    // A model stays in a pool only while its in/out still qualifies it for that pool (the gate).
    const kept = (services[svc] ?? []).filter((ref) => {
      const hit = findModel(providers, ref);
      return !!hit && qualifies(hit.m).includes(svc);
    });
    if (kept.length) out[svc] = kept;
  }
  return out;
}

class Settings extends Consumer<SettingsState> {
  constructor(ctx: Ctx) {
    super(ctx, KEY, DEFAULTS);
  }

  // Reject a row whose shape doesn't match SettingsState (legacy/corrupt) — DEFAULTS, never a throw.
  protected override parse(raw: string): SettingsState {
    try {
      const s = { ...DEFAULTS, ...(JSON.parse(raw) as object) };
      return isValidSettings(s) ? s : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  }

  // Derived views are cached so the React hooks return a STABLE reference until
  // state changes (useSyncExternalStore requires it — a fresh object per call loops).
  private chatCache: ChatModelSettings | null = null;
  private regCache: MediaRegistry | null = null;

  // Re-derive config.llm on every change (replaces the old syncMain/syncMedia),
  // and drop the cached views so the next read rebuilds them.
  protected override notify(): void {
    this.chatCache = null;
    this.regCache = null;
    const slice: LLMConfigList = {};
    for (const svc of ALL_SERVICES) slice[svc] = this.resolveConfig(svc) ?? undefined;
    writeLLMConfig(slice);
    writeRunnerPools(this.resolvePools());
    super.notify();
  }

  // ── resolution ────────────────────────────────────────────────────────────
  // Flatten a provider+model into a call target; null when the provider has no endpoint.
  private toConfig(p: Provider, m: Model): LLMConfig | null {
    if (!p.baseUrl) return null;
    return {
      provider: { name: p.name, type: p.api, baseUrl: p.baseUrl, apiKey: p.apiKey },
      model: {
        id: m.modelId || undefined,
        maxTokens: m.maxTokens,
        reasoningEffort: m.reasoningEffort,
        thinkingBudget: m.thinkingBudget,
        contextLength: m.contextLength,
        promptStyle: m.promptStyle,
        maxImageSize: m.maxImageSize,
        maxVideoSize: m.maxVideoSize,
      },
      input: m.input,
    };
  }

  // The single derived config for a service is its PRIMARY (pool head) — keeps every
  // existing config.llm[service] consumer working off one target.
  resolveConfig(service: ModelService): LLMConfig | null {
    const hit = findModel(this.state.providers, (this.state.services[service] ?? [])[0]);
    return hit ? this.toConfig(hit.p, hit.m) : null;
  }

  // Resolve a SPECIFIC pool member (a pinned pick) to a call target — a generation session uses this to
  // override the pool head with the user's chosen model. Null if the ref no longer resolves (deleted/moved).
  resolveByRef(ref: ModelAssignment): LLMConfig | null {
    const hit = findModel(this.state.providers, ref);
    return hit ? this.toConfig(hit.p, hit.m) : null;
  }

  // The full ordered pool per service for the concurrency runner. `reserve` (foreground-held slots)
  // applies only on the `text` pool — background sub-agent runs share it and get the open band (c − reserve).
  private resolvePools(): RunnerPools {
    const { providers, services } = this.state;
    const out: RunnerPools = {};
    for (const svc of ALL_SERVICES) {
      const slots: RunnerSlot[] = [];
      for (const ref of services[svc] ?? []) {
        const hit = findModel(providers, ref);
        const config = hit && this.toConfig(hit.p, hit.m);
        if (!hit || !config) continue;
        const reserve = svc === "text" ? hit.m.reserve ?? DEFAULT_RESERVE : 0;
        slots.push({ providerId: ref.providerId, modelId: ref.modelId, config, c: hit.m.c ?? DEFAULT_C, reserve });
      }
      if (slots.length) out[svc] = slots;
    }
    return out;
  }

  // ── chat (`text` pool head) view ─────────────────────────────────────────────
  private chatView(): ChatModelSettings {
    if (this.chatCache) return this.chatCache;
    const hit = findModel(this.state.providers, (this.state.services.text ?? [])[0]);
    const v: ChatModelSettings = !hit
      ? { provider: { name: "", type: "openai", baseUrl: "" }, model: {}, models: [] }
      : {
          provider: { name: hit.p.name, type: hit.p.api as TextProviderKind, baseUrl: hit.p.baseUrl, apiKey: hit.p.apiKey },
          model: {
            id: hit.m.modelId,
            maxTokens: hit.m.maxTokens,
            reasoningEffort: hit.m.reasoningEffort,
            thinkingBudget: hit.m.thinkingBudget,
            contextLength: hit.m.contextLength,
          },
          input: hit.m.input,
          imageMaxDim: hit.m.imageMaxDim,
          contextReserve: hit.m.contextReserve,
          models: hit.p.detected ?? [],
          modelLimits: hit.p.modelLimits ?? {},
        };
    this.chatCache = v;
    return v;
  }

  chat(): ChatModelSettings {
    return this.chatView();
  }
  // null when unconfigured (no endpoint / no model) — the no-model guard reads this.
  chatOrNull(): ChatModelSettings | null {
    const v = this.chatView();
    return v.provider.baseUrl && v.model.id ? v : null;
  }

  // ── registry CRUD (the Providers section) ────────────────────────────────────
  registry(): MediaRegistry {
    return (this.regCache ??= { providers: this.state.providers, assignments: this.state.services });
  }

  addProvider(): string {
    const id = newId();
    const taken = new Set(this.state.providers.map((p) => p.name));
    let n = this.state.providers.length + 1;
    while (taken.has(`Provider ${n}`)) n++;
    this.commit({ ...this.state, providers: [...this.state.providers, { id, name: `Provider ${n}`, api: "openai", baseUrl: "", models: [] }] });
    return id;
  }

  updateProvider(id: string, patch: Partial<Omit<Provider, "id" | "models">>): void {
    const providers = this.state.providers.map((p) => {
      if (p.id !== id) return p;
      const next: Provider = { ...p, ...patch, id };
      // Dialect changed: clamp each model's output to the new dialect's caps so stored state can't
      // disagree with the editor's Output radio (e.g. openai→anthropic drops image output to text).
      if (patch.api && patch.api !== p.api) {
        const allowed = providerCaps(next.api);
        next.models = next.models.map((m) => (allowed.includes(m.output) ? m : { ...m, output: allowed[0] }));
      }
      return next;
    });
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  removeProvider(id: string): void {
    const providers = this.state.providers.filter((p) => p.id !== id);
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  addModel(providerId: string, wireId: string): string {
    const id = newId();
    // A new model defaults to a text (chat) model accepting text — so it shows up as a `text` pool
    // option out of the box; the editor's Output/Input toggles change it for a media model.
    const providers = this.state.providers.map((p) => {
      if (p.id !== providerId) return p;
      const seed: Model = { id, modelId: wireId, output: "text", input: { text: true } };
      // Carry the context length the /models card already reported for this wire id (Detect fills
      // p.modelLimits). Without this, adding a detected model after Detect drops its window and the
      // 10% reserve can't engage until a re-detect — the regression the two-screen merge introduced.
      const len = p.modelLimits?.[wireId];
      if (len) seed.contextLength = len;
      if (wireId.toLowerCase().includes("cosmos")) seed.promptStyle = "cosmos-json";
      return { ...p, models: [...p.models, seed] };
    });
    this.commit({ ...this.state, providers });
    return id;
  }

  // Patch a model, then prune any pool it no longer qualifies for (the gate). Pool MEMBERSHIP is set
  // explicitly in the Use-cases tab — changing in/out never auto-joins, only removes what stopped qualifying.
  updateModel(providerId: string, modelId: string, patch: Partial<Omit<Model, "id">>): void {
    const providers = this.state.providers.map((p) =>
      p.id === providerId ? { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, ...patch, id: m.id } : m)) } : p,
    );
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  removeModel(providerId: string, modelId: string): void {
    const providers = this.state.providers.map((p) => (p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p));
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  // Set a service's whole ordered pool (position = priority). Empty clears it.
  assign(service: ModelService, refs: ModelAssignment[]): void {
    const services = { ...this.state.services };
    if (refs.length) services[service] = refs;
    else delete services[service];
    this.commit({ ...this.state, services });
  }

  slotOptions(service: ModelService, reg: MediaRegistry): Array<{ ref: ModelAssignment; label: string }> {
    const out: Array<{ ref: ModelAssignment; label: string }> = [];
    for (const p of reg.providers) {
      for (const m of p.models) {
        if (!qualifies(m).includes(service)) continue; // the gate: only models qualifying for this pool
        out.push({ ref: { providerId: p.id, modelId: m.id }, label: m.modelId ? `${p.name} : ${m.modelId}` : p.name });
      }
    }
    return out;
  }

  // Detect a provider's models via the direct llm /models listing (yields context lengths when the
  // endpoint reports max_model_len). Sets the detected list + per-model limits on the provider, and
  // each matching model's contextLength — restoring the context-window display. Endpoints that omit
  // max_model_len leave contextLength unset; the editor's manual Context length field covers that.
  async detect(id: string): Promise<{ ok: boolean; count: number; error?: string }> {
    const provider = this.state.providers.find((p) => p.id === id);
    if (!provider) return { ok: false, count: 0, error: "provider not found" };
    try {
      const infos = await listProviderModels({ name: provider.name, type: provider.api, baseUrl: provider.baseUrl, apiKey: provider.apiKey });
      const detected = infos.map((i) => i.id);
      const modelLimits: Record<string, number> = {};
      for (const i of infos) if (i.maxModelLen) modelLimits[i.id] = i.maxModelLen;
      const providers = this.state.providers.map((p) =>
        p.id !== id
          ? p
          : {
              ...p,
              detected,
              modelLimits,
              // Only text models read contextLength (the chat window); don't stamp it on media models.
              models: p.models.map((m) => (m.output === "text" && modelLimits[m.modelId] ? { ...m, contextLength: modelLimits[m.modelId] } : m)),
            },
      );
      this.commit({ ...this.state, providers });
      return { ok: true, count: detected.length };
    } catch (e) {
      return { ok: false, count: 0, error: errorMessage(e) };
    }
  }

  useChat = (): ChatModelSettings => this.useSelect(() => this.chatView());
  useRegistry = (): MediaRegistry => this.useSelect(() => this.registry());
}

let inst: Settings;
export function initSettings(ctx: Ctx): Settings {
  inst = new Settings(ctx);
  return inst;
}

// ── Chat (`text` pool head) read facades (sessions + chat UI) ─────────────────
export const getProvider = (): ChatModelSettings => inst.chat();
export const useProvider = (): ChatModelSettings => inst.useChat();
export const resolveMain = (): ChatModelSettings | null => inst.chatOrNull();

// ── Registry facades (the Providers section) ──────────────────────────────────
export const getMediaRegistry = (): MediaRegistry => inst.registry();
export const useMediaRegistry = (): MediaRegistry => inst.useRegistry();
export const addProvider = (): string => inst.addProvider();
export const updateProvider = (id: string, patch: Partial<Omit<Provider, "id" | "models">>): void => inst.updateProvider(id, patch);
export const removeProvider = (id: string): void => inst.removeProvider(id);
export const addModel = (providerId: string, wireId: string): string => inst.addModel(providerId, wireId);
export const updateModel = (providerId: string, modelId: string, patch: Partial<Omit<Model, "id">>): void => inst.updateModel(providerId, modelId, patch);
export const removeModel = (providerId: string, modelId: string): void => inst.removeModel(providerId, modelId);
export const assignModels = (service: ModelService, refs: ModelAssignment[]): void => inst.assign(service, refs);
export const slotOptions = (useCase: ModelService, reg: MediaRegistry): Array<{ ref: ModelAssignment; label: string }> => inst.slotOptions(useCase, reg);
export const detectProviderModels = (id: string): Promise<{ ok: boolean; count: number; error?: string }> => inst.detect(id);

// config.llm resolution for any service (used by media tools).
export function resolveMediaProvider(useCase: MediaService): LLMConfig | null {
  return inst.resolveConfig(useCase);
}

// Resolve a specific pinned pick ({providerId, modelId}) to a call target (generation sessions).
export function resolveModelRef(ref: ModelAssignment): LLMConfig | null {
  return inst.resolveByRef(ref);
}
