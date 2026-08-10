import { Download, MessageSquarePlus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { openLightbox, sendMediaToChat } from "../core/ui.ts";
import { saveMedia } from "../lib/saveMedia.ts";
import { useCtx } from "../renderer/ctx.tsx";

// A media thumbnail/player with a Save button overlaid in the top corner. `badge` shows the media
// reference alias ("img-3") — the handle the user (and model) can name in a follow-up. `sendToChat`
// adds a "send to chat" action (task 3 — the bridge out of a walled generation session).
export function SavableMedia(props: { kind: "image" | "video"; src: string; name?: string; className?: string; badge?: string; sendToChat?: boolean }) {
  const { kind, src, name, className, badge, sendToChat } = props;
  const { t } = useTranslation();
  const ctx = useCtx();
  async function save(e: React.MouseEvent) {
    e.stopPropagation();
    await saveMedia(ctx, src, kind, name);
  }
  function toChat(e: React.MouseEvent) {
    e.stopPropagation();
    void sendMediaToChat({ kind, url: src, name });
  }
  return (
    <div className="group relative inline-block">
      {kind === "image" ? (
        <img src={src} alt={name ?? ""} onClick={() => openLightbox(src)} className={className} />
      ) : (
        <video src={src} controls className={className} />
      )}
      {badge && (
        <span className="absolute left-2 top-2 rounded-md bg-black/50 px-1.5 py-0.5 font-mono text-[10px] font-medium text-white">
          {badge}
        </span>
      )}
      <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
        {sendToChat && (
          <button
            type="button"
            onClick={toChat}
            title={t("common.sendToChat")}
            className="rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
          >
            <MessageSquarePlus size={16} />
          </button>
        )}
        <button
          type="button"
          onClick={save}
          title={kind === "image" ? t("common.saveImage") : t("common.saveVideo")}
          className="rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
        >
          <Download size={16} />
        </button>
      </div>
    </div>
  );
}
