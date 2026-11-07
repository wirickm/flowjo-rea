# Graph window and axis transforms (FlowJo 10.6.2 GWCommand, TransformCommand)

Behavioural spec for the graph window commands that were PARTIAL or MISSING in
the UI audit. Read with javap on the FlowJo 10.6.2 jar (classes named per
rule) and llvm-objdump on `libNativeEngine-3.6.2.jnilib` (symbols named per
rule). Static reading only; written in our own words. Rules live in
`src/core/graphDisplay.ts`; the UI in `src/ui/GraphOptions.tsx`,
`src/ui/renderPlot.ts` and the graph window code of `src/ui/App.tsx`.
Tests: `tests/graph-display.test.ts` (unit), `e2e/graph-gaps.mjs` (browser).

Status words: **Done** (matches FlowJo, test named), **Own rule** (a deliberate
difference, reason given), **Deferred** (not built, reason given).

A general finding first: in 10.6.2 several menu commands exist only as enum
constants with a label and no action. `GWActionManager.createActions` builds
no action for `FIRSTSIBLING`, `LASTSIBLING` or `SCINOTATION`, and none of
`TransformCommand.CHANGE_PARAMETER_RANGE`, `CALCULATE_NEG_TRANSFORM_VALUE`,
`APPLY_TRANSFORM_TO_ALL_COMPS`, `REMOVE_TRANSFORM_FROM_ALL_COMPS`,
`TRANSFORM_OFF`, `AUTO_WIDTH_CALCULATE`, `DERIVE_LIN_PARM`, `DERIVE_LOG_PARM`
is referenced outside `TransformCommand` (checked by searching every class
for the constant names). Where the same behaviour is reachable another way
(transform dialog, preferences) the rule below comes from that path; where it
is not, this app's version is an Own rule.

## 1. Smoothing

### 1.1 Smooth (GWCommand.SMOOTH "Smooth")

- Classes: `SmoothAction.setChecked/setUnchecked`, `GateWinController.actionPerformed`
  (SMOOTH toggles), `GatePanel` popup (the item is added when
  `GraphSpec.canSmooth`), `GraphSpec.changeDisplayType`, `DisplayType.canSmooth`,
  `DisplayType.isSmoothedByDefault`, `GraphSpec.updateSpecFromPrefs`.
- `Graph@smoothing` is an integer. The toggle stores 13 (on) or 0 (off).
- Can smooth: every type except dot plot, contour, time series and heat map.
  Contours are always smoothed.
- Default: changing the graph type sets smoothing to 13 for contour, zebra,
  density and histograms, 0 for pseudocolor and dot plots. A new graph takes
  the preference `Graph/smoothing` (2-D, default off) and for histograms
  `Graph/smoothing1D` (default on).
- Engine: `GraphRequest::FromXML` reads `smoothing` with
  `XMLElement::BoolAttribute`, so any value above 0 means on. 2-D graphs are
  smoothed by `GHistogram2D::Smooth`, 1-D by `BasicHistogram::Smooth`; both
  build `Smoothing(true)`, whose kernel factor is the constant 13 (the
  constructor's flag selects 512 vs 64 and the kernel table holds 13 and 6).
  The kernel is the adaptive one of specs 10.5 (2-D) and 10.8 (1-D).
- flowjo-rea: **Done**. Display menu "Smooth", plot menu "Smooth"; type change
  resets to the type default; smoothed 2-D plots use the engine kernel
  (`smoothGrid`), smoothed histograms `smoothCurve`. Tests: `smoothing,
  outliers, foreground` (unit), "Smooth draws a different (smoothed) image",
  "the plot menu Smooth item toggles smoothing off", "histograms open
  smoothed" (e2e). Own rule: density plots with smoothing off draw the raw
  counts in the pseudocolor ramp (FlowJo's unsmoothed density look was not
  read).

### 1.2 Smoothing amount (GWCommand.ADJUSTSMOOTHING "Smooth")

- Classes: `GraphSpecOptionPanel` (combo "Smoothing:" with None, 6, 13, 26,
  52, 104, 208; visible for density, pseudocolor, zebra and histograms; the
  panel row exists only with the preference "support high resolution"),
  `AdjustSmoothingAction.doAction` (None stores 0, else the number).
- Because the engine reads the value as a boolean (1.1), every amount above 0
  draws the same graph in 10.6.2. The amount is kept in the workspace.
- flowjo-rea: **Done** (combo always shown, own placement). Test: "every
  smoothing amount above 0 draws the same picture" (e2e).

## 2. Show Outliers (GWCommand.SHOWOUTLIERS)

- Classes: `DisplayType.canShowOutliers(smoothed)`, `GraphSpec.canShowOutliers`,
  `OutlierAction`, `GraphSettings` (`showOutliers`, preference
  `Graph/showOutliers` default off).
- Available on contours always, and on zebra, density and pseudocolor only
  while smoothed. Not on dot plots or histograms.
- Drawing (engine `GraphSettingsSpec::FromXML` reads `showOutliers`): events
  outside the outermost level are drawn as dots in the foreground colour.
- flowjo-rea: **Done** for the availability rule; **Own rule** for the
  pseudocolor / density / zebra threshold: cells whose smoothed density is
  under the outermost 2% probability level are left empty and their events
  drawn as dots (the engine's exact cut was not read; contours keep the
  outermost contour level). Outliers are drawn from up to 20000 sampled
  events. Test: "Show Outliers on a smoothed pseudocolor draws outlier dots"
  (e2e), `outliers: contour always...` (unit).

## 3. Set Graph Resolution (GWCommand.SETGRAPHRESOLUTION)

- Classes: `GraphSpecOptionPanel` (combo "Resolution:" 256, 512, 1024, 2048,
  4096, shown with the preference "support high resolution"),
  `GraphResolutionAction.setGraphResolution`, `GraphSettings` (default 256;
  512 when the preference `Graph/highRes` is on), engine `graphResolution`.
- The histogram grid of the graph has that many cells per axis.
- flowjo-rea: **Done** for 256, 512 and 1024 (2-D grid and histogram bins).
  **Own rule**: 2048 and 4096 are offered but draw at 1024 (a 4096 x 4096 grid
  is 64 MB per plot in the browser). Tests: `resolution list and own 1024
  cap` (unit), "Set Graph Resolution 512 redraws the plot" (e2e).

## 4. Set Y Axis Range (GWCommand.YRANGE "Set Y Axis Range")

- Classes: `YAxisPanel` (scale type combo, max field 0 to 2147483647, field
  default 1000), `YAxisPanel$YScaleType` (Auto, Manual, Modal, Unit Area),
  `GateWinController.actionPerformed` YRANGE (Auto sets `setYAuto(true)`;
  Manual parses the field as an integer and calls `setYMax`), `GraphSpec.setYMax`.
- Histograms only. Modal is "Normalized To Mode" (already in the app, specs
  6.7). Unit Area is for comparing curves (not in the graph window's
  histogram options here).
- flowjo-rea: **Done** (Auto / Manual with the integer top; the count axis
  then spans 0 to that value). Tests: `# Dots ... Y max` (unit), "Set Y Axis
  Range: Manual offers a top value", "a manual Y top redraws" (e2e).

## 5. Number of dots (GWCommand.N_DOTS "# Dots:")

- Classes: `GraphSpecOptionPanel` (field 0 to 100000, dot plots only),
  `GateWinController.actionPerformed` N_DOTS (an entry of 0 becomes 100),
  `GraphSettings.init` (`FJPrefs.getNumDotsToDraw`, preference
  `Graph/dotsToDraw` default 8000), engine `dotsToDraw`.
- flowjo-rea: **Done**: the dot plot draws min(count, # Dots) events, evenly
  spaced through the population. Own rule: the choice of which events is ours
  (the engine's sampling was not read). Tests: `# Dots: 0 becomes 100`
  (unit), "dot plots draw 8,000 events by default", "# Dots sets the events
  drawn" (e2e).

## 6. Transforms (TransformCommand, transform dialog)

### 6.1 Linear Axis, Log Axis, Reset (popup on an axis)

- Classes: `TransformChangeAction.makePopup` (Linear Axis, Log Axis, plug-in
  user transforms, Reset, Customize Axis...), `changeDisplayLogLin`,
  `GParameter.resetTransformation` (RESET, for every transformation-equivalent
  sample and the parameter's uncompensated twin; tooltip "Restore the
  transform settings to those implied by the original data set").
- Linear Axis: a linear scale over the parameter's current min..max. Log Axis:
  a log scale over min..max; a minimum under 1e-4 becomes the cytometer's log
  minimum.
- flowjo-rea: **Done** (axis "T" button). Own rule: the cytometer log minimum
  is taken as 1 (Cytometer.getLogMin not traced to a value). Reset deletes the
  workspace scale so the data-set default applies in all samples. Tests:
  `Linear / Log Axis keep the parameter range` (unit), "Linear Axis switches
  the X scale", "Reset restores the data-set scale" (e2e).

### 6.2 Change Displayed Parameter Range (TransformCommand.CHANGE_PARAMETER_RANGE)

- No action in 10.6.2. The transform dialog changes the range with
  `ParmTransformCommand.DEC_MIN/INC_MIN/DEC_MAX/INC_MAX`
  (`ParameterController.decMin/incMin/decMax/incMax`): linear axes step by a
  tenth of the range (min' = (min - 0.1 max) / 0.9 and so on), other scales
  multiply or divide by sqrt(10); a log minimum of 0 steps to -10; results are
  pinned to the transform's limits.
- flowjo-rea: **Own rule**: "Change Displayed Parameter Range..." asks for
  minimum and maximum: the top becomes the maximum and the scale's
  extra-negative parameter is solved so the axis starts at the minimum
  (linear A, log M, logicle / hyperlog / arcsinh A, biex neg). A minimum the
  scale cannot show is refused. Tests: `Change Displayed Parameter Range sets
  the axis bottom and top` (unit), "Change Displayed Parameter Range sets min
  and max" (e2e).

### 6.3 Transform Off (TransformCommand.TRANSFORM_OFF)

- No action in 10.6.2. flowjo-rea: **Own rule**: a linear scale over the
  channel's 0..$PnR (menu item `tm-off`; no dedicated test, it sets the spec
  through the same path as Linear Axis).

### 6.4 Apply To All Compensated Parameters, Remove Transforms

- No action for APPLY_TRANSFORM_TO_ALL_COMPS / REMOVE_TRANSFORM_FROM_ALL_COMPS.
  The transform dialog's "Apply to Multiple Parameters" preselects
  `ParameterTransformController.getLikeParameters`: a fluorescence parameter's
  like parameters are all fluorescence parameters; a scatter parameter's all
  other non-time parameters; time's the time parameters. `applyToParameters`
  copies the transform to them in every transformation-equivalent sample.
- flowjo-rea: **Own rule** built on that rule: "Apply To All Compensated
  Parameters" copies the scale to the like parameters; "Remove Transforms"
  resets the like parameters to their data-set defaults. Tests: `like
  parameters` (unit), "Apply To All Compensated Parameters copies the scale",
  "Remove Transforms resets the like parameters" (e2e).

### 6.5 Calculate Width Basis (TransformCommand.AUTO_WIDTH_CALCULATE; ParmTransformCommand.AUTOWIDTH)

- Classes: `ParameterController.autoWidth` (arcsinh: `ArcsinhTransform.autoM`;
  biex: a copy of the parameter with `BiexTransform` neg decades 3, width -10,
  auto width on, a histogram request with an `Autowidth` element),
  `ParameterController$AutoWidthCallback` (reads `autoWidth`), engine
  `TransformedParameter::DetermineTransformationAutoWidth`.
- Engine rule: histogram of the whole sample's compensated values; the three
  lowest channels are zeroed; n = events below the channel of 0. n >= 100:
  r = the 5th percentile of the negative events; 11 <= n < 100: the 5th most
  negative event (percentile 500 / total); n < 11: W' = 0.5. Otherwise
  W' = log10(-r 10^M / T), T the top of the uncompensated parameter's scale,
  M the positive decades (the parameter default when 0). W' is clamped to 0..5
  and the width basis is -10^W' (as a float). In logicle terms W = W' / 2, the
  Parks formula W = (M - log10(T / |r|)) / 2.
- flowjo-rea: **Done** for FlowJo biex (width) and logicle (W, A kept valid).
  Own rule: exact values instead of 4096-channel bins (events in the lowest
  3/4096 of the display are dropped). Arcsinh (follow-up f2): `autoWidth`
  calls `ArcsinhTransform.autoM`, which only sets m to NaN; `getM` then reads
  log10(getMax()), so the width basis (`getWidthBasis` = -10^M) becomes
  minus the top of scale. Not data driven. **Done**: Calculate Width Basis
  on an arcsinh axis sets M = log10(T) (`arcsinhAutoM`, unit "Calculate
  Width Basis on arcsinh: M = log10(T), width basis -T"). Tests: `Calculate Width Basis: 5th percentile of the
  negative events` (unit), "Calculate Width Basis reports the width basis"
  (e2e).

### 6.6 Auto-calculate Extra Negative Decades (TransformCommand.CALCULATE_NEG_TRANSFORM_VALUE)

- No action in 10.6.2 and no engine routine (the only data-driven transform
  routine in the engine is the auto width above; the neg-decades slider in
  `TransformSliderBox` is manual).
- Re-checked (follow-up f2): `CALCULATE_NEG_TRANSFORM_VALUE` is referenced
  only by the `TransformCommand` enum (no class in the jar uses it: no
  `graphwindow.actions` handler, no transform dialog, no menu), and the engine
  has no matching routine (the only data-driven transform routine is
  `TransformedParameter::DetermineTransformationAutoWidth`).
- flowjo-rea: **Not a gap: no-op in FlowJo 10.6.2.**

### 6.7 Derive Linear / Log Parameter (TransformCommand.DERIVE_LIN_PARM / DERIVE_LOG_PARM)

- No action in 10.6.2. flowjo-rea: **Own rule**: a formula parameter
  "<parameter>_lin" = the value (linear 0..$PnR) or "<parameter>_log" =
  LOG(MAX(value, 1)) (linear 0..ceil(log10 $PnR)); names use letters, digits
  and underscore as the Derive Parameters dialog requires (specs 12.4). Tests:
  `derived linear / log parameters` (unit), "Derive Log Parameter adds a
  formula parameter" (e2e).

## 7. Gates

### 7.1 Tint (GWCommand.TINTGATE "Tint") and gate colour (GWCommand.SETGATECOLOR)

- Classes: `GateWinController.respondToActiveGateAction` (TINTGATE flips
  `Gate.setTinted`, then `gateColorChanged`; a synchronized group updates the
  gate everywhere), `gateColorChanged` (tinted: line colour = `Gate.getTint`,
  fill `ChartFill.TINTED_40`), `SetColorAction` SETGATECOLOR ->
  `setActiveGateColor` (sets the tint colour of the selected gate, of every
  sibling quad for a quad).
- flowjo-rea: **Done**: Display menu "Gate" colour and "Tint" for the selected
  gate, plot menu "Tint"; the gate outline and label take the colour, a
  tinted gate is filled at 40%. Own rules: colour and tint are kept in the
  workspace file but not written to .wsp; the synchronized-group copy is not
  made. Test: "gate colour and Tint redraw the gate", "the gate menu shows
  Tint as on" (e2e).

### 7.2 Create Gates On Peaks (GWCommand.CREATE_GATES_ON_PEAKS)

- Classes: `GatePanel` popup (histograms), `GWAction.doAction` ->
  `FlowCAPUtil.gateOnPeaks(popNode, xParm)`, `doGateOnPeaks`,
  `createSubPopGate`, `getSubRange`, `PeakFinder.findPeaks(int)`.
- The shown population's unsmoothed 256-bucket histogram of X;
  `findPeaks(32)`: flag 32 skips the small-peak rejection, so every peak is
  kept (up to 100). Each peak gives a range from its left to its right edge
  (bucket numbers rounded, converted at the bucket's position on the axis).
  Names: the parameter name when there is one peak, else "<parameter>.Pop<k>"
  with k from 0 in peak order; a derived parameter's single-peak name gets
  ".Pop". A child with the same name and range is removed and made again.
- flowjo-rea: **Done** (no-duplicate rerun, ranges in axis units). Tests:
  `every peak becomes a range named <parameter>.Pop<k>`, `one peak keeps the
  parameter name` (unit), "Create Gates On Peaks adds range gates", "running
  it again replaces the same ranges" (e2e). Note: as in FlowJo, tiny peaks of
  a few events also become gates.

### 7.3 Create Cluster Gates (GWCommand.CREATE_CLUSTER_GATES)

- Classes: `GatePanel` popup (when the X or Y parameter is named exactly
  "cluster"), `FlowCAPUtil.createClusterRangeGates`.
- top = ceil(scale max of the parameter), replaced by the parameter's $PnR
  when that is an integer; ranges "Pop<i>" = [i, i + 1) for i = 1 .. top - 1
  under the shown population.
- flowjo-rea: **Done** (plot menu item on a "cluster" axis). Test: `cluster
  ranges Pop1..Pop(top-1)` (unit). No fixture has a cluster parameter, so the
  e2e does not reach the menu item.

## 8. Colours

### 8.1 Foreground and background (GWCommand.FORECOLOR / BACKCOLOR)

- Classes: `GraphSpecOptionPanel` (colour buttons, default black / white),
  `SetColorAction`, `GraphSpec.canSetForegroundColor` (histograms, plots that
  can show outliers, dot plots; the button is off for pseudocolor), engine
  `foreColor` / `backColor` (`#000000` / `#FFFFFF`), preferences
  `Graph/foreColor`, `Graph/backColor`.
- flowjo-rea: **Done**: foreground colours dots, the histogram curve, contour
  lines and outliers; background fills the plot area. Tests: `foreground
  colour` (unit), "background colour fills the plot area", "foreground colour
  recolours the dots" (e2e).

### 8.2 Adjust color table (GWCommand.ADJUSTCOLOR)

- Classes: `GatePanel` popup (offered when the preference `Graph/adjustColor`
  is on, default off, and the graph is smoothed or a contour),
  `SetColorAction` -> `ColorTableGenerator` (rows of start colour, end colour,
  Linear / Log, Entries; Cancel, Apply, OK), preference `Graph/colorTable`.
- flowjo-rea: **Done** with **Own rule** details: the table replaces the
  pseudocolor ramp; stored in the preferences as rows
  "rrggbb-rrggbb-entries-lin|log"; the log curve is log10(1 + 9t) (FlowJo's
  curve was not read); the default rows reproduce this app's ramp. Tests:
  `colour table` (unit), "Adjust color table recolours the pseudocolor plot"
  (e2e).

## 9. Axis labels: Use Scientific Notation (GWCommand.SCINOTATION)

- No action in 10.6.2. The behaviour is the preference
  `Graph/scientificNotation` (default on; `FJPrefs.setScientific`, tooltip
  "Draw all log axis labels with scientific notation (superscripts following
  10)").
- flowjo-rea: **Done** as a preference, with an **Own rule** shortcut in the
  Display menu that sets the same preference. Off: decade labels as plain
  numbers (own format: 10, 100, 1000, ...). Test: "Use Scientific Notation off
  relabels the log axis" (e2e).

## 10. Navigation and windows

### 10.1 First / Last Sample (GWCommand.FIRSTSIBLING / LASTSIBLING)

- `FJActionManager.getFirstSiblingAction` looks the command up, but
  `GWActionManager.createActions` never creates it, so 10.6.2 has no such
  action. flowjo-rea: **Own rule**: "|<" and ">|" next to Previous / Next
  Sample jump to the first / last sample of the group that has the shown
  population (no wrap, as specs 18.5). Test: "Last / First Sample jump to the
  ends of the group" (e2e).

### 10.2 Close All Graph Windows (GWCommand.CLOSEALL)

- `GWAction.doAction` CLOSEALL -> `GateWinController.closeAll`. flowjo-rea:
  **Done**: "Close All" in each graph window title. Test: "Close All Graph
  Windows closes every graph window" (e2e).

### 10.3 Copy Image Without Transparency (GWCommand.COPYPICTURENOTRANS)

- `GWAction.doAction`: COPYPICTURETRANS and COPYPICTURENOTRANS both call
  `GateWinController.doCopy(node, transparent)`. flowjo-rea: **Done**: "Copy
  Image" now copies with a transparent background, "Copy Image Without
  Transparency" with white. Test: "Copy Image Without Transparency copies the
  plot image" (e2e).

### 10.4 Preferences (GWCommand.PREFS)

- `GWNavAction` PREFS opens the preferences. The graph-window entries used
  above are `FJPrefsFJML$Graph`: smoothing (2-D, off), smoothing1D (on),
  showOutliers (off), graphResolution (256), highRes / supportHighRes (off),
  scientificNotation (on), foreColor (black), backColor (white), dotsToDraw
  (8000), adjustColor (off), colorTable.
- flowjo-rea: **Done** for Use Scientific Notation, Smooth histograms, Dots to
  draw and Show "Adjust color table" (Preferences dialog, Graphs). Own rule:
  the resolution, outlier and colour defaults stay FlowJo's defaults and are
  not offered as preferences (they are set per graph).

### 10.5 Add Statistic (GWCommand.ADDSTAT)

- `GWAction.doAction` -> `GateWinController.openStatisticsDialog`.
  flowjo-rea: **Own rule** (unchanged): the plot menu adds the statistic
  chosen in the Statistics panel; the Add Statistic dialog belongs to the
  statistics area.

## 11. Print, Make Movie, Show in 3D

- Print (`GWPrintAction` -> `AbstractGraphWinController.doPrint`):
  **Own rule**: the plot image in a new window with the browser's print dialog
  (plot menu "Print...").
- Make Movie (`MovieAction`, `MovieGenerator`, preference
  `private_numberOfTransformGraphFrames` 300): **Own rule**: the graph of each
  sample of the group at this population, one per second, recorded from the
  canvas as a WebM video (MediaRecorder) and downloaded. FlowJo's frame
  sequences (gate or transform increments) are not reproduced. Test: "Make
  Movie records the group as a WebM video" (e2e).
- Show in 3D (`GWNavAction` SHOWCUBE): **Deferred**: a 3-D cube view needs a
  WebGL renderer and FlowJo's cube controls, which were not read.

## Summary

| Command | Status |
|---|---|
| SMOOTH, ADJUSTSMOOTHING | Done |
| SHOWOUTLIERS | Done (threshold own) |
| SETGRAPHRESOLUTION | Done (2048 / 4096 drawn at 1024, own) |
| YRANGE | Done |
| N_DOTS | Done (sampling own) |
| FORECOLOR, BACKCOLOR | Done |
| ADJUSTCOLOR | Done (curve and storage own) |
| TINTGATE, SETGATECOLOR | Done (.wsp and group sync own) |
| CREATE_GATES_ON_PEAKS, CREATE_CLUSTER_GATES | Done |
| CLOSEALL, COPYPICTURENOTRANS | Done |
| PREFS | Done (graph entries) |
| TransformCommand.RESET | Done |
| AUTO_WIDTH_CALCULATE | Done (biex, logicle; arcsinh deferred) |
| SCINOTATION | Done as preference, menu shortcut own |
| FIRSTSIBLING, LASTSIBLING | Own rule (no 10.6.2 action) |
| CHANGE_PARAMETER_RANGE, TRANSFORM_OFF, APPLY_TRANSFORM_TO_ALL_COMPS, REMOVE_TRANSFORM_FROM_ALL_COMPS, DERIVE_LIN_PARM, DERIVE_LOG_PARM | Own rule (no 10.6.2 action) |
| ADDSTAT | Own rule (unchanged) |
| PRINT, MAKEMOVIE | Own rule (browser equivalents) |
| CALCULATE_NEG_TRANSFORM_VALUE | Deferred (no 10.6.2 rule) |
| SHOWCUBE | Deferred (no 3-D view) |
