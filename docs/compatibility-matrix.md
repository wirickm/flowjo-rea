# Feature and compatibility matrix

Status values: **Done** (implemented and validated as stated), **Partial**
(works with the stated limits), **Gap** (measured difference from FlowJo),
**Not implemented**. Evidence labels follow REA's convention:
*observed* (seen in a FlowJo-written artifact or measured), *spec* (published
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
| 1 | Multiple data sets (`$NEXTDATA`) | spec | Partial | parser enumerates data sets | UI always loads data set 1 and reports the count |
| 1 | Inspect metadata, parameters, keywords, parser warnings | - | Done | E2E | - |
| 2 | Samples and groups; group membership | observed (wsp GroupNode/SampleRefs) | Done | E2E; wsp import shows FlowJo groups | No keyword-criteria (smart) groups |
| 3 | Compensation from `$SPILLOVER`/`SPILL`/`$COMP` | spec | Done | ISAC (spectrumMatrix cases); FJ-count (compensated biex rectangles exact in reused_quad_gate_with_child.wsp, tested fixture only) | Default for samples with a keyword is "file", as in FlowJo |
| 3 | Matrix CSV import, editing, validation (square, finite, channels present, invertible) | - | Done | unit tests; dialog shows validation result | No automatic single-stain matrix calculation |
| 3 | Spectral unmixing by ordinary least squares (fluorochromes x detectors matrix from CSV or Gating-ML; unmixed channels named by fluorochrome usable in plots, gates, stats, layout, export) | derived (OLS) | Implemented, tested, cross-checked | Synthetic exact recovery and least-squares residual orthogonality; FlowKit spectral fixture (flowutils OLS output, 33 channels x 10,000 events): worst relative error 2.6e-9; E2E UI path | Cross-check is against another open implementation, not an instrument vendor's unmixing (external dependency: vendor-unmixed reference data). No WLS, autofluorescence extraction, spectrum estimation from single-stain controls, or spectral FCS keywords |
| 3 | Scales: linear, log, arcsinh, logicle, hyperlog | spec (Gating-ML 2.0) | Done | ISAC (all transform cases exact); closed-form unit tests | - |
| 3 | FlowJo biex | observed (FJ-LUT); structure informed by FlowKit | Done | FJ-LUT 4096 entries within 1e-5 relative; FJ-count biex rect exact | - |
| 3 | FlowJo log, linear-with-gain | observed (wsp attributes) | Partial | FJ-count (Time gain exact) | FlowJo log not exercised by any FlowJo fixture |
| 4 | Pseudocolor, dot, histogram plots with transformed axes and decade ticks | - | Done | E2E screenshots | Zebra, density, overlays, backgating not implemented |
| 4 | Contour plots: equal-probability levels (2/5/10/20%), Gaussian smoothing (1.5 bins), optional outliers | derived (own definition) | Implemented, tested | Analytic Gaussian: contour radii within 0.6 bin of the enclosed-probability circle; E2E renders and level changes | Not compared with FlowJo's contour placement (FlowJo output needed); outliers drawn from the sampled event subset |
| 5 | Rectangle, polygon, ellipse, quadrant, 1-D range, boolean AND/OR/NOT gates | spec | Done | ISAC exact; E2E creation and editing; ellipse geometry unit tests | Ellipse editing (move, rotate/resize via major handles, width via minor handles) only when the plot scales equal the gate's scales; otherwise refused with a log message |
| 5 | Hierarchical gating, rename, delete (blocked when a boolean depends on it), undo/redo of every workspace edit | - | Done | E2E; unit tests | History is in memory only (not saved with the workspace) |
| 5 | Gating-ML 2.0 import | spec | Done | ISAC: 46 files, every truth file, 0 mismatched events | Pre-inverted matrices unsupported; non-square spectrum matrices are unmixed by OLS (no ISAC truth exercises them) |
| 5 | Gating-ML 2.0 export | spec | Partial | round trip (identical counts) | FlowJo biex/log and ratio dimensions are not representable and are rejected |
| 6 | Count, % parent, % grandparent, % total, mean, median, geometric mean, SD, CV, robust SD/CV, MAD, min, max, percentile | hand | Done | hand-computed tests; E2E table | Values on compensated, untransformed data. FlowJo's exact median/percentile and robust CV conventions are unknown (not verified against FlowJo) |
| 6 | Empty populations | - | Done | unit tests | Frequencies and channel stats give NaN, never 0 |
| 7 | Apply a gate tree to a group; sync edits to group | observed (FlowJo group gating) | Done | unit tests; E2E | Copies by population path; not FlowJo's live group-owned gates |
| 7 | Statistics table across samples of a group, CSV export | - | Done | E2E | No table editor templates |
| 7 | Layout editor: ordered plots rendered for any sample, reorder/remove, PNG export for one sample and batch PNG per sample in the group; saved in the workspace, undoable | - | Implemented, tested | E2E (2-up 920x442 PNG; one PNG per sample) | No free positioning, text boxes, overlays or vector (SVG/PDF) output; long gate labels can overlap |
| 8 | Save and reopen native workspace (`.frea.json`), relink FCS by file name, SHA-256 mismatch warning | - | Done | unit round trip; E2E (tree, counts, stats identical after reload) | FCS data is not embedded; files must be re-added |
| 9 | Export stats CSV, gated events CSV and FCS 3.1, plot PNG, Gating-ML | - | Done | E2E + re-read of exported FCS (event count and values) | No SVG/PDF vector plot export; no batch image export |

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

### Results by gate type and FlowJo axis scale (228 populations, 61 exact)

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
| rect [logicle,logicle] | 99 | 29 | 9.9 | 0.012 pp | Non-exact rows are children of polygon gates; introduced part <= 10 events |
| boolean NOT / OR | 12 | 0 | 10.9 | 0.013 pp | Operands inherit polygon differences |
| polygon [linear,linear] | 17 | 0 | 684 | 0.236 pp | **Gap**: FlowJo always higher |
| polygon [logicle,linear] | 34 | 0 | 189 | 0.080 pp | **Gap**: FlowJo always higher |
| polygon [logicle,logicle] | 24 | 0 | 37 | 0.028 pp | **Gap**: FlowJo always higher |
| ellipse [logicle,logicle] | 3 | 0 | 222 | 0.166 pp | **Gap**: FlowJo higher by 124-232 events (2.0-3.2% of the population) |

The earlier "0.25%" figure was the Singlets polygon's difference relative to
FlowJo's Singlets count (E03: 236,780 vs 237,375, -595 = -0.25% of the
population; parent counts equal, so all of it is introduced by that gate).
Downstream, the same events are a larger share of small populations: IL2+
under CD4+ (E03, 8_color_ICS.wsp) is 64 vs 74, -10 events = **-13.5% of that
population**, of which about 0.1 events is inherited and about 9.9 introduced
at the IL2+ rectangle itself (its parent CD4+ already differs by 135 events).

### FlowJo reference counts are not stable across FlowJo versions

For sample E05 the FlowJo 10.6.2 and 10.8.1 saves record Time = 284,933;
the FlowJo 10.10.0 save (8_color_ICS_dot_gate_name.wsp) records 284,845.
The Time gate bounds, the Time gain, the transforms and the spillover matrix
are identical in these files (checked by hashing those XML blocks). Our
count is 284,933. Likewise E03 CD4+ is 81,990 in the 10.6.2 save and
81,992 in the 10.8.1/10.10.0 saves, with identical CD3+/CD4+ vertices and
logicle parameters. Some reference differences therefore reflect FlowJo
version behavior (or stale saved counts), not a single fixed truth.

### Polygon diagnostic (existing evidence only)

`docs/validation/polygon-diagnostics.md`. For the Singlets polygon (linear
axes; parent equal to FlowJo, so no inheritance), FlowJo's extra events equal
all parent events lying outside our polygon within 0.078, 0.083 and 0.094
display bins (1 bin = 1/256 of the axis) on the three samples. FlowJo is
higher for every polygon on every sample. This is consistent with FlowJo
including a thin outer band, but these aggregate counts cannot distinguish
between: (a) a dilated or inclusive-boundary test, (b) rasterised gating at a
finer resolution, (c) FlowJo using unrounded vertices while the .wsp stores
values snapped to 1/256 of the axis (all Singlets vertices are multiples of
1024), (d) version-specific recomputation. No implementation change was made
on this basis.

**Reference data that would resolve it** (each item independent):
1. For one sample, FlowJo's event-level membership of Singlets and of one
   logicle polygon (e.g. CD3+): FlowJo "Export Population" as CSV including an
   event-number column, or a derived parameter of gate membership. Shows
   exactly which events differ and where they sit relative to the edges.
2. A synthetic FCS file with events on a regular grid crossing a polygon edge,
   a polygon drawn in FlowJo, and the FlowJo-saved .wsp with counts plus the
   exported member events. Separates (a), (b) and (c).
3. The same workspace saved by two FlowJo versions after forcing
   recalculation, to quantify (d).
4. For the logicle ellipse, the same event-level export for ellipse1.

### Construct coverage

| Behavior | Evidence | Status | Limitations |
|---|---|---|---|
| Read FlowJo 10 .wsp: samples, groups, per-sample spillover, transforms, gates, boolean nodes | observed in the 14 fixtures | Implemented; reference-compared as above | Format undocumented; only constructs present in the fixtures are handled. Graph/layout settings, statistic nodes, keyword-based groups, exclusion gates (`eventsInside="0"`) not imported (warned) |
| Raw-unit rectangle/polygon coordinates; display-space ellipse foci/edges; "Comp-" prefix; Time gain | observed; derived | Implemented | Derived from the fixtures only |
| Write FlowJo .wsp | - | Not implemented | Opening the output in FlowJo is the only real validation (external dependency) |

## Backlog for broader parity (not implemented)

Layout editor and batch reports; table editor templates; contour, zebra and
density plots; overlays and backgating; derived parameters; spectral
unmixing and compensation wizard; FlowJo .wsp export; importing FlowJo graph
settings; keyword-based groups and sample annotations; cell cycle,
proliferation, kinetics and other platforms; plugins; undo/redo; spline or
curved quadrant gates; ellipse rotation and resize editing; ratio dimensions
in the UI; multi-data-set selection in the UI; FlowJo statistic conventions
(median/percentile/robust CV) verified against FlowJo output.
