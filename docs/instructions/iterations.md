# Development iterations — how we build one

Every development iteration produces its documents **before code is built**, in a committed
`docs/tasks/task<n>/` folder — part of the permanent record, indexed in
[docs/tasks/README.md](../tasks/README.md) (task<n> → title → status → what it covers). The ADRs and the
[map](../ARCHITECTURE.md) remain the durable record; the task folder is the **per-iteration** record. Below:
the three docs, the flow, then mid-iteration corrections.

## The three iteration docs

### `task.md` — the PRD (what & why)

Goal, scope in canonical vocabulary (the entities and boundaries the [glossary](../glossary.md) defines), the
ADRs it executes, acceptance criteria (the **done-whens**), and explicit out-of-scope. Short — reviewed to
approve the *intent*. There is no separate PRD artifact; this is it.

### `implementation.md` — the build guide (how)

What will be built, concrete enough to review before building, in the **fixed anatomy** of
[documentation instruction rule 6](documentation.md): per-root overview tables → mermaid flows →
contract tables (deferred items marked) → data shapes → `Path | Files | What` touch-lists → key logic sketches
→ verification plan. Kept **in sync** while building as decisions shift — this is the shared-understanding
artifact the user reads to confirm we're aligned.

### `report.md` — the running record (what actually happened)

Written **as the work lands, not reconstructed at the end** — appending immediately is the whole point, since
by the end of a long iteration the reasoning behind a change is gone and a log written from memory is a
summary, not a record. It is the change-and-drift log: what actually changed versus what `task.md` /
`implementation.md` said, and why. What earns an entry: contract changes (anything a client of the code sees —
renamed fields, changed IPC channels, event-bus shapes, tool schemas) · drift from the settled task docs and
what forced it · decisions and the rejected option · bugs found while building, with the cause · behaviour
changes a reviewer would otherwise discover late · open items deliberately left, each with the direction to
close it. Keep it **current truth** — when a later round supersedes an entry, *rewrite* it (history lives in
git). State verification **honestly**: what was typechecked, what was tested, and what was **not** (a target
never launched, an e2e never run). The user reviews it once as a whole picture instead of adjudicating each
wart mid-build; the end-of-session docs step uses it as the checklist of what that pass must cover.

## The flow

> settle scope in discussion → write `task.md` + `implementation.md` → **the user reviews and confirms** →
> build, logging every change and deviation to `report.md` as it lands → verify the done-whens → **write the
> docs to current truth** (the end-of-session docs step in [/CLAUDE.md](../../CLAUDE.md) — map · ADRs ·
> glossary · conventions) → an **[independent drift review](drift.md)** → **adjudicate its findings** →
> commit code + task docs together on the user's explicit signal.

## Mid-iteration corrections — `fix-task.md` / `fix-implementation.md`

When work already under way surfaces a change that **isn't a small fix** and **carries a decision** — a design
divergence, a dropped-feature call, a review finding whose remedy has options — **do not just edit it in.**
Settle it first, the same way a task is settled: write a **`fix-task.md`** (the finding, the decision taken,
scope, done-whens) and, when the remedy is more than a line or two, a **`fix-implementation.md`** (same anatomy
as `implementation.md`), both in the **same `task<n>/`** as the iteration they correct. The user reviews and
confirms → apply → verify → commit alongside the iteration's work.

Small fixes (a typo, an obvious bug with one right answer) need **no** doc — a why-comment + a regression test
is enough ([ADR-0000](../adr/0000-adr-scope.md)'s bar). The test: *would applying this silently change a
decision a reviewer thought was settled?* If yes, it earns `fix-` docs; if no, just fix it and log it in
`report.md`.

## Keeping it current

This doc is the living detail; [/CLAUDE.md](../../CLAUDE.md) carries only the one-line flow and a pointer here.
When the iteration practice changes, update this doc and keep the CLAUDE.md pointer in sync.
