# Documentation

**Three layers, separated by lifecycle:**

| Layer | File(s) | Tense / lifecycle |
| --- | --- | --- |
| Map | `docs/ARCHITECTURE.md` (+ area docs) | present tense; updated with the code; instance-specific |
| Rules | `docs/conventions/` | present tense; portable across projects; one topic per file |
| Decisions | `docs/adr/` | dated, immutable log; statuses Proposed → Accepted → Superseded |

When the map outgrows one file, it becomes a **hub and spokes**: the hub keeps
the cross-cutting orientation (overview, process model, directory map, an index
of area docs) and each subsystem gets its own area file under
`docs/architecture/`. Updating the map then means updating the right spoke, not
just the hub — the hub's index line per spoke is what keeps "which file owns
this" answerable.

The separation exists because mixing them corrupts both: rules buried in dated
records go stale-looking the moment a supersession lands; history rewritten into
"current state" docs loses the why. ADRs record *that and why* something was
adopted; conventions state *what the rule is now*; the map shows *where things are*.

**Rules.**

1. **Diagrams are Mermaid**, never ASCII art — they render on the hosting platform
   and in IDEs, and survive edits. Quote node labels containing `?`, `/`, or
   `<br/>` (flowchart parser traps). **Never put a `;` in sequence-diagram messages
   or `Note` text** — it terminates the statement and the remainder fails to parse
   (`got 'NEWLINE'`); use a comma or "and". Avoid `;` in flowchart labels too.
   **Detail belongs in tables, not annotated trees.** A code-block tree with
   trailing `# comments` depends on line width — in a narrow viewer the lines
   wrap and the alignment (the only thing carrying the meaning) collapses into
   unreadable soup. Tables reflow per cell and survive any column width. Use a
   tree only for *shallow shape* (short names, no annotations); the moment
   per-item explanation appears, it's a two-column table: item | what it is.
   **One path base per table**: the section heading names the root
   (`apps/desktop`), every row is `./`-relative to it — mixed bases in one table
   make "what is where" unguessable. A different root (another app) is a
   different section with its own table. For file inventories use **three
   columns — path | files | comment**: the folder once, its files as short
   names, never brace-expansion paths (`{a,b}.ts` wraps badly and reads
   worse).
2. **ADR hygiene:** one decision per ADR; supersede, don't rewrite (exception: a
   never-published doc set may be cleaned wholesale — history that was never shared
   isn't history). Convention adoption is one ADR pointing at `conventions/`, not a
   restatement. **Superseded ADRs are archived only once orphaned.** Supersession is
   rarely total, so a superseded ADR stays in the active log until nothing current
   leans on it. The gate: it is *fully* superseded, the successor has **carried
   forward everything still operative**, and no current ADR still depends on a clause
   of it (a surviving dependency means the supersession is only partial — it stays
   put). Once orphaned, **relocate the record byte-identically** (move, never
   rewrite — relocation keeps the dated entry intact) to `adr/archive/`, and **leave
   a stub at the original path under the same filename**, pointing to the archived
   original and to the successor. The stub is what lets inbound links keep resolving
   with **zero relinking** — repointing every citation across the log is the
   expensive, error-prone path the stub avoids, and it only gets worse as the log
   grows. The index row stays. Archived ADRs aren't loaded by default; they exist for
   the rare audit that needs the original why.
3. **Documentation lives in documentation, not code.** Over-commenting steals
   context: source files are read whole, by people and by models, and every
   comment line spends working memory the task needed. Anything that documents —
   architecture narration, design rationale, module relationships — goes to its
   layer (the map, ADRs), never into the source file. File headers are **one
   line** — the file's role, plus a non-obvious contract if there is one. Inline
   comments exist only for traps the code cannot show: a constraint, a contract
   edge, a "this looks wrong but isn't" — one line each. Never narrate what the
   next block does, never number-walk the steps of a function, never restate the
   design, and never explain why a change was correct (reviewer-talk, noise
   after merge).
4. **Heuristics carry their rationale inline** — a threshold or magic decision in
   code states why that value, right where it's read.
5. **README is the operator's view** (install, run, configure); architecture detail
   links out to the map rather than duplicating it.
6. **Implementation guides have a fixed anatomy** — a pre-build guide is reviewed
   for *what will exist*, so it reads target-first, in this order:
   1. **Per-root overview** — one `Piece | What it is` table per app/root (the
      heading names the root, rows `./`-relative), stating what each part IS
      when done;
   2. **Flow diagrams** (Mermaid) for the runtime behavior involved;
   3. **Contract tables** — endpoints/events/schemas, with deferred items
      marked inline (`×`) so scope cuts are visible in the contract itself;
   4. **Data shapes** where persistence is touched — the **full schema, not a
      summary**: one `Column | Type | Notes` table per table/store
      (nullability, defaults, enum members, keys and indexes spelled out), plus
      the state transitions for any status column. **Every table gets its own
      such table — even a small or secondary one; never collapse a schema into
      an inline, `·`-separated run-on** (it buries nullability/keys and reads as
      unreadable soup — the same reason trees lose to tables in rule 1). The
      reviewer must never have to guess what a table will hold;
   5. **File touch-lists per root** — `Path | Files | What` (folder once, files
      as short names, never brace-expansion paths);
   6. **Key logic sketches** — annotated code blocks: **include one wherever
      complex logic is introduced or changed** (the non-obvious algorithm, the
      ordering that matters, the edge that bites), and **omit them for routine
      wiring**. The reviewer needs the hard parts pinned in reviewable form, not
      the plumbing — err toward a sketch for real logic, toward none for glue;
   7. **Verification plan** — the ordered gates that prove the done-whens.
   The reviewer sees the end state (what files, where, containing what) before
   a line is written; the builder inherits an exact checklist.
