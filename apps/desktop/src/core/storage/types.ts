// The per-entity repository layer — the typed replacement for the generic KV Storage port.
// Each local backend (SQLite tables, web IndexedDB stores, in-memory) implements StorageRepos.

import type { Container } from "../containers.ts";
import type { SessionMeta } from "../sessions/persistence.ts";
import type { Message } from "../sessions/types.ts";
import type { Agent } from "../agents.ts";

// A media blob row (server `media` table) — referenced by a message, scoped to a session.
export interface MediaRow {
  id: string;
  sessionId: string;
  messageId: string;
  kind: "image" | "video" | "file";
  mime: string;
  name: string | null;
  data: string; // data: URL
}

// CRUD for an id-keyed entity. remove() hard-deletes the row.
export interface CrudRepo<T> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  put(entity: T): Promise<void>;
  remove(id: string): Promise<void>;
}

// Messages are persisted incrementally — each commits once, by id, as it finalizes (put = upsert,
// so "land in-flight then update on finish" is the same row). replaceForSession is the wholesale
// rewrite, kept only for the compaction/reset path (a summary replacing the transcript); remove is
// the rare granular delete. listBySession returns the transcript in creation order (ULID id order).
export interface MessageRepo {
  listBySession(sessionId: string): Promise<Message[]>;
  put(sessionId: string, message: Message): Promise<void>;
  remove(id: string): Promise<void>;
  replaceForSession(sessionId: string, messages: Message[]): Promise<void>;
}

export interface MediaRepo {
  listBySession(sessionId: string): Promise<MediaRow[]>;
  put(media: MediaRow): Promise<void>;
  remove(id: string): Promise<void>;
}

// Settings are key/value rows; a config Consumer persists as a row.
export interface SettingRow {
  key: string;
  value: unknown;
}
export interface SettingRepo {
  list(): Promise<SettingRow[]>;
  get(key: string): Promise<SettingRow | null>;
  put(s: SettingRow): Promise<void>;
  remove(key: string): Promise<void>;
}

// A plugin's namespaced data row. pluginId is the plugin's SLUG (its folder name) — plugins are
// first-party and in-tree, so there is no installed-registration row; enable + settings live in
// config.plugins.<slug>, and this table holds only the plugin's own runtime data.
export interface PluginDataRow {
  pluginId: string;
  collection: string;
  key: string;
  value: unknown;
}
export interface PluginDataRepo {
  list(pluginId: string, collection: string): Promise<PluginDataRow[]>;
  put(row: PluginDataRow): Promise<void>;
  remove(pluginId: string, collection: string, key: string): Promise<void>;
}

// Every entity in the model, on one structure — each local backend implements this.
export interface StorageRepos {
  containers: CrudRepo<Container>;
  sessions: CrudRepo<SessionMeta>;
  messages: MessageRepo;
  media: MediaRepo;
  agents: CrudRepo<Agent>;
  settings: SettingRepo;
  pluginData: PluginDataRepo;
  // Clear ALL data (every table/store). For the data-version gate's breaking-change reset
  // (core/storage/version.ts).
  wipe(): Promise<void>;
}
