# FlowJo 10 UI gap specs (2026-11-07)

This folder specifies every FlowJo 10.6.2 UI command that flowjo-rea lacked or
only partly matched on 2026-11-07, and records how each one was closed.

## How the gaps were found

1. The full command inventory was read from FlowJo 10.6.2's command enums
   (`WSCommand`, `GWCommand`, `TransformCommand`, `LECommand`, `ChartCommand`,
   `TECommand`, `FJTableCommand`, `CompCommand`, `PECommand`,
   `PlatformNavCommand`), with each command's menu label and tooltip taken
   from `flowjodictionary*.properties`. That is 545 commands.
2. Each command was checked against the flowjo-rea code and classified as
   IMPL (equivalent control exists, with file:line evidence), PARTIAL,
   MISSING or NA (licensing, FlowJo Portal / cloud, enterprise, debug).
3. The REA ledger was re-run first (47 of 47 obligations verified) to confirm
   the engine-level rules were unchanged.

The full classification, with evidence for every row, is
[audit-2026-11-07.tsv](audit-2026-11-07.tsv) (columns: command, label,
status, evidence_or_gap). It is the state before the gap work.

| Command set | IMPL | PARTIAL | MISSING | NA |
|---|---|---|---|---|
| WSCommand (workspace window) | 53 | 12 | 40 | 29 |
| PlatformNavCommand (platforms) | 5 | 1 | 9 | 1 |
| GWCommand (graph window) | 38 | 3 | 20 | 3 |
| TransformCommand (axis transforms) | 7 | 3 | 6 | 1 |
| TECommand (table editor) | 9 | 11 | 18 | 4 |
| FJTableCommand (generated tables) | 3 | 2 | 12 | 3 |
| CompCommand (compensation editor) | 17 | 7 | 24 | 0 |
| LECommand (layout editor) | 35 | 14 | 69 | 8 |
| ChartCommand (figure properties) | 10 | 4 | 9 | 0 |
| PECommand (plate editor) | 0 | 4 | 51 | 0 |
| **Total** | **177** | **61** | **258** | **49** |

## Area specs

Each file has one subsection per PARTIAL or MISSING command: the FlowJo
command and label, the original class.method that proves each rule, the rule
in plain words, and the flowjo-rea status (Done with its test, Own rule with
the reason, or Deferred with the reason).

- [workspace.md](workspace.md): workspace window (WSCommand)
- [graph.md](graph.md): graph window and axis transforms (GWCommand, TransformCommand)
- [layout.md](layout.md): layout editor and figure properties (LECommand, ChartCommand)
- [tables.md](tables.md): table editor and generated tables (TECommand, FJTableCommand)
- [compensation.md](compensation.md): compensation editor (CompCommand, matrix editor)
- [platforms.md](platforms.md): plate editor and platforms (PECommand, PlatformNavCommand)

As elsewhere in this repo, the specs describe behaviour in our own words and
cite class and method names only; no FlowJo code, bytecode or decompiled
output is committed.
