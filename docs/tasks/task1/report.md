# Task 1 — Report (change & drift log)

Written as the work landed. Records what actually changed vs what `task.md` /
`implementation.md` said, and why. Current truth — superseded entries are rewritten.

## Decisions applied (the four confirmed forks)

- **D1** — `StorageEngine` collapsed to one local provider; `repos()` is the sole
  accessor. `localRepos()`, `connect()`, `disconnect()`, `connected`, and the
  `remote` ctor arg are gone.
- **D2** — `ContainerType "remote"` removed; the VM tools tier `core/tools/remote/`
  (only `base.ts`, `BaseRemoteTool`, un-globbed) deleted; the `activeType === "remote"`
  branches in `AgentsPanel` / `GraphsPanel` / `AgentRunView` and the Sidebar `addRemote`
  block dropped.
- **D3** — `core/account.ts` deleted; a minimal machine-local profile (name + avatar)
  salvaged into new `core/profile.ts` (localStorage, read before `ctx.storage`). The
  settings **Account** section became a **Profile** section (avatar + name only).
- **D4** — `SettingRow.scope` removed entirely; `Consumer.synced` param and its
  provider-branch removed (three consumers — settings, config/app, plugins/config —
  updated to the no-arg ctor).

## Contract changes (what a caller sees)

- **Removed HTTP service** — the whole `apps/knowledge` app (`/auth/*`, `/data/*`
  per-entity routers, `/kb`, `/inngest`).
- **Removed renderer tools** — `SaveMemory` / `SearchMemory` / `GetMemory` /
  `EditMemory` / `DeleteMemory` (the KB memory tools); the `core/tools/account/` tier
  and both init globs for it are gone.
- **`StorageEngine`** — API narrowed to `constructor(local)` + `repos()`.
- **`SettingRow`** — `scope` field dropped (`{ key, value }`).
- **`ContainerType`** — `"chat" | "local"` (was `… | "remote"`).
- **`core/account.ts` API** — deleted (`isConnected`, `login`, `register`, `logout`,
  `authedFetch`, `setConnection`, `attachAccount`, `applyConnection`, `Connection`).
  Replaced by `core/profile.ts` (`getProfile`, `useProfile`, `saveProfile`, `AVATARS`).

## Drift from the guide (discovered during build)

- **The comics plugin was an undocumented KB consumer** — not in `implementation.md`'s
  map. It called `SaveMemory` from two graphs (`mascot.ts`, `comic.ts`) and grounded
  `SearchMemory`/`GetMemory` in its planner agent (`agents.json`), with a prompt clause
  telling the agent to `SearchMemory` each cast character. Removing the KB orphaned all
  of these. **Resolution (in-scope, no data lost):** removed the `SaveMemory` calls
  (the mascot bible and lore are already persisted to the workspace bible JSON via the
  `Write` tool — the KB write was only a mirror), dropped `SearchMemory`/`GetMemory`
  from the planner's tool ceiling, and edited the planner prompt to point at the
  workspace bibles instead. This is a **behaviour reduction**: cross-comic lore recall
  via the shared knowledgebase is gone; per-workspace bible files remain the source.
- **Memory system-prompt blocks** — `core/prompts.ts` held a `memory.{save,search}`
  `pt()` catalog and `core/sessions/system.ts` advertised them gated on
  `has("SaveMemory")`. With the tools gone the gate is always false (dead), so both were
  removed.
- **`StorageSection` backend row** — showed `remote`/`local` via `storage.connected`.
  With one lane it is always "local" (uninformative), so the row + its
  `storage.backend_*` locale keys were dropped.

## Behaviour changes a reviewer would otherwise find

- Boot no longer attaches a remote provider or hydrates on a connection change — there
  is no connection change. `hydrateConsumers()` runs once at init.
- Session delete always hard-clears the transcript (`messages.replaceForSession(id, [])`);
  the former "connected → let the server soft-delete" branch is gone.
- No Account settings section, no Connected/Offline toggle, no login; the sidebar shows
  no Remote workspace block. The user menu's gear routes to `settings/profile`.

## Verification (honest)

- `pnpm install` — lockfile refreshed; **287 packages removed** (the knowledge service
  deps).
- `pnpm typecheck` — **green** (whole workspace, `tsc --noEmit`).
- `pnpm test` — **green, 215/215 across 32 files** (incl. the edited `consumer`,
  `settings`, `agent-grounding` tests).
- Residual grep for every removed symbol (`SaveMemory`/…/`isConnected`/`remoteRepos`/
  `localRepos`/`synced`/`knowledgebase`) over `apps/**` — **clean** (only the unrelated
  DB-plugin `isConnected(name)` and MCP OAuth survive, as intended).
- **NOT run:** a live app launch in either target (`pnpm dev` web / `pnpm dev:electron`).
  Done-when #4 (chat round-trips + re-hydrates from local storage, no Account UI) is
  unverified by a running app — only by typecheck + unit tests.

## Open items (for the end-of-session docs pass — not code)

- Supersede + archive-with-stub the now-obsolete ADRs (0039/0040/0041/0071) and amend
  0044/0045 (single lane); write the new local-only-posture ADR.
- Update the map: remove `docs/architecture/knowledge.md`; rewrite `storage.md` /
  `state.md` / `tools.md` for one lane; scrub `ARCHITECTURE.md`, `README.md`,
  `COMPARISON.md`, `TODO.md`, `BUILDING.md` of remote/account/KB.
- Retire the glossary's remote/account/Connected/knowledgebase terms into *Also seen as*.
