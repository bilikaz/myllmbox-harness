import { useSyncExternalStore } from "react";

import { createListeners } from "./storage/consumer.ts";

// Profile — the solo user's display identity (name + avatar), shown in the sidebar. Machine-local
// and kept in localStorage: it must be readable synchronously before ctx.storage exists (first paint).
const KEY = "myllmbox-harness:profile";

export interface Profile {
  username: string;
  avatar: string; // an emoji from AVATARS
}

export const AVATARS = ["🦊", "🐙", "🐼", "🤖", "🦉", "🐯", "🦋", "🌿", "🐶", "🦁", "🐵", "🐺"];

const DEFAULTS: Profile = { username: "You", avatar: "🦊" };

const { subscribe, notify } = createListeners();

function read(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Profile>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let state: Profile = read();

export function getProfile(): Profile {
  return state;
}

export function useProfile(): Profile {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export function saveProfile(patch: Partial<Profile>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  notify();
}
