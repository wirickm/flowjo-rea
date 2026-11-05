# FlowJo engine behavioral specs

Behavior of FlowJo's native analysis engine, written as specifications for an
independent implementation. No FlowJo code, disassembly or decompiled output
is reproduced here.

**Reference version: FlowJo 10.** Every FlowJo-computed count available to
this project was written by FlowJo 10.6.2 to 10.10.0, so the specs in
sections 1 onward describe FlowJo 10.6.2 (native engine
`libNativeEngine-3.6.2.jnilib` inside the official installer
`FlowJo-OSX64-10.6.2.dmg`; see `CLAUDE.md`). Gating runs in that native
engine, not in FlowJo's Java classes. FlowJo 11.2.0 notes are kept in
Appendix A for orientation only; FlowJo 11 gives different counts.

Evidence labels follow `docs/compatibility-matrix.md`: *observed* (seen in the
binary or a FlowJo file), *derived* (reasoned from observations), *unknown*.

## 1. Polygon gates (FlowJo 10.6.2)

Status: *observed*; implemented in `src/core/gateGrid.ts`; reference-compared
on the 14 fixture workspaces (`docs/validation/wsp-counts.md`).

1. **Grid.** Each polygon has a gate resolution `R` (.wsp attribute
   `gateResolution`; 256 in every fixture). Membership is decided on an
   `R x R` lattice, once per gate, then looked up per event.
2. **Axis mapping (events and vertices alike).**
   - Linear axes (no lookup table): `u = (v - min) * R / (max - min)` with
     `[min, max]` the axis range (`transforms:linear` minRange/maxRange, in
     FlowJo units = stored value x gain); lattice coordinate
     `floor(u + 0.5)`. Event values are read as 32-bit floats.
   - Transformed axes (logicle, biex, arcsinh, log): the index of the value
     in the transform's 4096-entry lookup table (largest entry at or below
     the value, compared as a 32-bit float), scaled to `R` and truncated.
     For events this equals the display cell `floor(display * R)` on every
     fixture, which the implementation uses. For vertices on logicle axes the
     table matters: it is built from T, W, M, A rounded to single precision,
     with entry `i = inverse(x_i)`, `x_0 = 0`, `x_{i+1} = x_i + 1/4096`
     (accumulated); the implementation reproduces it (`vertexCoord`).
   - Event coordinates are clamped to `0..R-1`; vertex coordinates are not.
   - FlowJo can mirror the y axis (`R - u`) for linear axes; because events
     and vertices use the same mapping this changes only rounding ties. The
     implementation does not mirror (fixture check: 36 of 42 exact without,
     35 with).
3. **Mask.** Lattice point `(x, y)` is in the gate when it is inside the
   polygon with rounded vertices or on its boundary (even-odd crossing test
   with the half-open edge rule `y1 < y <= y2`; points on edges or vertices
   count as inside).
4. **Membership.** An event is in the gate when its lattice point is in the
   mask. Events with a NaN coordinate are outside.

Reference result (all 14 workspaces): every polygon population matches
FlowJo exactly except where saves by different FlowJo versions of the same
gate disagree (see `docs/compatibility-matrix.md`); previously the worst
difference introduced by a polygon was 684 events.

Scope in this app: polygons imported from .wsp and polygons drawn in the app
use the grid; Gating-ML polygons keep exact point-in-polygon membership,
because the Gating-ML standard and its ISAC truth data define it that way.

## 2. Ellipse gates (FlowJo 10.6.2)

Status: *observed* (FlowJo 10.6.2 Java classes, read with the JDK's `javap`);
implemented in `src/core/gateGrid.ts`; reference-compared on the fixtures.

FlowJo 10's native engine has no ellipse gate. The Java layer converts every
ellipse to a polygon before sending it to the engine, so an ellipse is gated
exactly like a polygon (section 1) on that outline:

1. **Edge points.** The .wsp `gating:edge` holds four integer points in
   display units (0..255 on the 256-pixel graph frame): the major-axis
   endpoints `p0`, `p1`, then the minor-axis endpoints `p2`, `p3`. The foci
   and `gating:distance` are not used for gating.
2. **Shape.** `a = |p0 p1| / 2`, `b = |p2 p3| / 2` (swapped if `a < b`);
   centre = midpoint of `p0 p1`; angle = `atan((p0.y - p1.y) / (p0.x - p1.x))`
   (plain arctangent, not atan2); `e^2 = 1 - b^2 / a^2`.
3. **Outline.** For `i = 0..179`: `t = 2 pi (i / 180)` with the fraction
   `i / 180` computed in single precision; polar radius
   `r = a sqrt((1 - e^2) / (1 - e^2 cos^2 t))`; vertex
   `(round(cx + r cos(t + angle)), round(cy + r sin(t + angle)))` with
   `round(x) = floor(x + 0.5)`. Consecutive duplicate vertices are dropped.
4. **Back to data values.** Each outline vertex (a pixel) is converted to a
   data value (`channelToScale` of `px * width / 256`) and then placed on the
   grid like any polygon vertex (section 1, step 2), so on logicle axes a
   vertex can move one cell through the single-precision lookup table.
5. **Membership.** The resulting polygon is gated with the section 1 rule.

Reference result: all 4 fixture ellipses exact (3 logicle in
8_color_ICS_with_ellipse.wsp, previously 124 to 232 events off; 1 linear).
Without step 4 the logicle ellipses were 7 to 19 events off. FlowJo 10.8.1
(which saved that file) builds the outline identically to 10.6.2.

Scope in this app: ellipses imported from .wsp (with their stored edge points)
and ellipses drawn in the app (edge points derived from the axes, then
snapped to the lattice) use this rule; Gating-ML ellipsoids stay exact.

## 3. Rectangle gates (FlowJo 10.6.2)

Status: *observed* (native `FGate::GetRectRangeInScale`); implemented in the
.wsp importer; reference-compared.

- Membership is `min <= v < max` on each dimension, as before.
- A bound is treated as open when it falls on or beyond the edge of a linear
  axis: with channel `c = floor((b - min) * C / (max - min) + 0.5)` and
  `C = 4096` (FlowJo uses the parameter's channel range, at least 4096), a
  lower bound with `c <= 0` becomes `-infinity` and an upper bound with
  `c >= C` becomes `+infinity`. `[min, max]` is the sample's
  `transforms:linear` range.
- Effect on the fixtures: E01's Time gate (lower bound 1.28, axis minimum
  1.2747, its first event) keeps the two earliest events, as FlowJo does.
- The importer keeps each sample's FlowJo linear ranges
  (`SampleState.flowjoLinearRanges`) and the .wsp writer writes them back, so
  FlowJo applies the same rule to exported files.
- Not applied to transformed axes (no fixture exercises it there).

## 4. Statistics (FlowJo 10.6.2)

Status: *observed* (native `GParameter::Median/Percentile/RobustSD/RobustCV`,
`BasicHistogram`); implemented in `src/core/flowjoStats.ts`; **not
reference-validated** (the fixtures contain no FlowJo-computed median,
percentile or robust statistic; only Count statistic nodes).

1. **Histogram.** The population is binned into 4096 channels on the
   parameter's scale with the same mapping as gating: linear axes
   `floor((v - min) * 4096 / (max - min) + 0.5)` clamped to 0..4095 (value as
   a 32-bit float); logicle axes the 4096-entry single-precision lookup table
   index (section 1).
2. **Percentile p** (median: p = 50). Target `t = float(float(n * p) * 0.01)`
   in single precision; the result channel is the first channel `k` (from 0)
   whose cumulative count, as a 32-bit float, is `>= t`; if none of the first
   4095 channels reaches it, 4095; if `t <= 0`, channel 0. The value is the
   channel converted back to data units: linear `min + k * (max - min) / 4096`,
   logicle table entry `k`. No interpolation.
3. **Robust SD.** With channels `c16`, `c84` for p = 15.87 and 84.13 and data
   values `lo`, `hi`, `med` (single precision):
   - `c84 > 4094` (top saturated): `med - lo`;
   - else, `c16 < 1` (bottom saturated): `hi - med`;
   - else, if `0.75 (hi - med) > med - lo` and (`med < 0` or
     `c16 < 0.05 * 4096`): `hi - med`;
   - otherwise `(hi - lo) / 2`.
4. **Robust CV** = `100 * robust SD / median` (median not made absolute);
   0 when the population has fewer than 6 events.
5. Mean, SD, CV, geometric mean, mode and MAD are also histogram-based;
   decoded later, see section 8.2 (the earlier statement that they were not
   was wrong). Min and max are this app's own statistics (no FlowJo key).

Scope in this app: statistics use these conventions when the channel's
FlowJo scale is known: an imported FlowJo linear range (per sample), or a
workspace display scale that is linear or logicle. Other channels (arcsinh,
biex, hyperlog, raw) keep exact order statistics (type-7 interpolation).

## 5. Open items

- Channel range above 4096 (FlowJo reads it from a keyword); not exercised.
- Statistic conventions for arcsinh/biex axes and MAD's final step.
- FlowJo-computed median/percentile/robust values to validate section 4.

## 6. Application behaviors (FlowJo 10.6.2, static reading)

Source: the Java classes in `FlowJo-10.6.2.jar` (read with `javap`: names,
signatures, constants) and the native engine's symbols, from the same
verified installer. Investigated on 2026-11-02 for the front-end acceptance
test (`docs/validation/uat-2026-11-02.md`, which records each decision and
its reason). FlowJo was not run (macOS app); every item is *observed* from
static reading only, not from runtime (checklist Q10). Each item says
whether this app **matches** FlowJo or uses **its own rule** where FlowJo
has none or is weaker.

### 6.1 Cell cycle histogram resolution (matches)

- FlowJo fits cell cycle models on a histogram of the DNA parameter with
  `min(parameter channel range, 1024)` channels (`CCNode.HISTOGRAM_CHANNELS =
  1024`; engine `CellCycle::ProcessQuery` takes the minimum with
  `GParameter::GetChannelRange`). The user cannot set the resolution.
- The fit is Levenberg-Marquardt; it stops when damping reaches 1e4 or
  chi-square improves by less than 0.1 (medium confidence). No cancel control.
- This app: same resolution rule (`cellCycleChannels`, `src/core/service.ts`);
  the bins input is removed. The fitter stays this app's own (Nelder-Mead +
  NNLS). Measured on a 262144-range channel: 1024 channels 1.7 s, 4096
  channels 23 s, so the cap also bounds run time.

### 6.2 Quadrant gates (matches)

- FlowJo has no quadrant object. A quad is a 2-D rectangle gate with exactly
  one open bound per axis (`RectGate.isQuad`/`getQuadID`; tool tip "Four
  rectangular gates sharing a common center point").
- Dragging the shared centre moves the inner corner of every quad on the
  plot to the release point, clamped to the plot (`QuadLayer.moveQuads`,
  `QuadDrag.pinVal`). Deleting one quad from the tree also deletes its
  siblings on the same parameter pair (`NodeList.addSiblingQuads`).
- This app: the .wsp importer turns such a rectangle into a `quadrant` gate
  (identical `[lo, hi)` membership), so siblings with the same corner move
  together.
- Sibling delete, decompiled (Ghidra 12.1.4, as in 6.7): before asking,
  `STreeMgr.deleteSelection` calls `NodeList.addSiblingQuads`. For each
  selected population whose gate is a quad (not an And/Or/Not node), every
  sibling (same parent) whose gate is a quad on the same primary and
  secondary parameter names is added, wherever its centre is; then each is
  deleted with its subtree. A gate is a quad when it is a 2-D rectangle with
  exactly one open bound on each axis (`RectGate.getQuadID`), a 1-D range
  with an open end (`RangeGate.isQuad`) or a curly quad (`CurlyQuadGate`,
  always). This app matches (`deletionRoots`, `isQuadGate`,
  `src/core/project.ts`): quadrant gates count when their interval is an end
  one on every axis, spline quadrants always; the delete question names every
  population it removes. Booleans that use any removed population still
  block the delete, as before.

### 6.3 Spillover versus spectral matrices (matches the flag)

- FlowJo marks a spectral (unmixing) matrix with an explicit `spectral`
  attribute (`"1"` or `"true"`) and never infers the type from the matrix
  shape. It has an autofluorescence option. Its unmixing is weighted least
  squares (weights not decoded).
- This app: `SpilloverMatrix.kind` (`'spillover' | 'spectral'`). CSV spectral
  import and the autofluorescence row set it; without it the shape decides,
  as before. Unmixing stays ordinary least squares (own, documented).

### 6.4 Compensation matrix files (own rule)

- FlowJo imports matrices only from `.mtx` files (XML
  `transforms:spilloverMatrix`, or an older tab-separated text form) and
  matches channel names exactly on `$PnN`. It has no CSV matrix import.
- This app: CSV import, with its own rule that a header line starting with
  `#` (FlowKit's format) is read with the `#` removed and other `#` lines are
  comments. Channel matching stays exact on `$PnN`, as in FlowJo.

### 6.5 Gating-ML export (own rule)

- FlowJo 10.6.2 has no Gating-ML 2.0 export of its own (only a side file of
  raw workspace gate elements). Nothing to match.
- This app: populations that Gating-ML 2.0 cannot represent are skipped with
  a warning (with their descendants and booleans that use them), as the .wsp
  export does. FlowJo linear-gain gates (Time) are written in raw units,
  which is exact. Polygons and ellipses imported from .wsp are written as
  exact shapes; FlowJo's gate grid (sections 1-2) has no Gating-ML form, so
  their counts can differ after a round trip.

### 6.6 Deleting a derived parameter (own rule, stricter than FlowJo)

- FlowJo deletes a derived parameter as a tree node after one generic
  confirmation. It does not check or list dependent gates or statistics and
  does not cascade.
- This app: before deleting, lists the gates, statistic columns and other
  derived parameters that use it; no cascade; Undo restores.

### 6.7 Further observed behaviors (matched in UAT step 2)

Implemented on 2026-11-04 (`docs/validation/uat-2026-11-02.md`, step 2,
which records each decision). Where this app differs, it says so.

The four rules marked *(decompiled)* were then confirmed by reading the
verified FlowJo 10.6.2 jars (`FlowJo-10.6.2.jar`, SHA-256 `6a6436c0...`, and
`fjlib-2.3.0.jar` from the same installer) with Ghidra 12.1.4 headless
(JVM bytecode decompiler), cross-checked with `javap` where Ghidra's output
of exception handlers was unclear. REA 6.8.0 does not open JVM class files
(its Ghidra provider rejects the format; its Java path is JADX for Android),
so Ghidra was run directly. Only behavior is recorded here; the decompiled
output stays outside the repository.

- Linear axis range is `0..$PnR` (1024 when missing); changing the scale type
  keeps the range. Matches.
- Histogram overlays show raw counts on a shared axis by default; "Normalized
  To Mode" is an option and relabels the axis. Matches.
- Sibling gate names are unique: a new gate's default name goes through
  `ParentNode.uniqueChildName`; the rename dialog refuses a duplicate ("Name
  must be unique."). Matches; group names follow the same rule here.
  *(decompiled)* `NameUtil.uniqueName`: an unused name is kept; otherwise
  the first free `<stem>-N`, N = 1..999, where the stem is the name without
  a trailing `-` plus up to 3 digits when that dash is after the 3rd
  character (a copy of `CD4-1` is `CD4-2`); past 999 the time in
  milliseconds is appended. Names compare exactly (`String.equals` on child
  names). Matches.
- *(decompiled)* A newly drawn shape is discarded when `isTooSmall()`
  (`CreationDrag.complete`, also used by polygons): `Fig` is 10 px or less
  in both width and height, `FigRange` 10 px or less wide. Matches (the
  first implementation used "either direction", corrected).
- Importing a gate whose name a sibling already has replaces it (silently if
  equivalent, otherwise after a "Replace?" question); never a duplicate.
  Matches for Gating-ML import.
- *(decompiled)* Relinking: when a newly added file is read
  (`Sample.matchesBrokenSample`), FlowJo tests every workspace sample whose
  data is missing, whatever its file name, with
  `FCSFinder$SampleKeywordMatcher.keywordsMatch`, and merges the file into
  the first match (`mergeToOtherSample`); with no match the file is added as
  a new sample. The test, on the sample's saved keywords against the file's:
  `$TOT` must be saved (trimmed, non-empty) and equal; then `$DATE`, `$BTIM`,
  `$BEGINDATA` in turn, each saved one must be equal and the first one not
  saved ends these checks; last, `$FIL` matches when not saved or equal, or
  when the sample's file exists in the workspace's folder. Only the first
  keyword of each group is read (`$PAR`, `@Y2KDATE`, `$ETIM`, `$ENDDATA`,
  `@SAMPLEID1` and `FILENAME` appear in the code but are never compared).
  Matches, except the folder fallback (a browser cannot see folders) and
  values compared trimmed on both sides. (The first implementation matched by
  file name and compared `$TOT`, `$PAR`, `$BTIM`, `$ETIM`, `$DATE`, refusing
  a mismatched file; corrected.)
- *(decompiled)* The same file is not added twice
  (`WSSampleMgr.sampleShouldBeAdded`): a sample with the same file URI or the
  same sample ID is skipped silently. This app compares file content
  (SHA-256) and says so in the Log, because a browser exposes no path; it is
  stricter only for a byte-identical copy at another path, which FlowJo adds
  as a second sample. Samples can be removed after a confirmation.
- Percentile is an integer 0..100 (table editor 1..99); invalid input is
  blocked. Proliferation "Number of Peaks" is an integer 0..10, default 4.
  Matches (0..100 for percentiles).
- Statistics that need recalculation show "-"; export recalculates first.
  Matches.
- Platform errors are shown in the platform window; table templates are named
  and saved in the workspace. Matches.
- *(decompiled)* Tree delete (`STreeMgr.deleteSelection`) always calls
  `confirmNodeDeletion`, a Yes/No question (`SDialogs.confirm` with its
  "Don't Ask Again" box enabled); the box is remembered per message in the
  preferences, after which the question is skipped, and Preferences has a
  reset. The same path adds sibling quads to the selection
  (`NodeList.addSiblingQuads`, section 6.2; matched). This app asks every
  time, with no "Don't Ask Again" box yet. NOT
  applies to the normal selection. Matches. Escape
  cancels only the naming/rename dialog (step 3 decides this app's rule).
- Live keyword groups re-evaluate membership; they do not create new groups.
  Matches (message corrected). Opening a .wsp opens a new window instead of
  replacing the open workspace; this app has one window and asks before
  replacing a workspace with work in it.

### 6.8 Further static observations (comparison of 2026-11-05)

Source: the same verified installer (`FlowJo-10.6.2.jar` SHA-256
`6a6436c0...`, `fjlib-2.3.0.jar` SHA-256 `ed08fec9...`, engine
`ae2369f3...`). Read with `javap` (member signatures and constants; `-c` only
where a constant had to be located), the resource bundles
`com/treestar/flowjo/core/flowjodictionary*.properties`, and `llvm-nm
--demangle` on the engine. The last four items were then read with Ghidra
12.1.4 (headless decompiler for Java, REA's Ghidra provider for the engine);
confidence is given per item. Runtime is
unconfirmed for all of it (FlowJo was not run). The full comparison is
`docs/validation/comparison-2026-11.md`.

- Undo/redo (high for the class structure, medium for the limit): workspace
  undo (`WSUndoManager`, extending fjlib `FJUndoManager`) is a Swing
  `UndoManager`. Neither class nor any other class in the two jars sets a
  limit (`setLimit` occurs only in the unrelated manual-gate dialog), so the
  Swing default of 100 edits applies; a new edit after an undo drops the redo
  edits (Swing behavior). Preferences has "Disable Undo". This app: 100
  snapshots, redo dropped by a new edit. Matches; no "Disable Undo".
- Auto-save (high): Preferences offers "Enable Auto-Save" with an interval in
  minutes. A timer task saves each workspace that has a file and samples;
  ACS and Envoy workspaces are skipped; the status bar then reports that the
  workspace was auto-saved, with the time (`AutoSaveTask`). This app: none.
- Resetting "Don't Ask Again" (high): the remembered answers are reset
  as a whole from Preferences > Workspace ("Reset All Don't Show Memory", now
  or on exit). Completes specs 6.7.
- Removing samples (high): FlowJo asks whether to remove the selected samples
  from the workspace or only from the current group. This app removes from
  the workspace only.
- Shared group analysis (high): removing analysis owned by a group asks
  whether to delete it from every sample or give each sample its own copy;
  nodes holding group-owned analysis cannot be deleted from one sample. This
  app copies gates by path and has no group ownership.
- Statistics (high for the list): FlowJo's statistic set is Count, Freq. of
  Parent, Freq. of Grandparent, Freq. of Total, Freq. of (any ancestor), Mean,
  Median, Geometric Mean, Mode, CV, Robust CV, SD, Robust SD, Median Absolute
  Deviation, Percentile and Correlation (`Statistic` constants). There is no
  Min statistic; the engine names a Max. This app lacks Mode, Correlation and
  Freq. of (any ancestor) and adds Min and Max.
- Gate tools (high): rectangle, ellipse, polygon, freehand (pencil), quad,
  curly quad, spider quad, range, bisector, timeslice, auto gate, manual
  coordinate entry; magnetic gates, anchored (tethered) range gates, BifurGate
  (automatic bisectors at the valley of bimodal parameters), gate shape
  conversion, copy/paste of gates. The engine has no ellipse gate type, which
  agrees with section 2.
- Export (high): FCS 3 or CSV with either scale values or channel values;
  parameters all compensated, all uncompensated or a custom set; event count
  "no more than N" (random) or capped at the smallest file; concatenation of
  all files, every n files, or files with equal keyword values, adding a
  sample ID parameter. This app: FCS 3.1 or CSV scale values, compensated or
  not, no event cap, no concatenation.
- Interchange (high): `.wsp`, `.wspt` templates, ACS archives (workspace plus
  data), legacy Mac `.jo` read, Excel/CSV of the workspace table, FACSDiva
  XML import/export, compensation matrices saved as CSV or a Gating-ML based
  FlowJo matrix file. The FCS reader recognizes the FCS3.2 header tag (how
  much of 3.2 it supports is unknown) and reads packed (non-byte) and mixed
  bit widths, which this app rejects.
- Live group criteria: superseded by section 7.1 (decoded with Ghidra; the
  earlier "between" reading was wrong: keyword criteria have no between).
- Edge events (high): the graph window warns when 5% or more of events sit
  on either axis bound; on by default (`FJPrefsFJML$Graph`: `eventsOnAxis`
  true, `warningThreshold` 5; Preferences > Graphs). This app: none.
- Bisector (high; REA Ghidra provider, `QuadGate::ComputeBisectorGate`):
  two populations split at one value. An event whose parameter value is
  below the split is in the left population; every other event, the split
  value included, is in the right one. The comparison is exact on the value
  (not on the gate grid of section 1). This app: no bisector.
- Mode (high for the rule, medium for the bin count; `GParameter::Mode`,
  `BasicHistogram::ChannelMode`): built from the parameter's histogram; the
  mode is the first (lowest) channel with the highest count, as channel
  index times range / channel count, then converted to a data value. The
  statistics histogram is presumably the 4096-channel one of section 4.
- Curly quad (medium-high; decompiled `CurlyQuadGate`, checked with
  `javap -c`): each arm starts at the centre and is a parabola in display
  pixels, y = cy - round(k * dx^2), sampled about every 1/40 of the remaining
  width up to the frame edge; a command doubles or halves k. This app's
  spline quadrant is a different curve.
- Undo (now high): each user action's edits form one compound edit that is
  added through Swing `UndoManager.addEdit`, so the 100 limit counts user
  actions (decompiled `FJUndoManager.startNewEdit`, checked with `javap -c`).

## 7. Groups (FlowJo 10.6.2, Ghidra 12.1.4)

Read from `KeywordCriterion`, `GroupCriteria`, `CriteriaTest`,
`Group`, `Group$Role`, `ParameterList`, `KeywordedParameterList`,
`fjlib ParseUtil`, `WSGroupMgr` and `GroupDelConfirmationDlog` (headless
Ghidra decompiler; exception handlers and switch fall-through checked with
`javap -c`), plus the dictionary texts. Static reading only. Implemented in
`src/core/groupCriteria.ts` and `src/core/project.ts`.

### 7.1 Live group criteria (matches)

- A group holds at most 4 keyword criteria, read in file order from the
  `Criterion` elements; FlowJo writes only the leading criteria that have a
  keyword and a non-empty value.
- Functions (index order, with the text written in `.wsp`): `=`, `≠`, `>`,
  `>=`, `<`, `<=`, `Contains`, `Lacks`, `Exists`. Connectors: `And`, `Or`,
  `& Not`. Texts are looked up trimmed and case-insensitively; an unknown
  function reads as `=` and an unknown connector as `And`.
- A criterion takes part only when it has a keyword and a non-empty value
  (also `Exists`). The running result starts true and every active
  criterion applies its connector, the first one included: `And` gives
  result-and-test, `Or` result-or-test, `& Not` result-and-not-test. So a
  first criterion with `Or` makes the keyword part true.
- The test: the sample's value missing gives false. Otherwise both values
  are trimmed (Java trim). The six comparisons are numeric when the sample's
  value is a number (`ParseUtil.isNumber`: "0" yes; empty or "null" no; one
  trailing `%` is ignored and `%` alone counts; then Java's double parser,
  then the locale number format); FlowJo then parses both values and raises
  an error if the criterion's value is not a number (this app: no match).
  Otherwise they compare as Java `compareToIgnoreCase`. `Contains` / `Lacks`
  test the lower-cased sample value for the lower-cased criterion value.
  `Exists` is true whenever the keyword is present.
- The sample's value (`KeywordedParameterList.get`): a parameter name gives
  that parameter's stain (`$PnS`); `a + b` joins the values of `a` and `b`
  with a space; `FILENAME` is the file name; otherwise the keyword. The
  "<Any Keyword>" choice is dead code in 10.6.2 (a string is compared with a
  dictionary key, never equal).
- Stain sets: optional list of stain-set strings (`StainCriterion` /
  `stainId`). A sample's stain set is the trimmed non-empty `$PnS` of every
  measured parameter that is neither scatter (name starting with FS,
  Forward, BSC, SS, SSC, OrthSc, ObtSc, 90D or Side, any case) nor time (name
  containing "time"), in parameter order, joined with ", ". It must equal
  one of the listed strings.
- With no stain sets and no active first criterion a group accepts nothing.
- Reference group (`refGroupName`, `refGroupFunction`): `also` = in the
  criteria result or in the reference group; `only` = in both; any other
  function accepts nothing.
- Roles (`role` attribute): Undefined, Test, Controls, Replicate,
  Compensation, Instrumentation, Baseline, Gating level, written as
  `ws.group.dlog.<role>`. Read back by substring of the upper-cased text
  (TEST, CONTROLS, COMPENSATION, INSTRUMENTATION, MFO, COPY, in that order),
  so Replicate, Baseline and Gating level read back as Undefined.
- "Select every Nth sample": members at positions 0, n, 2n, ... (n below 1
  is 1).
- Removing samples asks whether to remove them from the workspace or only
  from the current group; deleting a group asks first; "All Samples" cannot
  be deleted.

### 7.2 Group-owned analysis (matches)

- "Copy analysis to group" applies the selected gate and its subtree to
  every member of the current group; the populations are owned by the group
  (`owningGroup` attribute on each population, the group's name).
- Synchronized groups (`synchronized` attribute): moving a group-owned gate
  moves it in every member; in other groups only the edited sample changes.
- A group-owned gate cannot be deleted from one sample; a node that contains
  group-owned analysis cannot be deleted ("contains analysis owned by a
  group"). Deleting group analysis asks: Cancel, Allocate To Samples (keep
  the gates in every member, owned by each sample), Allocate To First Sample
  (keep them only in the group's first member), Delete Entirely.
- Renaming a group-owned gate asks "Rename for all?".
- Samples that join a group receive its group analysis.
- This app has no group node in the population tree: deleting a group-owned
  population there is deleting it from its group (own UI rule; the choices
  and their effects match FlowJo).

## 8. Statistics (FlowJo 10.6.2, REA Ghidra provider)

Read with REA 6.8.0's Ghidra provider (`analyze_function` on
`Statistic::Compute`, `GParameter::ComputeStat`, `GParameter::Mode`,
`GParameter::Correlation`, `GParameter::MedianAbsoluteDeviation`,
`BasicHistogram::ScaleMean / ScaleStdDev / ScaleCV / ScaleGeometricMean /
ChannelMode / BuildHistogram`), `llvm-objdump` for the histogram sizes and
epilogues the decompiler dropped, and the Java `Statistic` / `StatKey`
classes (Ghidra, javap). Static reading only. Implemented in
`src/core/flowjoStats.ts` and `src/core/stats.ts`.

### 8.1 Statistic set and .wsp names (matches)

- FlowJo's statistics: Count, Freq. of Total, Freq. of Parent, Freq. of
  Grandparent, Freq. of (a named ancestor), Median, Mean, Mode, Percentile,
  Geometric Mean, Robust CV, CV, SD, Median Abs Dev, Robust SD, Correlation.
- In `.wsp` a `Statistic` element has `name` = the StatKey string written as
  is: `Count`, `fj.stat.freqoftotal`, `fj.stat.freqofparent`,
  `fj.stat.freqofgrandparent`, `fj.stat.freqof`, `Median`, `Mean`, `Mode`,
  `Percentile`, `Geometric Mean`, `Robust CV`, `CV`, `SD`, `Median Abs Dev`,
  `Robust SD`, `Correlation`; plus `id` (parameter), `percent`, `ancestor`
  (the ancestor population's name), `correlate` (second parameter),
  `expectedRange` and `value`.
- Freq. of = 100 x count / count of the named ancestor (this app: the
  nearest ancestor with that name).
- Correlation: the 10.6.2 engine's `GParameter::Correlation` returns NaN and
  has no other implementation, so FlowJo 10.6.2 shows no correlation value.
  This app matches (NaN).
- Min and Max are this app's own (no FlowJo key; not written to `.wsp`).

### 8.2 Histogram rules (matches on FlowJo scales)

`GParameter::ComputeStat` builds a `BasicHistogram` of the population on the
parameter's scale for every statistic below. Channel `k` stands for the data
value at position `k` (`k x range / channels`) converted back to data units.

- Sizes: 4096 channels for median, percentiles, mean, SD, CV, geometric mean,
  robust SD / CV and the MAD's median; 256 channels for the mode.
- Mean: sum over channels of count x channel value, in single precision,
  divided by n.
- SD: the same mean, then the sum of count x (channel value - mean)^2 over
  n - 1, single precision, square root (a fast reciprocal square root with
  one Newton step, i.e. single-precision sqrt).
- CV: 100 x SD / mean, the mean not made absolute.
- Geometric mean: on channel numbers. Without the parameter's log flag:
  10^(sum over channels 1..last of count x log10(channel) / n), events in
  channel 0 counted in n but not in the sum, then converted back. With the
  flag: the count-weighted mean channel, converted back. (This app takes the
  flag as "logicle axis"; the flag's source is not decoded.)
- Mode: the first (lowest) of the 256 channels with the highest count, as a
  position on the 4096-channel axis, converted back.
- Median Abs Dev: m = the 4096-channel histogram median; the absolute
  deviations of the individual events from m are sorted and the element at
  index floor(n / 2) (single precision) gives 100 x 1.4826 x deviation / m.
  So FlowJo's MAD is a percentage of the median. This app uses the same
  formula on every channel (with the exact median where no FlowJo scale is
  known).
- Fewer than 2 events: SD and CV are not decoded; this app shows NaN.

## Appendix A. FlowJo 11.2.0 (orientation only, not the reference)

Source: static analysis of `libNativeEngine.dylib` from the public FlowJo
11.2.0 macOS x64 installer (`./scripts/fetch-flowjo.sh`). Not validated
against any FlowJo 11 output.

### A.1 Polygon gates (FlowJo 11.2.0)

Status: *observed* (control flow and constants), not reference-validated.

Polygon membership is decided on a raster, not by an exact point-in-polygon
test on event values.

1. **Resolution.** Each polygon has a gate resolution `R` (the .wsp
   attribute `gateResolution`; schema default 256; every fixture polygon uses
   256). `R` must divide 4096 (the engine uses a right shift).
2. **Event cell.** For each axis, the event value is mapped to an index in
   0..4095 via the axis transform's 4096-entry lookup table (largest table
   edge at or below the value; values below the axis minimum map to 0, above
   the maximum to 4095). That index is shifted right by log2(4096 / R),
   giving a column `i` and row index `k` in 0..R-1. The mask row is flipped:
   `row = R - 1 - k`.
3. **Vertex snapping.** Each vertex is converted to integer grid units:
   - linear axes: `trunc((v - min) * R / (max - min))`;
   - other transforms: lookup-table index (as in step 2) times `R / 4096`,
     truncated;
   - the y axis is flipped (`trunc(R - u)`), so the polygon and the mask
     rows share the same orientation.
4. **Mask.** Cell `(i, row)` is in the gate if the lattice point
   `(i, row)` lies inside the snapped polygon or on its boundary:
   - scanline fill at each integer row between `ceil(minY + 1e-13)` and
     `floor(maxY - 1e-13)` (clamped to the grid): crossings use the half-open
     edge rule `y1 < y <= y2`; a horizontal edge lying on the scanline
     contributes both endpoints; crossings are sorted and paired, and the
     integer columns strictly between each pair (`ceil(c0 + 1e-13)` to
     `floor(c1 - 1e-13)`) are filled;
   - an edge pass then adds every lattice point lying exactly (within 1e-13)
     on an edge, walking edges in polygon orientation order (start vertex
     excluded, end vertex included). For gates attached to a quadrant
     (`quadId` 1 to 4) the edge pass excludes some boundary points depending
     on the quadrant; for `quadId = -1` (ordinary polygons) all boundary
     lattice points are included.
5. **Membership.** An event is in the gate when its cell is set.

Reference check (8_color_ICS.wsp, Singlets polygon, linear axes, parent count
equal to FlowJo's; FlowJo 10.6.2 reference): this spec gives about +1,520
events against FlowJo 10's count (our current exact test gives -595). The
same lattice with the boundary excluded gives -97. No rule tried at
resolution 256 or 4096 (cell centre, any corner, any overlap, half-open
boundary) reproduced FlowJo 10 exactly. Conclusion: FlowJo 10's polygon
semantics differ from FlowJo 11's, or a detail of the lookup-table edges is
still wrong (a 1/16-bin shift moves the Singlets count by roughly 400 events).

The point-in-polygon routine `ScalePointSet::PointInPoly` (used elsewhere,
not by gate computation) is an even-odd crossing test with the same half-open
rule, takes event coordinates as 32-bit floats, and counts points on edges and
vertices as inside.

### A.2 Ellipse gates (FlowJo 11.2.0)

Status: *observed* (structure), not reference-validated.

- The ellipse's defining points (foci and edge points from the .wsp) are
  converted to integer grid units with the same snapping as polygon vertices
  (A.1, step 3) before the ellipse parameters are computed.
- Membership is analytic in that scaled space: with centre `(cx, cy)`, angle
  `t`, semi-axes `a` and `b`, an event at scaled `(x, y)` is inside when
  `((dx cos t + dy sin t) / a)^2 + ((dy cos t - dx sin t) / b)^2 <= 1`
  (boundary inclusive), where `dx = x - cx`, `dy = y - cy`.
- Not yet determined: the range `R` passed to the snapping for ellipses, and
  which stored field is `a` versus `b`. Snapping the defining points to an
  integer grid is a candidate explanation for the logicle ellipse gap (2-3%),
  untested.
