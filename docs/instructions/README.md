# Instructions — living process docs

Working docs that **grow with the repo**, distinct from the settled design set
([ARCHITECTURE.md](../ARCHITECTURE.md) + area docs), the portable
[conventions](../conventions/README.md), and the dated [ADR log](../adr/README.md).
Each records the *current* detail of a practice or standard; the *decision to adopt*
it lives in an ADR (or a convention), and these docs hold the evolving specifics.

| Doc | What it is | Decision recorded in |
| --- | --- | --- |
| [iterations.md](iterations.md) | How we build one development iteration — the three docs (`task`/`implementation`/`report`), the flow, and mid-iteration `fix-` rounds | foundational (the repo's working method) |
| [drift.md](drift.md) | The independent drift reviewer's brief — who runs it, the job, the growing checklist, the `drift.md` format | [ADR-0000](../adr/0000-adr-scope.md) (recorded exception) |
| [documentation.md](documentation.md) | How we document — the three doc layers, Mermaid/tables/trees presentation, ADR hygiene (supersede/archive/stub), docs-not-code, heuristics carry rationale, the fixed implementation-guide anatomy | [ADR-0010](../adr/0010-adopt-shared-conventions.md) (moved from `conventions/` — a rule is followed in instructions where it's skipped in conventions) |
| [reuse-core-types.md](reuse-core-types.md) | Reuse the type that exists; don't wrap/alias/one-field-bag a core type into a ghost — a new named type earns existence only by naming a distinct concept or bundling 2+ recurring fields (here, not in conventions, because it must be followed while authoring) | this session's cleanup wave |

When a living doc changes, keep its mirror in [/CLAUDE.md](../../CLAUDE.md) in sync in
the same change; when the underlying *decision* changes, update the ADR/convention too.
