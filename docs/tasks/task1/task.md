# Task 1 — Remove the remote backend: a local-only solo harness

## Goal

The harness targets **solo users** on a single machine. Remove everything that
exists to talk to a remote account backend, so the app is **local-only** with no
account, no connection lifecycle, no cloud sync, and no knowledgebase. What remains
is a pure desktop/web chat harness whose entire durable state lives on the device.

## Why

The remote plane (`apps/knowledge` + the account/connection lifecycle + the
account-synced storage lane + the knowledgebase) is multi-user product surface a
solo tool does not need. It is also live drift and dead weight: it carries auth, a
whole second service and its docker stack, and a two-lane storage seam whose remote
half no solo user will ever attach. Removing it shrinks the surface to what a solo
user actually runs, and collapses the storage model to one lane.

## Scope (canonical vocabulary)

Remove, across the tree:

- **The remote service** — the entire `apps/knowledge` app and its workspace/package
  wiring.
- **The account + connection lifecycle** — `core/account.ts`, `authedFetch`,
  connect/disconnect/toggle, the "Connected" mode, any account/login UI, and the
  `settings` **`account` scope** (everything becomes machine-local).
- **The remote storage lane** — `core/storage/remote.ts` and the `StorageEngine`
  remote half (`connect`/`disconnect`/`connected`, `remote ?? local`); collapse
  `repos()` and `localRepos()` to a **single local provider**. Local backends
  (SQLite / IndexedDB / in-memory) and the `StorageRepos` shapes stay.
- **The knowledgebase plane** — the `/kb` feature and the renderer **memory tools**
  (`SaveMemory` / `SearchMemory` / `GetMemory` / `EditMemory` / `DeleteMemory`),
  removed from the tool registry entirely.
- **The remote docker stack** — the `docker/` services that exist only for the
  remote backend (MariaDB, OpenSearch/Dashboards, TEI embeddings, Inngest, the
  Traefik routes for them).

## ADRs this executes

- **Supersede** (obsolete once the remote is gone): [ADR-0039](../../adr/0039-account-local-store-and-connection-lifecycle.md)
  (account store + connection lifecycle), [ADR-0040](../../adr/0040-knowledge-remote-service.md)
  (the knowledge remote service), [ADR-0041](../../adr/0041-knowledgebase-plane.md)
  (the knowledgebase plane), [ADR-0071](../../adr/0071-remote-mirrors-harness-shapes.md)
  (remote mirrors the harness shapes).
- **Amend**: [ADR-0044](../../adr/0044-storage-engine-provider-swap.md) (drop the
  remote lane, keep the local `StorageEngine`) and [ADR-0045](../../adr/0045-machine-local-vs-account-synced.md)
  (the machine-local/account-synced split collapses — all state is machine-local).
- A new ADR records the **local-only posture** decision (the removal itself, and
  that the KB is cut, not deferred).

The precise supersede/archive-with-stub moves are in `implementation.md` and executed
in the end-of-session docs pass ([documentation](../../instructions/documentation.md)
rule 2). The initial commit is pushed, so ADRs are superseded, never deleted.

## Acceptance criteria (done-whens)

1. `apps/knowledge/` is gone; no workspace, package.json, lockfile, or import still
   references it.
2. No account/connection surface remains: no `core/account.ts`, no `authedFetch`, no
   connect/disconnect/toggle, no account UI; the app boots straight into local state.
3. `StorageEngine` exposes a **single local lane**; `core/storage/remote.ts` is gone;
   `connect`/`disconnect`/`connected` and the `remote ?? local` selection are removed;
   `repos()` resolves to the local provider. Sessions/messages/media/agents/settings
   persist and re-hydrate locally in **both** the web and Electron targets.
4. The memory tools are removed from the registry; nothing in the renderer calls `/kb`
   or the remote data API.
5. The `settings` `scope` collapses to local only (no `account` scope path).
6. `docker/` no longer defines the remote-only services; what remains is only what a
   local harness needs (if anything).
7. `pnpm typecheck` and `pnpm test` are green; the app launches and a chat round-trips
   with local persistence.
8. Docs are current truth: the map (ARCHITECTURE hub + `storage.md`, `knowledge.md`
   removed/retired, `state.md`, `tools.md`) reflects local-only; the obsoleted ADRs are
   superseded + archived-with-stubs; the glossary retires the remote/account/KB terms
   into *Also seen as*.

## Out of scope

- **A local knowledgebase.** The KB is **removed, not reimplemented** — no local
  embeddings, no local memory store. (A future task may reintroduce a local KB; this
  task does not stub or defer one.)
- Any new sync, backup, or multi-device mechanism.
- Auth of any kind (it existed only for the remote).
- Changes to the LLM/provider, tool, session-loop, graph, or browser subsystems beyond
  removing their remote/KB touch-points.
