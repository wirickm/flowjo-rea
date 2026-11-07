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

## 9. Event export (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider (`Exporter::WriteSample`,
`Exporter::WriteRow`, `Exporter::WriteParamHeaderRow`,
`Exporter::PopulateParmArray`, `Exporter::GetSampleIDParameter`,
`FCS3Exporter::WriteRow`), `llvm-objdump` (`ExportRequest::FromXML`
defaults) and headless Ghidra / javap on the Java side
(`PopulationExporter2`, `ExportModel`). Static reading only. Implemented in
`src/core/exportRules.ts` and `src/core/service.ts`.

- Formats: FCS 3, CSV scale values, CSV channel values. Parameters: all
  compensated, all uncompensated, or a chosen set.
- "No more than N" is not random (the dialog's tooltip says "randomly
  selected"): with step = trunc(count / N) in single precision (1 when count =
  N), events are taken every step-th in file order until N are written. For a
  whole sample the positions are 0, step, 2 step, ...; for a gated population
  the step-th, 2 step-th, ... event of the population (1-based). N at or above
  the count takes every event.
- CSV (`Exporter::WriteRow`): "," between columns, "\n" at line end; scale
  values print with C `%g` (6 significant digits), values within 1e-6 of zero
  as `0`; channel values as integers on the parameter's scale with
  `channelRange` channels, 1024 by default (the dialog never sets it).
- CSV header (`WriteParamHeaderRow`): parameter name, stain, or both joined
  with " :: ".
- Concatenation (`PopulationExporter2`): all files together, every n files
  (consecutive runs), or files with equal values of a keyword (groups in
  string order of the value; samples without a value are left out). Inside a
  file the populations are ordered by `$ETIM` (HH:mm:ss) ascending, a missing
  or unreadable time comparing equal. The cap per population is trunc(sum of
  min(N, count) / number of populations). A `SampleID` parameter holds each
  population's 1-based position.
- FCS rows (`FCS3Exporter::WriteRow`): float32 values divided by the
  parameter gain and, for Time, by the time step (raw units, original
  keywords). This app keeps its own rule: scale units with `$TIMESTEP` = 1,
  which reads back to the same values (FlowJo reads either).
- Not decoded: keyword-derived extra parameters and their "spread
  distribution"; file-naming patterns (this app downloads one file per
  output with a fixed pattern).

## 10. Gate tools (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider on the native engine (`QuadGate`,
`FGate::MoveMagneticGate`, `GHistogram2D` contour code, 1-D histogram
smoothing) and with headless Ghidra 12.1.4 / javap on the Java side (REA
cannot open JVM classes): `GateWinToolBar`, `EditorKeys`, `CurlyQuadGate`,
`SpiderPoint`, `QuadLayer`, `FigPoly`, `LayerAutoGate`, `ManualGateDP`,
`Gate.convert`, `WSClipboard`, `TetheredRangeGate`, `WSAutoQuadAction`,
`PeakFinder`, `RangeGateCreator`. Static reading only. Implemented in
`src/core/gateTools.ts` (rules), `src/core/analysis.ts` (membership),
`src/ui/Plot.tsx` and `src/ui/GateActions.tsx` (tools and actions).

### 10.1 Toolbar, keys and names (matches)

- Tools in toolbar order (full mode): Arrow, Rectangle, Range, Quad,
  Bisector, Ellipse, Polygon, Pencil, Auto Gate, Curly Quad, Spider Quad.
  This app shows the 2-D tools on 2-D plots and Arrow, Range, Bisector on
  histograms, and keeps its own spline quadrant last. Timeslice is a
  Kinetics-window object, not a gate tool (kinetics area).
- Single keys on a focused plot: S Arrow, E Ellipse, F Pencil, A Auto Gate,
  P Polygon, I Range, R Rectangle, Q Quad, X Spider Quad, C Curly Quad;
  Bisector has none. In 10.6.2 some of these key bindings send command names
  that `Tool.fromString` does not recognise; this app makes every key work
  (own rule, medium confidence on FlowJo's actual effect).
- "Manually Enter Gate..." is a menu command with the menu-shortcut key + G.
- Gate labels use the parameter's stain when it has one (preference "use
  stain for gate name", on by default), else the parameter name.
- Quads: "Q<n>: <x label><s> , <y label><t>" (spaces round the comma), s / t
  "+" on the right / upper side. Upper-left is Q b, upper-right Q b+1,
  lower-right Q b+2, lower-left Q b+3, where b starts at 1 and moves past any
  of the next four numbers a child name already starts with ("Q10" counts as
  "Q1"). Created lower-left, lower-right, upper-left, upper-right.
- Bisector (`RangeGateCreator.createBisectingChildren`): the split is the
  clicked value; "<label>-" = range (open, split), "<label>+" = range
  (split, open), created in that order; a taken name becomes
  "<parameter>::<label>-/+". Dragging near the split moves both halves.

### 10.2 Quad, offset quad and bisector membership (matches)

- The engine gets sibling quads as one composite (`QuadRequest`): four
  rectangles as `gating:QuadGate`, four polygons or curly quadrants as
  `gating:PolyQuad`, two one-sided ranges as `gating:BisectorGate`.
- Quad (native kind 7): centre from the upper-left child; per event, x < cx
  is left and y < cy is lower, so a value on a line goes right or up; NaN
  counts as below. Exact comparison on compensated scale values, no grid.
  This app's quadrant gate uses the same [lo, hi) rule.
- Offset quad: a quad whose upper-right child does not share the centre.
  With equal x the two halves of the horizontal line differ (left of x1
  splits at y1, right at y2); otherwise the vertical line steps (upper half
  at x1, lower at x2). The user makes one by dragging one half of a divider
  with the Arrow (within 15 px of it, kept 20 px inside the frame). Each
  quadrant here keeps its own dividers, so the membership is identical.
- Bisector (kind 8): below the split left, the split value and above right,
  NaN left. Exact. Own rule: a bisector half here is a one-sided range, so a
  NaN value falls in neither half (FCS list-mode data has no NaN; only a
  derived parameter can produce one).
- Curly quad: `CurlyQuadGate.writeQuery` sends polygons, so the engine never
  sees a curly shape; it gates the four as a PolyQuad (10.3).

### 10.3 Spider quad and curly quad (matches)

- Spider (`gating:PolyQuad`, native kind 11): four polygons, each with four
  vertices: (corner x, side y), the frame corner, (side x, corner y), the
  shared centre. Side points: top and bottom give x, left and right give y.
  Frame corners are one data unit outside the axis (x max on the axis).
  A new spider puts the side points 10 frame pixels right of and below the
  click and the centre at the click. Dragging the centre moves the shared
  vertex; a side point moves along its side while more than 10 px from
  either end. Alt+click with the Quad tool makes a spider.
- Membership on the R x R gate lattice: each lattice point takes the first
  polygon, in the order upper-left, upper-right, lower-left, lower-right,
  that contains it (edges and vertices inside); a point in none counts as
  upper-left. Events use the polygon gate's cell mapping (section 1).
- Curly quad (`CurlyQuadGate`): built on a 256 x 256 pixel frame whose edges
  are the axis display limits; k = 0.001 per pixel squared, fixed and not
  saved (`multInflection` is never called). Horizontal arm: x = cx + 1,
  then steps of max(1, (W - cx) div 40), y = cy - round(k dx^2), closed at
  the frame edge. Vertical arm: y = cy down to 0 in steps of
  max(1, cy div 40), x = round(cx + k dy^2), stopping after the first point
  past the frame. Lower-left is a plain rectangle; the other three follow the
  arms to the frame corners. The four are gated as a PolyQuad.
- .wsp: spider polygons are `gating:PolygonGate` with `quadId` 0 lower-left,
  1 lower-right, 2 upper-left, 3 upper-right; a curly quadrant is
  `gating:CurlyQuad` with the centre as the closed bound per axis.

### 10.4 Magnetic gates (matches; snapping own rule)

- Toggled per gate ("The gate relocates to where the events are densest");
  stored as `magnetic="1"`. In a synchronized group the flag goes to every
  copy; otherwise the population leaves its group.
- On every sample the gate starts where it was drawn. 2-D: a 256 x 256
  histogram of the parent; repeatedly compare the mean of the cells inside
  the gate with their count-weighted mean (counts truncated), and move one
  cell: x by the sign of dx when |dy| <= 2.41 |dx|, y by the sign of dy when
  |dx| <= 2.41 |dy| (sign of 0 is +1). Stop after 512 steps or on returning
  to a visited position, keeping the previous position if its score
  (dx^2 + dy^2) is lower. No data inside: the whole histogram against the
  middle of the gate's box; no data at all: the offset is 0 and the gate
  stays (read here as an early exit, medium confidence). 1-D: 256 bins; move toward the mean of the
  range's events one bin at a time while the count in [a, b - 1] keeps
  strictly increasing.
- Each sample shows the gate where it moved. Own rule: vertices are not
  snapped to whole channels after the move.

### 10.5 Pencil and Auto Gate (matches)

- Pencil (`FigPoly.processFreehandDrag`): a vertex is committed when the
  mouse is more than 12 px from the last one and the path bends
  ((d + a) / c > 1.04) or the run is long (d / bend > 12); release closes it;
  fewer than 4 points abandons it. The Polygon tool closes within 6 px of the
  first vertex (both axes) or on double-click.
- Auto Gate (`LayerAutoGate` + native contour plot): contours of the plotted
  population at 256 x 256, smoothing on, always the 2% level. Smoothing:
  each bin of count n spreads n w(i) w(j) over (2s + 1)^2 bins,
  s = ceil(13 n^-1/4), w(j) = exp(-0.5 j^2 sqrt(n) (2.4 / 13)^2), the
  kernel summing to 1; mass past an edge is mirrored back. Levels: bins
  above 0.005 in descending density; a level each time the running mass
  passes another N / 50; closed iso-lines, regions touching the frame closed
  along it. The contour with the vertex nearest the mouse (squared distance,
  last vertex not counted, first wins) is shown and, on click, becomes a
  polygon reduced to every (n div max(20, trunc(0.1 n)))-th vertex.
- Medium confidence: the threshold interpolation inside a level, the order
  of equal densities and the marching-cell tie rules (FlowJo's polygon order
  can differ; the picked shape is the same family of contours).

### 10.6 Manual entry, percent gates and anchored ranges (matches)

- `ManualGateDP`: Lower / Upper per axis, units Intensity (scale values
  pinned into the parameter range) or Percentile (0 to 100). Makes a
  rectangle ("<x>, <y> subset") or a range ("<x> subset"); "Make Quad Gates"
  / "Make Bisector Gates" makes them at the lower bounds instead.
- Percentile bounds make a percent gate, recomputed on every sample from the
  parent's smoothed histogram (4096 buckets for x, 256 for a rectangle's y,
  a FlowJo quirk): sum buckets with the total cut to whole counts until
  p x count; stored percents of 1 or more are divided by 100, below 1 read as
  a fraction, 100 gives the top. The smoothed histogram holds whole counts,
  so sparse data gives channel 0 (as FlowJo).
- Anchored range (`TetheredRangeGate`, "Anchored Gating"): a 1-D range whose
  bound is a statistic of a population of the same sample times a
  multiplier, open on the other side. Made by arming a statistic and
  clicking a histogram: multiplier = clicked value / statistic, 2 decimals
  (1 when the statistic is 0); Shift snaps to a whole number within 0.05;
  Alt makes the upper bound. It cannot be dragged.
- Own rules: the "Control gate" checkbox is not offered (this app has no
  control-sample concept); percent and anchored bounds are not written to
  .wsp (FlowJo's attribute layout for them is not fully decoded): percent
  gates are written with fixed bounds and anchored ranges are skipped, each
  with a warning.

### 10.7 Convert, copy and paste (matches)

- Convert (`Gate.convert`): rectangle to polygon (xmin, ymin), (xmin, ymax),
  (xmax, ymax), (xmax, ymin); polygon or ellipse to rectangle: the vertex
  bounding box snapped outward to whole data units; ellipse to polygon: the
  180-vertex outline in whole 256-frame pixels, repeats skipped, reduced to
  20 vertices; rectangle to ellipse: the corners become the edge points, so
  the axes are the diagonals: a circle in frame pixels through the corners;
  polygon to ellipse goes through the rectangle. Children and flags stay.
- Copy (`WSClipboard`): the selected populations with their subtrees;
  copying one quad copies its sibling quads. Paste under each selected
  population with coordinates and parameter names unchanged and group
  ownership cleared; a target that already has a child of that name is
  skipped, and a sample without a gate parameter is refused with a notice.

### 10.8 BifurGate (matches)

- `ws.autoquad` ("BifurGate"): for the selected population and every
  fluorescent parameter not on its gating path (and not -H / -W when the -A
  parameter exists), the parent's histogram on 4096 channels, smoothed as in
  10.5 in one dimension (left margin mirrored, the first two padding bins
  past the right edge lost, values rounded to whole counts).
- `PeakFinder.findPeaks`: repeatedly take the highest bin, walk out on each
  side (half width interpolated below half height, a regression slope over
  a window of clamp(half width, n/32, n/8) bins detecting the rise past a
  valley), count the events between the edges, place the peak at the
  interpolated median, zero its extent; drop peaks with fewer than
  min(100, N/100) events or under a tenth of the average accepted height,
  ending when a rejection finds over 95% of events removed. Keep the two
  largest; the split is the first lowest channel between their positions,
  converted with the channel's nominal value. Fewer than two peaks: no gate
  ("Unimodal").
- Children "<label>-" (open below) and "<label>+" (open above) under the
  selected population, named as the bisector.

## 11. Kinetics (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider on the native engine (`Kinetics`,
`KineticsRequest`, `GTimeSeries`, `GVector::Smooth`, `GParameter::FindTimeSlice`)
and with headless Ghidra 12.1.4 / javap on the Kinetics window
(`KineticsController`, `KineticsStatisticFormat`, `KineticsSmoothing`,
`TimesliceStatistics`, `KinToggleAutoSlice`, `MultiTimesliceDlog`,
`KineticsThresholdDlog`, `KineticsNode`). Static reading only. Implemented in
`src/core/kinetics.ts` (rules), `src/core/service.ts` (orchestration) and
`src/ui/Kinetics.tsx` (window). Timeslices live here, not among the gate
tools (section 10.1).

### 11.1 Options (matches)

- Statistics (saved by name): Median, Mean, Geometric Mean, Percentile,
  "% of cells over Threshold T", "Median (for cells > T)", "Mean (for cells
  > T)", "Geom. mean (for cells > T)", "Percentile (for cells > T)". The two
  percentile statistics need a percentile (default 90); the last five a
  threshold. Smoothing: None, Gaussian, Moving Average. Defaults: Median,
  no smoothing.
- The X parameter is the sample's Time parameter, or the event number when
  there is none. FlowJo's default Y is the first parameter with "/" in its
  name, else Ratio; this app falls back to the first other parameter.

### 11.2 The series (matches)

- Range R = time of the last event in file order minus the first (a last
  time of 0 counts as 1). Bin width max(1, trunc((R - 1) / 4096 + 1)),
  bins trunc((R + width) / width), at most 4096. Each statistic needs a
  minimum of events per bin (Median 20; Mean, Geometric Mean, % over T 10;
  Median > T 60; Mean / Geom. mean > T 30; Percentile max(20, 500 /
  min(p, 100 - p)), three times that above T); when bins x minimum exceeds
  the population count N, k = max(10, N div minimum) bins of width
  trunc(R / k + 1). An event's bin is trunc(t / width), clamped; the
  origin is 0.
- Statistics on scale values. Without a threshold, T = 0: values below 0 are
  left out of Mean, Median, Geometric Mean and Percentile. Mean: single-
  precision mean of y >= T. Geometric Mean: mean of the display-scale
  channel numbers, back to scale. % over T: 100 x (y >= T) / gated events of
  the bin. Median and percentiles stream the events in file order into a
  4096-channel histogram: the event that opens a new bin is counted in the
  bin before it (and lost from its own), and the file's last event is always
  processed. Empty bins are missing and print as 0.
- Smoothing (width 3): moving average with equal weights; Gaussian with
  weights exp(+k^2 / 9), as FlowJo 10.6.2 computes them (the exponent is
  positive, so far neighbours weigh more). Only present bins take part;
  missing bins stay missing. Values are printed with %6.5f.
- The time axis shown is [0, $ETIM - $BTIM] in whole seconds ("Time (SI
  Units)"), or the range R when that is under 1; scale = total / points.

### 11.3 Threshold (matches)

- "Define new threshold value": an absolute value (default 0.1), or a
  percentile (default 95) of the events within a timeslice. For the
  percentile the engine uses the timeslice's start and end, truncated, as an
  event-index range (FlowJo 10.6.2's behaviour); 100 gives the maximum, 0 the
  minimum.

### 11.4 Timeslices (matches)

- A timeslice is a name, start and end (X parameter scale units), a bar
  height and a colour (red, blue, cyan, green, magenta, orange, pink,
  yellow, repeating). All Events covers [0, points x scale] and is not
  saved. Slices sort by start, the longer first on ties.
- Dragging on the plot makes "Range #k" (k = slice count, raised until free),
  confirmed in a name prompt; a taken name gets "-1", "-2". Double-clicking a
  row edits name, start and end (whole numbers; times only when start <
  end).
- Multiple ranges: prefix and number (default 5); back-to-back slices of
  total / number from the All Events start while they fit, named prefix1,
  ...; bar heights 50, 75, 55, 80, ...
- Auto slicing toggles: around the longest run of zeros (none: [n/3, n]) and
  the first maximum, "Auto #c", "Auto #c+1" (and "Auto #c+2"); turning it
  off removes the "Auto #" slices.

### 11.5 Timeslice statistics (matches)

- The series is gap-filled once (a zero between two non-zero neighbours
  becomes their average). Channels come from the X parameter: round(t x
  tmax / W), tmax its scale maximum and W its scale width; dt = (end -
  start) / (end channel - start channel); points trunc(start / dt) up to
  trunc(end / dt), exclusive. A zero with a zero neighbour is a gap and is
  skipped.
- Peak (first maximum), Peak t = (peak index + 1) x dt, Mean Y = sum /
  (points x dt), AUC = Mean Y x (index span), Slope = least-squares slope
  over the index / dt (0 for one point); no points: NaN and AUC 0. dt is
  shown as end - start.
- Table columns Timeslice, Start t, End t, Peak t, Peak, Mean Y, Slope,
  AUC, dt; times as whole numbers. Copy Time Series writes "round(i x
  scale)<tab>value" per point.

### 11.6 Workspace and statistics table (matches)

- `KineticsNode` inside the population's `Subpopulations`: `yAxis`,
  `statistic`, `percentile`, `smoothing`, `absoluteThreshold` ("1" / "0"),
  `threshold` / `thresholdPercentile` (-999999 when unset, "#.##########"),
  `thresholdTimesliceName`, `yAuto`, `yMin`, `yMax`, `colorIndex`;
  `Timeslice` children (`name`, `startTime`, `endTime`, `y`, `color`
  "#rrggbb").
- Timeslice statistics as table columns: `plat.kin.startt`, `endt`,
  `peakt`, `peak`, `meany`, `slope`, `auc`, `dt` with `id` = the timeslice,
  inside the node's own `Subpopulations`; a missing slice gives NaN.
- Own rules: settings are kept per population path (shared across samples,
  as this app's plots are); `yAuto`, `yMin`, `yMax` are written with
  FlowJo's defaults (the plot always auto-scales, padded min x 0.97 and max
  x 1.03 as FlowJo does).
- Medium confidence: the Geometric Mean channel count, and the Time scale
  (tmax, W) taken as the Time channel range, with no $TIMESTEP gain.

## 12. Derived parameters (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider on the native engine (`Parser`,
`FunctionInterpreter`, `OperationParser`, `Sample::ComputeAlgebraic`,
`Sample::DP_ReplaceParameterNames`, `AlgebraicParameterSpec`,
`DerivedType`) and with headless Ghidra 12.1.4 / javap on the Java side
(`DerivedParameter`, `AlgebraicParameter`, `DerivedParameterController`,
`FormulaEditingPanel`). Static reading only. Implemented in
`src/core/formula.ts` (language), `src/core/analysis.ts` (evaluation),
`src/ui/Dialogs.tsx` (Derive Parameters) and the .wsp reader / writer.

### 12.1 Kinds (matches)

- FlowJo has algebraic (formula) parameters, the event number ("Event #"),
  imported CSV / CLR columns and cluster-frequency / consensus parameters.
  There is no ratio kind: a ratio is a formula. The dialog makes formulas
  only; a formula of exactly "Event #" is the event number.
- This app's earlier ratio parameters (A x (num - B) / (den - C)) still open
  and compute as before (own rule) and are written to .wsp as that formula.
- Own rule: imported CSV / CLR columns and cluster / consensus parameters
  are not offered (they need files or clusterings this app does not make).

### 12.2 Evaluation (matches)

- The formula is upper-cased; "EVENT #" and then every parameter name of the
  sample (longest first, then in parameter order) is replaced wherever it
  occurs, so names with "-" or "/" work and a longer name wins over a name
  it contains. Each name takes the event's compensated scale value; Event #
  the 0-based event index. Results are stored as 32-bit floats.
- At most 8 distinct names: a 9th takes the first one's slot. A math error
  (division by zero, sqrt or log of a negative, ...) stops the whole
  parameter; here gates and statistics on it report the error.

### 12.3 Language (matches)

- The expression is split at the rightmost operator of lowest priority, so
  every operator is left-associative (2^3^2 = 64), and unary signs bind
  tighter than ^ (-2^2 = 4). Priorities, loosest first: & and |; = and <>;
  < > <= >=; + -; * / %; ^; !; unary + -. There is no == or !=; ! is a prefix
  NOT. Numbers are C strtod (exponents, hex, INF, NAN).
- % truncates both sides (remainder with the dividend's sign; a divisor that
  truncates to 0 gives 0). a^b: pow for a > 0, 0 for a = 0, pow(a, trunc(b))
  for a < 0. Comparisons give 1 or 0; NaN compares false.
- Functions: sin, cos, tan, sinh, cosh, tanh, exp, atan, asin, acos, ln, log
  (base 10), abs, sqrt, neg, rand, if(c, a, b), min, max, avg, sd, cv
  (both divide the root of the squared deviations by n - 1), norm. String
  functions exist in FlowJo but do not make numbers; they are refused here.
- Errors carry FlowJo's messages: "Illegal math parameter.", "Empty
  expression.", "Missing operator in expression.", "Bad syntax in
  expression.", "Unbalanced open and close parentheses.", "Unknown
  function.", "Wrong number of arguments for function.", "Numeric value
  required for function.", "Unbalanced quotes for string value.".

### 12.4 Dialog and names (matches)

- "Derive Parameters": a name (letters, digits and underscore, not a number;
  a duplicate gives "Paramter with this name already exists"), default
  "Derived", then "Derived-1", ...; the formula with Insert Reference,
  Insert Function and Insert Operator lists; validated as it is typed
  ("Cannot parse the current equation: ..."). The new parameter's scale is
  linear 0 to 1000 by default.
- Own rule: references are inserted as plain names (FlowJo's editor stores
  `<Param name=.../>` commands and writes the plain names to the formula).

### 12.5 Workspace (matches)

- A `DerivedParameter` node in the sample's `Subpopulations` wrapping
  `<DerivedParameter name type="algebraic" formula>` (type "eventNumber" for
  Event #) with the raw text in `<Formula>` and the scale in `<Transform>`.
  Read back by name; unsupported types are skipped with a warning.
- Own rule: deleting a parameter in use asks first and lists its users
  (FlowJo has no dependency check; specs 6.6).

## 13. FCS reading (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider on the native engine (`FCSUtil::ReadFCSHeader`,
`FCSUtil::InitReadingFields`, `FCSUtil::CreateDataReader`, `FCSUtil::SetByteOrder`,
`FCSUtil::HandleStdKey`, `FCSPackedDataReader`, `FCSCytek3ByteDataReader`,
`FCSDataReader`). FCS reading is entirely native (no Java readers exist).
Implemented in `src/core/fcs.ts`.

### 13.1 Versions (matches)

- FCS 1.0, 2.0, 3.0, 3.1 and 3.2 are accepted. FCS 3.2's per-parameter
  `$PnDATATYPE` and `$PnTYPE` are ignored (only the first letter after
  `$Pn` is read: B, E, G, N, R, S); the whole file uses `$DATATYPE`.
- `$ENCRYPT` other than NONE is refused.

### 13.2 Data layout (matches)

- Integer widths: up to 8 bits take 1 byte, 9 to 16 take 2, then 24, 32
  and 64; other widths are refused ("Encountered unhandled data width").
  Mixed byte-aligned widths are read per parameter. When the last parameter
  of 16 bits or fewer is not exactly 8 or 16 bits, the event is one packed
  bit stream (not reset per event, bytes added least significant bit first,
  `$BYTEORD` unused).
- 24-bit values are little-endian unless the file is big-endian.
- `$BYTEORD` 1,2 / 1,2,3,4 (or 12 / 1234) is little-endian; any other order
  is read as a full byte reversal (with a warning here).
- Integer values are ANDed with (next power of two of `$PnR`) - 1;
  integers are unsigned.
- `$TOT` missing or 0: the event count is the DATA length x 8 / bits per
  event.

### 13.3 Own rules

- `$DATATYPE=A` (ASCII) is refused with an explicit error (FlowJo reads the
  bytes as integers by `$PnB`); `$MODE` C and U are refused (FlowJo reads C
  as list data and has an uncorrelated reader).
- A missing `$BYTEORD` reads little-endian with a warning (FlowJo infers the
  order from up to 16 events of the last 2-byte parameter).
- DATA offsets: this app picks the HEADER or TEXT offsets whose length fits
  `$TOT` (FlowJo uses `$BEGINDATA` / `$ENDDATA` only when the header offset
  is 0); both read the same files written to the standard.
- Not decoded: TEXT tokenising (`FFCSHeader`), the `$PnE` to scale
  conversion and the f1 > 0, f2 = 0 default (this app keeps 10^(f1 x / R)
  with f2 = 0 read as 1, warned), and the cytometer-specific quirks
  (Cytomics `$PnB` 10 read as 16, CXP / BCI masking).

## 14. Compensation (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider on the native engine
(`WeightOptimizer::CalculateSSM`, `WeightOptimizer::CalculateSSMCoefficient`,
`Compensator::Compensate`, `Compensator::PreCompensate`,
`Compensator::PrepareCompensatedParameters`, `CompensationSpec::FromXML`)
and headless Ghidra / javap on the Java side (`MatrixController`,
`CompensationMatrix`, `WizardMatrix`, `ParameterEntry`, `EngineSSM`).
Implemented in `src/core/compFlowjo.ts` and the Compensation dialog.

### 14.1 Matrix files (matches)

- .mtx: a Gating-ML root holding one `transforms:spilloverMatrix`
  (`spectral`, `prefix` "Comp-", `name`, `editable`, `version`, `status`,
  `transforms:id`) with `data-type:parameters` (`data-type:name`,
  `userProvidedCompInfix`) and one `transforms:spillover` row per channel
  of positional `transforms:coefficient transforms:value` entries. Values
  are spillover: row = stained channel, column = detector. Loading accepts
  the legacy `comp:*` names; a missing value is 0.
- CSV: an empty corner cell then the detectors; each row the channel then its
  spillover values; comma separated, "\n" endings.
- Own rule: legacy text matrix formats (`WorkspaceConverter`) are not read;
  the number format is the shortest exact decimal (FlowJo's
  `engineFormat` is not decoded).

### 14.2 Wizard (matches)

- Per single-stain control: its stained channel, a positive and a negative
  population (or the universal negative). Each population needs at least 100
  events and 2% of its parent ("Population %s does not contain enough
  events"); a population directly under the sample warns ("We recommend
  applying a scatter gate to cleanup %s"); a missing one is an error.
- Spillover(i, j) = (median P on j - median N on j) / (median P on i -
  median N on i), with a difference of exactly 0 taken as 1 (so the
  diagonal is 1); medians are FlowJo's histogram medians of uncompensated
  values. A difference below 1 warns ("Median of positive population is too
  small. ..."). Status FINALIZED, ERRONEOUS or EMPTY.
- This app's earlier percentage-based wizard stays as an extra (own rule).

### 14.3 Spillover spreading matrix (matches)

- SSM(i, j) = sqrt((P84_P,j - med_P,j)^2 - (P84_N,j - med_N,j)^2) /
  sqrt(med_P,i - med_N,i) with 4096-channel percentiles; 0 when the
  denominator is not positive or the result is NaN. Saved as CSV
  "SSM_<matrix>.csv": "SSM" then the parameters; rows the parameter without
  the comp prefix, then the values.

### 14.4 Applying a matrix (matches)

- Compensated values solve observed = true x S per event (LU for square
  matrices, least squares for spectral), as this app already did
  (specs 6.3); compensated parameters are named "Comp-" + name.

## 15. Cell cycle and proliferation (FlowJo 10.6.2)

Read with REA 6.8.0's Ghidra provider on the native engine (`CCModel`,
`CCFoxSynch`, `CCWatsonPragmatic`, `CCProlif`, `CellCycleRequest`,
`ProliferationRequest`); all fitting is native. Implemented in
`src/core/cellcycle.ts`, `src/core/proliferation.ts`.

### 15.1 Cell cycle (matches models and outputs; optimizer own)

- Dean-Jett-Fox: G1 and G2 Gaussians plus S(x) = a + b x + c x^2 between the
  peak means, broadened by the peak Gaussians. Watson pragmatic: G1 and G2
  plus amp [erfc(-((x - m1)/s1 + kG1)) - erfc(-((x - m2)/s2 - kG2))] / 2
  with fitted kG1, kG2.
- Peak constraints start empty (G2 position and CVs free); G2 is searched
  between 1.75 and 2.25 x the G1 mean. Histogram min(range, 1024) channels
  (6.1). RMSD = sqrt(sum over every channel of (model - data)^2 / channels).
  Outputs: % G1, % S, % G2 (component areas), G1 / G2 mean and CV, RMSD; no
  chi-square is reported (this app no longer shows one).
- Own rule: positions and widths by Nelder-Mead with exact nonnegative
  areas; FlowJo uses Levenberg-Marquardt on the same least squares (stop when
  chi-square improves by less than 0.1). Not decoded: FlowJo's initial-guess
  heuristics and the sub-G1 / super-G2 bounds.
- 2D cell cycle (EM; Java `EMModel`): a Gaussian mixture after k-means with
  exactly one EM step (loop quirk); not implemented here (own rule).

### 15.2 Proliferation (matches indices; model own)

- With N_g the fitted cells in generation g: Division Index = sum g N_g/2^g /
  sum N_g/2^g; Proliferation Index = the same over g >= 1; Expansion Index =
  sum N_g / sum N_g/2^g; Replication Index = sum_{g>=1} N_g / sum_{g>=1}
  N_g/2^g; % Divided = 100 sum_{g>=1} N_g/2^g / (N_0 + sum_{g>=1} N_g/2^g)
  (precursor cells that divided). Default number of peaks 4. FlowJo 10.6.2
  has no Precursor Frequency statistic (removed here).
- Model: FlowJo places generation i at r^i mu0 - (1 - r^i) offset on linear
  axes with a common width, ratio 0.5 unless estimated in [0.42, 0.54].
  Own rule: this app fits halving generations on a log10 axis (ratio 0.5,
  no offset), which coincides when FlowJo's offset is 0 and its ratio 0.5.

## 16. Preferences, Don't Ask Again, auto-save, edge warning, shortcuts (FlowJo 10.6.2)

Read with headless Ghidra and javap on the FlowJo 10.6.2 jar (`FJPrefsFJML`,
`PrefsWSResetDontAskAction`, `STreeMgr`, `AutoSaveTask`,
`GateWinController`); all Java. Implemented in `src/core/prefs.ts`, wired in
`src/ui/App.tsx` and `src/ui/Editors.tsx`.

### 16.1 Preferences (matches the honoured subset)

- Defaults: Disable Undo off, auto-save off every 10 minutes, edge warning on
  at 5%. Disable Undo: read when a workspace is created or opened; while on,
  edits are not recorded (the existing history is kept; specs 19.3).
- Own rule: preferences are kept in this browser (FlowJo keeps them in its
  preferences file). Preferences without an effect in this app are not shown.

### 16.2 Don't Ask Again (matches)

- The memory is a set of message keys. A confirmation whose key is in the set
  is answered Yes without asking (whatever was answered when it was stored,
  as in FlowJo). The checkbox is offered on statistic delete
  ("Are you sure you want to delete statistic(s)?"), population delete
  ("Are you sure you want to delete this population(s)?") and sample removal
  ("Are you sure you want to remove sample(s) from the %s ?"); group delete
  ("Do you want to delete group(s)?") always asks. This app also offers it on
  table delete (17.4).
- "Reset All Don't Show Memory" empties the set.

### 16.3 Auto-save and the edge-event warning

- Auto-save (matches the rule, destination own): every N minutes, only when
  auto-save is on, the workspace was saved once and it has samples. Status
  text "Auto-Saved <name> on EEE, d MMM yyyy HH:mm:ss". Own rule: a browser
  cannot overwrite the saved file, so the copy goes to this browser's
  storage.
- Edge warning (matches the rule, counting approximated): an axis is flagged
  when the fraction of displayed events on its lower or upper bound is greater
  than threshold / 100 (strict). The message gives int(100 x (sum of the four
  fractions + 0.005)): below 98 "Warning: %d% of events are on the chart
  edges!", otherwise "Warning: Nearly all events are on the chart edges!".
  Own rule: events in the first or last display bin stand for events on the
  bound.

### 16.4 Shortcuts (matches the implemented menu items)

- Ctrl/Cmd with: S save, Y preferences, E export, L layout editor, T table
  editor, G manual gate, Z undo, Shift+Z redo. Ctrl/Cmd+Y was redo in this app
  before; it is now Preferences, as in FlowJo.

## 17. Table and layout editors (FlowJo 10.6.2)

Read with headless Ghidra and javap (`TableTemplate`, `Iteration`, `Layout`,
`LEBatchBand`). Implemented in `src/core/tableEditor.ts`, `src/ui/Editors.tsx`
and `src/ui/Layout.tsx`.

### 17.1 Table columns (matches)

- A column is a statistic, a keyword value or a formula over the other
  columns of the same row (referenced by header). Tables are saved in the
  workspace file (own JSON, not the .wsp `Table` element).

### 17.2 Iteration (matches)

- By sample, by keyword value (groups in first-seen order, samples without
  the keyword left out) or by panel of N consecutive tubes. Layout batch
  exports one file per iteration; "Tiles across" N puts each sample's layout
  as one tile, N tiles per row, in a single file.

### 17.3 Outputs (matches CSV / TAB / HTML)

- CSV: an empty corner cell, " (%)" after headers containing "Freq.", cells
  with "," quoted and quotes doubled. TAB: first header "Sample:". HTML: grey
  header, right-aligned cells. Show Summary Stats adds Mean and Std.
  Deviation rows. Heat map: blue (column minimum) to yellow (maximum).
- Not implemented: Excel, XML Excel and SQL formats, printer and clipboard
  destinations, PowerPoint and animation batch destinations.

### 17.4 Delete

- "Are you sure you want to delete this table? " (with Don't Ask Again);
  layouts: "Are you sure you want to delete this layout? ".

## 18. Graph window interaction: stains, gate naming, navigation (FlowJo 10.6.2)

Read with javap on the FlowJo 10.6.2 jar and fjlib 2.3.0 (`SampleKeywordProxy`,
`GParameter`, `ParameterID`, `FJPrefsFJML$Graph`, `FJPrefsFJML` gate
preferences, `PrefsGates`) and the resource bundles (`flowjodictionary*.properties`);
all Java. Implemented independently in `src/ui/axes.ts` (`withStains`),
`src/ui/Dialogs.tsx` (`KeywordsDialog`, `GateNamerDialog`), `src/ui/Plot.tsx`
and `src/ui/App.tsx`. E2E: `e2e/uiparity.mjs`.

### 18.1 Parameter stains and axis titles (matches; scope own)

- FlowJo renames a parameter for display by editing its keywords on the
  sample (`SampleKeywordProxy.install`): `$PnS` sets the stain
  (`GParameter.setStain`), `$PnN` sets a name override (and "Comp-" + name on
  the compensated twin). `$PnG/R/E/B`, `$FIL`, `$TOT`, `$PAR` and other
  acquisition keywords are not editable (`isEditable`).
- The Graph Window axis title is the long name, `name + " :: " + stain` when
  the parameter has a stain, else the name (`ParameterID.getLongName`), when
  the preference "Include Parameter Stain ($P#S keyword)" is on
  (`FJPrefsFJML$Graph.showStain`, default true).
- This app: the Keywords window's `$PnS` column is editable; the edit is stored
  per sample (`SampleState.stains`) and replaces the stain in axis titles, gate
  names and the keyword list. Own rules: "apply to all samples with this
  parameter" (default on; FlowJo edits one sample's keyword at a time),
  `$PnN` overrides are not offered (they would rename the gating dimension),
  no confirmation prompt, the preference is always on, layout-editor plots
  still show the parameter name, and .wsp/FCS export writes the file's stain.

### 18.2 Subpopulation Identification (matches; colour own)

- After a gate is drawn FlowJo asks "Enter the name of this subpopulation:"
  in "Subpopulation Identification" (`dlog.gatenamer.*`). The name must be
  unique among siblings ("Name must be unique."). Favorites list the common
  gate names (preferences, Gates); "+" adds the shown name, "-" removes it.
- This app: shown for every single gate drawn on the plot (multi-gate tools
  such as quadrants and manual entry name automatically); prefilled with the
  automatic name, made unique as in 6.7. Cancel discards the gate (assumed;
  not confirmed in FlowJo). Not implemented: layer colour, the confirmation
  before "-".

### 18.3 Open Child Population (matches)

- Double-click inside a gate (Arrow tool) opens its population
  (`gw.nav.child`, "Show the selected gate's target population").

### 18.4 Child plot axes (matches)

- Preferences `displayOtherParams` = false and `childGraphType` = 1 ("Same as
  parent graph") by default (`FJPrefsFJML`): a new subset opens with its
  parent's X / Y parameters and plot type. This app: a population never viewed
  takes the plot of its nearest viewed ancestor; once changed it keeps its own.

### 18.5 Gating path and Next / Previous Sample (matches; wrap own)

- Breadcrumb "Gating Path" (`gw.breadcrumbbar.path.prompt`; "Ungated" at the
  sample). Plain keys (`EditorController.doPageUpDown`): PageDown is Next
  Sample, PageUp is Previous Sample. Menu accelerators
  (`gw.nav.nextsibling/prevsibling` = 33 / 34, with the menu key per
  `FJAction.lookupAccelerator`): Menu+PageUp next, Menu+PageDown previous
  ("View the next population at this level").
- This app: each path element selects that population. PageDown / PageUp,
  Ctrl/Cmd+PageUp / PageDown and the < > buttons move within the current group, keeping the population path;
  a sample without it shows All events. Own rule: no wrap at either end.

## 19. Interaction model: shortcuts, dispatch, undo, clipboard (FlowJo 10.6.2)

Full rule set with a citation for each rule, and the 168-entry accelerator
table: `docs/validation/flowjo-interaction-model.md` (javap on the FlowJo 10.6.2
jar and fjlib 2.3.0; FlowJo was not run). This section lists what is
implemented and the FlowJo function that proves each rule. Implemented in
`src/ui/App.tsx` (`keyRef`, clipboard helpers, `neighbour`), `src/ui/Plot.tsx`
(`nudge`, `previewFor`, `commitPreview`, key handler) and
`src/ui/GateActions.tsx`. E2E: `e2e/interaction.mjs` (21 checks).

### 19.1 Keyboard (matches the implemented subset)

| Rule | Behavior | Proven by |
|---|---|---|
| K1 | Every bundle accelerator carries the menu key (Cmd on macOS, Ctrl elsewhere); a numeric value is a key code, an upper-case letter adds Shift | fjlib `FJAction.lookupAccelerator`, `FJAction.getMask` |
| K4/K7 | Workspace and graph window keep separate key maps. This app: the graph window's keys apply while the plot has focus, the workspace's otherwise | fjlib `FJRibbonFrame.addAcceleratorToFrame`; `GraphWinMenuBar`, `GWActionManager.get*Actions` |
| Workspace | Ctrl/Cmd+C copy, X cut, V paste, B add statistic, I inspect (Keywords), G create group, Shift+G copy analysis to group, Shift+A / O / N AND / OR / NOT gate | `WSCommand` keys `le.action.*`, `ws.addstat`, `ws.sample.properties`, `ws.newgroup`, `ws.group.copygate`, `ws.boolean.*` via K1 |
| K10 | Delete / Backspace deletes the selected population (usual confirmation) | `KTreeTable.keyPressed`, `STreeMgr.deleteSelection` |
| Graph | Ctrl/Cmd+C copy image, T transpose, K / J next / previous X, Y next Y, U up to parent, O open child, G manual gate | `GWCommand` keys `gw.copy.picturetransparency`, `gw.graph.transpose/nextx/prevx/nexty`, `gw.nav.parent/child`, `gw.gate.manual`; `GWAction.doAction`, `AbstractGraphWinController.actionPerformed` |
| K9 | Arrow keys nudge the selected gate one pixel; Alt x2, Ctrl x2, Shift x3, multiplied; one undo step each | `EditorKeys.keyPressed`, `EditorKeys.nudge` |
| K9 | Delete / Backspace deletes the selected gate | `GWFrame$GWKeyDispatcher.dispatchKeyEvent`, `EditorKeys.keyPressed` |
| K9 | Space next sample; Shift / Ctrl / Alt+Space previous; PageDown next, PageUp previous (18.5) | `EditorController.doSpaceBar`, `EditorController.doPageUpDown` |
| K9 | While drawing a polygon: Backspace / Delete removes the last vertex, Space closes it, Escape aborts | `PolygonDrag.doEscapeAction`, `EditorKeys.keyPressed` |

Own rules: shortcuts fire on key press without FlowJo's 2 s repeat block
(`ActionAcceleratorListener.dispatchKeyEvent`); previous Y is Ctrl/Cmd+Shift+Y
because FlowJo's value (121) is F10 (K2); keys typed in a text field or
checkbox stay there; browser-reserved combinations are not claimed (C16).

### 19.2 Dispatch and enable rules (matches the implemented subset)

| Rule | Behavior | Proven by |
|---|---|---|
| D2 | A shortcut and its button run the same command (Ctrl/Cmd+B and Shift+G press the buttons) | `ActionAcceleratorListener.dispatchKeyEvent`, `SampleTreeTable.buildPopup` |
| E6 | Copy analysis to group is disabled when the selected analysis already belongs to the current group | `WSActionManager$1.run` |
| E10 | Next / Previous Sample go to the nearest sample of the group that has the same population, and are disabled when none does | `GWActionManager.adjust` |
| E3 | AND / OR need two or more selected populations of one sample | `WSActionManager$1.run` (`getCombineActions`) |

### 19.3 Undo / redo (matches)

| Rule | Behavior | Proven by |
|---|---|---|
| U1-U5 | One history for workspace and graph edits, one step per user action, no merging, limit 100, a new edit drops redo | `Workspace` constructor, `FJUndoManager.addEdit/startNewEdit/endCurrentEdit`, Swing `UndoManager` |
| U8 | Saving does not clear history; opening a workspace starts a new one | no caller of `WSUndoManager.discardAllEdits` |
| U9 | "Disable Undo" is read when a workspace is created or opened; while on, edits are not recorded; the existing history is kept | `Workspace.undoEnabled`, `FJUndoManager.canModify` |
| U10/U11 | Labels "Undo" / "Redo"; Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | `fj.action.undo/redo` via K1 |

### 19.4 Clipboard (matches; scope own)

| Rule | Behavior | Proven by |
|---|---|---|
| C1 | Copy takes every selected population plus sibling quadrants | `WSClipboard.copy`, `NodeList.addSiblingQuads` |
| C2 | Populations go to an internal clipboard, not the system one; it survives pasting | `WSClipboard` (`sFlowjoClipboard`) |
| C5 | Cut = Copy, then delete with the usual confirmation | `WSClipboard.cut` |
| C7 | Paste under every selected node across samples. This app: the selected population path(s) in the current sample and every checked sample; "Paste to group" pastes into every sample of the current group | `WSClipboard.internalPaste` |
| C8 | Pasted populations lose group ownership; name clashes and missing parameters skip with a notice (10.7) | `STreeTable.addElementToTree`, `SampleTreeTable.addDroppedNode` |
| C12 | Copy Image puts the plot on the system clipboard as an image; failure text "There was an error adding the image to the system clipboard." | `GateWinController.doCopy`, `FJClipboardUtil.addImageToClipboard` |
| C16 | Copy Table to Clipboard puts the statistics table as HTML and plain text | `FormattedTextTransferable`, `fj.tableactionmanager.copy` |

Own rules: Cut handles one population at a time; "Paste to group" pastes
sample-owned copies (FlowJo's group paste with nothing selected); the content
is captured at Copy time (FlowJo builds it at paste time, C3, medium
confidence); the image is PNG with transparency only.

Later sections add pasting tab/CSV text into keyword columns, drag and drop,
Copy Histogram Function / Copy Statistics and context menus (20), gate size
(22.2), Duplicate View (23) and the layout editor's keys (21). Still not
implemented: the layout editor's own undo history (one history per layout).

## 20. Text paste, drag and drop, right-click menus, text copies (FlowJo 10.6.2)

Rules from `docs/validation/flowjo-interaction-model.md` (C6, C10, C11, C13,
D7) plus a javap read of `KTreeTable.addPastedHeaderKeywords` and
`GatePanel.makeGatePopupMenu`. Implemented in `src/core/project.ts`
(`parseTabOrCsv`, `pasteAnnotations`; tests `tests/paste-annotations.test.ts`),
`src/ui/App.tsx` (`pasteTextRef`, `dropFiles`, `onDropOn`, `popMenu`,
`plotMenu`, `copyHistogram`, `copyStatistics`), `src/ui/Plot.tsx`
(`onContext`) and `src/ui/GateActions.tsx` (`ContextMenu`). E2E:
`e2e/gaps.mjs` (13 checks).

### 20.1 Text paste into the sample table (matches; column choice own)

| Rule | Behavior | Proven by |
|---|---|---|
| C6 | Paste pastes copied populations first; only with none does the system clipboard's text go to the table | `WSClipboard.paste`, `WSClipboard.pastable`, `WSViewMgr.pasteText` |
| C10 | Rows split on line breaks, cells on tabs (else commas, CSV quoting) | `StringUtil.parseTabOrCsvString` |
| C10 | With no editable keyword column yet, the first row names the keyword columns | `KTreeTable.addPastedHeaderKeywords`, `WSKeywordMgr.addKeyword` |
| C10 | Values fill from the selected row down; a single value fills every selected row; the paste is one undo step | `KTreeTable.pasteFromSystemClipboard` (`FJCompoundEdit`) |

Own rules: the keyword columns are the sample annotations; data fills them in
column order from the first (the app has no column selection); the first row
is also a header when all its cells are existing keywords; "selected rows" are
the checked samples.

### 20.2 Drag and drop (matches the implemented targets)

| Rule | Behavior | Proven by |
|---|---|---|
| C11 | Files dropped on the workspace open by type: FCS, workspace, Gating-ML XML, `.mtx` matrices | `TreeTableDropListener.processDropFile` |
| C11 | A matrix dropped on a sample or group is applied to it (also added to the matrices) | `TreeTableDropListener.compDrop` |
| C11 | A population dropped on a sample or population is copied under it (undoable); dropped on a group, it becomes the group's analysis | `TreeTableDropListener.initiateNodeDrop`, `GroupTableDropListener.drop` |

Own rules: a population cannot be dropped onto itself or its children; zip,
image and CSV/CLR matrix files are reported as not openable; drops between
workspaces do not apply (one workspace per page).

### 20.3 Right-click menus (matches the supported items, FlowJo order)

- Population (`SampleTreeTable.buildPopup`): Copy, Paste, Rename, Delete, -,
  Add Statistic, -, Inspect..., -, Copy analysis to group (disabled when the
  analysis already belongs to the group), -, Export / Concatenate....
- Sample or All events: Paste, Add Statistic, -, Inspect..., -, Export /
  Concatenate....
- Plot (`GatePanel.maybeDoPopup`, `makeGatePopupMenu`): on a gate, Rename...,
  Clear, -, Convert to Polygon / Rectangle / Ellipse (`makeGateConversionMenu`,
  disabled when not possible), -; always Add Statistic, Copy Image, Copy
  Histogram Function (1-D only), Copy Statistics, Copy to Layout Editor.
- Duplicate, Add Keyword, Select Equivalent Nodes, Expand / Collapse were
  added in 22.4, and Increase / Decrease Size in 22.2. Not offered (no app
  feature): DIVA export, line thickness, smoothing, colour, Copy Image Without
  Transparency. Add Statistic uses the statistic chosen in
  the Statistics panel (FlowJo opens its dialog).

### 20.4 Text copies from the graph (matches the commands; text layout own)

| Rule | Behavior | Proven by |
|---|---|---|
| C13 | Copy Histogram Function (Ctrl/Cmd+F, 1-D only) puts the X histogram on the clipboard as text | `GWAction.copyText`, `Histogram.toString(CoordinateTransformer)`, `gw.copy.histogram` |
| C13 | Copy Statistics puts the population's statistic values on the clipboard as text | `GWAction.copyStatistics`, `PopNode.collectStatNodeString` |

Own rules (FlowJo's text forms were not read): the histogram is a header
("parameter<TAB>Count") then one row per display bin, the bin centre in scale
units and its count; statistics are "column label<TAB>value" lines for the
statistics-table columns of the selected population.

## 21. Layout editor logic (FlowJo 10.6.2)

Full rule set (78 rules with citations): `docs/validation/flowjo-layout-model.md`
(javap on the FlowJo 10.6.2 jar and fjlib; FlowJo was not run). Implemented in
`src/core/layoutArrange.ts` (geometry; tests `tests/layout-arrange.test.ts`)
and `src/ui/Layout.tsx` (editor, rendering, export). Spec 17.2 (iteration by
sample / keyword / panel, batch tiles) still applies; 21.3 refines it. E2E:
`e2e/layout.mjs` (13 checks) and the layout checks in `e2e/workflow.mjs`.

### 21.1 Page and placement (matches; graph footprint own)

| Rule | Behavior | Proven by |
|---|---|---|
| P1 | Positions and sizes are points (1/72 in); 100% zoom is print size | `CustomPaper.create`, `le.nav.showat100.tooltip` |
| P2-P4 | US Letter (A4 offered), portrait, 1 inch margins: Letter page 468 x 648 pt | `PrintLayout.getDefaultPageFormat`, `CustomPaper.DEFAULT_INSETS` |
| P6 | Page breaks every page size; a point is on page floor(c / page) + 1 | `LayoutEditorController.getPageDimension`, `pointToPage` |
| P10 | "Copy to Layout Editor" centres the graph on (200, 200) pt, no cascade | `GWAction.copyToLayout` |
| P11 | Duplicate copies the selection at (+8, +8); a new text figure goes to (30, 50) | `AbstractLayerDiagram.duplicateSelection`, `LEPasteAction.doAction` |
| P12 | New figures go on top of the z-order | `AbstractLayerDiagram.add` |
| P13 | A graph's plot frame is 256 x 256 pt | `FigLightweightChartBox.getFrameWidth` |

Own rules: a graph is one box (the 256 pt frame plus this app's axes, 308 x 281
pt), and align uses that box (FlowJo aligns the frame and moves the axes as
dependents); items saved before positions existed are laid out two across;
the PDF draws each page as an image inside the margins.

### 21.2 Arrange (matches)

| Rule | Behavior | Proven by |
|---|---|---|
| A2-A5 | Align Left / Top / Right / Bottom use the selection's extent | `AlignableLayerDiagram.setX/setY/setRight/setBottom` |
| A6-A7 | Center / Middle: the integer mean of the centres, x = mean - floor(w / 2) | `AlignableLayerDiagram.setHCenter/setVCenter` |
| A8-A9 | Spacing: sort by leading edge; first and last stay; step = floor((last centre - first centre) / (n - 1)) | `AlignableLayerDiagram.setSpacing` |
| A11 | To grid: top-left to trunc((v + 18) / 36) x 36 | `AlignableLayerDiagram.alignToGrid`, `GuideGrid.snapPt` |
| A12 | Ctrl/Cmd + L T R B M align; K vertical, J horizontal spacing | `AlignableLayerDiagram.processAlignKey` |
| A15-A17 | Front keeps the selection order; Back reverses it; Forward / Backward step one place | `AbstractLayerDiagram.bringToFront/sendToBack/bringForward/sendBackward` |
| A20/A22 | Group: the members act as one figure (union bounds) and go on top; Ungroup releases them | `LEGroupAction.doGroup`, `FigGroup.ungroup` |
| A23 | Avoid page breaks: a figure crossing a break moves to the next page start, the push carrying to later figures; figures larger than a page stay | `LayerDiagram.avoidPageBreaks` |
| A24 | Locked figures are skipped by drag and nudge; align still moves them | `AbstractLayerDiagram.okToMove/getFigsToNudge` |
| S1 | Arrows nudge 1 pt; Alt x2, Ctrl/Cmd x2, Shift x3, multiplied | `EditorKeys.nudge` |
| G1-G3 | Grid layout: 3 x 4 cells, 4 pt padding, filled row by row; extras left out | `FigGridLayout.<init>`, `FJLayoutGrid.getNextCell` |

Own rules: there is no Spread (A10, a no-op in FlowJo) and no Same Size (A14,
absent) (resize handles, copy / paste, figure properties, shapes and several
layouts were added later: `docs/validation/ui-gaps/layout.md`); a group keeps its members as items (no scaling on resize, A21); grid
figures are covered in 25.2; guides and guide snapping (S4-S5) are added and
removed with buttons and by dragging off the page (there are no rulers to drag
them from); every move, including a nudge, is an undo step in
the workspace history (FlowJo: one history per layout, nudges not recorded,
S2 / U1).

### 21.3 Iteration (matches; I7 discriminator included)

| Rule | Behavior | Proven by |
|---|---|---|
| I1 | A graph finds its population by path in the bound sample; missing shows nothing | `PopModel.bind`, `Iteration.getCurrentNode` |
| I3/P14 | Iteration off (default): each graph shows the sample it came from | `PopModel.bind`, `FJPrefsFJML$Layouts.iterationType` |
| I4 | Sample iteration: every graph shows the value's sample | `Iteration.getCurrentSample` |
| I5 | Panel iteration keeps the graph's position within its panel | `Iteration.getSampleByPanel` |
| I6/I7 | Keyword iteration maps the k-th sample of a value to the k-th of the next, or matches a discriminator keyword | `Iteration.getSampleByKey/findSampleByKey` |
| I9 | PageDown / PageUp / Home / End step the iteration value | `LayoutEditor.dispatchKeyEvent` |
| I10 | Batch tiles step by whole pages | `Batch.getLayoutOffset` |

Own rules: graphs added before this change have no source sample and follow
the chosen value; keyword values are in first-seen order (I8 order not read);
control layers (I2) are not modelled.

### 21.4 Annotations

- Show Gates per graph (default on; `AnnotationPanel` `showGates`); Show
  Annotation draws the title line above the graph (default off).
- Later added: with Frequencies / with Names and the axes string (21,
  layout guides batch), ancestry with backgating and adjunct histograms (24),
  multigraph (25.3). Not implemented: custom axis label text (N8).

## 22. Graph display, gate size, tree commands, ribbon (FlowJo 10.6.2)

Rules with citations: `docs/validation/flowjo-display-tree-model.md` (javap on
the FlowJo 10.6.2 jar and fjlib; FlowJo was not run). Implemented in
`src/ui/renderPlot.ts` (`formatFreq`, display options), `src/ui/Plot.tsx`
(`scaleGate`), `src/core/project.ts` (`addKeywordToAll`, `findKeywords`,
`replaceKeywords`, `duplicatePopulation`), `src/ui/Dialogs.tsx` and
`src/ui/App.tsx`. Tests: `tests/display.test.ts`, `tests/tree-commands.test.ts`;
E2E `e2e/display.mjs` (14 checks).

### 22.1 Display menu (matches the drawn items)

| Rule | Behavior | Proven by |
|---|---|---|
| D1 | Display toggles belong to the population's graph and are saved with it | `GWActionManager.getDisplayActions`, `GWGraphSpecAction.doAction` |
| D2 | Show Grid (off): light grey lines at the labelled ticks, over the data, under the gates | `GraphEditor.paintBackground` -> `paintGrid` |
| D4/D5 | Show Gate Names / Frequencies (on): name on the first line, frequency on the second; quadrant names up to the colon | `Gate.getAnnotation(PopNode, boolean, boolean)` |
| D6 | Frequency: 3 significant figures, trailing zeros kept, no %; between 0 and 0.01 scientific ("4.00E-3") | `Gate.getFrequencyFormatted`, `FJNumberFormatter.formattedPercentDouble` |
| D7 | Label position "inside": centred on the gate's bounding box | `AnnotatedFig.getAnnoAnchor`, `AnnotatedFig.drawMultiLineAnnotation` |
| D8 | Show Medians (off): a 20 px "+" at the medians when the population has more than 10 events; on a histogram a dotted vertical line | `GWGraphSpecAction` (SHOWMEDIANS), `AnnotatedFig.drawAnnotation` |

Own rules: frequencies are capped at 2 decimals to match FlowJo's examples
(45.678 -> 45.7, 0.5 -> 0.50); medians are taken from the display bins; large
dots are 3 px (FlowJo's native size was not read) and offered on dot plots;
Show Event # Parameter was added in 24 and Show Uncompensated Parameters in
25.1.

### 22.2 Gate size (matches)

- Increase / Decrease Size (Ctrl/Cmd+= / Ctrl/Cmd+-, and the gate menu) scale
  the selected polygon, rectangle or ellipse by 1.1 / (1 / 1.1) about its own
  centre; quadrants and ranges are not scaled (`GateWinScaleFigAction`, factors
  1.1 and 1/1.1, built in `GWActionManager.<init>`). Window Reset Size items do
  not apply (one plot panel).

### 22.3 Axis stepping (matches)

- Next / Previous X and Y stop at either end of the parameter list (no wrap;
  `GWNavAction.doAction`).
  The colour axis (Ctrl/Cmd+] / [) was added in 24 and Duplicate View in 23.

### 22.4 Workspace tree (matches; selection model own)

| Rule | Behavior | Proven by |
|---|---|---|
| T1 | Expand All / Collapse All (Ctrl/Cmd+U, Ctrl/Cmd+Shift+U): every node and its subtree; a node's toggle covers its subtree | `WSTreeTableAction.doAction` (TREEEXPANDALL / TREECOLLAPSEALL), `STreeTable.collapseLevel` |
| T2 | Expansion is saved per node (`expanded="0|1"`, imported from .wsp) | `STree.setExpanded`, `AppNode.setExpanded` (reads / writes `expanded`) |
| T3 | Select Equivalent Nodes (Ctrl/Cmd+Shift+E): the same path in every sample of the current group | `NodeSelectionAction.doAction` (SELECTEQUIVALENTNODES) |
| T4 | Find (Ctrl/Cmd+F): keyword values only; literal substring, case-insensitive by default; Match case, Match whole word, a keyword context; Find Next wraps; Sample / Keyword / Value results | `FindReplaceDialog` (`getFilterRegex`) |
| T5 | Duplicate: a deep copy as a sibling, name made unique ("CD4" -> "CD4-1") | `WSDuplicateAction.doAction`, `PopNode.duplicate` |
| T6 | Add Keyword (Ctrl/Cmd+Shift+I): a name only, pre-filled "SampleID", trimmed; "Off", "Sample", "Panel" get "_"; added to every sample with an empty value | `WSGroupAction` (GROUPADDKEY), `WSKeywordMgr.addKeyword` |

Own rules: Select Equivalent checks the samples (the app's cross-sample
selection); Replace changes annotation keywords only (file keywords stay as
read); expanding or collapsing is an undo step.

### 22.5 Ribbon (grouping matches; one row own)

- The toolbar follows the workspace ribbon: the quick row (Undo, Redo, Add
  Samples, Create Group, Compensation, Table Editor, Layout Editor), then the
  Document, Find, Keywords, Expand, Cytometry and Settings bands
  (`WSRibbonStructure.loadDefaults`, `WSRibbonFrame.addTaskbarComponents`).
  Own rule: one toolbar row instead of tabs.

### 22.6 Escape (differs, own rule)

- FlowJo closes only message dialogs that offer Cancel, the gate namer, Add
  Statistic and New Keyword on Escape (`QDialog.showDialog`; `FJDialog` has no
  binding). This app closes the topmost menu or dialog on Escape (comparison
  C17).

## 23. Workspace window layout (FlowJo 10.6.2)

FlowJo's main screen is one workspace window: a taskbar, a ribbon with tabs
and bands, a group table above the sample tree-table, and one graph window per
opened node (comparison C1, C3, C4; `WSRibbonFrame`, `WSRibbonStructure.loadDefaults`,
`GroupTreeTable`, `SampleTreeTable`, `GWFrame`, bundle `ws.column.special.*`).
This is now the default screen; the earlier four-panel screen stays available
(Configure > Switch to classic layout, or `?layout=classic`). Implemented in
`src/ui/App.tsx` (`uiLayout`, `sampleTableRows`, graph windows). E2E:
`e2e/fjlayout.mjs`; the other e2e scripts run the classic layout.

| Element | Behavior | Proven by |
|---|---|---|
| Taskbar | Undo, Redo, Add Samples, Create Group, Compensation, Table Editor, Layout Editor | `WSRibbonFrame.addTaskbarComponents` |
| Ribbon | Tabs FlowJo, File, Edit, Workspace, Tools, Configure, each with its bands (22.5) | `WSRibbonStructure.loadDefaults` |
| Group pane | A table: Group, Role, Size; double-click edits the group | `GroupTreeTable` |
| Sample table | Default columns Name, Statistic, #Cells; samples expand to populations and statistic nodes; Statistic is the frequency of parent (22.1 format), #Cells the count | `SampleTreeTable`, `ws.column.special.name/statistic/ncells` |
| Graph windows | Double-click a sample or population opens its graph window, a separate window (one per node; again focuses it); Duplicate View opens another; windows move and close independently | `GWFrame`, `GWNavAction.duplicateGW` |

Graph windows are real separate windows (matches): browser child windows, and
child BrowserWindows in the Electron app (its window-open handler allows only
blank `gw-*` windows). The page renders into each one through a React portal
with the page's styles; keys pressed there reach the same shortcuts; closing
the window closes the graph window; a dialog opened from a graph window
brings the workspace window forward (dialogs belong to the workspace window).
Configure > "Graph windows as separate windows" (on by default) switches to
windows inside the page, which are also the fallback when pop-ups are blocked
(`src/ui/Popout.tsx`; E2E `e2e/fjlayout.mjs`).

Own rules: only the focused window is live, the others show a picture of
their last view until clicked; a single click in the table selects without moving a window, while
navigation inside the live window (gating path, double-click a gate, sample
keys) moves it; statistics, group tools, the sample list with annotations and
the log are in a side panel with tabs; populations are renamed from the
right-click menu.

## 24. Colour axis, Event # parameter, layout ancestry and adjunct histograms (FlowJo 10.6.2)

Rules from `docs/validation/flowjo-display-tree-model.md` (C1-C2, D10) and
`docs/validation/flowjo-layout-model.md` (N3-N5). Implemented in
`src/core/service.ts` (`plot` colour mean), `src/core/analysis.ts` (Event #
column), `src/ui/renderPlot.ts` (`colorBy`), `src/ui/App.tsx` and
`src/ui/Layout.tsx` (`graphCanvasSize`). Tests: `tests/color-axis.test.ts`;
E2E `e2e/coloraxis.mjs` (8 checks).

| Rule | Behavior | Proven by |
|---|---|---|
| C1 | Colour axis: a third parameter colours the events; on / off, a parameter chooser, colour map blue, green, yellow, red | `ColorMapAxisPanel`, `ColorMapParameterComboBox` |
| C2 | Next / Previous Color (Ctrl/Cmd+] / [) step the colour parameter through the axis list without wrapping | `GWNavAction.doAction` (PREV_COLOR / NEXT_COLOR) |
| D10 | Show Event # Parameter adds an "Event #" parameter at the end of the axis lists | `ParameterList.getParameterIDs` (`StringDefs.EventNum`) |
| N3 | Show Ancestry: a row of charts beside the graph, one per ancestor level, 140 pt each, starting 8 pt to the right; enabled below the root only | `FigChartRow.adaptToChart/getDepth`, `AnnotationPanel.adjust` |
| N4 | with Backgating: the ancestry charts overlay the graph's population; only with ancestry on | `FigChartRow.isBackgating`, `AnnotationPanel.adjust` |
| N5 | Show Adjunct Histograms: 1-D distributions of X and Y along the edges of a 2-D plot | `FigChartAdjunctHistogram`, `LEChart.showAdjunctHistograms` |

Own rules: each pseudocolor cell takes the colour of the bin's mean of the
colour parameter over that parameter's display range (FlowJo's native
colouring rule was not read); the colour axis is a per-population graph
setting and applies to pseudocolor plots; Show Event # Parameter is
workspace-wide; ancestry charts use each ancestor's saved plot axes (else the
graph's) and show only the gate leading to the next level; adjunct strips are
40 px; Show Uncompensated Parameters followed in 25.1.

## 25. Uncompensated parameters, grid figures, multigraph, .wsp layout settings (FlowJo 10.6.2)

Rules from `docs/validation/flowjo-display-tree-model.md` (D9) and
`docs/validation/flowjo-layout-model.md` (G1-G9, N6), plus the `LayoutEditor`
element observed in the fixture .wsp files. Implemented in
`src/core/analysis.ts` (raw twins), `src/ui/axes.ts` (`withUncompTwins`),
`src/ui/Layout.tsx` (`makeGrid`, `multigraphCells`) and `src/core/wsp.ts`.
Tests: `tests/uncomp.test.ts`, `tests/wsp-layout.test.ts`; E2E
`e2e/remaining.mjs` (7 checks).

### 25.1 Show Uncompensated Parameters (matches; naming own)

- When on, the raw twin of each compensated parameter is added to the axis
  lists (`ParameterList.getParameterIDs(uncomped, ...)`). Own rules: FlowJo
  names compensated parameters "Comp-<name>" and raw ones "<name>"; this app
  compensates in place, so the raw twin is "<name> (uncompensated)" and reads
  the parameter with no compensation; gates on a twin work like any other
  parameter but carry that name into exports; workspace-wide setting.

### 25.2 Grid figures (matches the visible result; model own)

| Rule | Behavior | Proven by |
|---|---|---|
| G1-G3 | 3 rows x 4 columns by default, 4 pt cell padding, filled row by row; items that do not fit are left out | `FigGridLayout.<init>`, `FJLayoutGrid.getNextCell` |
| G5 | Cells hold bare charts (no axes) by default | `FigGridLayout.makeChartFig`, pref `minimalChartInGrids` (true) |
| G6/G7 | Axes are shown on the grid border: X under the bottom row, Y at the left column | `FigGridLayout.addChartAxesToBorder`, `clearBorderLabels` |
| G9 | Extract Cells leaves each figure where it is | `FigBaseGrid.stripGridFromFigs` |

| G9 | Insert Rows or Columns, Delete Rows or Columns (with their contents), Set Grid Dimensions, Set Cell Padding, Make Rows or Columns Even, Autofit Cells, Clear Cells, Extract Cells from Grid; grid lines drawn | `FigGridLayout$ActionHandler`, `GridUtil.makeRowsEven/makeColsEven`, `FigBaseGrid.stripGridFromFigs` |

The grid is an object (`ws.layoutGrids`: position, rows, columns, padding,
cell size, bare charts) and each cell item records its row and column
(`src/core/layoutArrange.ts` `gridInsert`, `gridDelete`, `gridResize`,
`cellOrigin`, `borderAxes`; `src/ui/Layout.tsx`; tests in
`tests/layout-arrange.test.ts`; E2E `e2e/grid.mjs`). Insert shifts the later
rows (columns); Delete removes that row's (column's) cells with their contents
and closes the gap, never below one row or column; a smaller size releases
the cells outside as free items; moving a cell moves the whole grid; border
axes are recomputed after every change. Own rules: all cells share one size
(FlowJo keeps a size per row and per column; imported sizes take the
largest); dropping a population onto a filled cell (overlay or replace, G4)
and the "Scale Figs on Cell Resize" / "Autofit to Dropped Figures" toggles
are not offered.

### 25.3 Show Multigraph (matches the types offered)

- A grid of other parameter combinations for the same population beside the
  graph; at most 10 parameters (`FigChartGrid`, `ChartCommand` `le.chart.multigraph*`,
  `le.chart.nxn`, `FJPrefsFJML$Layouts.multiGraphLimit`). This app offers
  Histograms (one per parameter) and N x N (pseudocolor pairs, histograms on
  the diagonal); not offered: all-by, half N x N, slinky, dot / contour cell
  types. (Later added: half N x N, All by Y, Slinky and dot / contour cells;
  see `docs/validation/ui-gaps/layout.md` 3.4.)

### 25.4 .wsp layouts: page, iteration and figures

Page and iteration (observed in every fixture): the current layout's
PrintLayout (width, height, orientation: 1 portrait, 0 landscape) sets the
paper and orientation; its Iteration (iterationType OFF / SAMPLE / KEYWORD /
PANEL, iterationKeyword, discriminator, panelSize) sets the layout iteration.

Figures (decoded, not observed: every fixture's FigList is empty). The format
was read from FlowJo's figure writers and readers; full notes in
`docs/validation/flowjo-figlist-format.md`. Implemented in
`src/core/wspLayout.ts` (`parseFigList`, `writeFigList`), wired into
`src/core/wsp.ts` (import) and `src/core/wspWriter.ts` (export as a
`LayoutEditor` element); tests `tests/wsp-figures.test.ts`.

| Rule | Behavior | Proven by |
|---|---|---|
| F1 | The element name is the figure kind (ChartData / Chart, StyledText, FigList / Group, GridLayout, Image, ...); document order is the z-order | `FigFactory.makeFig`, `Fig.getElementName` |
| F2 | Common bounds `x y width height` in integer points | `Fig.getElement`, `Fig.setElementSelf`, `SElement.setRect` |
| F3 | A chart refers to its sample by workspace sampleID and to its population by path (node names joined with "/"); the first DataLayer is the population, later ones overlays | `ChartAttributes.extract/install`, `PopModel`, `DataLayer` |
| F4 | A chart's plot frame is 256 pt x scaleH / scaleV (a value over 50 is a percent); the final WindowPosition, when not empty, gives its position | `LEChartController.setElement`, `FigFactory.makeFigChartBox` |
| F5 | Graph type and X / Y parameter names in `<Graph>`; GraphEnvironment showGates, showFreqOnPlots, showGateNameOnPlots, showAxes, showGrid; GraphSettings drawLargeDots, showOutliers | `GraphDef` reader |
| F6 | Annotation, Ancestry (backgating), Multigraph (type, Parameters) are saved inside the chart, shown when their WindowPosition is displayed; showAdjunctHistograms on the chart | `LEChartController.setElement` |
| F7 | StyledText `<Content>` is Swing HTML escaped twice on disk; live values are `<input type="fjml" value="URL-encoded statistic">` | `FigBaseText.getElement/setElement`, `SElement.toWriter` |
| F8 | A group is a nested FigList of its members | `FigGroup.getElement`, `FigGroup.<init>` |
| F9 | GridLayout: rows, columns, RowSizes / ColSizes, Content / Cell row col with one figure, Labels Row / Column for the border axes; cell padding is not saved | `FigBaseGrid.getElement`, `FigGridLayout.restoreBorderLabels` |

Own rules: the app's graph box is the plot frame plus its axis margins
(`frameToBox` / `boxToFrame`, exact both ways); text figures import as plain
text (styling dropped; FJML statistics become "{name: path}") and export as a
simple Swing HTML body; a chart whose sample is not in the workspace follows
the chosen sample; statistic tables and other figure kinds are reported and
skipped (later added: shapes, lines with arrowheads, Image figures, text
styling, Key / Anno live fields, several Layout elements and PrintLayout
scaling, see `docs/validation/ui-gaps/layout.md`); export writes the attributes listed above (FlowJo
fills its own defaults for the rest); imported grids use a 4 pt padding.

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
