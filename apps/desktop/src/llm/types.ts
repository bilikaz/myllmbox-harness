// LLM layer vocabulary: services, call contract, StreamEvent. This is the floor — config, core, and tools all
// import shared shapes (Image, Video, ToolCallRequest, ToolSpec, service unions) from here.

// The call target is config's LLMConfig (config owns it); re-exported here so the llm layer keeps a local name.
import type { LLMConfig } from "../core/config/llm.ts";
export type { LLMConfig } from "../core/config/llm.ts";

export type TextProviderKind = "openai" | "anthropic" | "gemini";

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

// An image/video item riding a message, result, or attachment: url (a data: URL carrying the content, or http) +
// optional mime, display name, and storage-blob id. `ref` is the per-session model/user-facing alias ("img-3" /
// "vid-1") stamped at landing — short by design (a 26-char ULID invites one-char hallucinations that silently
// miss); never renumbered. Image and Video are kept as distinct types so the medium is in
// the type — not a field convention — and is free to diverge later (dimensions, duration…). Identical today.
export interface Image {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
  ref?: string;
}
export interface Video {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
  ref?: string;
}

// A tool call the model requested. `cwd` is the workspace root the dispatcher runs it under ("" when the model
// emits it / for workspace-less tools); the gateway fills it in before execution. `imageOutputDir` is the
// workspace-relative folder generated/edited images are saved into (from the container config); like `cwd`
// it's a non-model field the engine fills at dispatch.
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
  cwd: string;
  imageOutputDir?: string;
  // Media aliases mentioned in `arguments`, pre-resolved by the engine to their content (tools run
  // across the bridge as pure data and can't reach the session transcript). Non-model, engine-filled.
  mediaRefs?: Record<string, { url: string; mime?: string; name?: string }>;
  // The calling session + its meta (SessionRuntime — core keys plus flow-patched extension keys like
  // comics' generationJob), engine-stamped at dispatch: tools run across the bridge and can't reach
  // the store, so the session state they may recognize rides on the call.
  sessionId?: string;
  meta?: Record<string, unknown>;
  // An explicit model override for this call, non-model + caller-filled (same lane as mediaRefs/meta).
  // A human generation session fills it from its pinned pick so the tool uses THIS model instead of the
  // pool head; the agent never sets it (its media tools resolve the pool head). Plain data — crosses IPC.
  target?: LLMConfig;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: Image[];
  videos?: Video[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

// outputTokens includes thinkingTokens; never add thinkingTokens on top.
export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

// The media services config covers — the single runtime list; MediaService derives from it. These are
// the non-text use-case pools; gen-vs-edit and t2v/i2v/v2v are NOT pools (endpoint/param choices driven
// by the inputs present at call time), and recognition is text-output over a media input.
export const MEDIA_SERVICES = ["image", "video", "audio", "imageRec", "videoRec", "audioRec"] as const;
export type MediaService = (typeof MEDIA_SERVICES)[number];
// The 7 use-case pools. `text` is the chat pool — foreground chat AND background sub-agent runs share it
// (the concurrency runner reserves foreground capacity over background runs); it resolves through the
// text provider path.
export type ModelService = "text" | MediaService;

export type Modality = "text" | "image" | "video" | "audio";
export const SERVICE_MODALITY: Record<ModelService, Modality> = {
  text: "text",
  imageRec: "text",
  videoRec: "text",
  audioRec: "text",
  image: "image",
  video: "video",
  audio: "audio",
};

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

// Why a turn failed — drives recovery: "capacity" (context full / OOM) is NOT resumable (re-prefills the
// same oversized prompt), "transport" (connection lost) IS, "other" is anything else.
export type ErrorKind = "capacity" | "transport" | "other";

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "usage"; usage: StreamUsage }
  | { type: "retry"; message: string }
  | { type: "error"; message: string; kind: ErrorKind }
  | { type: "done" };

// A provider is one of the text dialects; media generation rides the OpenAI Images API, so the
// image/video providers live under the `openai` type too — there is no separate media dialect.
export type ProviderKind = TextProviderKind;

export interface ModelInfo {
  id: string;
  maxModelLen?: number;
}

export function targetLabel(t: LLMConfig): string {
  return t.model.id ? `${t.provider.name} : ${t.model.id}` : t.provider.name;
}

export interface GenParams {
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget?: number;
  w?: number;
  h?: number;
  seed?: number;
  numFrames?: number;
  fps?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
  // Input images for an EDIT call (base64 + mime). Present → the image provider runs its edit path
  // (/images/edits) instead of generation. Several = multi-reference editing (FLUX.2).
  images?: { b64: string; mime: string }[];
}

export interface MediaOut {
  b64: string;
  mime: string;
}

export type CallResult = { kind: "chat"; events: AsyncGenerator<StreamEvent> } | { kind: "media"; payload: MediaOut };

export interface ResponseHandler<T> {
  handle(interaction: CallResult): Promise<T>;
}

export interface CallContext {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenParams;
  signal: AbortSignal;
}

export interface Provider {
  call<T>(handler: ResponseHandler<T>): Promise<T>;
  defaultHandler(): ResponseHandler<unknown>;
}
