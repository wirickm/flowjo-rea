# Progress and handoff

## State (2026-11-07, remaining UI gaps)

Specs 25: Show Uncompensated Parameters (raw twins), grid figures with bare
charts and border axes, Show Multigraph (histograms, N x N), .wsp layout page
and iteration import. `npm test` 413 pass; `e2e/remaining.mjs` 7/7; every
other e2e script passes. Remaining differences are listed as own rules in
specs 18-25 (e.g. graph windows inside the page, layout figures from .wsp,
grid row / column commands).

## State (2026-11-07, colour axis and layout annotations)

Specs 24: colour axis (mean of a third parameter per bin, Ctrl/Cmd+] / [),
Show Event # Parameter, layout Show Ancestry (with Backgating) and Show
Adjunct Histograms. `npm test` 411 pass; `e2e/coloraxis.mjs` 8/8; every other
e2e script passes. Still open: uncompensated parameters, grid figures with
border axes, multigraph, .wsp layout import.

## State (2026-11-07, FlowJo-style workspace window)

Specs 23: the default screen is now FlowJo's workspace window: taskbar, ribbon
tabs and bands, group table (Group / Role / Size), sample tree-table (Name /
Statistic / #Cells, populations and statistic nodes under each sample) and
floating graph windows per node with Duplicate View. The four-panel screen is
kept as the classic layout (`?layout=classic`; the older e2e scripts use it).
`e2e/fjlayout.mjs` 18/18; every other e2e script passes; `npm test` 409 pass.

## State (2026-11-07, display menu, tree commands, ribbon, layout guides)

Specs 21 additions: layout guides (30 pt snap), per-graph gate frequency /
name toggles and the axes string. Specs 22: graph Display menu (grid, large
dots, two-line gate labels with FlowJo's 3-significant-figure frequency,
medians), gate size x1.1, no-wrap axis stepping, tree expand / collapse (saved,
imported from .wsp), Select Equivalent Nodes, Find / Replace, Duplicate, Add
Keyword, toolbar grouped into the ribbon bands, Escape closes dialogs (own).
`npm test` 409 pass; e2e display 14/14, layout 18/18, all others pass. Not
done: colour axis, Duplicate View, uncompensated / Event # parameters, grid
figures, ancestry / adjunct / multigraph, .wsp layouts.

## State (2026-11-07, remaining interaction gaps and layout logic)

Specs 20: text paste into sample keyword columns, drag and drop (files,
populations, matrices), right-click menus, Copy Histogram Function / Copy
Statistics. Specs 21: FlowJo 10 layout logic decoded
(`docs/validation/flowjo-layout-model.md`, 78 rules) and implemented: point
positions on Letter / A4 pages with breaks, (200, 200) placement, align /
spacing / grid / z-order / group / lock / nudge / avoid page breaks / grid
layout, iteration binding (off, sample, panel, keyword with discriminator),
multi-page PDF. `npm test` 402 pass; e2e: gaps 13/13, layout 13/13, workflow
47/47, every other script passes. Not done (own scope): layout guides,
grid figures with border axes, ancestry / adjunct / multigraph annotations,
.wsp layout import.

## State (2026-11-07, interaction model)

FlowJo 10.6.2 interaction model decoded with javap
(`docs/validation/flowjo-interaction-model.md`: 62 rules with citations, 168
accelerators). Implemented (specs 19): focus-aware workspace / graph shortcuts,
gate nudge and delete keys, polygon Backspace / Space, Space / PageDown sample
stepping, multi-population copy, Cut, paste into checked samples and to the
group, Copy Image and Copy table to the system clipboard, E6 / E10 enable
rules, Disable Undo read per workspace. `e2e/interaction.mjs` 21/21; all other
e2e scripts pass. Next: keyword text paste (C10), drag and drop, context menus.

## State (2026-11-07, graph window interaction parity)

Decoded with javap on FlowJo 10.6.2 (specs 18): stain editing and
"name :: stain" axis titles, Subpopulation Identification after drawing,
double-click to open a gate, child plots inherit the parent's axes, gating
path and PageDown / PageUp sample navigation. All implemented. `npm test`
377 pass; `e2e/uiparity.mjs` 16/16, `npm run e2e` 46/46, `e2e/step2.mjs`
19/19, groups, gatetools, prefs 0 failures (e2e helpers accept the gate
namer's default). REA ledger regenerated: new obligation
`graph.stain-axis-title`, 45 of 45 verified. Next: the interaction-model REA pass
(layout, shortcuts, command dispatch, undo/redo, clipboard).

## State (2026-11-07, Mac app)

Electron shell (`electron/main.cjs`) around the single-file build; packages
an unsigned macOS app (`npm run app:mac`). Network blocked, page sandboxed,
menu leaves FlowJo shortcuts to the page. Smoke test `e2e/electron.mjs` 6/6.
Not done: code signing / notarization, app icon, native file dialogs.

## State (2026-11-07, parity areas 10-11: table / layout editors and preferences)

Preferences dialog (Disable Undo, auto-save, edge warning, Reset All Don't
Show Memory), Don't ask again on delete confirmations, FlowJo's edge-event
warning, shortcuts (Ctrl/Cmd+Y is now Preferences, redo is Ctrl/Cmd+Shift+Z),
table editor (statistic / keyword / formula columns, iteration, summary, heat
map, CSV / TAB / HTML) and layout batch iteration with tiles (specs 16, 17).
REA ledger 44 of 44 verified. Every comparison area is High. Next: mac app
shell.

## State (2026-11-06, parity area 9: cell cycle and proliferation)

Cell cycle uses FlowJo 10.6.2's models (Dean-Jett-Fox quadratic S, Watson
erfc plateau), defaults (unconstrained, G2 in 1.75-2.25 x G1) and outputs
(RMSD over every channel, no chi-square); proliferation reports FlowJo's
indices (% Divided over precursors, Replication Index; no Precursor
Frequency). REA ledger 39 of 39 verified. Next areas: layout / table
editors, preferences.

## State (2026-11-06, parity area 8: compensation)

Compensation follows FlowJo 10.6.2 (specs section 14): .mtx save and load,
FlowJo CSV save, the wizard on positive / negative populations with
FlowJo's medians, rules and badges (universal negative included), and the
spillover spreading matrix with FlowJo's formula and CSV. REA ledger 37 of
37 verified. Next area: cell cycle and proliferation.

## State (2026-11-06, parity area 7: FCS reading)

FCS reading follows FlowJo 10.6.2 (specs section 13): FCS 3.2 accepted
($PnDATATYPE ignored), packed bit streams, 24-bit and mixed widths,
non-standard $BYTEORD read as a full reversal, $TOT computed when missing,
$ENCRYPT refused. REA ledger 35 of 35 verified. Next area: compensation.

## State (2026-11-06, parity area 6: derived parameters)

Derived parameters follow FlowJo 10.6.2 (specs section 12): the engine's
formula parser (left-associative operators, unary minus above ^, FlowJo's
functions and error messages), longest-first name substitution, the
8-variable limit, Event #, float32 results; the Derive Parameters dialog
with FlowJo's name rule and insertion lists; .wsp DerivedParameter nodes.
REA ledger 34 of 34 verified. Next area: FCS reading.

## State (2026-11-06, parity area 5: kinetics)

Kinetics follows FlowJo 10.6.2 (specs section 11): the engine's time binning
(range from the first and last events, width and minimum events per bin),
its nine statistics (percentiles streamed in file order with FlowJo's
quirks), smoothing (moving average; Gaussian with FlowJo's positive
exponent), absolute or timeslice-percentile thresholds; the Kinetics window
with timeslices (drag, edit, multiple ranges, auto slicing), the timeslice
table and statistics columns (plat.kin.*), Copy Time Series, and the .wsp
KineticsNode. REA ledger 31 of 31 verified. Next area: derived parameters.

## State (2026-11-06, parity area 4: gate tools)

Gate tools follow FlowJo 10.6.2 (specs section 10): the 11 FlowJo tools in
toolbar order with their single keys; quad / bisector names from stains and
FlowJo's Q numbering; offset quads; curly and spider quads gated as FlowJo's
PolyQuad label grid; pencil vertex rule; auto gate on FlowJo's smoothed 2%
contours; magnetic gates; manual entry with percent gates; anchored ranges;
convert; copy / paste; BifurGate (FlowJo's peak finder on the smoothed
4096-channel histogram). Decoded with REA's Ghidra provider (native) and
headless Ghidra / javap (Java). REA ledger 28 of 28 verified. Timeslice moved
to the kinetics area (it is a Kinetics-window object). Next area: kinetics.

## State (2026-11-06, parity area 3: export)

Event export follows FlowJo 10.6.2 (specs section 9): CSV scale values (%g)
or channel values (1024 channels), header by name / stain / both, parameter
sets, "no more than N" as FlowJo's deterministic step decimation (its
tooltip says random; the engine is not), concatenation all / every n / equal
keyword in $ETIM order with a SampleID parameter. REA ledger 20 of 20
verified. Next area: gate tools.

## State (2026-11-06, parity area 2: statistics)

Statistics now follow FlowJo 10.6.2 (REA Ghidra provider; specs section 8):
new Mode (256-channel histogram), Freq. of (named ancestor) and Correlation
(NaN, as the 10.6.2 engine); mean, SD, CV, geometric mean and Median Abs Dev
moved to FlowJo's histogram rules (section 4 had wrongly said they were not
histogram-based); FlowJo's StatKey names in .wsp (fj.stat.freqofparent ...),
statistic export added. Min/Max kept as own. REA ledger 17 of 17 verified.
Next area: export.

## State (2026-11-06, parity area 1: groups)

Groups now match FlowJo 10.6.2 (decoded with Ghidra 12.1.4; specs section
7): keyword criteria with FlowJo's 9 functions and 3 connectors (result
starts true, numeric comparisons, Java trim and case rules), stain sets,
reference groups, roles, colour and font style, check every n-th sample,
remove from group or workspace, delete-group question; group-owned analysis
with Synchronized groups, Allocate To Samples / First Sample / Delete
Entirely and Rename for all; .wsp read/write of all of it. REA ledger: 14 of
14 obligations verified (analyst and REA-native). Checks: `npx tsc -p .`
clean; `npm test` all pass; `npm run e2e` 46/46, `e2e/step2.mjs` 19/19,
`e2e/groups.mjs` 5/5 (dev server and file://). Next area: statistics.

## State (2026-11-05, comparison with FlowJo 10.6.2)

Analysis only, no app code changed: `docs/validation/comparison-2026-11.md`
(pattern inventory from wirickm/rea and wirickm/ghidra; part A behavior
parity, B code architecture, C UI/UX; 15 ranked fixes awaiting a go-ahead).
New static observations: specs 6.8. REA ledger: six new obligations bound to
existing tests, 10 of 10 verified (analyst mode); twelve open obligations in
`tools/rea-open-obligations.json`. Ghidra was not available in this session
(rows marked "needs Ghidra"); REA 6.8.0 refuses JVM class files at target
resolution. Next steps: go-ahead on the ranked fixes; Ghidra for the
"needs Ghidra" rows and the REA-native ledger rerun.

## State (2026-11-04, quad sibling delete)

Deleting one quad deletes its sibling quads on the same x and y parameters,
as FlowJo 10.6.2 does (`NodeList.addSiblingQuads` and the quad tests read
with Ghidra; specs 6.2). Checks run: `npx tsc -p .` clean; `npm test` 241
passed, 2 skipped; `npm run e2e` 46/46 and `node e2e/step2.mjs` 19/19, dev
server and `file://`. Still open: "Don't Ask Again" on delete; step 3;
REA-native ledger rerun.

## State (2026-11-04, acceptance test step 2 fixes)

Step 2 (medium defects) fixed: 13 defects (19 UAT ids), each matched to FlowJo 10.6.2
behavior from specs 6.7, one commit per group, decisions and reasons in
`docs/validation/uat-2026-11-02.md` section 4:
- linear range `0..$PnR`, kept across scale types; histogram overlays in raw
  counts with a "Normalized To Mode" option;
- shapes of 10 px or less discarded; unique sibling and group names;
- Gating-ML re-import replaces by name, never duplicates; quadrant names kept;
- same file not added twice; relink needs matching keywords; sample remove;
- percentile 0..100 and "Number of Peaks" 0..10 (default 4) enforced;
- stats show "-" while recalculating, exports recalculate; platform errors in
  the platform window; named templates;
- NOT on the selection; tree delete and workspace replace ask first;
  group-by message corrected.

Checks run: `npx tsc -p .` clean; `npm test` 232 passed, 2 skipped;
`npm run e2e` 46/46 and `node e2e/step2.mjs` 18/18, each on the dev server and
from `file://` (Chromium). REA ledger regenerated after the `stats.ts` change
(analyst mode, REA built from `../rea`): 4 obligations verified.

Confirmed by decompiling FlowJo 10.6.2's jars with Ghidra (REA 6.8.0 cannot
open JVM classes): shape size is 10 px or less in both directions
(corrected), relink is FlowJo's keyword test over every sample without data
and a non-matching file is a new sample (corrected), the `-N` suffix numbers
from an existing suffix's stem (refined), same file is same path in FlowJo
(content here, by necessity). Open decision: FlowJo's "Don't Ask Again" box
on delete.

Next steps: step 3 (own UX choices: Escape, matrix input checks, stale log
warnings, S4 layout items); quadrant sibling delete (specs 6.2); REA-native
ledger rerun with Ghidra.

## State (2026-11-02, acceptance test and step 1 fixes)

Front-end acceptance test (five browser operators, five datasets): 234
controls, 153 pass, 24 fail, 56 observations, no crashes. Each defect was
investigated against FlowJo 10.6.2 by static reading (REA checklist Q12-Q18;
behaviors in specs section 6). Decisions and reasons, per defect:
`docs/validation/uat-2026-11-02.md`.

Step 1 (severe defects) fixed, one commit and test each:
- cell cycle histogram at FlowJo's min(channel range, 1024) channels (S1 hang);
- .wsp quadrants imported as one quadrant split (centre drag moves all four);
- explicit spectral matrix kind (AF row no longer applied as spillover);
- "#"-prefixed matrix CSV headers (FlowKit den_comp.csv);
- Gating-ML export skips and warns per gate; Time gates in raw units;
- derived parameter delete lists dependent gates and statistics.

Checks run: `npx tsc -p .` clean; `npm test` 215 passed, 2 skipped; `npm run
e2e` all pass. REA ledger regenerated in analyst mode after the `wsp.ts`
change: 4 obligations verified (`docs/validation/rea-ledger-result.json`).
The REA-native ledger (`rea-ledger-result.native.json`) was not regenerated:
it needs Ghidra-produced REA bundles that were not available in this session.

Next steps: step 2 (medium defects, match FlowJo; list in the UAT record),
then step 3 (own UX choices); REA-native ledger rerun with Ghidra.

## State (2026-11-01, milestone 7)

Target is FlowJo 10 (every reference count comes from FlowJo 10.6.2 to
10.10.0). Gating and statistics rules were taken from FlowJo 10.6.2's native
engine (official installer; see `CLAUDE.md`) and written as behavioral specs
in `docs/validation/flowjo-engine-specs.md`, then implemented independently:

- polygons on FlowJo's gate grid (`src/core/gateGrid.ts`);
- ellipses as FlowJo's 180-vertex outline polygon;
- logicle vertices through FlowJo's single-precision lookup table;
- open rectangle bounds at a linear axis edge;
- median, percentiles, robust SD/CV from FlowJo's 4096-channel histogram
  (no FlowJo-computed statistics exist in the fixtures to validate against);
- .wsp export keeps FlowJo linear axis ranges and writes keyword groups as
  criteria; the offline build no longer contains `fetch(`;
- REA proof producer (`npm run rea-proof`; now `docs/validation/rea-ledger-request.json`).

FlowJo count report: 221 of 228 populations exact (was 61); the other 7 are
FlowJo version differences pinned in `tests/wsp.test.ts`.

Checks run: `npx tsc -p .` clean; `npm test` 196 passed, 2 skipped;
`npm run e2e` 46/46 on the dev server and 46/46 from `file://` (Chromium).

REA closure (2026-11-02): FlowJo 10.6.2 observations recorded as REA
original-case Evidence; REA's ledger reports `wsp.polygon-counts`,
`wsp.logicle-ellipse`, `gate.rect-open-bounds` and `stats.flowjo-conventions`
verified (`docs/validation/rea-ledger-result.json`; details in
`docs/obligation-ledger.md`).

Next steps: FlowJo-computed statistics to validate section 4 of the specs;
Firefox/Safari run of the offline build.

## State (2026-10-31, milestone 6)

Milestone 6 delivered: multi-data-set selection; cell cycle (Dean-Jett-Fox,
Watson), proliferation and kinetics platforms; spline (curved) quadrant
gates; exclusion gates; keyword-rule live groups; .wsp import of exclusion
gates, statistic nodes and keyword-criteria groups. Obligations, owners and
closure state: `docs/obligation-ledger.md` (REA obligation model, plus an
REA-generated ledger over this app's code).

Checks run: `npx tsc -p .` clean; `npm test` 174 passed, 2 skipped after an E2E run (169 passed, 7 skipped without E2E outputs);
`npm run build` -> `dist/index.html` (about 400 KB); `npm run e2e` 46/46 on
the dev server and 46/46 from `file://` (Chromium). All new numerics are
validated synthetically only.

Next steps: FlowJo-side evidence for the blocked obligations in the ledger;
an REA proof producer (owner digests + verifier results) to close REA
obligations; Firefox/Safari run of the offline build.

## State (2026-11, milestone 5, in progress)

Milestone 5 delivered: compensation wizard (spillover from single-stain
controls), derived ratio parameters, layout text blocks, PNG/SVG/PDF layout
export, and autofluorescence (AF spectrum from an unstained control added as
an extra unmixing row). E2E 39/39 on dev and file://; 149 unit tests. All
new numerics validated synthetically only (no FlowJo/vendor reference).

## State (2026-10-31, milestone 4)

Milestone 4 delivered: SVG export for plots and layouts; statistic templates
and all-groups CSV; live groups; density and zebra plots. E2E 35/35 on the
dev server and on the single-file build from file://; 137 unit tests.
Firefox/Safari: not verified. Only Chromium is installed in this
environment and installing other Playwright browsers is not permitted here
(external dependency: run the offline file in those browsers).

## State (2026-10-31, milestone 3)

Milestone 3 delivered: single-file offline build (`npm run build` ->
`dist/index.html`, opens from disk; E2E 30/30 from file:// and dev server);
FlowJo per-population plot settings import; sample annotations, group by
keyword/annotation, group rename; overlays/backgating. Fixed: module worker
never starting under file://, worker failures leaving the UI at
"Working..." forever, sampled point cap exceeding maxPoints.

## State (2026-10-30, milestone 2)

Branch `main` on GitHub (wirickm/flowjo-rea). Milestone 1 delivered the core
app. Milestone 2 (this session) delivered: per-population FlowJo evidence
report with inherited/introduced split;
undo/redo; full ellipse editing; contour plots; layout editor with batch PNG
export; OLS spectral unmixing; FlowJo-style .wsp export (unvalidated in
FlowJo). Status per feature: `docs/compatibility-matrix.md`.

## Commands and checks run (latest)

- `./scripts/fetch-fixtures.sh` (FlowKit commit f2159043b6a56e527d4baacf97490caf8354618e)
- `npm test`: 127 passed, 2 skipped (report writer and polygon diagnostic run only with `WRITE_REPORT=1` / `DIAG=1`)
- `npx tsc -p .`: clean
- `npm run dev` then `npm run e2e`: 26/26 checks passed in Chromium
- `WRITE_REPORT=1 npx vitest run tests/wsp-report.test.ts` -> `docs/validation/wsp-counts.md`
- `DIAG=1 npx vitest run tests/diagnostics/polygon.test.ts` -> `docs/validation/polygon-diagnostics.md`

## Defects found and fixed in milestone 2

- Plot canvas moved 22 px when switching tools (hint text wrapping); fixed
  with a fixed-height tool row. Earlier E2E clicks were offset by this.
- Compensation dialog applied a square-inverse check to spectral matrices.
- .wsp writer: Transformations were serialised before gates registered
  their scales; Time gain was written without `$TIMESTEP`.
- FlowJo linear gain was represented as a `linear` display transform, which
  made export ambiguous and gave imported Time a meaningless display scale;
  now a separate `scale` transform used only by imported gates.

## Unresolved

1. Polygon gates on the 8-colour set: about 0.25% fewer events than FlowJo.
   Rejected hypotheses are listed in the matrix. Next step: obtain FlowJo-side
   evidence (event-level export of a polygon population from FlowJo).
2. Ellipse on logicle axes: 2-3% fewer events than FlowJo. Likely related to
   FlowJo's logicle display mapping; same evidence needed.
3. FlowJo statistic conventions (median, percentiles, robust CV) unverified.

## Milestone 2 plan (prioritised by dependency, then user impact)

| # | Feature | Depends on | Acceptance criteria | External dependency |
|---|---|---|---|---|
| 1 | Undo/redo | none | Ctrl/Cmd+Z, Ctrl+Shift+Z / Ctrl+Y and toolbar buttons undo/redo every workspace edit (gates create/edit/delete/rename, boolean, compensation, scales, stats columns, groups, plot settings); 100-step cap; opening a workspace resets history; unit-tested history; E2E create -> undo -> redo restores the identical count | none |
| 2 | Full ellipse editing | none | Drag inside = move; drag a major-axis handle = change semi-major length and rotation; drag a minor-axis handle = change semi-minor length; geometry unit-tested (handles lie on the edited ellipse); refused with a log message when plot scale differs from gate scale; E2E handle drag changes the count | none |
| 3 | Contour plots | none | Contour option enabled; equal-probability levels (configurable 2/5/10%), each contour k encloses about 100 - k x level % of plotted events after Gaussian smoothing; outliers optional; marching squares unit-tested; enclosed fractions within 2 pp on a synthetic Gaussian | Matching FlowJo's contour placement exactly would need FlowJo output (not attempted) |
| 4 | Layout editor and batch export | reusable plot renderer | Add current plot to layout; reorder/remove; render all items for any sample; export layout PNG for one sample and batch PNG for every sample in the group; layout saved in workspace and undoable; E2E | none |
| 5 | Spectral unmixing (OLS) | none | Non-square spectrum matrix (fluorochromes x detectors) accepted from CSV and Gating-ML; least-squares unmixing; unmixed channels named by fluorochrome usable in plots, gates and stats; exact recovery on synthetic mixtures; comparison with FlowKit spectral fixture output | Instrument-vendor unmixing output for a reference comparison |
| 6 | FlowJo .wsp export | 1-5 not required | Writes samples, groups, matrices, transforms and gates in the observed FlowJo structure; re-import through our reader reproduces identical counts | Opening in FlowJo is the only real validation |

Milestone 2 plan status: items 1-6 implemented and tested as described in
the matrix. Items 3, 5 and 6 carry the external dependencies listed above.

## External dependencies (each independent)

1. FlowJo event-level membership export for one polygon and the logicle
   ellipse (resolves the polygon/ellipse count gaps).
2. A synthetic grid FCS + FlowJo-drawn polygon + FlowJo-saved .wsp and member
   export (separates boundary-band, rasterisation and vertex-rounding causes).
3. The same workspace saved by two FlowJo versions after recalculation.
4. Opening an exported .wsp in FlowJo and comparing counts (validates export).
5. Vendor-unmixed spectral reference data (validates unmixing beyond the
   FlowKit cross-check).

## Next implementation steps

1. Compensation wizard: spillover estimation from single-stain controls.
2. Autofluorescence handling and spectrum estimation for unmixing.
3. Derived parameters (e.g. ratio channels in the UI).
4. Layout text boxes and free positioning; PDF export.
5. Verify the offline build in Firefox and Safari (needs those browsers).
