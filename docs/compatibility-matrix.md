# Feature and compatibility matrix

Status values: **Done** (implemented and validated as stated), **Partial**
(works with the stated limits), **Gap** (measured difference from FlowJo),
**Not implemented**. Validation strength, weakest to strongest:
*implemented* (code exists), *tested* (own unit/E2E tests with independently
derived expectations), *cross-checked* (agrees with another open
implementation), *reference-validated* (agrees with a standard's truth data
or FlowJo output, on the named fixtures only). Evidence labels:
*observed* (seen in a FlowJo-written file or measured), *spec* (published
standard), *derived* (reasoned from observations), *unknown*.

Validation keys: **ISAC** = Gating-ML 2.0 compliance truth (per-event
membership, exact); **FJ-count** = counts FlowJo saved in FlowJo-written
.wsp files (`docs/validation/wsp-counts.md`); **FJ-LUT** = FlowJo-exported
biex table; **flowio** = independent FCS reader oracle; **hand** =
hand-computed expectations; **E2E** = `e2e/workflow.mjs` through the real UI.

## Priority workflows

| # | Target workflow / behavior | Evidence | Status | Validation | Known limitations |
|---|---|---|---|---|---|
| 1 | Import FCS 2.0/3.0/3.1 list mode (I 8/16/32/64-bit, F, D; big/little endian) | spec (FCS 3.1) | Done | flowio raw decode on 7 real files (exact values); synthetic files | `$MODE` H/C/U, `$DATATYPE` A, mixed byte order and non-byte bit widths rejected with explicit errors |
| 1 | `$PnE` log amplification, `$PnG` gain, `$PnR` bit masking | spec; ISAC custom_info | Done | ISAC (gates depend on gain and log scaling) | Gain applied to linear parameters only |
| 1 | `$TIMESTEP` scaling of Time | spec; observed (FlowJo time gates in seconds) | Done | FJ-count (Time gates exact) | Applied to a channel named `Time` (case-insensitive) |
| 1 | Inconsistent HEADER/TEXT DATA offsets | observed (FlowKit noncompliant files; off-by-one in test_comp_example.fcs) | Done | unit tests; warning surfaced in UI | Picks the candidate matching `$TOT` x row size |
| 1 | Non-UTF-8 TEXT | spec | Done | synthetic test | Falls back to Latin-1 with a warning |
| 1 | Multiple data sets (`$NEXTDATA`) | spec | Implemented, tested | Unit (two-set synthetic file: enumerate, switch, out-of-range error); E2E (300 -> 700 events) | One data set per sample at a time (switch in the sample panel); no real multi-data-set fixture; gates are kept across a switch even if channels differ |
| 1 | Inspect metadata, parameters, keywords, parser warnings | - | Done | E2E | - |
| 2 | Samples and groups; group membership; rename groups | observed (wsp GroupNode/SampleRefs) | Done | E2E; wsp import shows FlowJo groups | - |
| 2 | Sample annotations (key/value) and "group by" any annotation or keyword (one group per value, missing bucket); annotations as stats-table/CSV columns | - | Implemented, tested | Unit (groupByKey, syncLiveGroups); E2E | Groups made this way are live: membership is recomputed over all samples after every edit (renaming keeps the rule). Equality rules from "group by"; keyword rule groups (contains, does not contain, equals, does not equal, starts/ends with) created in the UI or imported from .wsp |
| 3 | Compensation from `$SPILLOVER`/`SPILL`/`$COMP` | spec | Done | ISAC (spectrumMatrix cases); FJ-count (compensated biex rectangles exact in reused_quad_gate_with_child.wsp, tested fixture only) | Default for samples with a keyword is "file", as in FlowJo |
| 3 | Matrix CSV import, editing, validation (square, finite, channels present, invertible) | - | Done | unit tests; dialog shows validation result | - |
| 3 | Compensation wizard: spillover from single-stain controls (brightest N% vs negative medians; optional pre-gate; per-control diagnostics) | derived (standard method) | Implemented, tested | Synthetic controls from a known matrix: cells within 0.005 (unit), worst 0.0004 (E2E) | No real single-stain fixtures, so not checked against reference data; not compared with FlowJo's wizard |
| 3 | Derived parameters: ratio channels A*(num-B)/(den-C) usable as plot axes, gate dimensions and statistics | derived (FlowJo ratio) | Implemented, tested | Engine unit tests (formula, gate, errors); E2E creates one and uses it as a stat | Ratio only; no other derived-parameter types FlowJo offers; not compared with FlowJo |
| 3 | Autofluorescence: estimate an AF spectrum from an unstained control (per-detector medians) and add it as an extra unmixing row | derived (standard AF-as-fluorochrome) | Implemented, tested | Synthetic: AF spectrum within 0.02 of truth; modelling AF cuts fluorochrome bias >3x vs omitting it | Needs an unstained control; synthetic validation only; not compared with FlowJo/vendor |
| 3 | Spectral unmixing by ordinary least squares (fluorochromes x detectors matrix from CSV or Gating-ML; unmixed channels named by fluorochrome usable in plots, gates, stats, layout, export) | derived (OLS) | Implemented, tested, cross-checked | Synthetic exact recovery and least-squares residual orthogonality; FlowKit spectral fixture (flowutils OLS output, 33 channels x 10,000 events): worst relative error 2.6e-9; E2E UI path | Cross-check is against another open implementation, not an instrument vendor's unmixing (external dependency: vendor-unmixed reference data). No WLS, autofluorescence extraction, spectrum estimation from single-stain controls, or spectral FCS keywords |
| 3 | Scales: linear, log, arcsinh, logicle, hyperlog | spec (Gating-ML 2.0) | Done | ISAC (all transform cases exact); closed-form unit tests | - |
| 3 | FlowJo biex | observed (FJ-LUT); structure informed by FlowKit | Done | FJ-LUT 4096 entries within 1e-5 relative; FJ-count biex rect exact | - |
| 3 | FlowJo log, linear-with-gain | observed (wsp attributes) | Partial | FJ-count (Time gain exact) | FlowJo log not exercised by any FlowJo fixture |
| 4 | Pseudocolor, dot, histogram plots with transformed axes and decade ticks | - | Done | E2E screenshots | - |
| 4 | Density (Gaussian-smoothed pseudocolor) and zebra (equal-probability bands of the smoothed density, alternating shades) plots | derived (own definitions) | Implemented, tested | Band masses within 1 pp of target on an analytic Gaussian; E2E renders distinct images | Not compared with FlowJo's density/zebra rendering (FlowJo output needed) |
| 4 | Overlays / backgating: any populations drawn on the current plot (coloured sampled dots over a greyscale base on 2-D plots; curves normalised to their own maximum on histograms), with legend and counts; saved per plot and rendered in layouts | - | Implemented, tested | E2E: 2-D overlay sampled at <= 5000 events; histogram overlay count equals the population count | 2-D overlays draw a sample (up to 5000 events) per population; no normalisation options other than per-curve maximum |
| 4 | Contour plots: equal-probability levels (2/5/10/20%), Gaussian smoothing (1.5 bins), optional outliers | derived (own definition) | Implemented, tested | Analytic Gaussian: contour radii within 0.6 bin of the enclosed-probability circle; E2E renders and level changes | Not compared with FlowJo's contour placement (FlowJo output needed); outliers drawn from the sampled event subset |
| 5 | Spline (curved) quadrant gates: each divider a monotone cubic spline through control points; four populations created together; control points draggable | derived (own definition) | Implemented, tested | Unit (straight dividers reproduce the ordinary quadrant exactly; partition; curved classification); E2E (partition of 40,000 events; dragging a point moves events) | Not compared with FlowJo's spline/curved quadrant (FlowJo-saved example needed); not representable in Gating-ML 2.0 (export refused) or in .wsp export (skipped with a warning); editable only when plot scales equal the gate's |
| 5 | Exclusion gates (population = parent events outside the gate; FlowJo `eventsInside="0"`) | observed attribute; semantics derived | Implemented, tested | Unit (fixture with the attribute flipped: count = parent - FlowJo inclusive count); E2E toggle | No FlowJo-saved exclusion gate in the fixtures; Gating-ML export writes gate + NOT boolean (re-imports as two populations) |
| 5 | Rectangle, polygon, ellipse, quadrant, 1-D range, boolean AND/OR/NOT gates | spec | Done | ISAC exact; E2E creation and editing; ellipse geometry unit tests | Ellipse editing (move, rotate/resize via major handles, width via minor handles) only when the plot scales equal the gate's scales; otherwise refused with a log message |
| 5 | Hierarchical gating, rename, delete (blocked when a boolean depends on it), undo/redo of every workspace edit | - | Done | E2E; unit tests | History is in memory only (not saved with the workspace) |
| 5 | Gating-ML 2.0 import | spec | Done | ISAC: 46 files, every truth file, 0 mismatched events | Pre-inverted matrices unsupported; non-square spectrum matrices are unmixed by OLS (no ISAC truth exercises them) |
| 5 | Gating-ML 2.0 export | spec | Partial | round trip (identical counts) | FlowJo biex/log and ratio dimensions are not representable and are rejected |
| 6 | Count, % parent, % grandparent, % total, mean, median, geometric mean, SD, CV, robust SD/CV, MAD, min, max, percentile | hand | Done | hand-computed tests; E2E table | Values on compensated, untransformed data. FlowJo's exact median/percentile and robust CV conventions are unknown (not verified against FlowJo) |
| 6 | Cell cycle: Dean-Jett-Fox (G1/G2 Gaussians, broadened 2nd-order S phase, Poisson-weighted NNLS + Nelder-Mead) and Watson pragmatic on a linear DNA histogram | derived (published models) | Implemented, tested | Synthetic 55/30/15: DJF within 0.5 pp (unit), 2.0 pp (E2E); Watson within 3.2 pp; G1-only gives S+G2 < 1% | Synthetic only; not compared with FlowJo or ModFit; debris and aggregates flagged, not modelled |
| 6 | Proliferation: dye-dilution generations (log-space Gaussians at 2-fold spacing), % divided, division / proliferation / expansion indices, precursor frequency | derived (published definitions) | Implemented, tested | Synthetic 6 generations: per-generation % within 0.15 pp, indices within 0.2% (unit); E2E % divided 80.2 vs 80 | Synthetic only; assumes exact 2-fold dilution and equal widths; FlowJo's older "proliferation index" definition differs (here: expansion index) |
| 6 | Kinetics: count, mean, median or % above threshold per equal-width time bin | - | Implemented, tested | Hand-built exact cases (unit); E2E bin counts sum to the population | Equal-width bins only; no smoothing or curve fitting |
| 6 | Empty populations | - | Done | unit tests | Frequencies and channel stats give NaN, never 0 |
| 7 | Apply a gate tree to a group; sync edits to group | observed (FlowJo group gating) | Done | unit tests; E2E | Copies by population path; not FlowJo's live group-owned gates |
| 7 | Statistics table across samples of a group, CSV export | - | Done | E2E; CSV quoting unit test | - |
| 7 | Statistic templates (save, apply, delete column sets) and all-groups CSV (Group column, one row per group membership) | - | Implemented, tested | E2E (template restores identical table; all-groups row count) | Not FlowJo's table editor: no per-column formatting, iteration over keywords or formula columns |
| 7 | Layout editor: ordered plots and text blocks rendered for any sample, reorder/remove, PNG/SVG/PDF export for one sample and batch export per sample in the group; saved in the workspace, undoable | - | Implemented, tested | E2E (2-up PNG; SVG with text; PDF validated strictly by pypdf; batch); unit test of the PDF writer | PDF is one page embedding the composed image as JPEG (not vector text); no free positioning |
| 8 | Save and reopen native workspace (`.frea.json`), relink FCS by file name, SHA-256 mismatch warning | - | Done | unit round trip; E2E (tree, counts, stats identical after reload) | FCS data is not embedded; files must be re-added |
| 9 | Export stats CSV, gated events CSV and FCS 3.1, plot PNG, Gating-ML | - | Done | E2E + re-read of exported FCS (event count and values) | - |
| 9 | Plot and layout SVG export (single and batch): vector axes, text, gates, contours, histograms, dots; pseudocolor density embedded as an image | - | Implemented, tested | Unit (renderer -> well-formed SVG with expected text/paths); E2E files re-parsed as XML | No PDF (print the SVG to PDF from a browser); text widths in SVG are estimated, so long labels may differ slightly from the canvas |

## FlowJo workspace interoperability (distinct from the native format)

Reference: population counts FlowJo saved in 14 FlowJo-written workspaces
(FlowJo 10.6.2, 10.8.0, 10.8.1, 10.10.0) from FlowKit commit
f2159043b6a56e527d4baacf97490caf8354618e. Every population, with reference
count, our count, absolute and population-relative difference, and the
inherited/introduced split, is in
[validation/wsp-counts.md](validation/wsp-counts.md). "Exact" below means
exact **on these fixtures only**; it is not proof that a gate type is
compatible in general.

Reproduce:

```bash
./scripts/fetch-fixtures.sh
```

```bash
npx vitest run tests/wsp.test.ts
```

```bash
WRITE_REPORT=1 npx vitest run tests/wsp-report.test.ts
```

```bash
DIAG=1 npx vitest run tests/diagnostics/polygon.test.ts
```

### Results by gate type and FlowJo axis scale (228 populations, 188 exact)

"Introduced" = the part of the difference attributable to the gate itself:
our parent x (our frequency of parent - FlowJo frequency of parent).
Inherited + introduced = total difference exactly. This attribution is at
population level; event-level FlowJo output would be needed to identify
which events differ.

| Gate [x,y scale] | Pops | Exact | Worst introduced (events) | Worst freq.-of-parent diff | Status on fixtures |
|---|---:|---:|---:|---:|---|
| rect [biex,biex] | 14 | 14 | 0 | 0 | Exact (tested fixtures) |
| rect [asinh,asinh] | 2 | 2 | 0 | 0 | Exact (tested fixtures) |
| ellipse [linear,linear] | 1 | 1 | 0 | 0 | Exact (one 51-event fixture) |
| boolean AND | 1 | 1 | 0 | 0 | Exact (one fixture) |
| rect [linear,linear] | 21 | 14 | 88 | 0.031 pp | All 7 non-exact rows are the FlowJo 10.10.0 Time-gate chain for E05 (see below) |
| rect [logicle,logicle] | 99 | 99 | 0.1 | 0 | Exact (tested fixtures) |
| boolean NOT / OR | 12 | 10 | 0 | 0 | Non-exact rows inherit polygon residuals |
| polygon [linear,linear] | 17 | 10 | 2.1 | 0.001 pp | Near-exact with the FlowJo 10 gate grid (`docs/validation/flowjo-engine-specs.md` section 1) |
| polygon [logicle,linear] | 34 | 20 | 2.4 | 0.001 pp | Near-exact; residuals from the approximated logicle lookup table |
| polygon [logicle,logicle] | 24 | 17 | 4.2 | 0.003 pp | Near-exact; same residual source |
| ellipse [logicle,logicle] | 3 | 0 | 222 | 0.166 pp | **Gap**: FlowJo higher by 124-232 events (2.0-3.2% of the population) |

Before the FlowJo 10 gate grid (exact point-in-polygon test) the polygon rows
had 0 exact populations, worst introduced difference 684 events (Singlets,
-0.25% of the population) and downstream effects up to -13.5% of small
populations (IL2+ under CD4+). The grid rule was taken from FlowJo 10.6.2's
native engine; see the specs doc.

### FlowJo reference counts are not stable across FlowJo versions

For sample E05 the FlowJo 10.6.2 and 10.8.1 saves record Time = 284,933;
the FlowJo 10.10.0 save (8_color_ICS_dot_gate_name.wsp) records 284,845.
The Time gate bounds, the Time gain, the transforms and the spillover matrix
are identical in these files (checked by hashing those XML blocks). Our
count is 284,933. Likewise E03 CD4+ is 81,990 in the 10.6.2 save and
81,992 in the 10.8.1/10.10.0 saves, with identical CD3+/CD4+ vertices and
logicle parameters. Some reference differences therefore reflect FlowJo
version behavior (or stale saved counts), not a single fixed truth.

### Polygon diagnostic (historical)

`docs/validation/polygon-diagnostics.md` records the band analysis done
before the gate grid was known (FlowJo's extra events lay within about 0.08
display bins outside the exact polygon). It is superseded by the FlowJo 10
gate grid, which explains those counts; it is kept as history. Remaining
polygon residuals (at most 4.2 events introduced per gate) are attributed to
the approximated transform lookup table and rounding ties, pending a finer
analysis of FlowJo 10's table construction. Item 4 below still applies to the
logicle ellipse: FlowJo event-level export of ellipse1.

### Construct coverage

| Behavior | Evidence | Status | Limitations |
|---|---|---|---|
| Read FlowJo 10 .wsp: samples, groups, per-sample spillover, transforms, gates, boolean nodes | observed in the 14 fixtures | Implemented; reference-compared as above | Format undocumented; only constructs present in the fixtures are handled. Layout-editor pages not imported (warned). Statistic nodes import as statistics columns (only `Count` is observed in the fixtures; other names and the parameter attribute are assumptions). Keyword-criteria groups import as live groups (the 14 fixtures' `$FIL contains` groups agree with the FlowJo-saved empty membership; case-insensitive matching is unverified; group-reference criteria kept as saved, warned). Exclusion gates import with `exclude` (the attribute is observed with value 1 in every fixture; value 0 and its meaning are derived, with no FlowJo-saved example) |
| Per-population plot (axes, Pseudocolor/Histogram type) from `<Graph>` | observed | Implemented, tested (unit + E2E) | FlowJo saves the node's last-viewed plot; it shows a child gate for only 121 of 219 fixture gates. Graph colours, smoothing and resolution not imported; types other than Pseudocolor/Histogram unobserved |
| Raw-unit rectangle/polygon coordinates; display-space ellipse foci/edges; "Comp-" prefix; Time gain | observed; derived | Implemented | Derived from the fixtures only |
| Write FlowJo-style .wsp (samples, groups, square spillover, scales, rectangle/polygon/ellipse gates, quadrants as rectangles, And/Or/Not nodes, this app's counts) | observed structure | Implemented; round-trip tested with this app's reader only | **Not validated in FlowJo** (external dependency: open the file in FlowJo and compare counts). Spectral matrices, ratio dimensions, complemented boolean operands and scales without an observed FlowJo equivalent (hyperlog, Gating-ML log) are not representable and produce export warnings. `gating:distance` semantics unknown; 2a is written |

## Backlog for broader parity (not implemented)

Plugins; FlowJo's table editor (per-column formatting, keyword iteration,
formulas); free layout positioning and vector PDF; derived-parameter types
other than ratio; WLS unmixing; FlowJo statistic conventions
(median/percentile/robust CV) verified against FlowJo output; every
"Not compared with FlowJo" item above (each needs FlowJo-side output).
Obligations and their closure state: `docs/obligation-ledger.md`.
