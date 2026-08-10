import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, Plus, Square } from "lucide-react";

import { useProvider, useMediaRegistry, slotOptions } from "../../core/settings.ts";
import { effectiveImageMaxDim, getAppConfig } from "../../core/config/index.ts";
import { clipboardFiles, readAttachments } from "../../lib/attachments.ts";
import { b64ToBytes, parseDataUrl } from "../../lib/dataUrl.ts";
import { useCtx } from "../../renderer/ctx.tsx";
import { navigate } from "../../lib/router.ts";
import { AttachmentList } from "../../components/AttachmentList.tsx";
import { useActiveSession, setPinnedModel, setGen } from "../../core/sessions/index.ts";
import { consumePendingAttachment, usePendingAttachment } from "../../core/ui.ts";
import type { ModelService } from "../../llm/types.ts";
import type { FileAttachment, Image, Video } from "../../lib/types.ts";
import type { Attachments } from "../../core/sessions/index.ts";

// Generation knob choices — mirror the ImageGenerate/VideoGenerate arg enums (kept inline: a UI concern,
// the tool schemas are the source of truth for what the model may pass).
const ASPECT_OPTS = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const;
const QUALITY_OPTS = ["low", "good", "super"] as const;

// Message composer shared by chat and agent runs — owns its input state; the parent owns what submit means.
export function Composer(props: {
  seed?: string;
  disabled?: boolean; // blocks send (context full, compacting, missing workspace)
  modelLabel?: string; // the model that actually answered this chat; falls back to the configured head
  streaming?: boolean;
  lock?: boolean; // hard-lock the input itself (a running sub-agent: stop it to guide it)
  lockNote?: string; // placeholder shown while locked
  // Generation sessions (task 3): the container's media pool. Unset/"text" is a normal chat composer;
  // "image"/"video" turn it into a generation composer (inline model picker, knob bar, ref-only attach).
  target?: ModelService;
  // The main chat composer sets this so it (and only it, avoiding a race with the child/agent/browser
  // composers) picks up a Send-to-chat attachment. See core/ui.ts sendMediaToChat.
  consumesPending?: boolean;
  onStop?: () => void;
  onSubmit: (text: string, atts: Attachments) => void;
}) {
  const { t } = useTranslation();
  const provider = useProvider();
  const ctx = useCtx();
  const session = useActiveSession();
  const registry = useMediaRegistry();
  const [input, setInput] = useState(props.seed ?? "");
  const [images, setImages] = useState<Image[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [attachNote, setAttachNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Generation mode: derived from the container's pool. `image` sessions accept an image attachment as
  // an ImageEdit reference; `video` sessions are text→video only in v1 (no reference param). The picker
  // pins a model per session; the knob bar sets aspect/quality/(duration) per session.
  const gen = props.target === "image" || props.target === "video";
  const pool: ModelService = props.target ?? "text";
  const genOptions = gen ? slotOptions(pool, registry) : [];
  const pinned = session.meta.pinnedModel;
  const pinnedRef =
    pinned && genOptions.some((o) => o.ref.providerId === pinned.providerId && o.ref.modelId === pinned.modelId)
      ? pinned
      : genOptions[0]?.ref;
  const pinnedLabel = genOptions.find((o) => o.ref.providerId === pinnedRef?.providerId && o.ref.modelId === pinnedRef?.modelId)?.label;
  // Attach = ImageEdit reference. Gate on the resolved model's declared input (task 2's capability
  // model), NOT the pool: a pure text→image model pinned to an image session can't take a reference, so
  // the composer must not offer one. Video takes no reference in v1.
  const genModel = gen && pinnedRef ? registry.providers.find((p) => p.id === pinnedRef.providerId)?.models.find((m) => m.id === pinnedRef.modelId) : undefined;
  const canRef = pool === "image" && !!genModel?.input?.image;
  const cfg = getAppConfig();
  const knobs = session.meta.gen ?? {};
  const aspect = knobs.aspect ?? (pool === "video" ? "16:9" : "1:1");
  const quality = knobs.quality ?? "good";
  const duration = knobs.duration ?? cfg.videoGen.defaultDurationS;
  const patchGen = (p: NonNullable<typeof session.meta.gen>): void => setGen(session.id, { ...knobs, ...p });

  // A busy session QUEUES a text message (the pending inbox — delivered at the next cycle
  // boundary); attachments can't ride a pending record yet, so they still wait for idle.
  const hasAtts = images.length > 0 || videos.length > 0 || files.length > 0;
  const canSend = gen
    ? // Generation needs a prompt + a configured pool model, and can't overlap a running generation.
      input.trim().length > 0 && genOptions.length > 0 && !props.streaming && !props.disabled
    : (input.trim().length > 0 || hasAtts) && !(props.streaming && hasAtts) && !props.disabled;

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  async function addAttachments(list: FileList | File[]) {
    const maxDim = effectiveImageMaxDim(provider.imageMaxDim);
    const caps = getAppConfig().media;
    const { images: imgs, video: vids, files: fs, skipped, resized } = await readAttachments(list, {
      imageMaxDim: maxDim,
      imageMaxBytes: caps.imageMaxBytes,
      gifMaxBytes: caps.gifMaxBytes,
      videoMaxBytes: caps.videoMaxBytes,
    });
    if (imgs.length) {
      if (gen) {
        // Generation composer: an image is an ImageEdit reference — only when the pinned image model
        // actually accepts image input. Video (and text→image models) take no reference.
        if (canRef) {
          setImages((prev) => [...prev, ...imgs]);
          setAttachNote(t("session.imageRefEdit"));
        } else setAttachNote(t("session.noGenRef"));
      } else if (provider.input?.image === false) {
        // The chat model can't SEE images, but a configured image model can still USE one as a
        // generation reference (the ref annotation rides the message) — attach with a note.
        if (ctx.llm.resolve("image")) {
          setImages((prev) => [...prev, ...imgs]);
          setAttachNote(t("session.imageRefOnly"));
        } else setAttachNote(t("session.noImageSupport"));
      } else {
        setImages((prev) => [...prev, ...imgs]);
        setAttachNote("");
      }
    }
    if (vids.length) {
      if (gen) setAttachNote(t("session.noGenRef"));
      else if (!provider.input?.video) setAttachNote(t("session.noVideoSupport"));
      else {
        setVideos((prev) => [...prev, ...vids]);
        setAttachNote("");
      }
    }
    if (fs.length && !gen) setFiles((prev) => [...prev, ...fs]);
    // Notes last so the accept paths can't clear them; skip outranks resize when both apply.
    if (resized.length) setAttachNote(t("session.attachResized", { names: resized.join(", "), max: maxDim }));
    if (skipped.length) setAttachNote(t("session.attachTooBig", { names: skipped.join(", ") }));
  }

  async function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const el = e.target;
    if (el.files?.length) await addAttachments(el.files);
    el.value = ""; // allow re-picking the same file
  }

  // Window-level paste: clipboard media lands in the composer from anywhere on the view — no need to
  // focus the textarea first (a screenshot → Ctrl+V is the whole flow). Other editable elements keep
  // their native paste; loose text pasted outside any input is dropped into the composer, focused.
  // Ref-to-latest so the document listener is registered once but sees current props/closures.
  const docPaste = useRef<(e: ClipboardEvent) => void>(() => {});
  docPaste.current = (e: ClipboardEvent) => {
    if (props.lock) return;
    const target = e.target as HTMLElement | null;
    const composerInput = inputRef.current;
    const inOtherEditable =
      target !== composerInput &&
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || !!target?.isContentEditable);
    if (inOtherEditable) return;
    const files = clipboardFiles(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      void addAttachments(files);
      composerInput?.focus();
      return;
    }
    const text = e.clipboardData?.getData("text");
    if (text && target !== composerInput) {
      e.preventDefault();
      setInput((prev) => prev + text);
      composerInput?.focus();
      return;
    }
    // Neither files nor text: an OS-clipboard bitmap Electron's DOM paste event didn't carry —
    // read it from main (absent on web, where clipboardData covers it).
    if (!text && ctx.api.readClipboardImage) {
      void ctx.api.readClipboardImage().then((url) => {
        const parsed = url ? parseDataUrl(url) : null;
        if (!parsed) return;
        // Time-suffixed so repeated pastes stay distinguishable (the name is display + save suggestion only).
        void addAttachments([new File([new Uint8Array(b64ToBytes(parsed.b64))], `pasted-${Date.now()}.png`, { type: parsed.mime })]);
        composerInput?.focus();
      });
    }
  };
  useEffect(() => {
    const h = (e: ClipboardEvent): void => docPaste.current(e);
    document.addEventListener("paste", h);
    return () => document.removeEventListener("paste", h);
  }, []);

  // Send-to-chat: only the main chat composer consumes the pending attachment (generation composers and
  // sub-agent/browser composers don't), so a routed image/video lands exactly once, in the chat.
  const pendingAtt = usePendingAttachment();
  useEffect(() => {
    if (!props.consumesPending || gen || !pendingAtt) return;
    const p = consumePendingAttachment();
    if (!p) return;
    const media = { url: p.url, name: p.name, mime: p.mime };
    if (p.kind === "image") setImages((prev) => [...prev, media]);
    else setVideos((prev) => [...prev, media]);
    inputRef.current?.focus();
  }, [pendingAtt, props.consumesPending, gen]);

  function submit() {
    if (!canSend) return;
    const text = input.trim();
    const atts: Attachments = {
      images: images.length ? images : undefined,
      videos: videos.length ? videos : undefined,
      files: files.length ? files : undefined,
    };
    setInput("");
    setImages([]);
    setVideos([]);
    setFiles([]);
    setAttachNote("");
    props.onSubmit(text, atts);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <>
      <div className="mx-auto max-w-3xl rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <AttachmentList
          className="mb-2 px-1"
          images={images}
          videos={videos}
          files={files}
          // The note describes the last attach action — any change to the attachment set clears it as stale.
          onRemoveImage={(i) => {
            setImages((prev) => prev.filter((_, j) => j !== i));
            setAttachNote("");
          }}
          onRemoveVideo={(i) => {
            setVideos((prev) => prev.filter((_, j) => j !== i));
            setAttachNote("");
          }}
          onRemoveFile={(i) => {
            setFiles((prev) => prev.filter((_, j) => j !== i));
            setAttachNote("");
          }}
        />
        {attachNote && <p className="mb-1 px-1 text-xs text-amber-600">{attachNote}</p>}
        <textarea
          ref={inputRef}
          rows={1}
          value={props.lock ? "" : input}
          disabled={props.lock}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={props.lock ? props.lockNote ?? t("session.placeholder") : gen ? t(`gen.placeholder_${pool}`) : t("session.placeholder")}
          className="max-h-24 w-full resize-none overflow-y-auto px-2 py-1 text-sm outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:bg-transparent"
        />
        <input ref={fileRef} type="file" multiple hidden onChange={onPickFiles} />
        <div className="mt-2 flex items-center gap-2">
          {/* Attach: chat, or an image-edit reference when the pinned image model accepts image input. */}
          {(!gen || canRef) && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title={t("session.attach")}
              className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
            >
              <Plus size={18} />
            </button>
          )}
          {/* Knob bar (generation only): aspect + quality, plus duration for video. Persisted per session. */}
          {gen && (
            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
              <select
                value={aspect}
                onChange={(e) => patchGen({ aspect: e.target.value })}
                title={t("gen.aspect")}
                className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 outline-none hover:bg-neutral-50"
              >
                {ASPECT_OPTS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select
                value={quality}
                onChange={(e) => patchGen({ quality: e.target.value })}
                title={t("gen.quality")}
                className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 outline-none hover:bg-neutral-50"
              >
                {QUALITY_OPTS.map((q) => (
                  <option key={q} value={q}>
                    {t(`gen.quality_${q}`)}
                  </option>
                ))}
              </select>
              {pool === "video" && (
                <label className="flex items-center gap-1" title={t("gen.duration")}>
                  <input
                    type="number"
                    min={1}
                    max={cfg.videoGen.maxDurationS}
                    value={duration}
                    onChange={(e) => patchGen({ duration: Math.max(1, Math.min(cfg.videoGen.maxDurationS, Number(e.target.value) || 1)) })}
                    className="w-12 rounded-md border border-neutral-200 bg-white px-1.5 py-1 outline-none hover:bg-neutral-50"
                  />
                  {t("gen.seconds")}
                </label>
              )}
            </div>
          )}
          <div className="flex-1" />
          {gen ? (
            genOptions.length === 0 ? (
              <button
                type="button"
                onClick={() => navigate("settings/providers")}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-amber-600 hover:bg-neutral-100"
              >
                {t("gen.configureModel")}
                <ChevronDown size={14} />
              </button>
            ) : (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((o) => !o)}
                  title={t("session.changeModel")}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
                >
                  {pinnedLabel || t("session.selectModel")}
                  <ChevronDown size={14} />
                </button>
                {pickerOpen && (
                  <>
                    <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setPickerOpen(false)} aria-hidden />
                    <div className="absolute bottom-full right-0 z-20 mb-1 max-h-64 w-64 overflow-y-auto rounded-lg border border-neutral-200 bg-white py-1 shadow-lg">
                      {genOptions.map((o) => {
                        const active = o.ref.providerId === pinnedRef?.providerId && o.ref.modelId === pinnedRef?.modelId;
                        return (
                          <button
                            key={`${o.ref.providerId}:${o.ref.modelId}`}
                            type="button"
                            onClick={() => {
                              setPinnedModel(session.id, o.ref);
                              setPickerOpen(false);
                            }}
                            className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-neutral-100 ${active ? "text-neutral-900" : "text-neutral-600"}`}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )
          ) : (
            <button
              type="button"
              onClick={() => navigate("settings/providers")}
              title={t("session.changeModel")}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
            >
              {props.modelLabel || provider.model.id || t("session.selectModel")}
              <ChevronDown size={14} />
            </button>
          )}
          {props.streaming ? (
            <button
              type="button"
              onClick={props.onStop}
              title={t("session.stop")}
              className="rounded-md bg-neutral-900 p-1.5 text-white hover:bg-neutral-700"
            >
              <Square size={16} className="fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              className="rounded-md bg-neutral-900 p-1.5 text-white hover:bg-neutral-700 disabled:opacity-30"
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-neutral-400">{t("session.disclaimer")}</p>
    </>
  );
}
