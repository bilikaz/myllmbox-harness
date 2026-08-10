# How we work

This repo documents itself in three layers (see [docs/conventions/documentation.md](docs/conventions/documentation.md)):

- **Map** — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (hub) + [docs/architecture/](docs/architecture/) (area docs): where things are, present tense.
- **Rules** — [docs/conventions/](docs/conventions/): portable engineering rules, one topic per file.
- **Decisions** — [docs/adr/](docs/adr/): dated decision log, Proposed → Accepted → Superseded.

Terminology is governed by [docs/glossary.md](docs/glossary.md) — one canonical
name per concept, synonyms map into its table. Before coining a term in any doc,
discussion, or code identifier, check the glossary; new concepts get their row
added in the same change that introduces them.

Alongside those settled layers, two working areas **grow with the repo**:

- **Living process docs** — [docs/instructions/](docs/instructions/): the evolving
  detail of a practice (e.g. the drift reviewer's brief). The *decision to adopt*
  the practice lives in an ADR; the instruction doc holds the specifics, and its
  summary is mirrored in this file. Keep the two in sync in the same change.
- **Development iterations** — [docs/tasks/](docs/tasks/): one committed folder per
  iteration (`task<n>/`), the per-iteration record described below.

## Chat style — short by default

Chat answers state the main things only — what's done, what's broken, what's next —
in a few short sentences or a tight list. No long prose, no background essays, no
restating what the user already knows; the user misses things in walls of text.
Write the long version only when explicitly asked ("explain in detail"). Docs and
`report.md` entries keep their existing depth — this rule is for conversation only.

## Before starting work

Check the current branch first. Starting from `main`/`master` is the normal case
(a feature branch gets created at commit time). On any other branch, ask the user
whether working on it is intended — they may have forgotten to switch back after
a merge.

Read the docs: the ARCHITECTURE.md hub, then the
[docs/architecture/](docs/architecture/) area doc for the area you're touching,
the conventions index ([docs/conventions/README.md](docs/conventions/README.md)),
and any ADRs near your change ([docs/adr/README.md](docs/adr/README.md)).
Read-only exploration subagents get the same instruction — point them at the specific
area doc and files relevant to their task. (They map and report; they never write the
implementation — see "While working".)

## Development iterations — `docs/tasks/task<n>/`

Work beyond a trivial change is an **iteration**, and it produces its documents in a
committed `docs/tasks/task<n>/` folder — part of the permanent record, indexed in
[docs/tasks/README.md](docs/tasks/README.md) (task<n> → title → status → what it
covers):

- **`task.md` — the PRD (what & why).** Goal, scope in canonical vocabulary (the
  entities and boundaries the [glossary](docs/glossary.md) defines), the ADRs it
  executes, acceptance criteria (the done-whens), and explicit out-of-scope. Short —
  reviewed to approve the *intent*.
- **`implementation.md` — the guide (how).** What will be built, concretely enough to
  review before building, in the **fixed anatomy** of
  [documentation convention rule 6](docs/conventions/documentation.md): per-root
  overview tables → mermaid flows → contract tables (deferred items marked) → data
  shapes → `Path | Files | What` touch-lists → key logic sketches → verification plan.
  Kept **in sync** while building as decisions shift. This is the shared-understanding
  artifact the user reads to confirm we're aligned — and, unlike before, it is
  **committed** inside the task folder (the ADRs + map remain the durable record; this
  is the per-iteration record).

The flow: settle scope in discussion → write `task.md` + `implementation.md` → the
user reviews and confirms → build, logging every change and deviation to `report.md`
as it lands → verify the done-whens → an independent drift review → commit code +
task docs together on the user's explicit signal.

### The running record — `report.md`

Every iteration keeps a **`report.md`** in its `task<n>/`, written **as the work
lands, not reconstructed at the end**. It is the change-and-drift log: what actually
changed versus what `task.md` / `implementation.md` said, and why. Appending
immediately is the whole point — by the end of a long iteration the reasoning behind a
change is gone, and a log written from memory is a summary, not a record. The user
reviews it **once, as a whole picture**, rather than adjudicating each wart as it
appears.

What earns an entry: contract changes (anything a client of the code sees — renamed
fields, changed IPC channels, event-bus shapes, tool schemas); drift from the settled
task docs and what forced it; decisions and the rejected option; bugs found while
building, with the cause; behaviour changes a reviewer would otherwise discover late;
and open items deliberately left, each with the direction to close it. Keep it
**current truth** — when a later round supersedes an entry, *rewrite* it; history lives
in git. State verification **honestly**: what was typechecked, what was tested, and
what was **not** (a target never launched, an e2e never run). It is a log for review,
not a design doc — the design docs are updated at the end-of-session step, and
`report.md` is the checklist of what that pass must cover.

### Mid-iteration corrections — `fix-task.md` / `fix-implementation.md`

When work already under way surfaces a change that **isn't a small fix** and **carries
a decision** — a design divergence, a dropped-feature call, a review finding whose
remedy has options — **do not just edit into it.** Settle it first, the same way a task
is settled: write a **`fix-task.md`** (the finding, the decision taken, scope,
done-whens) and, when the remedy is more than a line or two, a **`fix-implementation.md`**
(same anatomy as `implementation.md`), both in the **same `task<n>/`** as the iteration
they correct. The user reviews and confirms → apply → verify → commit alongside the
iteration's work. Small fixes (a typo, an obvious bug with one right answer) still need
**no** doc — a why-comment + a regression test is enough
([ADR-0000](docs/adr/0000-adr-scope.md)'s bar for what earns a document). The test:
*would applying this silently change a decision a reviewer thought was settled?* If yes,
it earns `fix-` docs; if no, just fix it.

### The independent drift review — `drift.md`

A built iteration is reviewed by a **separate reviewer agent** — fresh context, no
conversation history — that reviews the completed work and writes findings to a
**`drift.md`** in the same `task<n>/`. It is the *other side* of `report.md`: the
builder logs what it changed and why; the reviewer checks the **result** in **three
passes at once** — (1) **drift** (does it match the settled docs, conventions, ADRs,
glossary), (2) **code review** (is the new/changed code itself correct — logic, edge
cases, failure paths, concurrency/replay hazards, resources, capability gating, tests
that actually exercise behaviour), and (3) **design review** (for any new/changed
user-facing surface: visuals present and coherent, the UI makes sense, the UX is easy
to use, and it works in both the web and Electron targets).

**Who runs it:** the reviewer is **almost always a different provider's agent the user
starts** — not the builder, and not a Claude sub-agent. The builder does **not**
self-review by default; only when the user **explicitly asks** does it spawn a sub-agent
to do the review, at the end of a phase. This is distinct from the CI PR reviewer gate
(`.github/workflows/review.yml`, `@bilikaz/code-reviewer`), which runs automatically on
every pull request *after* push — the drift review runs *before* the commit signal, on
the built iteration; the two are complementary.

The living detail — the reviewer's job, the full checklist (which grows as new drift
classes, code lenses, and design lenses surface), and the `drift.md` format — is
[docs/instructions/drift.md](docs/instructions/drift.md). That doc is the reviewer's
brief; this subsection is its summary. Keep the two in sync in the same change; the
decision to adopt the review is a recorded exception in
[ADR-0000](docs/adr/0000-adr-scope.md).

`drift.md` is findings **ordered by severity** (blocker → minor), each with the file(s),
why it matters, and a concrete fix direction, plus a short summary table — only what
drifts, never what is correct. Findings are handled by **"Settle, then move"**: the
reviewer **reports, never edits**; the builder adjudicates each (decision-carrying → a
`fix-` round; small fix → just fixed; rejected → recorded with why), because a reviewer
without conversation history is sometimes wrong.

## While working

Build aligned with what is already settled: Accepted ADRs and the conventions as
written are binding. Don't invent a new pattern where a documented one fits, and
don't update the docs mid-session — note discoveries and deviations as you go and
carry them to the end-of-session step.

### Implementation is the holder's job — never delegated to a sub-agent

The agent holding the session **writes the implementation itself.** Do **not** hand
coding to a spawned sub-agent. A sub-agent starts from the task docs alone with **none**
of the conversation's settled context — the hundred small decisions, corrections, names,
and trade-offs argued out over the session — so it drifts, half-wires, and leaves
broken/incomplete work that costs more to review-and-repair than it would have to build
directly (observed repeatedly: context-less builds that miss whole files and don't even
typecheck). Sub-agents are strictly for **read-only exploration** (mapping code, broad
searches) whose *conclusion* returns to the holder, and for the **independent drift
review** (where a fresh reader with no history is the whole point). For writing code:
the holder does it, because the holder is the only one who knows what was settled.

### Verification cadence

Typecheck and tests are MILESTONE gates, not edit-by-edit reflexes. Run them
when a settled change-set is complete, or when actively chasing a concrete
failure — not after every file touched. During a large refactor the tree may
stay broken for a while by design; verify once when the agreed shape is in
place, not at every intermediate step. (Typecheck is cheap and may run more
freely while wiring imports; the full test suite is the milestone gate.)

### Git is read-only mid-session — NO COMMITS UNTIL ASKED

No commits, no pushes, no staging beyond what file operations themselves
require (`git mv` / `git rm`). The session's work accumulates uncommitted so
the whole change is reviewable as one diff — mid-flight commits have
destroyed that audit trail before. Committing happens only in the
end-of-session step below, and only on the user's EXPLICIT commit signal:
"implementation looks good" or "docs confirmed" is not it.

**Each commit and each push needs its own explicit signal, every time.** A prior
"commit/push" authorizes **only** the change in front of it then — it is **not**
standing permission for the follow-ups. Being asked to *make* a change (write docs,
add a convention, fix a file) is **never** permission to commit or push it — do the
edits, then stop and let the user review the diff. When unsure whether you're
authorized, you are not: leave it uncommitted and ask.

## Settle, then move

When a question, objection, or correction is raised — about code or docs — the
debate comes first and the edits come after. Don't touch files while a decision
is still open; discuss until it's settled or the user explicitly says go. This
applies symmetrically: code changes wait for settled decisions, doc updates wait
for finished debates (or the user's "time to write docs" signal). Nothing is
marked Accepted until the user has actually read and confirmed it.

This applies to the INITIAL request too, not just mid-session objections. A bug
report or feature ask that sounds clear is not yet settled scope — the user's
idea often sharpens over the next few messages, and edits started in the middle
of that get rewritten. First investigate and debate: diagnose, lay out the
design and its consequences, surface the corner cases, and restate what will be
done — then start editing once the user confirms the shape. Reading code and
docs while the debate runs is fine; changing files is not.

Reviews follow the same rule: findings (including the drift reviewer's report) are
**adjudicated against the settled context before being applied** — reviewers without
conversation history are sometimes wrong; record what was applied vs rejected and why.

## When the user says it's time to write docs

This step runs only on the user's signal, at the end of a session:

1. **Update the map** — ARCHITECTURE.md and the area docs reflect the code as it now
   is; no transient-state scars.
2. **Write new ADRs** for decisions made this session — status **Proposed**, one
   decision per file, added to the ADR README index. Supersede, don't rewrite.
   Gate every candidate through [ADR-0000](docs/adr/0000-adr-scope.md):
   architectural decisions only — bug fixes don't get ADRs (commit message +
   regression test + why-comment), and process changes amend this file instead.
3. **Add or amend conventions** for patterns discovered this session (new topic
   file, or an addition to an existing one — the qualifying bar is in
   [docs/conventions/README.md](docs/conventions/README.md)). State the
   candidates considered explicitly — "considered, none qualified" is a valid
   outcome; silently skipping the question is not.
4. **Update the glossary** — new terms get rows, renamed concepts keep the old word
   under *Also seen as*.
5. **Ask the user to confirm** the new ADRs and conventions. Confirmed → mark
   Accepted. Corrected → settle the corrected version, mark it Accepted, and apply
   it to the session's work so code and docs agree.

The distinction that makes this work: existing docs are **settled** — follow them
without debate, fast. New ADRs and conventions are **fluid** — drafted from what
the session discovered, and only become settled once the user confirms them. Next
session (and every subagent) then starts from the upgraded baseline.

## After everything is agreed

Commit and push the session's work on the user's explicit signal:

- On `main`/`master`: create a new feature branch for the session's work first.
  Implementation iterations **always** get a `task<n>` branch, branched from `main`.
  Docs-only sessions may commit on a plainly-named branch.
- On any other branch: stay on it — it's already the feature branch.
- Commit all the work (code + docs), then push with `./push.sh <branch-name>`
  (plain `git push` fails here — the SSH key isn't in the default agent).
