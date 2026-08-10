import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { DetectButton, Row, fieldInput, fieldInputBare, fieldInputFlex, fieldInputFull } from "./Field.tsx";
import {
  addModel,
  addProvider,
  assignModels,
  detectProviderModels,
  providerCaps,
  removeModel,
  removeProvider,
  slotOptions,
  updateModel,
  updateProvider,
  useMediaRegistry,
  type MediaRegistry,
  type MediaModel,
  type MediaProvider,
  type ModelAssignment,
} from "../../core/settings.ts";
import { getAppConfig } from "../../core/config/index.ts";
import { fmtTokens } from "../../lib/format.ts";
import { MEDIA_SERVICES, type Modality, type ModelService, type ProviderKind, type ReasoningEffort } from "../../llm/types.ts";
import { useDetection } from "../../lib/hooks.ts";

// The 7 use-case pools ModelsSection orders into priority lists (`text` first — chat + sub-agent runs).
const USE_CASES: readonly ModelService[] = ["text", ...MEDIA_SERVICES];
const INPUTS: readonly Modality[] = ["text", "image", "video", "audio"];

// The provider dialects; media generation is the OpenAI Images/Videos API, so it rides the `openai` type.
const FLAVORS: readonly ProviderKind[] = ["openai", "anthropic", "gemini"];
const FLAVOR_KEY: Record<ProviderKind, string> = { openai: "apiOpenai", anthropic: "apiAnthropic", gemini: "apiGemini" };

const FIELD = "w-[28rem]";

export function ModelsSection() {
  const { t } = useTranslation();
  const reg = useMediaRegistry();
  // First-run (no providers, empty D1 store) opens on Providers so there's a way forward;
  // otherwise the Use-cases pools are the more useful landing.
  const [tab, setTab] = useState<"useCases" | "providers">(reg.providers.length ? "useCases" : "providers");

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold text-neutral-900">{t("providers.title")}</h2>
      <p className="mt-1 text-sm text-neutral-500">{t("providers.subtitle")}</p>

      <div className="mt-4 flex gap-1 border-b border-neutral-200">
        {(["useCases", "providers"] as const).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-sm ${
              tab === id
                ? "border-neutral-800 font-medium text-neutral-900"
                : "border-transparent text-neutral-500 hover:text-neutral-700"
            }`}
          >
            {t(`providers.tab.${id}`)}
          </button>
        ))}
      </div>

      {tab === "useCases" ? <UseCasesTab reg={reg} /> : <ProvidersTab reg={reg} />}
    </div>
  );
}

function UseCasesTab({ reg }: { reg: MediaRegistry }) {
  const { t } = useTranslation();
  return (
    <div>
      <p className="mt-3 text-xs text-neutral-400">{t("providers.poolHint")}</p>
      {USE_CASES.map((uc) => (
        <SlotRow key={uc} uc={uc} reg={reg} />
      ))}
    </div>
  );
}

const refKey = (r: ModelAssignment): string => `${r.providerId}|${r.modelId}`;

// An ordered priority pool: listed models (reorderable, removable) on top, an "add" picker
// for the rest. Position = priority — the runner fills the top with capacity first. Only models
// whose in/out qualifies them for this pool appear as options (the gate).
function SlotRow({ uc, reg }: { uc: ModelService; reg: MediaRegistry }) {
  const { t } = useTranslation();
  const options = slotOptions(uc, reg);
  const list = reg.assignments[uc] ?? [];
  const labelFor = (r: ModelAssignment): string => options.find((o) => refKey(o.ref) === refKey(r))?.label ?? refKey(r);
  const remaining = options.filter((o) => !list.some((r) => refKey(r) === refKey(o.ref)));
  const set = (next: ModelAssignment[]): void => assignModels(uc, next);
  const move = (i: number, d: number): void => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };
  return (
    <Row label={t(`providers.uc.${uc}`)}>
      <div className={`${FIELD} space-y-1`}>
        {list.map((r, i) => (
          <div key={refKey(r)} className="flex items-center gap-1 rounded-md border border-neutral-100 bg-neutral-50/50 px-2 py-1">
            <span className="w-4 shrink-0 text-xs text-neutral-400">{i + 1}</span>
            <span className="flex-1 truncate text-sm text-neutral-800">{labelFor(r)}</span>
            <button disabled={i === 0} onClick={() => move(i, -1)} className="p-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-30" title={t("providers.moveUp")}>
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button disabled={i === list.length - 1} onClick={() => move(i, 1)} className="p-0.5 text-neutral-400 hover:text-neutral-700 disabled:opacity-30" title={t("providers.moveDown")}>
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => set(list.filter((_, k) => k !== i))} className="p-0.5 text-neutral-400 hover:text-red-600" title={t("providers.removeFromPool")}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {remaining.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              const [providerId, modelId] = e.target.value.split("|");
              set([...list, { providerId, modelId }]);
            }}
            className={fieldInputFlex}
          >
            <option value="">{t("providers.addToPool")}</option>
            {remaining.map((o) => (
              <option key={refKey(o.ref)} value={refKey(o.ref)}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {list.length === 0 && remaining.length === 0 && <span className="text-xs text-neutral-400">{t("providers.noModels")}</span>}
      </div>
    </Row>
  );
}

function ProvidersTab({ reg }: { reg: MediaRegistry }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="mt-3 flex items-center justify-end">
        <button
          onClick={() => setOpen(addProvider())}
          className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          <Plus className="h-4 w-4" /> {t("providers.addProvider")}
        </button>
      </div>
      {reg.providers.length === 0 && <p className="mt-2 text-sm text-neutral-400">{t("providers.empty")}</p>}
      {reg.providers.map((p) => (
        <ProviderCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
      ))}
    </div>
  );
}

function ProviderCard(props: { p: MediaProvider; open: boolean; onToggle: () => void }) {
  const { p, open } = props;
  const { t } = useTranslation();
  const { detecting, msg, detect } = useDetection(
    () => detectProviderModels(p.id),
    (r) => (r.ok ? t("providers.found", { count: r.count }) : t("providers.failed", { error: r.error })),
  );

  return (
    <div className="mt-3 rounded-lg border border-neutral-200">
      <button onClick={props.onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
          {open ? <ChevronDown className="h-4 w-4 text-neutral-400" /> : <ChevronRight className="h-4 w-4 text-neutral-400" />}
          {p.name || "—"}
        </span>
        <span className="text-xs text-neutral-400">
          {t(`providers.${FLAVOR_KEY[p.api]}`)} · {t("providers.modelCount", { count: p.models.length })}
        </span>
      </button>

      {open && (
        <div className="border-t border-neutral-100 px-4 pb-4">
          <Row label={t("providers.providerName")}>
            <div className={FIELD}>
              <input
                value={p.name}
                onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                placeholder={t("providers.providerNamePlaceholder")}
                className={fieldInputFull}
              />
            </div>
          </Row>

          <Row label={t("providers.baseUrl")}>
            <div className={FIELD}>
              <input
                value={p.baseUrl}
                onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })}
                placeholder="http://localhost:8000/v1"
                className={fieldInputFull}
              />
            </div>
          </Row>

          <Row label={t("providers.apiKey")}>
            <div className={FIELD}>
              <input
                type="password"
                name={`provider-api-key-${p.id}`}
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={p.apiKey ?? ""}
                onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })}
                placeholder={t("providers.apiKeyPlaceholder")}
                className={fieldInputFull}
              />
            </div>
          </Row>

          <Row label={t("providers.api")}>
            <div className={FIELD}>
              <select
                value={p.api}
                onChange={(e) => updateProvider(p.id, { api: e.target.value as ProviderKind })}
                className={fieldInputFull}
              >
                {FLAVORS.map((f) => (
                  <option key={f} value={f}>
                    {t(`providers.${FLAVOR_KEY[f]}`)}
                  </option>
                ))}
              </select>
            </div>
          </Row>

          <div className="mt-3 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-neutral-700">{t("providers.models")}</h4>
            <DetectButton label={t("providers.detect")} busy={detecting} disabled={!p.baseUrl} title={t("providers.detectHint")} onClick={detect} />
          </div>
          {msg && <p className="py-1 text-xs text-neutral-500">{msg}</p>}

          {p.models.map((m) => (
            <ModelRow key={m.id} p={p} m={m} />
          ))}
          <AddModelRow p={p} />

          <div className="mt-4 flex justify-end border-t border-neutral-100 pt-3">
            <button
              onClick={() => removeProvider(p.id)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-400 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-4 w-4" /> {t("providers.removeProvider")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddModelRow({ p }: { p: MediaProvider }) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState("");
  const added = new Set(p.models.map((m) => m.modelId));
  const remaining = (p.detected ?? []).filter((d) => !added.has(d));
  const [pick, setPick] = useState("");

  if (remaining.length > 0) {
    return (
      <div className="mt-2 flex items-center gap-2">
        <select value={pick} onChange={(e) => setPick(e.target.value)} className={fieldInputFlex}>
          <option value="">{t("providers.pickModel")}</option>
          {remaining.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <button
          disabled={!pick}
          onClick={() => {
            addModel(p.id, pick);
            setPick("");
          }}
          className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {t("providers.addModel")}
        </button>
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-2">
      <input
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        placeholder={t("providers.customModelPlaceholder")}
        className={fieldInputFlex}
      />
      <button
        disabled={!custom.trim()}
        onClick={() => {
          addModel(p.id, custom.trim());
          setCustom("");
        }}
        className="flex items-center gap-1 rounded-md border border-neutral-200 px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
      >
        <Plus className="h-4 w-4" /> {t("providers.addModel")}
      </button>
    </div>
  );
}

// The per-model editor: two visually-separated axes — Input (what it accepts) and Output (what it
// produces) — which gate the pools it qualifies for. Text output reveals the chat knobs; image/video
// reveal max-size. Concurrency knobs sit above.
function ModelRow({ p, m }: { p: MediaProvider; m: MediaModel }) {
  const { t } = useTranslation();
  const outputs = providerCaps(p.api);
  const isText = m.output === "text";
  const cosmosSignal = m.promptStyle === "cosmos-json" || m.modelId.toLowerCase().includes("cosmos");
  const appCfg = getAppConfig();
  const minReserve = m.contextLength ? Math.floor(m.contextLength * appCfg.session.reserveMinFraction) : 0;
  const reserveBelowMin = minReserve > 0 && !!m.contextReserve && m.contextReserve < minReserve;

  return (
    <div className="mt-2 rounded-md border border-neutral-100 bg-neutral-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-medium text-neutral-800">{m.modelId || t("providers.defaultModel")}</span>
        <button
          onClick={() => removeModel(p.id, m.id)}
          title={t("providers.removeModel")}
          className="shrink-0 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Two axes: Input (accepted) and Output (produced) — these gate the pools it can join. */}
      <div className="mt-3 grid grid-cols-2 gap-4">
        <div className="rounded-md border border-neutral-200 bg-white p-2.5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("providers.input")}</p>
          <div className="flex flex-col gap-1">
            {INPUTS.map((mod) => (
              <label key={mod} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={!!m.input?.[mod]}
                  onChange={(e) => updateModel(p.id, m.id, { input: { ...m.input, [mod]: e.target.checked } })}
                />
                {t(`providers.mod.${mod}`)}
              </label>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-neutral-200 bg-white p-2.5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">{t("providers.output")}</p>
          <div className="flex flex-col gap-1">
            {outputs.map((mod) => (
              <label key={mod} className="flex items-center gap-1.5 text-sm text-neutral-700">
                <input
                  type="radio"
                  name={`output-${m.id}`}
                  checked={m.output === mod}
                  onChange={() => updateModel(p.id, m.id, { output: mod })}
                />
                {t(`providers.mod.${mod}`)}
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-neutral-600">
        <label className="flex items-center gap-1.5" title={t("providers.concurrencyHint")}>
          {t("providers.concurrency")}
          <input
            type="number"
            min={1}
            value={m.c ?? ""}
            placeholder="5"
            onChange={(e) => updateModel(p.id, m.id, { c: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)) })}
            className="w-16 rounded border border-neutral-200 px-1.5 py-0.5"
          />
        </label>
        {isText && (
          <label className="flex items-center gap-1.5" title={t("providers.reserveHint")}>
            {t("providers.reserve")}
            <input
              type="number"
              min={0}
              max={m.c ?? 5}
              value={m.reserve ?? ""}
              placeholder="2"
              // Clamp to c: reserve > c makes the runner's open band (c − reserve) negative and blocks every child.
              onChange={(e) => updateModel(p.id, m.id, { reserve: e.target.value === "" ? undefined : Math.min(m.c ?? 5, Math.max(0, Number(e.target.value))) })}
              className="w-16 rounded border border-neutral-200 px-1.5 py-0.5"
            />
          </label>
        )}
        <label className="flex items-center gap-1.5" title={t("providers.ratingHint")}>
          {t("providers.rating")}
          <input
            type="number"
            value={m.rating ?? ""}
            placeholder="0"
            onChange={(e) => updateModel(p.id, m.id, { rating: e.target.value === "" ? undefined : Number(e.target.value) })}
            className="w-16 rounded border border-neutral-200 px-1.5 py-0.5"
          />
        </label>
      </div>

      {/* Text-output knobs — folded in from the old Provider screen. */}
      {isText && (
        <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
          {m.contextLength != null && (
            <p className="text-xs text-neutral-500">{t("providers.contextWindow", { tokens: fmtTokens(m.contextLength) })}</p>
          )}
          <FieldLabel label={t("providers.reasoning")}>
            <select
              value={m.reasoningEffort ?? "off"}
              onChange={(e) => updateModel(p.id, m.id, { reasoningEffort: e.target.value as ReasoningEffort })}
              className={fieldInput}
            >
              {(["off", "low", "medium", "high", "xhigh", "max"] as const).map((r) => (
                <option key={r} value={r}>
                  {t(`providers.${r}`)}
                </option>
              ))}
            </select>
          </FieldLabel>
          {/* Anthropic ignores the token budget (ADR-0006) — hidden. */}
          {m.reasoningEffort && m.reasoningEffort !== "off" && p.api !== "anthropic" && (
            <FieldLabel label={t("providers.thinkingBudget")}>
              <input
                type="number"
                value={m.thinkingBudget ?? ""}
                onChange={(e) => updateModel(p.id, m.id, { thinkingBudget: e.target.value ? Number(e.target.value) : undefined })}
                placeholder={t("providers.noBudget")}
                className={fieldInput}
              />
            </FieldLabel>
          )}
          <FieldLabel label={t("providers.maxOutput")}>
            <input
              type="number"
              value={m.maxTokens ?? ""}
              onChange={(e) => updateModel(p.id, m.id, { maxTokens: e.target.value ? Number(e.target.value) : undefined })}
              placeholder={t("providers.providerDefault")}
              className={fieldInput}
            />
          </FieldLabel>
          {/* Manual context length — Detect pre-fills it when the endpoint reports max_model_len, but
              many don't, and it's what the context-window display + the reserve's 10% floor key off. */}
          <FieldLabel label={t("providers.contextLength")}>
            <input
              type="number"
              min={1}
              value={m.contextLength ?? ""}
              onChange={(e) => updateModel(p.id, m.id, { contextLength: e.target.value ? Number(e.target.value) : undefined })}
              placeholder={t("providers.contextLengthPlaceholder")}
              className={fieldInput}
            />
          </FieldLabel>
          <FieldLabel label={t("providers.contextReserve")}>
            <div className="flex w-[28rem] flex-col gap-1">
              <input
                type="number"
                name={`system-reserve-${m.id}`}
                autoComplete="off"
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                value={m.contextReserve ?? ""}
                min={minReserve || undefined}
                onChange={(e) => updateModel(p.id, m.id, { contextReserve: e.target.value ? Number(e.target.value) : undefined })}
                onBlur={(e) => {
                  const v = e.target.value ? Number(e.target.value) : undefined;
                  if (v !== undefined && minReserve && v < minReserve) updateModel(p.id, m.id, { contextReserve: minReserve });
                }}
                placeholder="50000"
                className={`w-full ${fieldInputBare} ${
                  reserveBelowMin ? "border-red-400 focus:border-red-500" : "border-neutral-200 focus:border-neutral-400"
                }`}
              />
              {minReserve > 0 && (
                <span className={`text-xs ${reserveBelowMin ? "text-red-600" : "text-neutral-400"}`}>
                  {reserveBelowMin
                    ? t("providers.reserveBelowMin", { min: fmtTokens(minReserve) })
                    : t("providers.reserveMin", { min: fmtTokens(minReserve) })}
                </span>
              )}
            </div>
          </FieldLabel>
          {m.input?.image && (
            <FieldLabel label={t("providers.imageMaxDim")}>
              <input
                type="number"
                min={1}
                value={m.imageMaxDim ?? ""}
                onChange={(e) => updateModel(p.id, m.id, { imageMaxDim: e.target.value ? Number(e.target.value) : undefined })}
                onBlur={(e) => {
                  // 0/negative would mean "downscale everything to nothing" — treat as unset.
                  const v = e.target.value ? Number(e.target.value) : undefined;
                  if (v !== undefined && v < 1) updateModel(p.id, m.id, { imageMaxDim: undefined });
                }}
                placeholder={String(appCfg.media.imageMaxDim)}
                className={fieldInput}
              />
            </FieldLabel>
          )}
        </div>
      )}

      {cosmosSignal && m.output === "image" && p.api === "openai" && (
        <label className="mt-2 flex items-center gap-1.5 text-sm text-neutral-700">
          <input
            type="checkbox"
            checked={m.promptStyle === "cosmos-json"}
            onChange={(e) => updateModel(p.id, m.id, { promptStyle: e.target.checked ? "cosmos-json" : "plain" })}
          />
          {t("providers.promptStyleCosmos")}
        </label>
      )}

      {m.output === "image" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-32 text-sm text-neutral-600">{t("providers.maxImageSize")}</span>
          <input
            value={m.maxImageSize ?? ""}
            onChange={(e) => updateModel(p.id, m.id, { maxImageSize: e.target.value })}
            placeholder="1280x1280"
            className={fieldInputFlex}
          />
        </div>
      )}
      {m.output === "video" && (
        <div className="mt-2 flex items-center gap-2">
          <span className="w-32 text-sm text-neutral-600">{t("providers.maxVideoSize")}</span>
          <input
            value={m.maxVideoSize ?? ""}
            onChange={(e) => updateModel(p.id, m.id, { maxVideoSize: e.target.value })}
            placeholder="1280x720"
            className={fieldInputFlex}
          />
        </div>
      )}
    </div>
  );
}

// A labelled field row inside the folded text-knobs block (mirrors the settings Row look).
function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-40 shrink-0 text-sm text-neutral-600">{label}</span>
      {children}
    </div>
  );
}
