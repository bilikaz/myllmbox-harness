# How we work

This repo is an Electron + React desktop chat harness, **documented in layers that are the source** — code is
built to them and they read as **current truth, present tense** (history lives in git + the ADR log).

**Read these before you touch anything — they are the source, and more current than this file. This list is
the floor, not a menu: read the ones your change touches, don't skim past them.**

1. [docs/instructions/README.md](docs/instructions/README.md) — **how we build** (the living process, binding
   as written). Open the specific guide the moment you hit its trigger — *the instruction is the current
   detail, this file only names it*: **running an iteration** · **the drift review**.
2. [docs/conventions/README.md](docs/conventions/README.md) — the **binding engineering rules**, one topic per file.
3. [docs/glossary.md](docs/glossary.md) — **law**: one canonical name per concept. Check it before coining a
   term or a code identifier; a new concept gets its row in the same change (retired words stay under *Also
   seen as*).
4. [docs/adr/README.md](docs/adr/README.md) — the **decision log**, dated (Proposed → Accepted → Superseded),
   gated by [ADR-0000](docs/adr/0000-adr-scope.md).
5. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — **the map** (hub + the [area docs](docs/architecture/), where
   things are); read it for the area you're touching.

The durable record is the **ADRs + the map**; the **living docs** ([architecture](docs/architecture/) ·
[instructions](docs/instructions/) · [conventions](docs/conventions/)) are current truth, kept in sync with
the code. Per-iteration work is recorded under [docs/tasks/](docs/tasks/) (one `task<n>/` folder each).

## Chat style — short by default

Chat answers state the main things only — what's done, what's broken, what's next — in a few short sentences
or a tight list. No long prose, no background essays, no restating what the user already knows; the user
misses things in walls of text. Write the long version only when explicitly asked ("explain in detail"). Docs
and `report.md` entries keep their existing depth — this rule is for conversation only.

## Before starting work

Check the branch first — `main`/`master` is the normal case (a feature branch is created at commit time). On
any other branch, ask whether working on it is intended — they may have forgotten to switch back after a
merge. Then read, for the area you're touching: the [glossary](docs/glossary.md), the [ADRs](docs/adr/README.md)
near your change, the [map](docs/ARCHITECTURE.md) + area doc, and the [conventions](docs/conventions/README.md)
your change exercises. Point read-only subagents at the **same specific docs** — never "go read everything."

## Development iterations — `docs/tasks/task<n>/`

Work beyond a trivial change is an **iteration**: it writes its docs **before code**, committed in a
`task<n>/` folder — **`task.md`** (the PRD: what & why, the done-whens), **`implementation.md`** (the build
guide, kept in sync), **`report.md`** (the running change-and-drift log, verification stated honestly). The flow:

> settle scope → write `task.md` + `implementation.md` → **user confirms** → build, logging to `report.md` as
> it lands → verify the done-whens → **write docs to current truth** → **independent drift review** →
> **adjudicate** → commit on the user's signal.

The full lifecycle — the three docs' anatomy and mid-iteration **`fix-` rounds** (a change that *carries a
decision* is settled in `fix-task.md`/`fix-implementation.md` first, not just edited in) — is the instruction
**[docs/instructions/iterations.md](docs/instructions/iterations.md)**. The drift review is
**[docs/instructions/drift.md](docs/instructions/drift.md)**: a fresh-context reviewer (almost always a
different provider's agent the user runs, not you) reviews the code **and** the current-truth docs into one
`drift.md`; you **adjudicate against the settled context and apply** — the reviewer reports, never edits. Docs
land **before** the review so it catches doc drift in the same pass.

## While working

Build to what is settled: Accepted ADRs, the conventions, the glossary, and the design docs **as written are
binding**. Don't invent a pattern where a documented one fits; note discoveries and deviations as you go and
carry them to the end-of-session step — don't rewrite the design docs mid-build.

### Implementation is the holder's job — never delegated to a sub-agent

The agent holding the session **writes the implementation itself.** Do **not** hand coding to a spawned
sub-agent. A sub-agent starts from the task docs alone with **none** of the conversation's settled context —
the hundred small decisions, corrections, names, and trade-offs argued out over the session — so it drifts,
half-wires, and leaves broken/incomplete work that costs more to review-and-repair than to build directly
(observed repeatedly: context-less builds that miss whole files and don't even typecheck). Sub-agents are
strictly for **read-only exploration** (mapping code, broad searches) whose *conclusion* returns to the
holder, and for the **independent drift review** (where a fresh reader with no history is the whole point).

### Verification cadence

Typecheck and tests are **milestone gates**, not edit-by-edit reflexes. Run them when a settled change-set is
complete, or when chasing a concrete failure — not after every file. During a large refactor the tree may stay
broken for a while by design; verify once when the agreed shape is in place. (Typecheck is cheap and may run
more freely while wiring imports; the full test suite is the milestone gate.)

## Git is read-only mid-session — NO COMMITS UNTIL ASKED

No commits, no pushes, no staging beyond what file operations require (`git mv` / `git rm`). Work accumulates
uncommitted so the whole change reviews as one diff — mid-flight commits have destroyed that audit trail
before. **Each commit and each push needs its own explicit signal, every time** — a prior "commit/push"
authorizes only the change in front of it then, not the follow-ups. "Looks good" is not a commit signal; being
asked to *make* a change is **never** permission to commit it. When unsure whether you're authorized, you are
not: leave it uncommitted and ask.

## Settle, then move

When a question, objection, or correction is raised — about code or docs — **the debate comes first and the
edits come after**. Don't touch files while a decision is open; discuss until it's settled or the user says go.
This applies to the **initial request** too: a bug report or feature ask that sounds clear is not yet settled
scope — the user's idea often sharpens over the next few messages, and edits started mid-way get rewritten.
First investigate and debate: diagnose, lay out the design and its consequences, surface the corner cases,
restate what will be done — then edit once the user confirms the shape. Reading code and docs while the debate
runs is fine; changing files is not. Reviews follow the same rule: findings (including the drift reviewer's)
are **adjudicated against the settled context before being applied** — a no-history reviewer is sometimes
wrong; record what was applied vs rejected and why.

## When the user says it's time to write docs

End-of-session, on the user's signal, **before the drift review** (so the reviewer checks the written docs
against the code in the same pass):

1. **Update the map** — [ARCHITECTURE.md](docs/ARCHITECTURE.md) and the area docs reflect the code as it now
   is; no transient-state scars.
2. **New ADRs** for architectural decisions this session — status **Proposed**, one per file, added to the
   [ADR index](docs/adr/README.md). Supersede, don't rewrite. Gate through
   [ADR-0000](docs/adr/0000-adr-scope.md): bug fixes don't get ADRs (commit message + regression test +
   why-comment); **process changes amend this file or the relevant instruction doc**.
3. **The conventions question** — did this session discover a portable pattern? State the candidates
   explicitly — "considered, none qualified" is valid; silently skipping isn't.
4. **The glossary** — new terms get rows; renamed concepts keep the old word under *Also seen as*.
5. **The user confirms** — nothing is Accepted until read and confirmed. Next session (and every subagent)
   starts from the upgraded baseline.

## After everything is agreed

Commit and push on the user's explicit signal:

- On `main`/`master`: create the feature branch first. Implementation iterations **always** get a `task<n>`
  branch off `main`; docs-only sessions may commit on a plainly-named branch.
- On any other branch: stay on it — it's already the feature branch.
- Commit all the work (code + docs), then push with `./push.sh <branch-name>` (plain `git push` fails here —
  the SSH key isn't in the default agent).
