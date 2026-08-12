# ADR-0000: What lands in this log (root of all roots)

Status: accepted
Date: 2026-06-10

## Context

The log started accumulating entries that aren't architecture: a bug fix dressed
up as a decision (the context-meter accumulation fix), and a working-procedure
write-up restating `/CLAUDE.md`. Each seemed reasonable alone; together they
dilute the log — a reader can no longer assume an ADR marks a structural choice
that future work depends on. The log needs its own gate.

## Decision

An entry belongs here only when **all three** hold:

1. **It's architectural** — it shapes the system's structure, contracts, or
   boundaries (a port, a layer rule, a wire format, a gating model).
2. **A real choice existed** — alternatives with trade-offs were on the table,
   and the why deserves to outlive the conversation that decided it.
3. **Future work depends on it** — someone building later acts differently
   because this was decided.

What does **not** land here, and where it goes instead:

- **Bug fixes** — correctness has no alternatives. The record is the commit
  message, the regression test, and (when the fix pins down a contract) a
  why-comment at the code and a line in the map.
- **Process and procedures** — how we work lives in `/CLAUDE.md`, which is
  updated directly when the workflow changes. No ADR mirrors it, **with one
  recorded exception (below).**
- **Restatements** — content that lives elsewhere is pointed at, never copied
  (the [documentation instruction](../instructions/documentation.md) already says
  this for convention adoptions; it applies to everything).

## Recorded exception — the independent drift review

One process decision is structural enough to be logged here rather than only in
`/CLAUDE.md`: the **independent drift review**. Every built iteration is reviewed
by a separate reviewer agent — fresh context, no conversation history, almost
always a different provider's agent the user starts — that reads the completed
work against the settled context in three passes (drift, code, design) and writes
findings to a `drift.md` in the iteration's `docs/tasks/task<n>/`. The reviewer
reports, never edits; findings are adjudicated per *Settle, then move*.

It earns a place in the log because it is **structural, not merely procedural**:
it changes *who* reviews an iteration and *what artifacts* a `task<n>/` folder must
contain. The living detail — the reviewer's brief and its growing checklist — is
[docs/instructions/drift.md](../instructions/drift.md); the workflow summary is in
[/CLAUDE.md](../../CLAUDE.md). This is the **sole** standing exception to the
process-out-of-log rule: further process changes still amend `/CLAUDE.md`, not the
log, unless this ADR is later amended to record another.

## Consequences

- The log stays a trustworthy index of structural decisions; "is there an ADR?"
  remains a meaningful question.
- The one recorded process exception (the drift review) lives here, at the root
  of the log, so there is a single place to look for what earns an ADR and what
  does not — including its own carve-outs.
- Some genuinely useful records live only in commits, tests, and CLAUDE.md —
  acceptable, because each has a defined home and the map links the layers.
- This ADR is numbered 0000 because it governs the log itself; entries predating
  it were grandfathered without re-review.
