import { useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { ChevronRight, RefreshCw, Shrink } from "lucide-react";

import { contextLimit, useActiveSession, useCompacting } from "../../core/sessions/index.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { useProvider, useMediaRegistry, slotOptions } from "../../core/settings.ts";
import { containerTarget, getContainer } from "../../core/containers.ts";
import type { ModelService } from "../../llm/types.ts";
import { fmtTokens } from "../../lib/format.ts";
import { cn } from "../../lib/cn.ts";
import { ConfirmActions } from "../../components/ConfirmActions.tsx";
import { Modal } from "../../components/Modal.tsx";

// Right-panel contribution: the active session's context window — or, for generation sessions, the
// capabilities of the pinned media model (a context meter is meaningless when the model isn't the LLM).
export function ProgressPanel() {
  const session = useActiveSession();
  const provider = useProvider();
  const pool = containerTarget(getContainer(session.containerId)?.type);
  if (pool !== "text") return <CapabilitiesPanel pool={pool} />;
  return (
    <ContextWindow
      used={session.meta.usedTokens ?? 0}
      total={provider.model.contextLength}
      limit={contextLimit(provider)}
      sid={session.id}
    />
  );
}

// What the pinned (or pool-head) media model can do: output modality, accepted inputs, and the knobs
// the composer exposes. Replaces the token meter for image/video sessions.
function CapabilitiesPanel({ pool }: { pool: ModelService }) {
  const { t } = useTranslation();
  const session = useActiveSession();
  const registry = useMediaRegistry();
  const options = slotOptions(pool, registry);
  const pinned = session.meta.pinnedModel;
  const ref = pinned && options.some((o) => o.ref.providerId === pinned.providerId && o.ref.modelId === pinned.modelId) ? pinned : options[0]?.ref;
  const model = ref ? registry.providers.find((p) => p.id === ref.providerId)?.models.find((m) => m.id === ref.modelId) : undefined;
  const label = options.find((o) => o.ref.providerId === ref?.providerId && o.ref.modelId === ref?.modelId)?.label;
  if (!model) {
    return (
      <Card title={t("capabilities.title")}>
        <p className="text-sm text-neutral-500">{t("capabilities.noModel")}</p>
      </Card>
    );
  }
  const inputs = (["text", "image", "video", "audio"] as const).filter((k) => model.input?.[k]);
  return (
    <Card title={t("capabilities.title")}>
      <p className="truncate text-sm font-medium text-neutral-800">{label}</p>
      <dl className="mt-3 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-neutral-500">{t("capabilities.output")}</dt>
          <dd className="font-medium text-neutral-700">{t(`modality.${model.output}`)}</dd>
        </div>
        <div className="flex items-start justify-between gap-2">
          <dt className="text-neutral-500">{t("capabilities.inputs")}</dt>
          <dd className="text-right font-medium text-neutral-700">
            {inputs.length ? inputs.map((k) => t(`modality.${k}`)).join(", ") : t("capabilities.none")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-neutral-400">{t(`capabilities.hint_${pool}`)}</p>
    </Card>
  );
}

// `total` is the full context window, `limit` the usable budget (window − reserve); usage is shown against limit.
function ContextWindow({ used, total, limit, sid }: { used: number; total?: number; limit: number; sid: string }) {
  const { t } = useTranslation();
  if (!total || limit <= 0) {
    return (
      <Card title={t("progress.contextWindow")}>
        <p className="text-sm text-neutral-500">{t("progress.noModel", { used: fmtTokens(used) })}</p>
      </Card>
    );
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const left = Math.max(0, limit - used);
  const reserve = total - limit;
  const full = used >= limit;
  return (
    <Card title={t("progress.contextWindow")} action={<SummarizeControl sid={sid} ratio={used / limit} />}>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-neutral-500">
          {t("progress.used", { used: fmtTokens(used), total: fmtTokens(limit) })}
        </span>
        <span className={cn("font-medium", full ? "text-red-600" : "text-neutral-700")}>
          {full ? t("progress.full") : t("progress.left", { tokens: fmtTokens(left) })}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            full ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-blue-500",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-neutral-400">
        {t("progress.reserved", { reserve: fmtTokens(reserve), total: fmtTokens(total) })}
      </p>
    </Card>
  );
}

function SummarizeControl({ sid, ratio }: { sid: string; ratio: number }) {
  const { t } = useTranslation();
  const ctx = useCtx();
  const compacting = useCompacting();
  const [confirm, setConfirm] = useState(false);
  const hot = ratio >= 0.7; // turn the control red once context is 70% full
  return (
    <>
      <button
        type="button"
        onClick={() => setConfirm(true)}
        disabled={compacting}
        title={t("progress.summarizeHint")}
        className={cn(
          "-my-1 flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium hover:bg-neutral-100 disabled:opacity-50",
          hot ? "text-red-600" : "text-neutral-400",
        )}
      >
        {compacting ? <RefreshCw size={14} className="animate-spin" /> : <Shrink size={14} />}
        {compacting ? t("progress.summarizing") : t("progress.summarize")}
      </button>
      {confirm && (
        <Modal open onClose={() => setConfirm(false)} className="w-[min(480px,92vw)]">
          <div className="px-6 py-5">
            <h2 className="text-base font-semibold text-neutral-900">{t("progress.summarizeTitle")}</h2>
            <p className="mt-2 text-sm leading-relaxed text-neutral-600">
              <Trans i18nKey="progress.summarizeBody" components={{ b: <b /> }} />
            </p>
            <ConfirmActions
              className="mt-5 flex justify-end gap-2"
              cancelLabel={t("common.cancel")}
              confirmLabel={t("progress.summarize")}
              onCancel={() => setConfirm(false)}
              onConfirm={() => {
                setConfirm(false);
                void ctx.sessions.compact(sid);
              }}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

function Card(props: { title: string; chevron?: boolean; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">{props.title}</h3>
        {props.action ?? (props.chevron && <ChevronRight size={16} className="text-neutral-400" />)}
      </div>
      {props.children}
    </section>
  );
}

