# Task Index

One row per development iteration. Each `task<n>/` holds `task.md` (the PRD — what & why,
scope, acceptance criteria) and `implementation.md` (the guide — mermaid flows, contract
tables, schemas, touch-list, key logic), both written and reviewed **before** building;
`report.md` (the builder's change-and-drift log) and `drift.md` (the independent
reviewer's findings) are written **after** building. A mid-iteration correction that
carries a decision adds `fix-task.md` (+ `fix-implementation.md` when the remedy is more
than a line or two) to the same folder.

The iteration flow and what each doc contains are in [/CLAUDE.md](../../CLAUDE.md); the
fixed anatomy of `implementation.md` is
[documentation convention rule 6](../conventions/documentation.md); the drift reviewer's
brief is [../instructions/drift.md](../instructions/drift.md). The settled design set the
tasks execute is the [architecture hub](../ARCHITECTURE.md) + the
[ADR log](../adr/README.md).

| Task | Title | Status | Covers |
| --- | --- | --- | --- |
| [task1](task1/task.md) | Remove the remote backend: a local-only solo harness | **built · verified** (typecheck + 215 tests green; app-launch not run) · [report](task1/report.md) | supersedes ADR-0039/0040/0041/0071 · amends 0044/0045 · new local-only posture ADR |
