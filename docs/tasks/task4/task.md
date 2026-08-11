# task4 — Capability-gate every element by container type

## Goal

Make a session's **`container.type`** the one signal that decides what a session can do and how every part
of the app behaves for it. Today that decision is scattered — `drive()` branches on `graphId`,
`SessionView.submit` branches on generation, panels each `return null` on their own conditions, and a
`workspace` boolean is threaded through tools, agents, and graphs. Nothing stops an illegal combination, so
an agent could be launched into an Images (media) session and run an LLM turn there. task4 replaces all of
that with a single rule: **each element self-gates on the active `container.type`.**

## The model

Every session lives in a container, and the container's **`type`** says what the session is. Types today:

| `container.type` | Session does | Turn | Workspace | What shows |
|------------------|--------------|------|-----------|------------|
| `chat` | conversation | LLM loop | no | chat + agent + graph chrome, context meter |
| `local` | conversation | LLM loop | **yes** (fs tools) | same as `chat` |
| `image` | generate images | media tool | no | media composer + knobs, capabilities panel |
| `video` | generate video | media tool | no | same as `image` |
| `audio` *(future)* | generate audio | media tool | no | same |

`chat`/`local` are conversation sessions driven by the LLM loop — or by `graph.command` when the session
carries a `graphId`, or fed to a resident loop; a graph run is still a conversation session, just driven by
its graph. `image`/`video` are generation sessions driven by the media tool.

**Each element self-gates on the type.** On chat/session select, the active `container.type` is broadcast
and every element answers for itself — *"my type → I show / I can run"* or *"not mine → I'm out."* A UI
space, a tool, an agent, and a graph each **declare the container types they support**; the turn dispatch
switches on the type; and a tool that runs receives the **whole container** (type + id + `config` +
permissions) so it can **behave differently** by container (save to the workspace in `local` vs. memory in
`chat`, write to the box using a future `remote`/`ssh` container's connection info). Gating is
decentralized — no central capabilities object; the type is the ping and each element decides — so adding a
new container type is a per-element opt-in, never a sweep of `if container.type === …`.

**Nothing is added to storage.** The type is already on the container; the relational ids are already on
`Session` and stay untouched:

- `containerId` → the container (its `type` + a Local container's workspace root)
- `agentId` → the agent persona
- `graphId` → the graph that drives the turns (output is still conversation)
- `parentId` → the sub-agent parent (delivery, sidebar thread, restart recovery [ADR-0073](../adr/0073-subagent-restart-recovery.md))

The broadcast is the existing reactive store: `setActive` / `setActiveContainer` already call `reg.notify()`,
fanning out to every `useActiveContainerId()` / `useActiveSession()` subscriber at once (a `sessionBus`
exists if an explicit event is ever wanted). One notify reconfigures the whole surface in one pass — no new
plumbing, no half-switched state.

## Scope

- **Turn dispatch keyed on `container.type`** — one router: `image`/`video` → the media tool; `chat`/`local`
  → the existing `drive()` (`graphId` → `graph.command`; a waiting resident loop → feed; else the LLM loop).
  Folds the generation branch out of `SessionView.submit` into the one dispatch.
- **UI spaces self-gate** — a registry contribution declares its supported container types; `Slot` renders
  it only for the active type. Covers agents, sub-agent cleanup, agent permissions, graphs, and plugin
  panels: conversation sessions show chat/agent/graph chrome + the context meter; generation sessions show
  the media composer + the capabilities panel; and only conversation sessions show the system prompt banner.
- **`BaseTool` gets the container** — the constructor gains a `container: () => Container | undefined`
  getter beside `config`, **re-seeded per call on the same rail `config` already uses**: both the renderer
  and electron-main re-seed it (from the filter params / the call) before the registry runs. So a tool
  always knows its container — in `canRun()` and `run()` alike — correct even for a background sub-agent
  (the container comes from the caller, not a global).
- **`canRun()` gates on the container type; `cwd` is dropped.** A workspace tool's `canRun()` is
  `this.container()?.type === "local"` — the `needsWorkspace` / `hasWorkspace` / `agent.workspace` /
  `inWorkspace` booleans all go away. And since the container carries the workspace root (`config.root`),
  `run()` loses its `cwd` parameter and reads `this.container()` instead — one source, no redundant path.
  Tools / agents / graphs are available only in the container types their `canRun` / declaration allows; a
  media container has no agent-tool ceiling.
- **`runAgent` targets a conversation container** — routes to a `chat` container when the active one is
  `image`/`video`, so an agent is never created inside a media session.

## Done-whens

1. Every element self-gates on the active `container.type` (declares supported types / branches on the
   type); no `workspace` / `needsWorkspace` / `hasWorkspace` / `agent.workspace` / `inWorkspace` remains, and
   `run()` no longer takes a `cwd` param — workspace tools read the root from `this.container()`.
2. Playing an agent while an `image`/`video` session is active creates the agent session in a `chat`
   container — never in a media container; a media session never runs an LLM turn.
3. A media session shows the media composer + capabilities panel only — no system banner, agents,
   sub-agent cleanup, permissions, graphs, or plugin agent panels. Conversation sessions are unchanged.
4. Turn dispatch is a single router on `container.type`; the generation branch is no longer separate from
   `drive()`.
5. Tools / agents / graphs are available only in the container types they declare; a tool that runs
   receives the active `Container` (type + `config` + permissions) and acts on it.
6. No new stored field and no migration — `container.type` + the existing ids are the source of truth.
7. `pnpm typecheck` + `pnpm test` green, with tests for: the turn dispatch per type, `runAgent` routing out
   of a media container, tool/agent gating by container type, and a UI space gating on the active type.

## Out of scope

- **Audio** — an `audio` container and its generation are future; the type is reserved but not creatable
  (no model to test).
- **Composer internals** — task3 already collects the prompt/knobs; task4 only routes the turn.
- **Graph behavior** — only its gating folds into the model; orchestration is untouched.
- **Any new session field or id change** — the four ids stay exactly as they are.

## ADR this executes

- **New (Proposed): "Container type as the capability-gating key"** — every element self-gates on
  `container.type`; the turn router, UI spaces, and the tool/agent/graph ceiling all key on it; no central
  capabilities object and no new field. Drafted at the end-of-session docs step, confirmed by the user.
