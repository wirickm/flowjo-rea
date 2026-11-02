# REA investigation checklist: FlowJo 10 compatibility

REA's investigation workflow (rea `.agents/skills/reverse-engineer-anything`,
"Plan broader investigations") starts from a checklist of questions and the
evidence each answer needs, and ends by marking each question answered,
partially answered or unresolved. This is that checklist for the FlowJo 10
work. Behavioral answers: `docs/validation/flowjo-engine-specs.md`. Obligation
status: `docs/obligation-ledger.md`.

Target identity: official installer `FlowJo-OSX64-10.6.2.dmg`
(SHA-256 `90721621...`), native engine `libNativeEngine-3.6.2.jnilib`
(SHA-256 `ae2369f3...`), `FlowJo-10.6.2.jar` (SHA-256 `6a6436c0...`). Full
digests: `tools/rea-originals.json`.

## Questions

| # | Question | Evidence the answer needs | Evidence obtained | Status |
|---|---|---|---|---|
| 1 | Which FlowJo version wrote the reference counts? | FlowJo-written files | `.wsp` `flowJoVersion` attributes: 10.6.2 to 10.10.0 | Answered |
| 2 | Where does FlowJo 10 gate events: Java or native code? | Static analysis of the shipped app | Java `PolyGate` has no membership test; native engine symbols and the Java-to-engine query (`writeQuery`) | Answered |
| 3 | How does FlowJo 10 decide polygon membership? | Static analysis of the engine functions; comparison with FlowJo output | REA `analyze_function` (Ghidra) of the polygon mask fill and `PointInPoly`; 47 of 75 fixture polygons exact before version differences, all exact after | Answered |
| 4 | How are events and vertices mapped to the grid? | Engine functions; FlowJo output | REA `analyze_function` of `ScaleToChannel`; logicle table construction read with llvm-objdump | Answered |
| 5 | How does FlowJo 10 gate ellipses? | Java bytecode of the ellipse classes; FlowJo output | `javap` of `EllipseGate`, `PolyGate`, `FigGatingEllipse` (REA has no desktop-Java bytecode route; REA `inspect_artifact` verifies the classes and their digests in the shipped jar); all 4 fixture ellipses exact | Answered (bytecode reading is analyst evidence) |
| 6 | Why do some rectangle counts differ? | Engine function; FlowJo output | REA `analyze_function` of `GetRectRangeInScale`; E01 Time chain exact after the open-bound rule | Answered |
| 7 | How does FlowJo 10 compute median, percentiles, robust SD/CV? | Engine functions; FlowJo-computed statistics | REA `analyze_function` of `GParameter::Median`, `ChannelMedian`, `Build1DHistogram`, `ScaleRobustCV/SD` | Partially answered: no FlowJo-computed statistics to compare against |
| 8 | Do the remaining count differences come from this app or from FlowJo? | Saves of the same gate by several FlowJo versions | Other FlowJo versions' saves record this app's count for all 7 remaining rows | Answered |
| 9 | Does FlowJo 11 behave the same? | FlowJo 11 engine analysis | FlowJo 11.2 engine: different vertex snapping and lattice | Answered (it does not) |
| 10 | Does runtime FlowJo behave as the static reading says? | REA runtime observation (LLDB, process capture, Frida) of FlowJo running | None: FlowJo 10 is a macOS app and cannot run in this Linux environment | Unresolved: needs a Mac with FlowJo |
| 11 | MAD, arcsinh/biex statistics, arcsinh/biex lookup tables | Engine functions; FlowJo output | Not analysed | Unresolved (out of current scope) |

## REA reconstruction stages

| Stage (rea `docs/reconstruction-readiness.md`) | Status | Evidence |
|---|---|---|
| discover-classify | Done | Installer inventory; engine vs Java split (Q2) |
| diagnose-environment | Done | FlowJo 11 vs 10 version skew found and resolved (Q1, Q9) |
| acquire-authority | Done | Ghidra approved in `CLAUDE.md` before use; a refused launch ran nothing |
| static-analysis | Done with REA | REA MCP session, Ghidra 12.1.4 provider: `inspect_artifact` and 9 `analyze_function` records; jar `inspect_artifact` (`tools/reaObserveFlowjo.mjs`) |
| reactive-scenarios | Not done | Q10 |
| compare-authority-candidate | Done | FlowJo-saved counts vs this app (`docs/validation/wsp-counts.md`) |
| preserve-contradictions | Done | 7 FlowJo version differences pinned in `tests/wsp.test.ts` |
| verify-reconstruction-closure | Done | REA ledger: 4 obligations verified, analyst and REA-native original cases (`docs/validation/rea-ledger-result*.json`) |
| export-replay | Done, with one REA finding | Bundles exported; ledger replay deterministic; bundle import restores identical IDs; CLI and MCP `analyze_function` give the same Evidence ID; `inspect_artifact` IDs differ by adapter parameters (`docs/obligation-ledger.md`) |
