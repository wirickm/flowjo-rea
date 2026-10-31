# Progress and handoff

## State (2026-11, milestone 5, in progress)

Milestone 5 so far: compensation wizard (spillover from single-stain
controls) and derived ratio parameters. E2E 37/37 on dev and file://; 145
unit tests. Remaining in this milestone: layout text boxes + PDF;
autofluorescence/spectrum estimation (the latter needs reference data).

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
report with inherited/introduced split; REA run from the local checkout;
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
- REA: `npm ci --ignore-scripts && npm run build:cached` in `../rea`, then
  `node scripts/rea.mjs doctor --json` and `inspect-artifact` (outputs in `docs/rea/`)

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
   evidence (event-level export of a polygon population from FlowJo, or
   licensed analysis of FlowJo's polygon test).
2. Ellipse on logicle axes: 2-3% fewer events than FlowJo. Likely related to
   FlowJo's logicle display mapping; same evidence needed.
3. FlowJo statistic conventions (median, percentiles, robust CV) unverified.
4. FlowJo binary analysis not performed (artifact absent; EULA restriction;
   see `docs/design.md` section 2).

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
6. FlowJo installer plus an established license/jurisdiction permission, plus
   a deep-analysis engine (Ghidra/IDA/Hopper), for any REA analysis of FlowJo.

## Next implementation steps

1. Compensation wizard: spillover estimation from single-stain controls.
2. Autofluorescence handling and spectrum estimation for unmixing.
3. Derived parameters (e.g. ratio channels in the UI).
4. Layout text boxes and free positioning; PDF export.
5. Verify the offline build in Firefox and Safari (needs those browsers).
