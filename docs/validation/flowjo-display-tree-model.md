<!-- Behavioral description of FlowJo 10.6.2 (graph Display menu, gate size,
colour axis, workspace tree commands, ribbon, Escape) written for the
clean-room reimplementation; no FlowJo code, disassembly or decompiled text.
"App:" notes predate the 2026-11-07 batch; specs section 22 supersedes them. -->

# FlowJo 10.6.2: graph window Display menu, gate size, colour axis, workspace tree, ribbon, Escape

Read statically with `javap -p -c -constants` from the FlowJo 10.6.2 jar
(`/tmp/claude-0/fj/jar`), fjlib 2.3.0 (`/tmp/claude-0/fj/lib`) and the
`flowjodictionary*.properties` bundles. Everything below is behaviour written in
my own words. No FlowJo code, bytecode or decompiled text is reproduced.

Context, not repeated here: accelerators and dispatch are in
`docs/validation/flowjo-interaction-model.md` (table 1.2 already lists
Menu+= / Menu+- / Menu+] / Menu+[ / Menu+D / Menu+U / Menu+Shift+U /
Menu+Shift+E / Menu+F as "missing"). The layout-editor annotation flags are in
`flowjo-layout-model.md` N2. Engine specs 16-21 are also not repeated.

Confidence: **H** means the bytecode path was read end to end. **M** means the
main path was read but a detail (a callee, a constant's meaning, or runtime
layout) was inferred. **L** means inferred.

App status compares with `src/ui/App.tsx`, `src/ui/Plot.tsx` and
`src/ui/renderPlot.ts` as they stand now.

---

## 1. Graph window Display menu (D)

**D1 Menu contents.** The graph window menu bar has a "Display" menu
(`gw.menu.display`). It holds exactly seven check-box items, in this order, with
no separators:

1. Show Grid
2. Draw Large Dots
3. Show Gate Frequencies
4. Show Gate Names
5. Show Medians
6. Show Uncompensated Parameters
7. Show Event # Parameter

"Use Scientific Notation" (`gw.show.scinot`) and "Adjust color table" are
commands but are not in this menu. Each check mark is refreshed from the current
graph's settings (`GateWinMenuBar.updateDisplayChecks`).
Cite: `GWActionManager.getDisplayActions` (array of 7), `GateWinMenuBar.buildDisplayMenu`.
H. App: **missing**. There is no Display menu or equivalent toggles in the
graph panel.

**D2 Scope: per graph, saved with the population.** Every toggle changes only
the graph spec of the window it was used in. Six of them live on that graph's
`GraphEnvironment`; Large Dots lives on its `GraphSettings`. Both belong to the
population node's `GraphSpec`, so other windows and other populations are not
affected.
- The environment is written into the workspace as a `GraphEnvironment`
  element with attributes `showGrid`, `showAxes`, `showGates`,
  `showFreqOnPlots`, `showGateNameOnPlots`, `showMedians`, `showUncomped`,
  `addEventParam` and `lastYAxisName`.
- Large Dots is written as the `drawLargeDots` attribute of `GraphSettings`.
- A new graph takes its initial values from the preferences (D3-D9).
- `GraphEnvironment.updateSpecFromPrefs` can re-apply the workspace's
  preferences to an existing graph.

Cite: `GWGraphSpecAction.doAction` (each branch toggles the spec of the
controller's graph and then repaints the gate panel),
`GraphEnvironment.<init>/init/writeEnvironment`, `GraphSettings` attributes.
H. App: per-population plot settings exist (`PlotSettings`), but none of these
seven flags is among them.

**D3 Show Grid.**
- Default: off (preference `Graph/showGrid` = false).
- What it draws: one full-length line for each **labelled** (major) tick on
  each axis. Lines are vertical for X ticks and horizontal for Y ticks, across
  the whole plot. Unlabelled minor ticks get no line. Line colour comes from
  preference `Graph/gridColor`, default light grey.
- Where: the grid is painted in the editor background, after the background
  figures (the plot image) and before the gate figures. So it lies over the
  data and under the gates.

Tooltip: "Display grid lines under major axis tick marks."
Cite: `GraphEditor.paintBackground` -> `paintGrid` (skips ticks with
`AxisTick.isLabel()` false), `FJPrefsFJML$Graph.showGrid/gridColor`. H.
App: **missing** in the graph window. The layout editor has its own page grid,
which is unrelated.

**D4 Draw Large Dots.**
- Default: off (preference `Graph/drawLargeDots` = false).
- It applies only to dot, density, contour, zebra and pseudocolor plots
  (`GraphSpec.canDrawLargeDots`). Histograms ignore it.
- The flag is stored in `GraphSettings` and is passed to the native engine,
  which renders the image.
- Size: the preference `Graph/dotSize` (default 4) is never read by the Java
  code and is not written to the graph XML, so it does not set the size.
- In the one Java renderer that draws dots (`BufferedImageMaker$DotPlot`, used
  for engine-supplied SVG dot images), a normal dot is a 1x1 square and a large
  dot a 16x16 square, both in the image's own coordinates. Those coordinates are
  then scaled by plot height / `graphResolution`.

The on-screen large-dot size in the normal graph window is set by the native
engine and was not determined.
Cite: `GWGraphSpecAction` (`GraphSettings.toggleLargeDots`),
`GraphSpec.canDrawLargeDots`, `BufferedImageMaker$DotPlot.paint/setAttributes`,
`FJPrefsFJML$Graph.drawLargeDots/dotSize`. H for flag and scope, L for size.
App: **missing**. Dot plots use a fixed dot size.

**D5 Show Gate Frequencies, Show Gate Names: text content.**
- Defaults: both on (`Gates/showFreqOnPlots` = true,
  `Gates/showGateNameOnPlots` = true).
- Each gate figure carries one annotation string:
  - both on: the name on line 1 and the frequency on line 2, separated by a
    newline;
  - names only: the name;
  - frequencies only: the frequency;
  - both off: no annotation.
- Quadrant names are shortened in the annotation. For a quadrant gate whose name
  has a ":" after the first character, is at least 3 characters long, and has a
  digit as its 2nd character, only the text before the ":" is shown. For
  example, "Q1: CD4- , CD8+" shows as "Q1". The population keeps its full name.
- Frequency = the population's raw frequency of parent, multiplied by 100 and
  formatted by D6.
- When the population count is an estimate, "*" is added: "12.3*", or "12.3*%"
  when a percent sign is shown.

Cite: `Gate.getAnnotation(PopNode, boolean, boolean)`,
`Gate.getFrequencyFormatted`, `PopNode.getGateAnnotation`,
`AbstractGraphController` (gate creation sets the annotation from the
environment flags). H. App: **differs**:
- the app draws `name pct` on **one** line, joined by a space;
- the quadrant short form is not applied;
- the app's own toggles (`gateNames`/`gateFreq` in RenderOptions) are not wired
  into the graph window, only into layout items.

**D6 Frequency number format.** Defaults: preferences `Workspace/useSigFigs`
= true, `Workspace/sigFigs` = 3 (range 1-8), `Workspace/decimals` = 2
(range 0-6), `Gates/showPercentSign` = false. With significant figures on
(the default):
- If 0 < |v| < 0.01, or |v| > 399999: scientific notation with the mantissa
  to (sigFigs - 1) decimals, e.g. "5.00E-3".
- Otherwise the number of integer digits is `1 + trunc(log10|v|)`, with the
  log truncated toward zero. The value gets `sigFigs - that` decimals, never
  fewer than 0. Trailing zeros are kept (fixed number of decimals).
- The locale's decimal separator is used. Rounding is Java DecimalFormat's
  default (half-even on the binary value).
- A "%" is appended only when Show Percent Sign is on.
- Worked examples with defaults:

  | value | shown |
  |---|---|
  | 45.678 | 45.7 |
  | 5.123 | 5.12 |
  | 0.5 | 0.50 |
  | 0.05 | 0.050 |
  | 0.004 | 4.00E-3 |
  | 100 | 100 |
  | 0 | 0 |

With significant figures off: a fixed `decimals` (default 2) decimals.
Cite: `Gate.getFrequencyFormatted` -> `FJNumberFormatter.formattedPercentDouble`;
`FJPrefs.getFormatter` (builds `IntlFormatter(useSigFigs, sigFigs, decimals,
showPercentSign)`); `IntlFormatter.formattedDouble(Double, boolean)`,
`sizeOfIntegerFraction`, `sciNotationPatternString`, `decPatternString`,
`setFracDig`; `FJPrefsFJML$Workspace.useSigFigs/sigFigs/decimals`. H. The value
0 is M: it follows from log10(0) and the clamp at 0 decimals. App: **differs**.
The app always uses `toFixed(2) + "%"` (e.g. "45.68%", "0.50%"), in the graph
and in the tree.

**D7 Annotation position.**
- Default anchor: "inside" (`Gates/annotationPosition` = INSIDE).
- Inside: the annotation block is centred on the centre of the gate figure's
  bounding box.
- The other anchors are Above, Below, To Left and To Right. They put the block
  7 px outside the matching side of the bounding box: above = top minus block
  height minus 7, below = bottom + 14, left = left minus block width minus 7,
  right = right + 7. The other coordinate stays centred.
- Each line of a two-line block is centred horizontally within the block.
- A user-dragged offset (`annoOffset`) is added to the anchor position.
- A gate newly drawn on a **1-D** graph while frequencies are shown starts with
  its annotation moved up by twice the figure's font size.

Cite: `AnnotatedFig.getAnnoAnchor`, `AnnotatedFig.drawMultiLineAnnotation`,
`FJPrefs.getGateAnnotationPosition`, `AbstractGraphController` (1-D offset at
creation). H for the anchor maths, M for line centring. App: **differs**. The
app puts the label at the gate's top-left (rectangles), the top-most vertex
(polygons) or a plot corner (quadrants), then shifts it to avoid overlaps
(`placeLabel`). It has no centring, no anchor preference and no draggable
offset.

**D8 Show Medians.**
- Default: off (`Gates/showMedians` = false).
- Turning it on (or off) also updates every gate figure **currently selected**
  in that window, through `AnnotatedFig.setShowMedians`. The tooltip:
  "Draws a small black cross at the median of each dimension of each gate."
- Drawn for a gate only when its population has **more than 10 events**.
- The medians are those of the gate's population on the graph's X and Y
  parameters.
- 2-D graph: a black "+" centred on (median X, median Y), 20 px across:
  - a horizontal line from x-10 to x+10;
  - a vertical line from y-10 to y+10.
- When there is no Y median (1-D): a dotted vertical line at median X, in the
  gate's line colour, over the full plot height.

Cite: `GWGraphSpecAction` (SHOWMEDIANS branch), `AnnotatedFig.drawAnnotation`
(count > 10, `PopNode.requestMedians` on the X/Y names), `AnnotatedFig.drawXat`
(arm 20/2, black; NaN Y gives a dotted line with `medianLineStroke`),
`FJPrefsFJML$Gates.showMedians`. H.
App: **missing**.

**D9 Show Uncompensated Parameters.**
- Default: off (`Graph/showUncomped` = false).
- When off, the axis parameter lists leave out every parameter that has a
  compensated equivalent: the raw twin of a "Comp-" parameter is hidden. When
  on, the lists also include those raw parameters.
- This changes the X, Y and colour-axis lists and the Next/Previous X/Y/Colour
  order.

Cite: `ParameterList.getParameterIDs(boolean uncomped, boolean eventParam)`
(skips parameters with `getCompensatedEquivalent() != null` unless uncomped),
`AxisComboBox` reads `GraphEnvironment.getShowUncomped`,
`FJPrefsFJML$Graph.showUncomped`. H. App: **missing**. The app's axis list
(`sampleChannels`) is the file's channels plus unmixed and derived outputs. It
has no separate compensated twins and no toggle.

**D10 Show Event # Parameter.**
- Default: off (`Graph/addEventParam` = false).
- When on, the axis lists end with an extra parameter named "Event #"
  (`fj.string.eventnum`), unless the sample already has an event-number
  parameter. Its value is the event's row number in acquisition order.
  Tooltip: "Provides the row number of the event, which is useful for
  referencing the events by their order of collection."

Cite: `ParameterList.getParameterIDs` (appends the `StringDefs.EventNum` entry),
`ParameterList.addEventParameter`, `GraphEnvironment.toggleEventParam`. H for
the list, M for the value (from the tooltip). App: **missing**.

**D11 What the Display toggles do not do.** None of them is recorded as an
undoable edit: the action changes the spec and repaints, with no edit object.
None of them changes a preference.
Cite: `GWGraphSpecAction.doAction` ends with `GatePanel.inval`. M (the absence
of an undo edit was read only in this method).

## 2. Gate size and window size (S)

**S1 Increase Size / Decrease Size act on the selected gates, not the window.**
- Labels: Increase Size (`gw.gate.scale.increase`, Menu+=) and Decrease Size
  (`gw.gate.scale.decrease`, Menu+-). Tooltips: "Increase/Decrease the size of
  the selected gate."
- For each selected gate figure:
  - quadrant figures are skipped;
  - polygon figures, which include ellipses (`FigEllipse` extends `FigPoly`),
    and rectangle figures are scaled about their own centre point. The figure
    is scaled, then moved back so its centre is where it was.
- Step: x1.1 for Increase and x(1/1.1) = x0.90909 for Decrease, the same on
  both axes. Increase followed by Decrease therefore returns to the original
  size, up to pixel rounding.
- Scaling is done on the figure's screen points (integer pixels). The gate is
  then re-derived from the figure (`figChanged`), so the population is
  recomputed.
- Range gates (`FigRange`) and other figure types are not scaled.

Cite: `GWActionManager.<init>` (`GateWinScaleFigAction` with factors 1.1 and
0.9090909090909091), `GateWinScaleFigAction.doAction`. H. App: **missing**.

**S2 Reset This Graph Window's Size.**
- Label: `gw.reset.this` ("Return to the default graph size and shape").
- Closes the window's option panel set and resizes the window to its expected
  default size. The preferences `Graph/gwWidth`/`gwHeight` default to the
  graph controller's logical size; that constant holds 390 and 582.

Cite: `GWAction` (RESET -> `GateWinController.resetSize`, then
`graphResized`), `AbstractGraphWinController.resetSize`,
`FJPrefsFJML$Graph.gwWidth/gwHeight`, `GateWinController.LOGICAL_SIZE`. M
(`getExpectedSize` not decoded; which of 390 / 582 is width is not confirmed).
App: **n/a**. The app has one plot panel and no windows.

**S3 Reset All Graph Windows Size.** Applies S2 to every open graph window of
the workspace. Label: `gw.reset.all`. Cite: `GWAction` (RESETALL ->
`Workspace.resetAllSize`). M. App: **n/a**.

## 3. Colour axis (C)

**C1 What the colour axis is.**
- 2-D graph windows have a "Color Axis" panel (`ColorMapAxisPanel`) with:
  - a check box, "Click to toggle the use of Color Axis";
  - a parameter chooser (`ColorMapParameterComboBox`);
  - a colour-map chooser, default "Default (blue,green,yellow,red)";
  - min and max labels in the format `#.####`.
- When used, events are coloured by a third parameter: the graph's heat-map
  statistic parameter (`GraphSpec.setHeatMapStatParameterLongName`).

Cite: `ColorMapAxisPanel` (fields, string constants), `ColorMapParameterComboBox`.
M (the rendering is in the engine). App: **missing**.

**C2 Next Color / Previous Color (Menu+] / Menu+[).**
- Move the colour-axis parameter one step forward or back in the same parameter
  list as the axis choosers. That list follows D9 and D10.
- **No wrap.** At either end, or when no colour parameter is selected, nothing
  changes and FlowJo plays its "click" sound.
- On a change the colour parameter is set on the graph spec and the heat-map
  axis is redrawn.
- Next/Previous X and Y (Menu+K / Menu+J, Menu+Y / Menu+F10) use the same
  step-without-wrap rule.

Tooltips: "Change the color axis value to the next/previous parameter."
Cite: `GWNavAction.doAction` (PREV_COLOR/NEXT_COLOR ->
`AbstractGraphWinController.nextColorParameter`; a false result plays "click"),
`AbstractGraphContainer.incrementColorAxis`,
`ColorMapAxisPanel.incrementColorAxis`,
`ColorMapParameterComboBox.incSelectedItem`, `AxisComboBox.getNextSelection`
(index +/-1, null outside 0..n-1). H. App: colour axis **missing**. Next/Prev X
and Y **differ**: App.tsx `step()` wraps modulo the channel count.

## 4. Duplicate View (V)

**V1 Duplicate View (Menu+D, `gw.nav.duplicategw`, "Duplicate the current view").**
- First the current window's on-screen state is written into its graph spec.
- Then a **second graph window** opens for the **same population**, with a copy
  of that graph spec: same axes, plot type, display flags and so on.
- The new window is placed at the "shoulder" of the current one, offset by the
  current window's width so it sits beside it, and kept on screen.
- The two windows then have independent specs. The population's stored spec is
  replaced by a clone, so later changes in one window do not move the other.

Cite: `GWNavAction.duplicateGW` (extract, `WindowManager.getShoulderLocation`,
`PopNode.openOriginalGraph(spec, point, true)`), `GraphNode.openOriginalGraph`
(duplicate branch -> `PopNode.openDuplicate`, then `setGraphSpec(clone)`),
`PopNode.openDuplicate`. H for the flow, M for the exact placement.
App: **missing**. There is one plot panel. A second plot would need a
multi-view UI.

## 5. Workspace tree (T)

**T1 Expand All (Menu+U) / Collapse All (Menu+Shift+U).**
- Every row of the sample tree is set expanded (or collapsed) **recursively**:
  the node and all of its descendants.
- After Collapse All, only the previously selected rows that are sample nodes
  stay selected; selections below samples are dropped because those rows are
  hidden.
- Labels: Expand All / Collapse All (`ws.tree.expandall` = 85 -> Menu+U;
  `ws.tree.collapseall` = U -> Menu+Shift+U). Tooltips: "Expand/Collapse all
  tree nodes in the workspace".

Cite: `WSTreeTableAction.doAction` (TREEEXPANDALL/TREECOLLAPSEALL ->
`SampleTreeTable.collapseAll(boolean)`), `STreeTable.collapseAll`
(`STree.setExpandedDeep` on every row), `SampleTreeTable.collapseAll`
(re-selects sample nodes). H. App: **missing**. The population tree is always
fully expanded.

**T2 Expand Selection / Collapse Selection.**
- These do not work one level at a time. They expand (or collapse) each
  **selected** row together with its whole subtree.
- Then the sample list (sample tree) or the group tree table is rebuilt.
- Labels: `ws.tree.expandlevel` "Expand Selection", `ws.tree.collapselevel`
  "Collapse Selection". Tooltips: "Expand/Collapse all selected tree nodes".
  They have no accelerators, only mnemonics.

Cite: `STreeTable.collapseLevel(boolean)` (selected rows only,
`setExpandedDeep`). H. App: **missing**.

**T3 Expansion state is saved.**
- Each node's expanded flag is stored on the node (`AppNode.setExpanded`) and
  saved in the workspace as `expanded="0|1"`.
- The attribute is present on `SampleNode`, `Population`, `GroupNode` and
  `Statistic` elements, as seen in the fixtures (e.g.
  `8_color_ICS_simple.wsp`: 23 `expanded="1"` and 4 `expanded="0"`).
- It is read back on load.

Cite: `STree.setExpanded` -> `AppNode.setExpanded`; `AppNode` reads/writes the
`expanded` attribute. H. App: **missing**. The importer ignores `expanded`.

**T4 Select Equivalent Nodes (Menu+Shift+E).** For each selected node:
- The node's path (names from the sample down) is taken.
- Starting at its sample, FlowJo walks the samples of the **current group**
  (the group selected in the group pane) in that group's order, wrapping
  around, until it returns to the starting sample.
- In each sample it looks up the node at the **same name path**. Samples that
  lack it are skipped.
- The selection is first cleared. The original node and every equivalent found
  are selected. Their ancestors are expanded so they are visible.
- A node with no sample (for example a group node) yields nothing beyond
  itself. With no current group, nothing beyond the node is found.

Tooltip: "Select the equivalent nodes in the workspace."
Cite: `NodeSelectionAction.doAction` (SELECTEQUIVALENTNODES ->
`SampleTreeTable.selectEquivalents`), `SampleTreeTable.selectEquivalents(AppNode)`
(`getFullPath`, `expandAncestry`, `selectNode`),
`WSNodeMgr.getEquivalentNodes/nextEquivalentNode` (`Group.nextSample`,
`SampleNode.findChild(path)`). H. App: **missing**. The tree shows one sample;
Next/Previous Sample already keeps the path (specs 18.5).

**T5 Find (Menu+F) searches keyword values only.**
- "Find" (`ws.find`; tooltip "Search for text in the keywords of the data
  files") opens the keyword Find/Replace dialog (`KeywordFindRelpaceDialog`).
- It does **not** search population or sample names.
- Fields:
  - "Find what:" text field (`fj.find.what`);
  - "Replace with:" text field (`fj.find.replacewith`);
  - "Context:" chooser (`fj.find.context`) with "All Keywords"
    (`ws.find.allkeywords`) first, then every workspace keyword, filtered and
    sorted (`WSKeywordMgr.getFilteredSortedKeywords`);
  - an Options group with three check boxes: "Match case", "Match whole word
    only" and "Replace partial";
  - buttons Find Next, Replace, Replace All, Close and Help;
  - a "{Search Results}" table.
- Result table:
  - columns are Sample, Keyword and Value, and cells are not editable;
  - with All Keywords: one row per (sample, keyword) for every sample in the
    workspace;
  - with one keyword: one row per sample that has that keyword.
- Matching rules:
  - the find text is matched as a **literal substring**: it is regex-quoted,
    so `.` or `*` are not wildcards;
  - only the **Value** column is matched;
  - matching is case-insensitive unless Match case is on;
  - Match whole word wraps the text in word boundaries;
  - an empty find text shows every row.
- Find Next selects the next visible result row. After the last row (or with no
  selection) it goes to the first row, so it wraps. It clears the selection when
  there are no rows.

Cite: `FindReplaceDialog` (fields, `getFilterRegex`: quote, optional `\b..\b`,
`(?i)` unless case), `KeywordFindRelpaceDialog.getSearchContext/updateFilter`
(row filter on column 2 only) `/selectNextRow`,
`KeywordFindResultTableModel` (columns, rows, `isCellEditable` false). H.
App: **missing**. There is no Find.

**T6 Find Next accelerator.** `ws.find.next` = "2" gives Menu+2 by the rule in
interaction-model K1. It is also the dialog's button.
Cite: bundle. M (whether Menu+2 is reachable from the workspace was not checked).
App: **missing**.

**T7 Duplicate Population.**
- Label: `ws.population.duplicate`.
- For each selected **population** node (other node types are ignored):
  - a deep copy is made: the gate is cloned and every descendant is copied,
    with Boolean and combination descendants added after the others so their
    references resolve;
  - the copy is added as a **sibling** under the same parent;
  - it is named `ParentNode.uniqueChildName(original name)`, by the sibling
    rule in specs 6.7. "CD4" becomes "CD4-1"; a copy of "CD4-1" becomes "CD4-2".
- The sample tree is then rebuilt.

Cite: `WSDuplicateAction.doAction`, `PopNode.duplicate`,
`PopNode(PopNode)` -> `ParentNode(PopNode, true)` (children re-created from
their XML through `NodeFactory.create`). H. App: **missing** as one command. The
same result is possible with Copy and Paste onto the parent (specs 19 / 4.1).

**T8 Add Keyword (Menu+Shift+I, `ws.group.keywordadd`).**
Tooltip: "Create a new attribute-value pair for all samples in the workspace."
- One prompt (an `SDialogs.ask` text dialog): "What is the name of the keyword
  to add?" (`ws.keywordmgr.whichkey`), pre-filled with "SampleID"
  (`ws.keywordmgr.sampleid`). It has OK and Cancel. **No value field.**
- Cancel does nothing. The name is trimmed.
- The reserved names "Off", "Sample" and "Panel" get a "_" appended ("Sample"
  becomes "Sample_").
- If a keyword with that name already exists in the workspace, nothing is
  added; only a column for it is added to the tree view.
- Otherwise, if the name is not empty, every sample gets the keyword with an
  **empty value**, the keyword is registered and a column for it is added.
- Values are then typed per sample in that column, or set with "Copy value to
  group" or "Create keyword value series".
- The bundle also has "Please enter a unique keyword."
  (`ws.keywordmgr.mustbeunique`), but this path did not show it.

Cite: `WSGroupAction` (GROUPADDKEY -> `WSKeywordMgr.addKeyword()`),
`WSKeywordMgr.addKeyword()/addKeyword(String)/doAddKeyword/isDuplicateKeyword/addColumnToView`.
H for the flow, M for the reserved-name comparison (it compares against the
`StringDefs.Off/Panel` keys). App: **differs**. The app adds a key = value
annotation to the **selected sample only**, with a value field, and adds no
column.

## 6. Workspace ribbon (R)

Default layout, used when no saved ribbon configuration exists
(`WSRibbonStructure.loadDefaults`). Users can customise it ("Customize Ribbon",
"Add Band...", "Commit to Preferences"). A "Simple" mode
(`ws.ribbon.beginner`) gives a smaller ribbon, and the Preferences button is
dropped when preferences are locked or simple mode is on.

Cite: `WSRibbonStructure.loadDefaults`, `WSRibbonFrame.makeBand` (band class per
band), each `WS*Band` constructor, `WSActionManager.get*Actions`, bundle labels.
Confidence H for order and commands, M where noted. App status follows the
table.

| Tab (task) | Band (title key -> label) | Commands in order |
|---|---|---|
| FlowJo (`ws.ribbon.task.flowjo`) | Navigate (`ws.ribbon.band.flowjo`; M: the band also sets its name to the app name) | New Workspace; Add Samples... (popup when the Envoy plug-in is installed); Create Group...; *separator*; Table Editor; Layout Editor; Preferences... |
| | Experiment | Annotate Experiment... (MIFlowCyt); Add Keyword; Plate Editor |
| | Biology | Cell Cycle...; Kinetics...; Compare Populations...; Proliferation Modeling... |
| | Help | About; Workspace Links (popup); Contact FlowJo (popup); Instrumentation (popup) (M: Raindance builds show a different help list) |
| File | Document | Print...; Save; Revert (low priority); Open... (popup when Envoy is installed); Save As... (popup); *separator*; Export/Concatenate (popup: Export / Concatenate Populations, Export / Concatenate Group); Apply Template (low priority) |
| | Find | Find; FCS Scan |
| Edit | Clipboard | Cut; Copy; Paste |
| | Select | Select Samples (popup: every sample ... every twelfth); Select Equivalent Nodes; Select All |
| | Expand | Expand Selection; Expand All; Collapse Selection; Collapse All |
| Workspace | Groups | Create Group...; Copy analysis to group; Group selected samples; Copy value to group |
| | Populations | Rename...; tSNE; Nodes (popup); Plugins (popup); Inspect... |
| | Statistics | Add Statistic...; Median (popup); CV (popup); Freq. of (popup); (Raindance builds only: Poisson correction) |
| | Keywords | Add Keyword; Create group from keyword value; Create keyword value series...; Copy value to group |
| Tools | Cytometry (`band.instrumentation`) | Edit Compensation Matrix; Derive Parameters...; Check Sample Quality; Script Editor |
| | Biology | (same as above) |
| | Boolean | Create Combination Gates; Make Or Gate; Make And Gate; Make Not Gate |
| Configure (`task.settings`) | Settings | Edit Columns...; Reset Column Widths; Hide Stats (toggle); Show Compensation Nodes (toggle); Hide Platforms (toggle); Hide Derived Parameters (toggle) |
| | Font | font-name combo; font-size combo |
| | Power (`band.debug`) | Diagnostics (popup); Nodes (popup); Extra (popup) |

Taskbar (the small quick-access row above the tabs): Undo; Redo; *separator*;
Add Samples...; Create Group...; Compensation; Table Editor; Layout Editor.
Cite: `WSRibbonFrame.addTaskbarComponents`, `WSActionManager.getWSTaskBarActions`. H.

**R1 App status: differs.** `App.tsx` has a single flat toolbar:
- Add FCS files, Open workspace, Import Gating-ML, Preferences, Tables, Save
  workspace, Undo, Redo;
- then a separator;
- then Compensation, Keywords, Derived, Export, Platforms, Layout.

Suggested grouping to match FlowJo:
- quick row: Undo, Redo, Add Samples, Create Group, Compensation, Tables,
  Layout;
- **Document**: Open, Save, Import Gating-ML, Export;
- **Edit**: Cut, Copy, Paste and the selection commands;
- **Workspace**: Groups, Populations, Statistics, Keywords;
- **Tools / Cytometry**: Compensation, Derived, Platforms;
- **Configure**: Preferences.

## 7. Escape in dialogs (E)

**E1 Message dialogs (`QDialog`, used by `SDialogs`) close on Escape only when
they offer Cancel.**
- `QDialog.showDialog` registers Escape on the dialog's root pane only when the
  dialog's option set includes Cancel: Cancel, OK/Cancel, Yes/No/Cancel or
  Save/Don't Save/Cancel. On macOS it also registers Command+Period.
- The key presses the footer's Cancel button if there is one. Otherwise it
  closes and disposes the dialog, which also counts as cancel.
- OK-only notices (`SDialogs.notify*`) and Yes/No confirmations
  (`SDialogs.confirm`) do **not** close on Escape.
- Text prompts (`SDialogs.ask`, OK/Cancel: Add Keyword, rename prompts) and
  Yes/No/Cancel prompts (`SDialogs.yesNoCancel`, e.g. save on close) do close
  on Escape.

Cite: `QDialog.showDialog(Window, String, int, JComponent, JComponent[], int,
int, String, String)` (the closeable flag is true only for the four
Cancel-bearing option types), `QDialog.showDialog(..., DialogFooter, boolean,
...)` (Escape key binding: Cancel button click, else close-and-dispose),
`QDialog.getEscapeKey/getCommandPeriodKey`, option types used per `SDialogs`
method. H.

**E2 The base custom dialog (`FJDialog`) does not bind Escape.** It binds
Menu+Q (Command+Q on macOS, Ctrl+Q elsewhere) to dispose the dialog. Dialogs
built on it close on Escape only if they add their own handling. That includes
Find/Replace, Preferences-style dialogs and the gate namer.
Cite: `FJDialog.setCloseListener`, `FJDialog$1/$2` (dispose). H.

**E3 Dialogs with their own Escape handling** (found by searching every class
that compares a key code with Escape or binds the Escape keystroke):
- Subpopulation Identification (`GateNamerDialog`): Escape = Cancel
  (`doCancel`). With specs 18.2, Cancel discards the gate.
- Add Statistic (`StatDialog`): Escape bound on the root pane.
- Parameter editor's New Keyword dialog (`NewKeywordDialog.setEscapeKeyHandling`).
- The layout editor's `EditorKeys` handles Escape (interaction-model K11).

Cite: `GateNamerDialog` key listener, `StatDialog` root-pane input map,
`NewKeywordDialog.setEscapeKeyHandling`. H for which classes, M for what
StatDialog / NewKeywordDialog do on Escape (presumed close / cancel).

**E4 App status: differs.** App.tsx (own rule C17) closes the topmost menu or
dialog on Escape for every dialog. FlowJo closes only:
- Cancel-bearing message prompts (E1);
- the gate namer, Add Statistic and New Keyword dialogs (E3).

FlowJo does **not** close OK-only notices, Yes/No confirmations, Find/Replace
or other FJDialog windows (E2) on Escape. If matching FlowJo exactly matters,
narrow the rule. Otherwise keep it as an own rule and say so in the comparison
doc.

---

## Not determined

- On-screen size of large dots in the normal graph window (D4). The Java
  preference `dotSize` (4) is unused; the engine decides.
- Exact window placement for Duplicate View, and which of 390 / 582 is the
  default width (S2).
- How quadrant-gate annotations are placed: they probably go in the plot
  corners, but `FigQuad` was not decoded. Also how annotation collisions are
  handled; no avoidance code was seen in `AnnotatedFig`.
- What StatDialog and NewKeywordDialog do on Escape, beyond binding it.
- Whether any ribbon band is hidden in Simple mode beyond the Preferences
  button.
- Whether the Find dialog is modal.
