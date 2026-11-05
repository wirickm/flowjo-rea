# flowjo-rea compared with FlowJo 10.6.2 (2026-11)

Analysis only: no application code changed. Reference: FlowJo 10.6.2
(official installer, hashes in 2.1); FlowJo 11 is not the reference.
Patterns: only those in the inventory below, from wirickm/rea and
wirickm/ghidra. Every FlowJo statement comes from static reading of the
shipped files (FlowJo is macOS-only and was not run), so runtime behavior is
unconfirmed throughout. No FlowJo code, bytecode listing or disassembly is in
this repository; behaviors are described in words with class, key and symbol
names only. Working material (unpacked installer, REA Evidence JSON, survey
notes) stayed under `/tmp/fj10`.

Contents: 1 pattern inventory; 2 evidence; 3 part A (behavior parity);
4 part B (code architecture); 5 part C (UI/UX); 6 ranked fixes; 7 open
questions and blockers.

## 1. Pattern inventory (Phase 1)

Only these patterns are used in parts A to C. "Serves" names the comparison
part. Paths are relative to each repository (rea = wirickm/rea at 6e9ee97,
ghidra = wirickm/ghidra at its default branch, 12.3 DEV sources).

| # | Pattern / template | Source | What it requires | Serves |
|---|---|---|---|---|
| P1 | Route the target first | rea `.agents/skills/reverse-engineer-anything/SKILL.md` ("Route the target first") | Pick the first tool from the target kind: archive/package -> `open_binary`/`inspect_artifact`; native -> `open_binary` + deep provider; do not call unadvertised tools | A |
| P2 | Staged investigation checklist | rea SKILL.md ("Plan broader investigations") | Questions -> evidence each needs; smallest overview first; corroborate with the evidence type the claim needs; finding ledger with confidence, search boundary, unknowns; revisit checklist, mark answered / partial / unresolved | A, C |
| P3 | Observation / inference / unknown split | rea SKILL.md ("Work summary-first"), `AGENTS.md` (Product and Authority) | Every conclusion says which it is; cite Evidence IDs; never imply static analysis observed execution | A, B, C |
| P4 | Evidence record and retained references | rea `references/evidence-workflows.md` | Cite `evidence_id`; keep authority, limitations, coverage; bounded negative searches stay bounded (absence not proven by an exhausted page) | A |
| P5 | Native target workflow (Ghidra) | rea `references/native-and-artifacts.md` ("Native targets", "Ghidra startup deadline recovery"), `docs/ghidra-provider.md`, `docs/native-investigation.md` ("Provider and verification boundaries") | Ghidra 12.x (>=12.1) + JDK; `rea doctor --provider ghidra`; `open_binary` -> `list_procedures` / `analyze_function`; addresses and pseudocode are observations, not source; provider unavailability stays unknown, not false | A |
| P6 | Packages and extraction | rea `references/native-and-artifacts.md` ("Packages and extraction") | `inspect_artifact` for ZIP/JAR/DMG inventories; DMG traversal only on macOS; inventory is central-directory entries only | A, C |
| P7 | Reviewed obligation | rea `docs/reconstruction-obligation-ledgers.md` ("Reviewed obligation examples") | Stable `obligation_id` + version, title, layer, family, target location, `required_case_kinds`, required authorities, dependencies, residual unknowns, `required_next_evidence`, `disposition`, review Evidence | A |
| P8 | Manifest binding and closure | same doc ("Manifest and closure", "Proof applicability") | One owner + `owner_sha256`; original cases and fixtures covering every case kind; verifier enumerating the obligation; proof bound to owner digest and obligation version; static-only sources cannot close runtime claims; `blocked`/`out-of-scope` never count as verified | A |
| P9 | Layered architecture, dependencies inward | rea `docs/architecture.mermaid`, `AGENTS.md` (Architecture and Cleanup) | Domain -> contracts -> providers/adapters -> application -> entry adapters; one owner per interpretation; normalize once at the owning boundary | B |
| P10 | Typed error contract | rea `docs/error-contract.schema.json` | Error object `{code, category, message, retryable, remediation{action}}` plus optional `recovery{kind, operation}` and `details`; closed code set (20) and category set (10); `additionalProperties: false` | B |
| P11 | Tagged errors and `Result` | rea `AGENTS.md` (Architecture and Cleanup) | Parse unknown boundary values; model expected failures as tagged errors in `Result`; keep partial facts and failure reasons | B |
| P12 | Named limits and honest recovery text | rea `docs/design/limits-and-recovery.md` ("Name a default...", "Keep a fixed ceiling honest", "Recovery text") | Every limit is a named constant with a unit; a setting only when operators need headroom; recovery text names the limit, effective value, unit, source, bounds, next action, whether a restart is needed and what does not raise it; invalid configuration is never a silent fallback | B, C |
| P13 | Agent recovery ladder | same doc ("What agents do"); SKILL.md ("Connect only when needed") | Retry once only when safe; do not repeat unchanged calls; diagnose the observed blocker and continue other supported work | A (process) |
| P14 | Contribution scope, fail-closed | rea `CONTRIBUTING.md` ("Contribution scope", "Fail-closed integration") | Do not integrate while scope, authority, side-effect or verification questions are open; early proposals and draft PRs welcome | B |
| P15 | Conventional commits and PR readiness | rea `AGENTS.md` (Pull Request Readiness), `.github/pull_request_template.md` | `type(scope): outcome` titles; PR sections Summary / Problem / Change and scope / Contract impact / Evidence / Validation / Compatibility / Author readiness (left unchecked by agents) / Before merge; report only checks that ran | B |
| P16 | Performance order | rea `AGENTS.md` (Performance) | Optimize tokens/context, then analysis time, then CPU/memory; measure only when targeting performance | B |
| P17 | GhidraScript structure | ghidra `Ghidra/Features/Base/ghidra_scripts/ExportFunctionInfoScript.java`, `CallotherCensusScript.java` | Header comment block, `//@category`, class extends `GhidraScript`, `run()` checks `currentProgram`, `printerr`/`println`, `monitor.checkCancelled()` in loops | A |
| P18 | Headless arguments and continuation | ghidra `Decompiler/ghidra_scripts/WindowsResourceReference.java` (`getScriptArgs`), `Base/ghidra_scripts/SetHeadlessContinuationOptionScript.java` (`HeadlessScript`, `isRunningHeadless`) | Positional script args via `getScriptArgs()`; headless-only behavior behind `isRunningHeadless()`; `analyzeHeadless ... -postScript <script> <args>` | A |
| P19 | Decompiler use from a script | ghidra `Decompiler/ghidra_scripts/AddVfunctionCallRefScript.java` (`setUpDecompiler`), `CompareFunctionSizesScript.java` | `DecompInterface`, `setOptions`, `toggleCCode(true)`, `setSimplificationStyle("decompile")`, `openProgram`, per-function timeout, `dispose` | A |
| P20 | Export script output | ghidra `ExportFunctionInfoScript.java` | Write to a caller-chosen file; report the path written | A |
| P21 | Developer guide conventions | ghidra `DevGuide.md` | Gradle tasks, running tests headless; no headless-analysis or UI-design guidance (confirmed: no UI/UX pattern in either repo) | (none for C) |

Gap noted for part C: neither repository has a UI/UX design pattern or
template. Part C therefore uses only P2 (checklist), P3 (observation vs
inference), P12 (recovery text, applied to user-facing messages) and the
FlowJo 10 resource evidence; it does not invent a UI pattern. See the
section 7.

## 2. Evidence from FlowJo 10.6.2 (Phase 2)

### 2.1 Identity

| Item | SHA-256 | Matches `tools/rea-originals.json` |
|---|---|---|
| `FlowJo-OSX64-10.6.2.dmg` | `90721621...a32f08` | yes (installer named in the note) |
| `FlowJo-10.6.2.jar` | `6a6436c0...861c61c` | yes |
| `libNativeEngine-3.6.2.jnilib` | `ae2369f3...289b56` | yes |
| `fjlib-2.3.0.jar` | `ed08fec9...69632e` | not listed before (new subject in prose only, see 2.3) |

`release.properties`: appVersion 10.6.2, engVersion NativeEngine-3.6.2.
Everything unpacked to `/tmp/fj10` (outside the repository) and kept there.

### 2.2 Routes tried (P1, P5, P6, P13)

| Target | Route | Result | REA Evidence / outcome |
|---|---|---|---|
| Native engine | `rea doctor --provider ghidra --json` | Ghidra missing: `GHIDRA_INSTALL_DIR is not set` (`missing_analysis_engine`) | blocked |
| Native engine | `rea inspect <engine> --provider ghidra` | `provider_unavailable` (`not_configured`) | blocked |
| Native engine | `rea inspect-macho <engine>` | `capability_unavailable`: native macOS utilities require macOS | blocked on Linux |
| Native engine | `llvm-nm --demangle` (analyst, as in the existing originals) | 19,365 defined symbols; class groups in part A | analyst observation |
| `FlowJo-10.6.2.jar` | `rea inspect-artifact` | complete ZIP inventory, `shipped-artifact` authority | `ev_20bd9a62a53e05a01c860ce4562d5ae666b820868ae15720c62c679bd8ab63eb` |
| `fjlib-2.3.0.jar` | `rea inspect-artifact` | same | `ev_7dc00c95e318c2dae414547b5319a0fb983525914d8f5e7306aebff6bc140407` |
| One FlowJo `.class` (`EllipseGate.class`) | `rea inspect <class> --provider ghidra` | `target_unavailable`, `unsupported_target`, `file_format_rejected` ("unsupported binary format") | REA limitation, observed |
| Java classes | Ghidra headless with a GhidraScript (P17 to P20) | not run: Ghidra 12.1.4 is not installed here and its release download is blocked for this session | blocked |
| Java classes | `javap -p` / `-constants` (and `-c` only to find constants) | member signatures, enum constants, string constants | analyst observation |
| Resource bundles | `flowjodictionary*.properties` (main, `_dlog`, `_plat`, `_prefs`) | UI labels, tooltips, accelerators, workflows | analyst observation |

**Finding R1 (REA limitation, confidence high, observed):** REA 6.8.0 cannot
open JVM class files. The refusal happens at target resolution
(`BinaryTargetResolver`: a complete class file with the `CAFEBABE` magic that
parses as a JVM class returns "unsupported binary format"), before any
provider is selected, so installing Ghidra would not change it. REA's only
Java route is JADX for Android packages. The Ghidra JVM decompiler must be run
directly (`analyzeHeadless` with a GhidraScript), and its results recorded as
analyst Evidence, as `tools/rea-originals.json` already does.

**Finding R2 (blocker, confidence high):** the brief says Ghidra 12.1.4 is
installed at `/opt/ghidra_12.1.4_PUBLIC`; it is not present in this session,
and `github.com/NationalSecurityAgency/ghidra` releases are not reachable
here. Every item marked *(needs Ghidra)* below stays Unknown or medium
confidence until it is decompiled. A GhidraScript written to the P17 to P20
conventions (`ExportSelectedFunctionsScript.java`: `getScriptArgs` output
directory plus name fragments, `DecompInterface` per function, one file per
function) is ready outside the repository, untested.

### 2.3 How the new observations are recorded

- Behaviors in words: `docs/validation/flowjo-engine-specs.md` section 6.8
  (new) plus the existing sections 1 to 6.7.
- Original-case Evidence: six new observations in `tools/rea-originals.json`
  (`unique-child-name`, `shape-too-small`, `relink-keywords`,
  `quad-siblings`, `cell-cycle-channels`, `undo-limit`), authority
  `shipped-artifact`, provider `javap`. The first five restate behaviors
  already decoded in specs 6.1, 6.2 and 6.7; `undo-limit` is new.
  Two of them rest partly on `fjlib-2.3.0.jar` (`NameUtil`, `FJUndoManager`);
  they are recorded under the jar subject with the fjlib class named in the
  symbols, because `tools/reaProof.ts` labels every non-`jar` subject as a
  native observation (see fix F9).
- Closed obligations: six new entries in `tools/rea-obligations.json`, each
  bound to existing tests. REA ledger (analyst mode) regenerated:
  **10 of 10 obligations verified, ledger `ready`**
  (`docs/validation/rea-ledger-result.json`, ledger Evidence
  `ev_df9c0065f11a8a3b...`, closure digest `c96414af1deb...`; was 4 of 4).
- Open obligations (Differs / Missing): twelve entries in
  `tools/rea-open-obligations.json`, in REA's reviewed-obligation shape, not
  yet in the ledger (no owner; see fix F9).

| New original Evidence | Observation | Obligation |
|---|---|---|
| `ev_11d197fc5dc61181...` | unique-child-name | names.unique-sibling |
| `ev_69adcbebbd20d663...` | shape-too-small | gate.min-shape |
| `ev_1c5be4529e984868...` | relink-keywords | sample.relink-keywords |
| `ev_9bdbf4c7336d6cff...` | quad-siblings | gate.quad-sibling-delete |
| `ev_7cb8479303c58b36...` | cell-cycle-channels | cellcycle.histogram-channels |
| `ev_bc9a71d441d5bcee...` | undo-limit | workspace.undo-limit |

### 2.4 Update after Ghidra became available (same day)

Ghidra 12.1.4 was installed at `/opt/ghidra_12.1.4_PUBLIC` (official release,
SHA-256 `ddac49f9...d2d4db`, the value pinned in rea's CI workflow) and
`rea doctor --provider ghidra` reports healthy. R2 is resolved; R1 (REA has
no JVM route) stands.

- REA-native ledger rerun (`tools/reaObserveFlowjo.mjs`, REA Ghidra provider,
  bundles kept in `/tmp`): **10 of 10 obligations verified, ledger `ready`**
  (`docs/validation/rea-ledger-result.native.json`; 41 Evidence records). The
  six new obligations rest on the analyst observations, linked from the REA
  records.
- Java classes decompiled with headless Ghidra and the P17 to P20 GhidraScript
  (output in `/tmp`), cross-checked with `javap -c`: A1 (undo limit, now high
  confidence), A26 (curly quad shape), C23 (edge-event default 5%, on).
- Engine functions analyzed with REA's Ghidra provider (second session,
  bundle in `/tmp`): A25 bisector rule (high), A9 Mode rule (high). A16
  channel mapping stays Unknown (unresolved virtual dispatch). A17 random
  selection is not in `Exporter::SampleLoop`; bounded search of the engine
  export classes found no selection routine, so it is likely in the Java
  export command (`ExportCommand2`) or a downsample gate: Unknown.

## 3. Part A: behavior parity

Status: **Match** (same behavior, evidence cited), **Differs** (both have it,
behavior differs), **Missing** (FlowJo 10 has it, this app does not),
**Unknown** (cannot be decided from the evidence available here), **Own**
(this app has its own rule where FlowJo has none). Confidence is about the
FlowJo side; runtime is unconfirmed for every FlowJo item (static reading
only). "Specs" = `docs/validation/flowjo-engine-specs.md`. "Matrix" =
`docs/compatibility-matrix.md`. Inventory: FlowJo-10.6.2.jar 2,941 classes,
fjlib-2.3.0.jar 1,957, fjengine 112; engine about 535 FlowJo C++ classes
(gating 87, FCS I/O 46, formula parser 109, ML/downsample 63, histograms 31,
statistics 39, platforms 29, transforms 19, export 15, compensation 9).

### 3.1 Already decoded and closed (build on, not redone)

| Behavior | Status | Evidence | Obligation |
|---|---|---|---|
| Polygon gating on the gate grid | Match (221/228 populations exact; 7 pinned version differences) | specs 1; engine `PolyGateHistogram2D`, `ScalePointSet` | wsp.polygon-counts (verified) |
| Ellipse as 180-vertex outline polygon | Match | specs 2; `EllipseGate.writeQuery`; engine has no ellipse gate type (new, consistent) | wsp.logicle-ellipse (verified) |
| Rectangle bounds open at a linear axis edge | Match | specs 3; `FGate::GetRectRangeInScale` | gate.rect-open-bounds (verified) |
| Median, percentile, robust SD/CV on the 4096-channel histogram | Match (not validated against FlowJo-computed values) | specs 4 | stats.flowjo-conventions (verified) |
| Quad = rectangle with one open bound per axis; centre drag moves all | Match | specs 6.2 | - |
| Quad sibling delete | Match | specs 6.2 | gate.quad-sibling-delete (verified, new) |
| Cell cycle histogram min(range, 1024) | Match | specs 6.1 | cellcycle.histogram-channels (verified, new) |
| Unique sibling names, `-N` suffix | Match | specs 6.7 | names.unique-sibling (verified, new) |
| Shapes of 10 px or less discarded | Match | specs 6.7 | gate.min-shape (verified, new) |
| Relink by keyword test | Match (folder fallback impossible in a browser) | specs 6.7 | sample.relink-keywords (verified, new) |
| Same file not added twice | Own (content hash; FlowJo compares URI/ID) | specs 6.7 | - |
| Spillover vs spectral flag | Match (flag); unmixing Differs (OLS vs FlowJo weights) | specs 6.3; new: `SpectralWeightsDialog`, `WeightOptimizer` (weights exist; no separate unmixing solver found) | - |
| Derived parameter delete | Own (stricter) | specs 6.6 | - |
| Gating-ML 2.0 export | Own (FlowJo 10.6.2 has none of its own) | specs 6.5 | - |

### 3.2 New comparison rows

| # | Area | FlowJo 10.6.2 behavior | This app | Status | FlowJo evidence | Conf. |
|---|---|---|---|---|---|---|
| A1 | Workspace | Undo keeps 100 user actions (each action's edits are one compound edit); new edit drops redo | 100 snapshots, same | Match | `WSUndoManager` / `FJUndoManager` (decompiled: `startNewEdit` adds each compound edit through Swing `UndoManager.addEdit`, no `setLimit`; checked with `javap -c`); specs 6.8 | high |
| A2 | Workspace | Preference "Disable Undo" | none | Missing | `prefs.ws.noundo` | high |
| A3 | Workspace | Optional auto-save every N minutes (saved workspaces with samples; not ACS/Envoy) | none | Missing | `AutoSaveTask`, `prefs.ws.autosave*` | high |
| A4 | Workspace | Delete confirmations with "Don't Ask Again", reset in Preferences | asks every time | Missing (known open item) | specs 6.7; `prefs.ws.resetdontask` | high |
| A5 | Samples | Remove from workspace or from current group only | asks workspace or current group; removes from the group only (2026-11-06) | Match (specs 7.1) | `ws.deletesample.ws/group` | high |
| A6 | Groups | Group-owned analysis; delete asks "everywhere or copy to each sample"; synchronized groups | group-owned populations; Synchronized groups; Allocate To Samples / First Sample / Delete Entirely; Rename for all (2026-11-06) | Match (specs 7.2) | `fj.string.groupdelprompt`, `ws.group.dlog.sync` | high |
| A7 | Groups | Live criteria (decoded, specs 7.1): =, ≠, >, >=, <, <=, Contains, Lacks, Exists; And / Or / & Not from a true start; stain sets; reference group | FlowJo functions and connectors, numeric comparisons, stain sets, reference groups (2026-11-06) | Match (specs 7.1) | `CriteriaTest`, `fj.criterion.contains`, `fj.keyword.criterion.*` | medium |
| A8 | Groups | Roles (test, control, compensation, baseline, replicate...) and every-Nth sample | roles in the group dialog and .wsp; check every n-th sample (2026-11-06) | Match (specs 7.1) | `Group$Role`, `Group.getEveryNthSample` | high |
| A9 | Statistics | Mode, Correlation, Freq. of (any ancestor). Mode = the first (lowest) channel with the highest count in the parameter's histogram, channel index times range / channels, then converted to a data value | Mode (256-channel rule), Freq. of (named ancestor), Correlation (NaN, as the 10.6.2 engine) (2026-11-06) | Match (specs 8) | `Statistic.MODE/CORRELATION/FREQOF`; Mode: REA Ghidra `GParameter::Mode` `ev_14466f77...`, `BasicHistogram::ChannelMode` `ev_c5cc3d11...`; histogram size for statistics assumed 4096 as for the median (specs 4); Correlation and Freq. of rules not read | high (Mode rule); medium (bin count) |
| A10 | Statistics | No Min statistic (engine names a Max) | Min and Max kept as own statistics; not written to .wsp (no FlowJo key) (2026-11-06) | Own rule (documented) | `Statistic` constants; engine stat-name literals | medium |
| A11 | Statistics | Comparison statistics (KS, Overton, chi-square, probability binning) | moved to Platforms (Compare Populations), A39 | Moved to A39 | `StatKey`, `KolmogorovSmirnoff`, `MultiDimCompare` | high |
| A12 | FCS read | Versions 2.0, 3.0, 3.1; 3.2 tag recognized | 2.0, 3.0, 3.1; 3.2 refused with an explicit error | Differs | engine literal `FCS3.2`; extent of 3.2 support Unknown | medium |
| A13 | FCS read | Packed (non-byte) and mixed bit widths, 3-byte variants | rejected with an explicit error | Missing | `FCSPackedDataReader`, `FCSMixedDataLengthRawDataReader`, `FCS3ByteDataReader` | high (names) |
| A14 | FCS read | `$NEXTDATA` data sets | one data set at a time | Match | `FCSUtil::ReadDataPage` | medium |
| A15 | Export | FCS 3 events | FCS 3.1 float32 | Match (format); parameter choice Differs | `FCS3Exporter`; `ExportParameters{ALL_UNCOMPENSATED,ALL_COMPENSATED,CUSTOM}` | high |
| A16 | Export | CSV of scale values or channel values; header by stain, parameter or both | scale values, parameter names | Differs | `ExportFileTypes{CSV_SCALE,CSV_CHANNEL}`, `HeaderParameter`; channel mapping not recovered (`GParameter::ScaleToChannel` dispatches through a virtual table Ghidra could not resolve, `ev_86470e58...`) | high (exists); mapping Unknown |
| A17 | Export | Event cap (random N, or smallest file) and concatenation (all, every n, equal keyword) with a sample-ID parameter | none | Missing | `ExportModel$EventCountParameter`, `$GroupConcatenationParameter`, `Exporter::GetSampleIDParameter` | high |
| A18 | Workspace files | `.wsp` read | read; 221/228 counts exact | Match | specs 1 to 3; matrix | high |
| A19 | Workspace files | `.wsp` write | written, never opened in FlowJo | Unknown | matrix | - |
| A20 | Workspace files | `.wspt` templates, ACS archives, legacy `.jo`, Excel/CSV of the workspace table | none (native `.frea.json`, stats CSV) | Missing | `WSDocument.saveTemplate/doSaveACS/readJoFile/doSaveToExcel` | high |
| A21 | Workspace files | `.wsp` layout pages | matrix says "warned"; no such warning in `src/core/wsp.ts` (silently ignored) | Differs (doc vs code) | this app: matrix "Construct coverage" row 1 vs `wsp.ts` | high |
| A22 | Compensation | Matrix files: FlowJo matrix (Gating-ML based) and CSV save, load from file | CSV import (own `#` header rule) | Differs | specs 6.4; `CompCommand{SAVE_FJFORMAT,SAVE_CSVFORMAT,LOAD_FILE}` | high |
| A23 | Compensation | Spillover spreading matrix (SSM) view/export | none | Missing | `CompCommand{CALCSSM,SSM_VIEW,SSM_SAVE}`, `WeightOptimizer::CalculateSSM` | high |
| A24 | Compensation | Wizard with auto positive/negative gates, universal negative, status badges | median-based wizard, own | Differs | `compeditor.model.AutoGateMaker`, `WizardMatrix` | high (exists); algorithm Unknown *(needs Ghidra)* |
| A25 | Gates | Bisector: two populations split at one value; an event below the split is in the left one, every other event (the split value included) in the right one; exact comparison on the parameter value, not the gate grid | none | Missing | REA Ghidra `QuadGate::ComputeBisectorGate` (per-event overload) `ev_0086d5bb...`; `gw.tool.bisector` | high |
| A26 | Gates | Curly quad: each arm is a parabola in display pixels from the centre, y = cy - round(k dx^2), sampled about every 1/40 of the remaining width to the frame edge; a command doubles or halves k | spline quadrant (monotone cubic through control points, own definition) | Differs | `CurlyQuadGate.getHorizontalCurlyFunction`, `multInflection` (decompiled, checked with `javap -c`) | medium-high |
| A27 | Gates | Spider quad, freehand (pencil), timeslice, auto gate, magnetic gates, manual coordinate entry, anchored range, BifurGate | none (Time range gates work) | Missing | `gw.tool.*`, `TetheredRangeGate`, `AutoGateMaker`, `ws.autoquad` | high |
| A28 | Gates | Copy/paste gates; convert shape (rect/poly/ellipse) | none | Missing | `GWCommand{COPYGATE,PASTEGATE}`, `GateConvertEdit` | high |
| A29 | Gates | Exclusion via a negation flag on the gate | `exclude` toggle | Match (semantics derived; matrix row 5) | `FGate::SetNegation`, `Gate.getNot` | medium |
| A30 | Gates | Same-named gate under a node: asks to replace | Gating-ML import asks (specs 6.7); drawing uses `-N` | Match | `ws.parent.node.prompt` | high |
| A31 | Transforms | Linear, log, biex, logicle, arcsinh, hyperlog | same (ISAC exact, FJ-LUT) | Match | `Transform$TransformType` | high |
| A32 | Transforms | Miltenyi, robust log, manual table; auto width basis; per-cytometer defaults (about 30 families) | none; own defaults (logicle for fluorescence) | Missing / Differs | `TransformType`, `Cytometer$CytometerType`, `TransformedParameter::DetermineTransformationAutoWidth` | high |
| A33 | Transforms | Apply a transform to one sample, group or all samples | per channel, global | Differs | `ParmTransformCommand{APPLYTOGROUP,APPLYALLSAMPLES}` | high |
| A34 | Derived params | Formula language (arithmetic, log/exp, trig, if-then, string functions), event number, imported CSV/CLR | ratio A*(num-B)/(den-C) only | Differs (matrix backlog) | `AlgebraicParameter`, engine `Parser`, `formula.func.*` | high |
| A35 | Keywords | Add, edit, find/replace, value series, paste to group | view only | Missing | `WSKeywordMgr`, `KeywordFindRelpaceDialog`, `KeywordValueSeriesDialog` | high |
| A36 | Platforms | Cell cycle DJF / Watson; 2D cell cycle (EM) | DJF / Watson (own fitter); no 2D | Match (models) / Missing (2D) | `cellcycle.model.*`, `graphwindow.cellcycle.em.*` | high |
| A37 | Platforms | Proliferation (peaks, indices) | same; older "proliferation index" definition differs (matrix) | Differs (definition) | `proliferation.*`, `StatKey.ProlIndex` | medium |
| A38 | Platforms | Kinetics: smoothing (Gaussian, moving average), threshold, auto-slicing; stats peak, slope, AUC | equal-width bins, count/mean/median/% above | Differs | `KineticsSmoothing`, `StatKey kin*` | high |
| A39 | Platforms | Compare populations, 3D viewer, Q&B, sample quality, calibration, plate editor, FCS Scan, tSNE, scripting (Rhino), plugins | none | Missing (matrix backlog: plugins) | `PlatformNavCommand`, `com.flowjo.native_tsne`, `PluginManager` | high |
| A40 | Graphs | Edge-event warning at axis bounds | none | Missing | `gw.gates.panel.warn1/2`, `prefs.graphs.threshold` | high |
| A41 | Graphs | Dot, pseudocolor, contour, density, zebra, histogram, CDF | all but CDF | Match / Missing (CDF) | `DisplayType`, `fj.graph.*` | high |
| A42 | Layout | Free positioning, iteration (sample / keyword / panel), batch to PDF, PowerPoint, web | ordered list, per-sample batch, raster PDF | Differs (matrix backlog) | `leditor.*`, `Batch$BatchDestination` | high |
| A43 | Tables | Table editor (formulas, formatting, iteration, outputs) | stat columns + named templates | Differs (matrix backlog) | `teditor.*` | high |
| A44 | Open | Missing data files searched for and status shown per file | relink by keywords when files are added | Differs (browser cannot search disks) | `ws.sample.file.*` | high |

Bounded negative searches (P4): "Missing" for a FlowJo feature means its
classes, keys or symbols were found; "none" for this app means the survey of
`src/` found no code (`/tmp` survey notes, file:line in each row's source).
Absence in FlowJo (A10 Min; A7 starts/ends with) is from the class and
string inventory only, so it is medium or low confidence.

## 4. Part B: code architecture

Compared against the rea patterns P9 to P16 only. flowjo-rea facts come from
reading `src/`, `tests/`, `e2e/` and `docs/` (file:line given). rea is a
CLI/MCP tool and flowjo-rea a browser app, so only patterns that carry over
are applied; where a rea mechanism has no counterpart need here (runtime
settings through MCP, provider lifecycles) that is said instead of copying it.

| # | Pattern | rea | flowjo-rea | Difference | Smallest change that aligns it | Conf. |
|---|---|---|---|---|---|---|
| B1 | P9 dependencies inward | domain -> contracts -> providers -> application -> CLI/MCP adapters (`docs/architecture.mermaid`) | `src/core` (model, formats, gating, statistics, `AnalysisService`) <- `src/worker` (22-line RPC shim) <- `src/ui`. `core` never imports `ui` or `worker` | Direction matches. There is no application layer: workflows (relink, import merge, apply to group, export orchestration) live in `src/ui/App.tsx` (1,057 lines) next to rendering | Move workflow functions out of `App.tsx` into `src/core` one at a time as they are touched (relink and import merge already live in `core/project.ts`; follow that). No new framework | high |
| B2 | P9 one owner per interpretation | consumers use the owner's parsed facts | FCS and gating run in the worker; `.wsp`, Gating-ML and workspace JSON are parsed and written on the UI thread (`src/ui/App.tsx:193,199,216,997,1018`) | Two execution owners for parsing (owner module is still `core`, so facts are not reinterpreted) | None needed for correctness. If large `.wsp` files block the UI, route them through `AnalysisService` like FCS | high |
| B3 | P10 typed error contract | `{code, category, message, retryable, remediation{action}, recovery?, details?}`, closed sets, `additionalProperties: false` | `AppError{code, message}` with 16 codes (`src/core/errors.ts:3-33`); the worker sends `{code, message}`; `INTERNAL` and `WORKER_FAILED` are outside the `ErrorCode` union (`src/worker/analysis.worker.ts:19`, `src/ui/workerClient.ts:21,26`); the UI drops the code and logs the message (`src/ui/App.tsx:96-119`) | No remediation field, codes not closed across the worker, code lost in the UI | Add `INTERNAL` and `WORKER_FAILED` to `ErrorCode`; add an optional `remediation` string to `AppError` and carry it across the worker; show `code` and remediation in the Log. Skip `category`/`retryable` until a consumer needs them | high |
| B4 | P11 parse unknown boundary values | parse at the boundary; tagged errors in `Result`; keep partial facts | the worker dispatches any `AnalysisService` property name (`src/worker/analysis.worker.ts:12-13`); expected failures are thrown; partial facts are kept well (per-population errors, `src/core/analysis.ts:145-157`) | Worker boundary accepts unvalidated operation names | Allow-list the operation names in the worker (the client's typed proxy already lists them). Keep throw-based errors: `Result` would touch every module for no observed failure | high |
| B5 | P12 named limits with units | every limit a named constant with a unit; settings only for headroom; honest recovery text | named: `HISTORY_LIMIT`, `MIN_SHAPE_PX`, `MIN_EVENTS`, `MAX_PEAKS`, `CELL_CYCLE_MAX_CHANNELS`; bare literals: 20000 plot points (`App.tsx:319,331`; repeated `Layout.tsx:73,79`), 200 log entries (`App.tsx:95`), 500-character keyword values dropped (`App.tsx:166`), 1000 data sets walked then silent stop (`src/core/fcs.ts:117`), 150 ms debounce; no FCS size or event cap | Literals repeated across files; three caps drop data silently | Put the literals in named constants with units (e.g. `MAX_PLOT_EVENTS`, `LOG_MAX_ENTRIES`, `KEYWORD_SNAPSHOT_MAX_CHARS`, `FCS_MAX_DATASETS`) and add a warning when the data-set walk or keyword snapshot truncates, naming the limit and that it has no override. No settings: no user needs headroom today | high |
| B6 | P12/P13 lifecycle and recovery | owned processes, deadlines, cleanup, recovery text that names the next action | worker crash rejects pending requests with `WORKER_FAILED`; no restart, timeout or cancel (`src/ui/workerClient.ts:18-28`) | After a crash every later request fails until reload, with no instruction | On `WORKER_FAILED`, show remediation "reload the page and add the FCS files again; save the workspace first". Restart logic only if crashes are seen | medium |
| B7 | P11 keep partial facts (UI) | failures stay scoped | no React error boundary (no `ErrorBoundary`/`componentDidCatch` in `src`) | A render exception can blank the page (unverified) | One error boundary around each panel that logs the error and keeps the rest of the page | medium |
| B8 | Testing (AGENTS.md "Tool and Test Changes") | prefer real public workflows, then production-boundary integration, then goldens; report unverified coverage | strong oracle tests (flowio, ISAC truth, FlowJo counts in 14 workspaces); E2E (`e2e/*.mjs`) not part of `npm test`; Playwright not in `package.json` | E2E depends on a preinstalled Playwright | Add `playwright` as a dev dependency pinned to the preinstalled version (or document the requirement in README) | high |
| B9 | P15 contribution and PR template | `CONTRIBUTING.md`, `.github/pull_request_template.md`, Conventional Commits, readiness left to the human | Conventional Commits already used; no `CONTRIBUTING`, no PR template, no CI | Missing contributor rules outside `CLAUDE.md` | Add a short PR template (Summary, Problem, Change and scope, Evidence, Validation performed, Author readiness unchecked) mirroring rea's, and point `CONTRIBUTING.md` at `CLAUDE.md` rules | high |
| B10 | Static checks (AGENTS.md `check:fast`) | typecheck plus lint | `tsc` strict only; 4 `eslint-disable` comments with no ESLint config | Dead lint directives | Either remove the 4 directives or add ESLint with `react-hooks` (what they refer to). The second also catches stale effect dependencies | high |
| B11 | Architecture doc | `docs/architecture.mermaid` of layer owners | `docs/design.md` prose | No owner diagram | Add `docs/architecture.mermaid` (core / worker / ui owners and the worker protocol) | high |
| B12 | P7/P8 evidence tooling | reviewed obligations may be open (no binding); evidence operation reflects the evidence type | `tools/reaProof.ts` requires owner, fixtures and verifier for every obligation, and labels every non-`jar` subject `inspect_native_functions` | Open obligations and `fjlib` evidence cannot enter the ledger correctly | Let the producer emit ownerless obligations as reviewed obligations without a manifest binding (they stay open), and derive the operation from the subject format (`zip` -> Java classes). Then merge `tools/rea-open-obligations.json` into the ledger | high |
| B13 | P16 performance order | measure only for performance work | no measurements claimed | none | none | - |

Not applicable from rea: runtime analysis settings through MCP (no
operator-tunable budgets in a browser app), provider registries and process
ownership (one in-page worker), generated error catalogs (16 codes; a table
in the docs would do if wanted).

## 5. Part C: UI/UX

FlowJo side: resource bundles `com/treestar/flowjo/core/flowjodictionary.properties`
(and `_dlog`, `_plat`, `_prefs`), fjlib `com/bric/swing/QDialog.properties`,
and UI class names; band-to-tab placement and button order are built in code
and were not read *(needs Ghidra)*. Accelerator modifiers are inferred
(menu key, Shift for an upper-case value): medium confidence. This app's side:
`src/ui/*`. No rea or ghidra pattern covers UI design (section 1, gap); the
recommendations below are either "match FlowJo 10" (evidence-backed) or
"own rule" (a browser constraint or this app's choice, to be decided in UAT
step 3, `docs/validation/uat-2026-11-02.md` section 5).

| # | Area | FlowJo 10.6.2 | This app | Status | Recommendation for step 3 | Conf. |
|---|---|---|---|---|---|---|
| C1 | Main window | Ribbon frame: tabs File, Edit, Tools, Configure, Workspace, FlowJo; 22 bands (Document, Clipboard, Navigate, Groups, Keywords, Populations, Statistics, Boolean, Biology, Cytometry, Visualizations, Discovery, ...); presets Simple / Experienced / Advanced (`ws.ribbon.*`, `WSRibbonFrame`) | one toolbar and four panels, no menus (`src/ui/App.tsx:540-560`) | Differs | Own rule: keep one page. Group the toolbar into FlowJo's band names (Document, Groups, Populations, Statistics, Biology, Cytometry) so FlowJo users find commands | high |
| C2 | Group pane | Group list above samples; "All Samples" cannot be edited or deleted; name, role, size (`GroupTreeTable`, `ws.groupmgr.errcantdeleteall`) | group list; role set in the group dialog (2026-11-06) | Match | Keep; add role only with A8 | medium |
| C3 | Sample tree | One tree-table: samples, populations and statistic nodes with columns Name, Statistic, #Cells and optional keyword columns (`SampleTreeTable`, `ws.column.special.*`) | population tree plus a separate statistics table | Differs | Own rule: keep the split; optional keyword columns later | high |
| C4 | Graph window | One window per population; menus File, Edit, Go, Graph, Display, Help; breadcrumb gating path; parent/child and next/previous sample navigation (`GWFrame`, `gw.breadcrumbbar.*`, `gw.nav.*`) | one plot panel bound to the selected population | Differs | Match in part: add a breadcrumb of the gating path and next/previous sample keys (PageUp/PageDown, as `gw.nav`) to the plot panel | high |
| C5 | Gate naming | After drawing, a naming dialog (name, favorites list, colour; unique-name check) (`GateNamerDialog`, `dlog.gatenamer.*`) | automatic name, double-click to rename | Differs | Own rule: keep automatic names (faster); naming rules already match (specs 6.7) | high |
| C6 | Gate tools | 13 tools: arrow, rectangle, ellipse, polygon, pencil, quad, curly quad, spider, range, bisector, timeslice, auto gate, manual entry (`gw.tool.*`) | select, rectangle, polygon, ellipse, quadrant, spline; select and range on histograms | Missing (A25 to A27) | Add bisector first (fix F8); others later | high |
| C7 | Transforms | Transform dialog per parameter (logicle T/W/M/A, biex width/decades) with apply to group / all samples / several parameters (`dlog.parameter.*`, `dlog.transformvalues.*`) | scale dialog per channel, global | Differs (A33) | Defer: needs a per-sample scale model | high |
| C8 | Layout editor | Own ribbon window (tabs File, Edit, Arrange, Object, Settings, Layout Editor), free drawing tools, graph definition dialog, iteration by sample / keyword / panel, batch to PDF / PowerPoint / web (`le.*`) | modal with an ordered two-column list, per-sample batch | Differs (A42) | Defer; the S4 layout items in UAT step 3 stay own choices | high |
| C9 | Table editor | Own window (tabs Table Editor, Edit, Visualize, Plot): formula and keyword columns, formatting, outputs to file / clipboard / layout (`te.*`) | statistics panel with named templates | Differs (A43) | Defer | high |
| C10 | Compensation | Compensation window: control group, positive/negative gates per parameter, status badges, Calculate, matrix editor, SSM (`compeditor.*`, `plat.comp.*`) | compensation dialog with wizard and editable grid | Differs (A22 to A24) | Keep; step 3 matrix input checks stay an own rule (FlowJo accepts bad files silently, specs 6.7) | high |
| C11 | Derived parameters | Formula editor with reference insertion, scale range, preview, apply to group (`plat.derived.*`, `dlog.dp.*`) | ratio builder | Differs (A34) | Defer | high |
| C12 | Keywords | Inspect window (keywords, parameters, prev/next sample) plus Add Keyword, Find & Replace, Value Series (`PropertiesDialog`, `ws.find.*`) | Keywords modal, view and filter only | Match (view) / Missing (edit) | Add prev/next sample in the Keywords modal (small) | high |
| C13 | Export | "Export or Concatenate" dialog: format (FCS3, CSV scale, CSV channel), parameters, event cap, naming pattern, concatenation, file count and overwrite warnings (`export.*`) | Export modal: CSV or FCS, compensated toggle, plot PNG/SVG, Gating-ML, .wsp | Differs (A15 to A17) | Match: add event cap and concatenation options with A17 | high |
| C14 | Platforms | One window per platform; errors in the window; warning before opening many windows (`plat.factory.*`) | Platforms modal; errors in the window (specs 6.7) | Match | Keep | high |
| C15 | Preferences | 25 panels (Workspace, Graphs, Gates, Cytometers, ...) incl. "Reset All Don't Show Memory", "Disable Undo", auto-save (`prefs.*`) | none | Missing | Add a minimal Preferences dialog only for what fixes need: "Don't ask again" reset (F1), auto-save if adopted | high |
| C16 | Keyboard | About 150 accelerators, e.g. Cmd+Z / Shift+Cmd+Z undo/redo, Cmd+S save, Cmd+G group, Cmd+B add statistic, Cmd+E export, Cmd+I inspect, Cmd+Enter open graph, Cmd+Y Preferences (`*.accelerator`) | Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl/Cmd+Y (redo) (`src/ui/App.tsx:82-93`) | Differs | Match where the browser allows: Cmd/Ctrl+S, +G, +B, +E, +I. Browser-reserved keys (Cmd+L, +T, +N, +W, +R) stay unmapped (own rule). Keep Ctrl+Y as redo (Windows convention; in FlowJo it opens Preferences) | medium |
| C17 | Escape | Escape bound only in the rename dialog (specs 6.7) | Escape clears a polygon draft only | Differs | Own rule as planned: Escape closes every dialog (browser convention) | high |
| C18 | Delete confirmations | Populations, samples, groups, layouts, tables, plates each ask; many with "Don't Show Again" (`ws.mgr.confirmation*`, `ws.groupmgr.deleteprompt`, `le/te/pe.delete.confirm`) | asks for population delete, sample remove, in-use derived parameter; not for group, matrix, template, statistic column, layout item (`src/ui/App.tsx:593,857,867`) | Differs | Match: ask before deleting a group and a template; add "Don't ask again" (F1). Statistic columns and layout items stay undoable without a question (own) | high |
| C19 | Remove samples | Asks: from workspace or from the current group (`ws.deletesample.ws/group`) | asks: from workspace or from the current group (2026-11-06) | Match | Match (F2) | high |
| C20 | Unsaved changes | "Save changes?" on close (`ws.doc.wannasave`, QDialog save prompts) | no guard when the tab closes | Missing | Match: `beforeunload` guard when the workspace has unsaved edits (F3) | high |
| C21 | Add samples | Add Samples command and a "Drag Samples Here" drop target; per-file failure counts (`ws.sample.drag.here`, `ws.samplemgr.numfilesnotadded`) | file picker only | Missing (drop) | Match: accept dropped FCS files on the samples panel (F4) | high |
| C22 | Status | Status/progress area; auto-save message (`WSProgressPanel`) | "Working..." / "Ready" plus the Log | Match | Keep; step 3 stale-log warnings stay own | medium |
| C23 | Edge events | Warning in the graph when 5% or more of events are on either axis bound; on by default (`gw.gates.panel.warn1/2`; `FJPrefsFJML$Graph.eventsOnAxis` = true, `warningThreshold` = 5) | none | Missing (A40) | Match: caption warning at 5% with the share on the bounds | high |
| C24 | Launcher, help, repositories | Start window with recent documents; Help band; LabArchives / Cytobank / Enterprise links | none | Missing | Own rule: not needed in an offline single file | high |
| C25 | Group dialog | Create/Modify Group: name, colour, role, criteria (keyword op value), Live, Synchronized (`GroupDlog`) | Create/Modify Group dialog: name, role, Live, Synchronized, 4 criteria, stain sets, reference group (2026-11-06) | Match | Match criteria operators with F7 | high |

## 6. Ranked proposed fixes

Ranked by impact over effort. Effort: S (under a day), M (days), L (weeks).
Nothing here is implemented; each waits for a go-ahead. "Needs Ghidra" means
a FlowJo rule must be decoded first to match it exactly.

| Rank | Fix | Rows | Impact | Effort | Evidence | Conf. |
|---|---|---|---|---|---|---|
| F1 | "Don't ask again" on delete confirmations, remembered per message, reset from a minimal Preferences dialog | A4, C15, C18 | Medium: the known open UAT item; fewer repeated questions | S | specs 6.7, 6.8; `SDialogs.confirm`, `prefs.ws.resetdontask` | high |
| F2 | Remove samples from the workspace or only from the current group | A5, C19 | Medium: group editing without losing samples | S | `ws.deletesample.ws/group` | high |
| F3 | Unsaved-changes guard on tab close | C20 | High: prevents data loss (FCS data and edits are in memory only) | S | `ws.doc.wannasave` | high |
| F4 | Drop FCS files onto the samples panel | C21 | Medium: common FlowJo workflow | S | `ws.sample.drag.here` | high |
| F5 | Error contract: close `ErrorCode` over `INTERNAL`/`WORKER_FAILED`, carry an optional remediation, show code + remediation in the Log; allow-list worker operations; error boundary per panel; remediation for worker failure | B3, B4, B6, B7 | Medium: clearer recovery, no blank page | S | `src/core/errors.ts`, `src/worker/analysis.worker.ts`, `src/ui/workerClient.ts` | high |
| F6 | Named limits with units; warn when the data-set walk (1000) or keyword snapshot (500 characters) truncates | B5 | Medium: no silent data loss | S | `src/core/fcs.ts:117`, `src/ui/App.tsx:166` | high |
| F7 | Live group criteria: numeric comparisons, between / not between, exists / lacks | A7, C25 | Medium: FlowJo groups built on numeric keywords | S-M | `CriteriaTest` | medium |
| F8 | Bisector gate | A25, C6 | Medium: common FlowJo gate | M | `QuadGate::ComputeBisectorGate`: below the split left, the rest right (decoded) | high |
| F9 | REA producer: emit ownerless obligations as open reviewed obligations; derive the evidence operation from the subject format; then merge `tools/rea-open-obligations.json` | B12 | Medium: the ledger shows open parity work, not only closed work | S | rea `docs/reconstruction-obligation-ledgers.md`; `tools/reaProof.ts` | high |
| F10 | Event export: event cap and concatenation with a sample-ID parameter | A17, C13 | High for users who downsample or merge files | M | `ExportModel` enums, `Exporter::GetSampleIDParameter`; random selection rule *(needs Ghidra)* | high |
| F11 | Statistics Mode and Freq. of (any ancestor); Correlation later | A9 | High for parity of stats tables | M | `Statistic` constants; Mode rule decoded (first highest histogram channel); Freq. of and Correlation rules not read | high (Mode) |
| F12 | `.wsp` layout pages: emit the warning the matrix promises, or correct the matrix | A21 | Low, but a doc/code mismatch | S | `docs/compatibility-matrix.md`, `src/core/wsp.ts` | high |
| F13 | Graph navigation: gating-path breadcrumb and next/previous sample keys; edge-event caption | C4, C23, A40 | Medium | S-M | `gw.breadcrumbbar.*`, `gw.nav.*`, `gw.gates.panel.warn1/2` | high |
| F14 | Keyboard accelerators allowed by the browser (S, G, B, E, I) | C16 | Low-medium | S | `*.accelerator` keys | medium |
| F15 | Repository hygiene: PR template and CONTRIBUTING pointer, ESLint with `react-hooks` (or drop the 4 directives), Playwright as a dev dependency, `docs/architecture.mermaid` | B8 to B11 | Low-medium: contributor clarity | S | rea `.github/pull_request_template.md`, `AGENTS.md` | high |

Larger items, not ranked for now (L effort or need an own decision):
group-owned analysis (A6), per-sample transforms (A33), formula derived
parameters (A34), keyword editing (A35), copy/paste and shape conversion
(A28), packed / mixed FCS bit widths (A13), CSV channel values (A16), auto-save
in a browser (A3), layout and table editors (A42, A43), the platforms in A39.

## 7. Open questions and blockers

1. **Ghidra (blocker).** `/opt/ghidra_12.1.4_PUBLIC` does not exist in this
   session and the release download is blocked. To unblock: install Ghidra
   12.1.x there (or allow `github.com/NationalSecurityAgency/ghidra`
   releases), then run the prepared GhidraScript on the rows marked *(needs
   Ghidra)* and `rea ... --provider ghidra` on the engine for an REA-native
   ledger rerun.
2. **REA and JVM classes (finding R1).** Not fixable by configuration;
   decompiled Java stays analyst Evidence unless REA adds a JVM route.
3. **UI pattern.** Neither rea nor ghidra has a UI/UX design pattern. Part C
   uses FlowJo 10 as the reference and labels every other recommendation as
   an own rule. If a UI pattern source should govern step 3, name it.
4. **Fix F9 touches `tools/reaProof.ts`.** It is tooling, not app code, but
   it is a code change; it waits for a go-ahead like the others.

## 8. Parity tracker

Updated with each area PR (one PR per area, REA loop: decode with Ghidra /
REA, spec, REA obligation, implementation, tests, ledger). Ratings use the
rows above: High = every row Match or a documented own rule.

| Area | Rating | Since |
|---|---|---|
| Gating math | High | 2026-11-01 |
| Core statistics rules | High | 2026-11-01; mean, SD, CV, geometric mean and MAD now on FlowJo histogram rules 2026-11-06 |
| .wsp import | High | 2026-11-01 |
| Transforms (main types) | High | 2026-11-01 |
| Naming, delete, relink, undo | High | 2026-11-05 |
| **Groups** | **High** | 2026-11-06 (specs 7; obligations groups.*) |
| FCS reading | Medium | |
| Compensation | Medium | |
| Cell cycle, proliferation | Medium | |
| Gate tools | Low | |
| Export | Low | |
| **Statistics list** | **High** | 2026-11-06 (specs 8; obligations stats.histogram-moments, stats.mode-mad-correlation, stats.wsp-names) |
| Kinetics | Low | |
| Derived parameters | Low | |
| Layout and table editors | Low | |
| Preferences, autosave, shortcuts | Low | |

