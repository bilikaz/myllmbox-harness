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
| [task2](task2/task.md) | Unify providers: one registry, 7 input→output use-cases | **PRD approved · implementation.md in progress** | refines ADR-0042 (use-cases derived from output+inputs; imageGen+imageEdit→image); drops the hardcoded default seed |
| [task3](task3/task.md) | Generation sessions: chat with a media model (Images/Videos) | **scope settled · PRD drafted** | depends on task2; reuses the session/message stack; no new store |

> The **prod deploy** (docker/prod + Cloudflare tunnel, live at harness.myllmbox.com) shipped ad-hoc under the commit label "task2" **before** this index adopted that number, and never got its own task docs. The documented `task2/` slot is this providers refactor; the deploy is captured in that commit + the docs pass, not a task folder.
