# Progress and handoff

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
