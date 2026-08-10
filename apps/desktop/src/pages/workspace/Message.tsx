import { memo, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Loader2 } from "lucide-react";

import { Markdown } from "../../components/Markdown.tsx";
import { SavableMedia } from "../../components/SavableMedia.tsx";
import { Thinking } from "./Thinking.tsx";
import { ToolCard } from "./ToolCard.tsx";
import type { FileAttachment, Image, Video, Role, ToolCallRequest } from "../../lib/types.ts";

// "14:32" today, else "Jun 11 14:32". Full date-time on hover (the title attr).
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function Stamp({ ts }: { ts?: number }) {
  if (!ts) return null;
  return (
    <span className="px-1 text-[10px] text-neutral-400" title={new Date(ts).toLocaleString()}>
      {fmtTime(ts)}
    </span>
  );
}

// One transcript entry; memoized via sameMessage so only the live streaming message re-renders.
function MessageImpl({
  role,
  text,
  thinking,
  images,
  videos,
  files,
  toolCalls,
  results,
  toolImages,
  toolVideo,
  toolChildren,
  toolBrowserWindows,
  createdAt,
  streaming,
  generating,
}: {
  role: Role;
  text: string;
  thinking?: string;
  images?: Image[];
  videos?: Video[];
  files?: FileAttachment[];
  toolCalls?: ToolCallRequest[];
  results?: Map<string, string>;
  toolImages?: Map<string, Image[]>;
  toolVideo?: Map<string, Video[]>;
  toolChildren?: Map<string, string[]>; // toolCallId → sub-agent sessions (RunAgent's doors)
  toolBrowserWindows?: Map<string, string>; // toolCallId → browser window a Browser call opened
  createdAt?: number;
  streaming: boolean;
  generating?: "image" | "video"; // a generation session's pool — drives the elapsed-time indicator (task 3)
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[80%] flex-col items-end gap-2">
          {images && images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {images.map((im, i) => (
                <SavableMedia kind="image" key={i} src={im.url} name={im.name} badge={im.ref} className="max-h-48 cursor-zoom-in rounded-xl object-cover" />
              ))}
            </div>
          )}
          {videos && videos.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {videos.map((v, i) => (
                <SavableMedia kind="video" key={i} src={v.url} name={v.name} badge={v.ref} className="max-h-48 rounded-xl" />
              ))}
            </div>
          )}
          {files && files.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {files.map((f, i) => (
                <span
                  key={i}
                  className="flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-600"
                >
                  <FileText size={12} className="shrink-0 text-neutral-400" />
                  <span className="max-w-[14rem] truncate">{f.name}</span>
                </span>
              ))}
            </div>
          )}
          {text && (
            <div className="rounded-2xl bg-neutral-100 px-4 py-2.5 text-sm text-neutral-800">{text}</div>
          )}
          <Stamp ts={createdAt} />
        </div>
      </div>
    );
  }
  const hasTools = !!toolCalls?.length;
  const hasMedia = !!images?.length || !!videos?.length;
  // Generation placeholder still running: an elapsed-time indicator (not a bare pulse) so a slow video
  // reads as working, not hung — the AC3 "not a hung spinner" requirement (task 3).
  const genPending = generating && streaming && !text && !hasMedia && !hasTools;
  return (
    <div className="space-y-2">
      {thinking && <Thinking text={thinking} streaming={streaming && !text} />}
      {genPending ? (
        <GenerationProgress kind={generating} />
      ) : (
        (text || (streaming && !hasTools)) && (
          <Markdown text={text} className="text-neutral-800 prose-pre:bg-neutral-900 prose-pre:text-neutral-100">
            {streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-neutral-400 align-middle" />}
          </Markdown>
        )
      )}
      {/* Assistant-message media = generation output (task 3): the generate turn stamps results here, not
          on a tool card. Offer send-to-chat — the bridge out of a walled generation session. */}
      {images && images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((im, i) => (
            <SavableMedia kind="image" key={i} src={im.url} name={im.name} badge={im.ref} sendToChat className="max-h-72 cursor-zoom-in rounded-xl object-cover" />
          ))}
        </div>
      )}
      {videos && videos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {videos.map((v, i) => (
            <SavableMedia kind="video" key={i} src={v.url} name={v.name} badge={v.ref} sendToChat className="max-h-72 rounded-xl" />
          ))}
        </div>
      )}
      {toolCalls?.map((c) => (
        <ToolCard
          key={c.id}
          call={c}
          output={results?.get(c.id)}
          images={toolImages?.get(c.id)}
          videos={toolVideo?.get(c.id)}
          childSessionIds={toolChildren?.get(c.id)}
          browserWindowId={toolBrowserWindows?.get(c.id)}
        />
      ))}
      <Stamp ts={createdAt} />
    </div>
  );
}

// Elapsed-time indicator for a running generation. Ticks each second; video carries a "slow" hint
// (generation is minutes per second of clip). Self-contained timer — mounts only while pending.
function GenerationProgress({ kind }: { kind: "image" | "video" }) {
  const { t } = useTranslation();
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-sm text-neutral-500">
      <Loader2 size={15} className="animate-spin" />
      <span>{t(`gen.generating_${kind}`, { secs })}</span>
    </div>
  );
}

type MessageProps = Parameters<typeof MessageImpl>[0];

// Tool maps get fresh identity every parent render — compare only the entries this message's calls read.
function sameMessage(prev: MessageProps, next: MessageProps): boolean {
  if (
    prev.role !== next.role ||
    prev.text !== next.text ||
    prev.thinking !== next.thinking ||
    prev.images !== next.images ||
    prev.videos !== next.videos ||
    prev.files !== next.files ||
    prev.toolCalls !== next.toolCalls ||
    prev.createdAt !== next.createdAt ||
    prev.streaming !== next.streaming ||
    prev.generating !== next.generating
  ) {
    return false;
  }
  return (next.toolCalls ?? []).every(
    (c) =>
      prev.results?.get(c.id) === next.results?.get(c.id) &&
      prev.toolImages?.get(c.id) === next.toolImages?.get(c.id) &&
      prev.toolVideo?.get(c.id) === next.toolVideo?.get(c.id) &&
      prev.toolChildren?.get(c.id) === next.toolChildren?.get(c.id) &&
      prev.toolBrowserWindows?.get(c.id) === next.toolBrowserWindows?.get(c.id),
  );
}

export const Message = memo(MessageImpl, sameMessage);
