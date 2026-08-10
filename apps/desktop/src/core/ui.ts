import { useSyncExternalStore } from "react";

import { Consumer, createListeners } from "./storage/consumer.ts";
import type { Ctx } from "./ctx.ts";
import { createContainer, getActiveContainer, getContainersByType, setActiveContainer } from "./containers.ts";
import { createSession, getSessionsForContainer, setActive } from "./sessions/index.ts";
import { navigate } from "../lib/router.ts";

// UI state. The persisted panel preference is a consumer (follows the connection
// like everything else); the lightbox is transient runtime state.
const KEY = "myllmbox-harness:ui";

class UiPanel extends Consumer<{ rightPanel: boolean }> {
  constructor(ctx: Ctx) {
    super(ctx, KEY, { rightPanel: true });
  }
  toggle(): void {
    this.commit({ rightPanel: !this.state.rightPanel });
  }
  useRight = (): boolean => this.useSelect((s) => s.rightPanel);
}

let panel: UiPanel;
export function initUi(ctx: Ctx): UiPanel {
  panel = new UiPanel(ctx);
  return panel;
}

export const toggleRightPanel = (): void => panel.toggle();
export const useRightPanel = (): boolean => panel.useRight();

// Lightbox — transient (the currently-zoomed image url), never persisted.
let lightboxUrl: string | null = null;
const lb = createListeners();

export function openLightbox(url: string): void {
  lightboxUrl = url;
  lb.notify();
}
export function closeLightbox(): void {
  if (lightboxUrl !== null) {
    lightboxUrl = null;
    lb.notify();
  }
}
export function useLightbox(): string | null {
  return useSyncExternalStore(lb.subscribe, () => lightboxUrl, () => lightboxUrl);
}

// Send-to-chat bridge (task 3): the ONE seam between a walled generation session and a chat. A generated
// image/video is handed to a chat session's composer as a pending attachment — the user adds a prompt and
// sends it, so the media enters the LLM's context deliberately (generation output never leaks on its own).
export interface PendingAttachment {
  kind: "image" | "video";
  url: string;
  name?: string;
  mime?: string;
}
let pending: PendingAttachment | null = null;
const pa = createListeners();

// Route the media into a chat: prefer the ACTIVE chat (the one in view), else the first chat container,
// else create one; open its first session (create one if none), stash the attachment, and navigate to
// the workspace. The target chat's composer consumes `pending` on the next render.
export async function sendMediaToChat(att: PendingAttachment): Promise<void> {
  const active = getActiveContainer();
  const chat =
    (active?.type === "chat" ? active : undefined) ??
    getContainersByType("chat")[0] ??
    (await createContainer({ type: "chat", name: "Chat" }));
  if (!chat) return;
  setActiveContainer(chat.id);
  const session = getSessionsForContainer(chat.id)[0];
  if (session) setActive(session.id);
  else createSession({ containerId: chat.id });
  pending = att;
  pa.notify();
  navigate("");
}

// Consume-once: the chat composer reads the pending attachment and clears it so it isn't re-added.
export function consumePendingAttachment(): PendingAttachment | null {
  const p = pending;
  if (p) {
    pending = null;
    pa.notify();
  }
  return p;
}
export function usePendingAttachment(): PendingAttachment | null {
  return useSyncExternalStore(pa.subscribe, () => pending, () => pending);
}
