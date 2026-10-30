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
| 3 | Compensation from `$SPILLOVER`/`SPILL`/`$COMP` | spec | Done | ISAC (spectrumMatrix cases); FJ-count (compensated gates exact in reused_quad_gate_with_child.wsp) | Default for samples with a keyword is "file", as in FlowJo |
| 3 | Matrix CSV import, editing, validation (square, finite, channels present, invertible) | - | Done | unit tests; dialog shows validation result | No automatic single-stain matrix calculation |
| 3 | Spectral unmixing | - | Not implemented | - | Non-square matrices rejected explicitly |
| 3 | Scales: linear, log, arcsinh, logicle, hyperlog | spec (Gating-ML 2.0) | Done | ISAC (all transform cases exact); closed-form unit tests | - |
| 3 | FlowJo biex | observed (FJ-LUT); structure informed by FlowKit | Done | FJ-LUT 4096 entries within 1e-5 relative; FJ-count biex rect exact | - |
| 3 | FlowJo log, linear-with-gain | observed (wsp attributes) | Partial | FJ-count (Time gain exact) | FlowJo log not exercised by any FlowJo fixture |
| 4 | Pseudocolor, dot, histogram plots with transformed axes and decade ticks | - | Done | E2E screenshots | Contour, zebra, density, overlays, backgating not implemented (contour shown disabled) |
| 5 | Rectangle, polygon, ellipse, quadrant, 1-D range, boolean AND/OR/NOT gates | spec | Done | ISAC exact; E2E creation and editing | Ellipse editing: translate only, and only when the plot scale equals the gate's scale |
| 5 | Hierarchical gating, rename, delete (blocked when a boolean depends on it) | - | Done | E2E; unit tests | No undo |
| 5 | Gating-ML 2.0 import | spec | Done | ISAC: 46 files, every truth file, 0 mismatched events | Non-square spectrum matrices, pre-inverted matrices unsupported |
| 5 | Gating-ML 2.0 export | spec | Partial | round trip (identical counts) | FlowJo biex/log and ratio dimensions are not representable and are rejected |
| 6 | Count, % parent, % grandparent, % total, mean, median, geometric mean, SD, CV, robust SD/CV, MAD, min, max, percentile | hand | Done | hand-computed tests; E2E table | Values on compensated, untransformed data. FlowJo's exact median/percentile and robust CV conventions are unknown (not verified against FlowJo) |
| 6 | Empty populations | - | Done | unit tests | Frequencies and channel stats give NaN, never 0 |
| 7 | Apply a gate tree to a group; sync edits to group | observed (FlowJo group gating) | Done | unit tests; E2E | Copies by population path; not FlowJo's live group-owned gates |
| 7 | Statistics table across samples of a group, CSV export | - | Done | E2E | No layout editor / table editor templates |
| 8 | Save and reopen native workspace (`.frea.json`), relink FCS by file name, SHA-256 mismatch warning | - | Done | unit round trip; E2E (tree, counts, stats identical after reload) | FCS data is not embedded; files must be re-added |
| 9 | Export stats CSV, gated events CSV and FCS 3.1, plot PNG, Gating-ML | - | Done | E2E + re-read of exported FCS (event count and values) | No SVG/PDF vector plot export; no batch image export |

## FlowJo workspace interoperability (distinct from the native format)

| Behavior | Evidence | Status | Validation | Limitations |
|---|---|---|---|---|
| Read FlowJo 10 .wsp: samples, groups, per-sample spillover, transforms, gates, boolean nodes | observed in 14 FlowJo-saved workspaces (FlowJo 10.6.2 to 10.10.0) | Partial | FJ-count | Format undocumented; only constructs present in the fixtures are handled. Graph/layout settings, statistics nodes, keywords-based groups, exclusion gates (`eventsInside="0"`) not imported (warned) |
| Rectangle and quadrant gates (raw-unit coordinates) | observed | Done | FJ-count exact (diamond quad, asinh, biex; reused quad) | - |
| "Comp-" prefixed parameters = compensated channel | observed | Done | FJ-count exact in reused_quad_gate_with_child.wsp | - |
| Time gate with FlowJo per-sample gain | observed | Done | FJ-count: Time exact on all 3 samples | - |
| Ellipse gates (display-space foci/edges at gate resolution) | observed; derived | Partial | FJ-count exact for single_ellipse_51_events (linear) | **Gap**: ellipse on logicle axes 2.0 to 3.2% below FlowJo |
| Polygon gates | observed | **Gap** | FJ-count: Singlets polygon about 0.25% below FlowJo on all samples; downstream populations inherit it (worst: 10 events on a 74-event population) | Cause unidentified. Tested and rejected: exact raw-space test, 6 binning hypotheses, FlowJo logicle as biex table. Needs FlowJo-side evidence |
| Boolean And/Or/Not nodes by dependency path | observed | Done | FJ-count bounded (inherits polygon gap) | - |
| Write FlowJo .wsp | - | Not implemented | - | No way to validate output without FlowJo; button shown disabled |

Overall: 61 of 228 FlowJo-saved counts reproduced exactly; every workspace
without polygon gates or logicle ellipses matches exactly. This is
**demonstrated partial compatibility, not FlowJo parity**.

## Backlog for broader parity (not implemented)

Layout editor and batch reports; table editor templates; contour, zebra and
density plots; overlays and backgating; derived parameters; spectral
unmixing and compensation wizard; FlowJo .wsp export; importing FlowJo graph
settings; keyword-based groups and sample annotations; cell cycle,
proliferation, kinetics and other platforms; plugins; undo/redo; spline or
curved quadrant gates; ellipse rotation and resize editing; ratio dimensions
in the UI; multi-data-set selection in the UI; FlowJo statistic conventions
(median/percentile/robust CV) verified against FlowJo output.
