// StorageEngine — carried on ctx.storage. A thin holder over the one local provider (SQLite / IDB /
// in-memory). A solo harness has a single realm; repos() is the whole durable model.

import type { StorageRepos } from "./types.ts";

export class StorageEngine {
  constructor(private readonly local: StorageRepos) {}

  // The durable model — every entity (containers/sessions/messages/media/agents/settings/plugin data).
  repos(): StorageRepos {
    return this.local;
  }
}
