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

## Final status (2026-11-08)

After the area rounds, two follow-up rounds and an independent re-audit of
every row that was PARTIAL or MISSING (the re-audit confirmed each claim in
the code and spot-checked the "no-op in FlowJo 10.6.2" claims with javap),
the status of all 545 commands is in
[final-status-2026-11-08.tsv](final-status-2026-11-08.tsv) (columns: command,
label, status on 2026-11-07, final status, evidence). The rows the re-audit
still found narrower were fixed afterwards and are marked "after the
re-audit" in the evidence column.

- IMPL: an equivalent, user-reachable control.
- OWN: implemented with a documented deliberate difference (Own rule in the
  area spec, with the reason; usually a browser limit such as file system
  access, the OS print dialog or vendor binary output).
- NOGAP: the command does nothing in FlowJo 10.6.2 (no handler, enum-only,
  or a stub), with class.method evidence in the area spec.
- NA: out of scope for a local web app (licensing, FlowJo Portal / cloud,
  enterprise, debug), unchanged from the audit.

| Command set | IMPL | OWN | NOGAP | NA | PARTIAL | MISSING |
|---|---|---|---|---|---|---|
| WSCommand (workspace window) | 84 | 19 | 2 | 29 | 0 | 0 |
| PlatformNavCommand (platforms) | 8 | 4 | 3 | 1 | 0 | 0 |
| GWCommand (graph window) | 47 | 14 | 0 | 3 | 0 | 0 |
| TransformCommand (axis transforms) | 9 | 6 | 1 | 1 | 0 | 0 |
| TECommand (table editor) | 29 | 7 | 2 | 4 | 0 | 0 |
| FJTableCommand (generated tables) | 13 | 2 | 2 | 3 | 0 | 0 |
| CompCommand (compensation editor) | 43 | 4 | 1 | 0 | 0 | 0 |
| LECommand (layout editor) | 92 | 21 | 5 | 8 | 0 | 0 |
| ChartCommand (figure properties) | 21 | 2 | 0 | 0 | 0 | 0 |
| PECommand (plate editor) | 47 | 7 | 1 | 0 | 0 | 0 |
| **Total** | **393** | **86** | **17** | **49** | **0** | **0** |

Not yet checked against files saved by FlowJo itself (no sample files
available): the FACSDiva XML, plate XML, CSV/CLR import, mask files and the
layout table / plate figure XML were all decoded from FlowJo's own reader
and writer classes and are covered by round-trip tests only.

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
