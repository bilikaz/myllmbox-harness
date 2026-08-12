# The independent drift review

## Who runs it

The drift review is done by a **drift reviewer**: a separate agent with **fresh context
and no conversation history**. It is **almost always a different provider's agent,
started by the user** — not the agent that built the work, and not a Claude sub-agent.
The builder does **not** run it by default: the user starts the reviewer, then hands the
builder the resulting `drift.md` to adjudicate.

Only when the user **explicitly instructs it** does the builder spawn a sub-agent — at
the end of a phase — to perform the review itself. Absent that instruction, the builder
never self-reviews and never assumes the reviewer's role.

This review is distinct from the **CI PR reviewer gate**
([`.github/workflows/review.yml`](../../.github/workflows/review.yml),
`@bilikaz/code-reviewer`), which runs automatically on every pull request *after* push.
The drift review runs *before* the commit signal, on the built iteration, with fresh
context and all three passes below; the CI gate is an automated code-review backstop on
the PR. They are complementary.

**This document is what the drift reviewer follows** — its job, its checklist, and the
artifact it writes. A reviewer spawned or pointed here reads it as its brief.

## The job

**Three reviews in one pass, all into the one `drift.md`:**

1. the **drift review** — does the *result* match the settled context (below);
2. a **code review** of all new/changed code — is the code itself correct and sound,
   independent of whether it matches the docs;
3. a **design review** of any new/changed user-facing surface — are the visuals coherent
   and complete, does the UI make sense, is the UX easy to use.

The fresh-context reviewer is the best-placed reader to do all three: it sees the diff
as a stranger, so it catches builder-blind drift **and** the ordinary bugs and design
gaps an author skims past — drift, code, and design in one pass (a task can *drift*
cleanly and still be buggy or awkward to use).

Read the **completed work** against the **settled context**, read the **whole diff** as
a code reviewer, and *use* the built surface as a design reviewer, then write findings to
a **`drift.md`** in the same `docs/tasks/task<n>/`. Run once the done-whens verify,
before the commit signal; a `fix-` round is reviewed again on the corrected work.

- **Report; do not edit code.** The reviewer only writes `drift.md`. The builder
  adjudicates each finding against the settled context (*Settle, then move*): a finding
  that carries a decision earns a `fix-task.md` / `fix-implementation.md` round; a small
  fix with one right answer is just fixed; a rejected finding is recorded with why. A
  reviewer without conversation history is sometimes wrong — findings are proposals, not
  commands.
- **`drift.md` format:** findings **ordered by severity** (blocker → minor), each with
  the file(s), why it matters, and a concrete fix direction, plus a short summary table
  at the end. Only what drifts — never restate what is correct. It is a review artifact,
  not a design doc.

## The checklist — what to look at

Read the built work against the settled context — `task.md` · `implementation.md` · the
[conventions](../conventions/README.md) · the [architecture hub](../ARCHITECTURE.md) +
the area docs + the [ADRs](../adr/README.md) · the [glossary](../glossary.md) — **and
read the whole diff as a code reviewer and use the surface as a design reviewer** — then
check:

- **Code review — the new/changed code itself** (correctness, not just conformance):
  logic errors + off-by-ones · unhandled edge cases (empty / null / boundary / duplicate
  / the 1→2→N case) · **error + failure paths** (does a throw/reject leave state
  consistent? is a failure surfaced, not swallowed? tools **never throw** — they return
  a typed error result, [ADR-0007](../adr/0007-tool-system.md); a stop/abort cancels
  cleanly, [ADR-0014](../adr/0014-stop-semantics-and-tool-cancellation.md)) ·
  **concurrency & replay hazards** (the supervised session loop and its persisted waits /
  boot-resume, [ADR-0079](../adr/0079-session-loop-architecture.md); graph nodes as
  response producers with park/resume, [ADR-0080](../adr/0080-graphs-as-response-producers.md);
  async sub-agent delivery + the durable `delivered` watermark and `reconcile()` on boot,
  [ADR-0060](../adr/0060-async-subagent-delivery.md) /
  [ADR-0073](../adr/0073-subagent-restart-recovery.md); the concurrency runner's slot
  leases, [ADR-0066](../adr/0066-concurrency-runner.md); idempotency so a
  replayed/retried step can't double-apply; incremental message persistence commits each
  message once, [ADR-0072](../adr/0072-commit-on-landing.md)) · resource handling
  (session-owned browser windows and their op locks,
  [ADR-0051](../adr/0051-browser-windows-session-owned.md); streams, timeouts, aborts,
  leaks) · **capability gating** — one `canRun()` predicate enforced at **both** the
  advertise and the invoke boundary ([capability-gating](../conventions/capability-gating.md),
  [ADR-0036](../adr/0036-host-capability-surface.md)); an advertise-only gate drifts ·
  **config as the sole source of truth** ([ADR-0031](../adr/0031-config-sole-source-of-truth.md))
  and the one data carrier `Ctx` ([ADR-0032](../adr/0032-ctx-main-data-carrier.md)) ·
  **canonical shapes end to end** — one concept, one shape; a shape-sniffing union means
  the canonical shape is missing ([canonical-shapes](../conventions/canonical-shapes.md)) ·
  input validation + secrets never logged · accidental complexity / a simpler correct
  form · and — critically — **do the tests actually exercise the behaviour** (a real
  assertion on the effect, a canary that would fail if the code broke — mock at the port
  with a side-effect recorder, real engines, structural assertions
  ([testing](../conventions/testing.md)); not CRUD/plumbing that passes regardless, not a
  mock asserting the mock)?
- **Design review — the new/changed user-facing surface** (the React renderer): are
  **visuals present and coherent** — a placeholder/empty state where real content should
  be, inconsistent spacing/type, a missing loading/error/empty branch? **Does the UI make
  sense** — do states, labels, and layout match the settled UI model (Slot-region
  contribution registry + hash router, [ADR-0008](../adr/0008-ui-registry-routing.md);
  the [react](../conventions/react.md) conventions — named function components, hooks-only
  state access, stable list keys)? **Is every user-facing string routed through `t()`
  with en/lt key parity** ([ADR-0009](../adr/0009-i18n.md) /
  [i18n](../conventions/i18n.md)), and prompt-asset text kept in the English-only `pt()`
  catalog outside i18n ([ADR-0015](../adr/0015-prompt-assets.md))? **Is the UX easy to
  use** — the happy path is discoverable, nothing dead-ends, error states say what to do
  next — and does it work in **both targets**, the pure-web Vite build and Electron, with
  desktop-only capabilities detected through the bridge, not assumed
  ([ADR-0001](../adr/0001-dual-target-build.md) /
  [ADR-0034](../adr/0034-platform-hosts-over-agnostic-core.md))?
- **Contract drift** — the built surface vs what `implementation.md` promised and the
  ADRs/glossary name: the typed IPC channels + `HarnessApi`
  ([ADR-0002](../adr/0002-typed-ipc-bridge.md)); the tool registry shapes and permission
  tiers ([ADR-0033](../adr/0033-tools-registry-folder-by-permission.md)); the event-bus
  contracts ([ADR-0005](../adr/0005-event-bus.md)); the storage repos / canonical shapes
  ([ADR-0043](../adr/0043-per-entity-repos.md)) and the remote mirror's field parity
  ([ADR-0071](../adr/0071-remote-mirrors-harness-shapes.md)).
- **No dead / duplicate code** — anything the change made obsolete but left behind: a
  superseded path, a fallback no longer reachable, a second way to do one thing, a stale
  comment asserting the old model, a fixture for a dropped shape, a flag never read.
  Extract only essential duplication; remove the rest in the same change
  ([consolidation](../conventions/consolidation.md)).
- **Docs drift** — ADRs, glossary, the architecture hub + area docs, and trees still
  describing the removed/renamed thing (the map is **current truth** — no transient
  scars); a fully-superseded ADR left in the active log instead of archived-with-a-stub,
  or vice-versa ([documentation](documentation.md) rule 2).
- **Convention consistency** — new/changed code against [naming](../conventions/naming.md)
  (role names, the bells test), [types-placement](../conventions/types-placement.md),
  [capability-injection](../conventions/capability-injection.md),
  [error-handling](../conventions/error-handling.md), [logging](../conventions/logging.md)
  (structured events, data objects never interpolation),
  [constants-and-identifiers](../conventions/constants-and-identifiers.md), and
  [destructive-actions](../conventions/destructive-actions.md) (a delete affordance names
  exactly what it destroys).
- **Correctness end to end** — does the change do what the task claims across the
  renderer / core / host bridge / remote service, not just what a unit test asserts in
  isolation; and is verification stated **honestly** in `report.md` (what was
  typechecked with `pnpm typecheck`, tested with `pnpm test`, and what was **not** — a
  target never launched, an e2e never run)?

## Keeping it current

This checklist grows as new drift classes **or code/design-review lenses** surface. When
it changes — a new item, the `drift.md` format, how findings are adjudicated, what earns
a `fix-` round — update this doc **and** the CLAUDE.md workflow subsection in the same
change, so the two never disagree. If the *decision itself* changes, update the
drift-review exception in [ADR-0000](../adr/0000-adr-scope.md) too.
