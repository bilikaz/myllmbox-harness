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

When a living doc changes, keep its mirror in [/CLAUDE.md](../../CLAUDE.md) in sync in
the same change; when the underlying *decision* changes, update the ADR/convention too.
