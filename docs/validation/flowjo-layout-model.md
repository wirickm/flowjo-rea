<!-- Behavioral description of FlowJo 10.6.2's layout editor written for the
clean-room reimplementation; no FlowJo code, disassembly or decompiled text.
The "App:" notes were written before the 2026-11-07 layout batch; specs
section 21 lists what is now implemented and supersedes them. -->

# FlowJo 10.6.2 Layout Editor: layout logic as behavioral rules

Scope: page model, placement, arrange commands, grid layout, iteration and batch
additions, graph annotations, snapping, nudge and undo. Read from FlowJo 10.6.2
class files with `javap -p -c -constants` (jar classes under
`com/treestar/layout/**`, `com/treestar/flowjo/application/leditor/**`,
`com/treestar/flowjo/charting/**`, `com/treestar/flowjo/core/{Iteration,PopModel}`,
`com/treestar/lib/gui/grid/FJLayoutGrid`; fjlib `com/bric/print/*`,
`com/treestar/lib/gui/undo/FJUndoManager`). This file gives behavior only, in
my own words. No code, disassembly or decompiled text is copied. Citations are
class.method names or bundle keys (`flowjodictionary.properties`).

Each rule gives a citation, a confidence (H/M/L) and an app status:
**match**, **differs** or **missing**. The app is compared through
`src/ui/Layout.tsx`, `LayoutItem`/`LayoutPlot` in `src/core/model.ts` and
`src/core/tableEditor.ts`. The app keeps a layout as an ordered list of plots
and text blocks. It composes them into a fixed 2-column grid of 460x420 px cells
(`compose`, `PLOT`) and stores no positions, page or z-order.

Units: layout coordinates are integer points (1/72 inch) at 100% zoom (see P1).

---

## 1. Page model and placement (P)

**P1 Units are points.** Paper sizes are inches x 72. Layout and figure
coordinates are integer points, so 100% zoom is print size
(`le.nav.showat100.tooltip`). A graph's plot frame is 256x256 logical units.
Cite: `CustomPaper.create`, `FigLightweightChartBox.<init>/getFrameWidth`. H. App: **differs** (pixels, fixed 460x420 cell).

**P2 Default paper.** US Letter (8.5x11 in = 612x792 pt). When the locale is
metric, A4 instead (8.2677x11.6929 in). The other papers offered are US Legal,
A5, ROC 16K, JB5 and B5. Cite: `PrintLayout.getDefaultPageFormat`,
`CustomPaper.<clinit>`. H. App: **missing**. The PDF is sized to the composed
raster.

**P3 Margins are 1 inch on every side.** The paper's imageable area is inset
72 pt on each side (`CustomPaper.DEFAULT_INSETS`, applied in the `CustomPaper`
constructor). The `Insets` argument of the `PrintLayout` constructors is never
used. Printable page: Letter 468x648 pt, A4 about 451x698 pt. Cite:
`CustomPaper.<init>`, `PrintLayout.<init>(int,int,PageFormat,Insets,int,int[])`.
H. App: **missing**.

**P4 Orientation default is portrait.** The PageFormat is created without
setting an orientation, so the Java default applies. Cite:
`PrintLayout.getDefaultPageFormat`. M. App: **missing**.

**P5 Header and footer are off by default.** When either is active, the
usable page height shrinks by that block's height plus `innerPadding` (36 pt).
Cite: `PrintLayout.getUserImageableSize`, `FJPrefsFJML$Layouts.showHeader/showFooter`
(default false), `FJPrefs.getPrintLayout`. H. App: **missing**.

**P6 Page size, scaling and page breaks.** The page used by the editor is the
user imageable size from P3/P5. Content scaling defaults to 1.0 (ScalingMode
NONE). Page breaks repeat every page-size x scale. A point lies on page
floor(coord/page)+1 in each direction. Cite:
`LayoutEditorController.getPageDimension/getPageScale/pointToPage`,
`PrintLayout.<init>` (contentScaling 1). H. App: **missing**.

**P7 Per-layout view flags and saved attributes.** Defaults: rulers on, page
breaks on, guides off, grid off, zoom 100%, placeholders off. Each layout saves
`showGrid`, `showRulers`, `showGuides`, `showPageBreaks`, `showDebugOutput`,
`scale`, `usePlaceholders`, its `BatchSettings` and its `FigList`. Cite:
`Layout.<init>`, `Layout.readProperties/writeProperties`,
`FJPrefsFJML$Layouts.<clinit>`. H. App: **missing**.

**P8 Dropping workspace nodes (the main way to add graphs).**
- The dropped nodes are sorted in sample-tree order.
- Each graph node becomes one chart figure. Consecutive statistic or platform
  nodes become one text figure, one line per statistic. The full statistic
  description is on by default (`fullStatDescription`).
- The new figures form a single row with a 30 pt gap between their extended
  bounds (bounds including axes and other dependent figures). The row is
  horizontal when the `across` pref is set (default true), otherwise it is a
  column.
- The first figure is centered on the drop point, then clamped so its
  extended bounds do not go above or left of 0. Later figures follow from it.
- All new figures are appended on top of the z-order and selected.

Cite: `LayoutEditor.addFigs(NodeList,Point,DropTargetDropEvent)`,
`FigList.distribute(Point,int,boolean,boolean)`,
`FJPrefs.getLayoutDirection` -> `FJPrefsFJML$Layouts.across`. H.
App: **differs**. "Add to layout" appends to the list, and position comes from
the 2-column grid.

**P9 Dropping onto a figure that accepts the drop.** The nodes go into that
figure (for example as an overlay on that graph) instead of creating new
figures, unless the drop is a replace drop. Cite: `LayoutEditor.addFigs`
(`getHitFig`, `Fig.willAcceptDrop`, `Fig.dropNodes`), `LEditor.replaceOnDrop`. M.
App: **missing**.

**P10 "Copy to Layout Editor" from a graph window has no cascade.** It opens
the layout editor and adds the graph through P8 at the fixed point (200,200).
The graph is centered there, so repeated copies stack on the same spot. Cite:
`GWAction.copyToLayout` (bundle `gw.copy.layout`). H. App: **differs** (appends
to the list).

**P11 Paste and duplicate offsets.**
- Pasted workspace nodes go through P8 at the last right-click point, or at
  (50,50) when there is none.
- Pasted figures: if the top-left of their bounds is outside the visible area,
  they are first moved to the visible area's top-left. Then they are offset by
  (+4,+4).
- Pasted text and images are placed at (30,50).
- Duplicate copies the selection at (+8,+8) and selects the copies.

Cite: `LEPasteAction.doAction`, `AbstractLayerDiagram.duplicateSelection`. H.
App: **missing**.

**P12 New figures go on top and adding is undoable.** A new figure is
appended to the end of the layer contents (the top of the z-order). Adding
records a `FigAddDeleteEdit`. Cite: `AbstractLayerDiagram.add(Fig,boolean)`.
H. App: **missing** (no z-order).

**P13 Default graph size.** The plot frame is 256x256 pt, or 512x512 with the
high-resolution graph pref. Axes, legend, annotation and adjunct histograms are
separate dependent figures outside the frame, so the extended bounds are
larger. Cite: `FigLightweightChartBox.getFrameWidth/getGraphSize`,
`FigFactory.makeFigChartBox`, `LEChartController.makeFigs`. M (axis figure
sizes not decoded). App: **differs** (460x420 px including margins).

**P14 Iteration default and group.** A new layout's iteration is OFF, so each
graph shows its own sample. A drop sets the iteration group to the current
workspace group when the group is the placeholder "workspaceSelection". Cite:
`FJPrefsFJML$Layouts.iterationType` (OFF), `LayoutEditor.addFigs`,
`Iteration.getGroup`. H. App: **differs**. A layout item has no own sample, and
the view always renders for a sample picked in the dialog.

**P15 Mismatch check on drop.** Each dropped graph is checked against the
layout's iteration. If the mismatch policy answer is Cancel, the drop is
abandoned. Cite: `LayoutEditor.addFigs` -> `Layout.checkForMismatch`,
`FJPrefsFJML$Layouts.mismatchPolicy`. M. App: **missing**.

---

## 2. Arrange commands (A)

**A1 Which figures align commands act on.** Align and spacing act on the
current selection minus dependent figures (axes, legends, chart annotations,
adjunct histograms). Inside the selection, only figures that report
`isAlignable` move (axes do not). All math is integer and uses the figure's own
bounds (`getX/getY/getWidth/getHeight`), not its extended bounds. A chart
therefore aligns by its plot frame, and its axes follow as dependents. Cite:
`AlignableLayerDiagram.align(Alignment)`, `Fig.isAlignable`,
`FigAxis.isAlignable` (false), `Fig.translate(int,int,boolean)` (moves
dependents). H. App: **missing**.

**A2 Align Left.** Every figure's x becomes the smallest x in the selection.
The reference is the selection extent, not the first selected figure, and not
the page margin that the tooltip mentions. Cite: `AlignableLayerDiagram.setX`,
`le.align.lefts`. H. App: **missing**.

**A3 Align Top.** y becomes the smallest y. Cite: `setY`, `le.align.tops`. H.
App: **missing**.

**A4 Align Right.** Every right edge (x+w) becomes the largest right edge.
Cite: `setRight`, `le.align.rights`. H. App: **missing**.

**A5 Align Bottom.** Every bottom edge (y+h) becomes the largest bottom edge.
Cite: `setBottom`, `le.align.bottoms`. H. App: **missing**.

**A6 Center (horizontal).** The target is the integer mean of
(x + floor(w/2)) over the alignable figures. The sum is divided by the full
selection count, including non-alignable figures. Each figure is then placed so
that x = target - floor(w/2). This is the mean of the centers, not the middle
of the extent. Cite: `setHCenter`, `le.align.hcenters`. H. App: **missing**.

**A7 Center (vertical).** Same as A6 with y and h. Cite: `setVCenter`,
`le.align.vcenters`. H. App: **missing**.

**A8 Spacing (horizontal).** Needs at least 2 figures.
1. Sort the figures by left edge.
2. step = floor((center.x of last - center.x of first) / (n-1)). A negative
   step becomes 0.
3. The first and last figures stay where they are.
4. Each middle figure's left edge becomes the previous figure's new left edge
   + step. y does not change.

The gaps are equal only when all widths are equal. Cite:
`AlignableLayerDiagram.setSpacing` with the comparator in
`AlignableLayerDiagram$1`, `le.align.hspacing`. H. App: **missing**.

**A9 Spacing (vertical).** Same as A8 with top edge, center.y and y. Cite:
`setSpacing(VERTICAL)`, `le.align.vspacing`. H. App: **missing**.

**A10 Spread (hspread/vspread) does nothing.** The commands exist
(`Alignment.ALIGN_H_SPREAD/ALIGN_V_SPREAD`, `LayoutActionManager` aHSpread and
aVSpread), but `AlignableLayerDiagram.align(FigList,Alignment)` has no case for
them. They are also not on the ribbon: `LayoutActionManager.getHAlignActions`
and `getVAlignActions` return left/right/center/spacing and
top/bottom/center/spacing only. H. App: **n/a** (do not implement, or implement
as a no-op).

**A11 Align to Grid.** Each selected figure's top-left snaps to the nearest
multiple of the grid size g (pref `gridSize`, default 36 pt):
v -> trunc((v + trunc(g/2)) / g) x g, using Java integer division. This happens
whatever the snap-to-grid setting is. Cite: `AlignableLayerDiagram.alignToGrid`,
`GuideGrid.snapPt`, `le.string.aligntogrid`. H. App: **missing**.

**A12 Align keys.** L, T, R, B and M give left, top, right, bottom and
vertical center. K gives vertical spacing and J horizontal spacing. A second L
branch (horizontal center) and a second B branch (grid) can never be reached.
Cite: `AlignableLayerDiagram.processAlignKey`; ribbon accelerators
`le.align.*.accelerator`. H. App: **missing**.

**A13 Align is one undoable edit.** Every align or spacing command records
one "Alignment" edit that snapshots the state of every figure in the layer.
Cite: `FJAlignAction.doAction`, `FigAlignEdit` (`string.alignment`). H. App:
**missing**.

**A14 There is no "Same size" command in 10.6.2.** No bundle key, LECommand
or action exists for it. H (based on absence). App: **n/a**.

**A15 Z-order and Bring to Front.** Z-order is the order of the layer's
contents list (index 0 is at the back). Bring to Front takes each selected
figure in selection order, removes it and appends it. The selection ends on
top, in selection order. Cite:
`AbstractLayerDiagram.bringToFront()/bringToFront(Fig)`. H. App: **missing**.

**A16 Send to Back.** Each selected figure, in selection order, moves to
index 0. The result reverses the selection order: the last selected figure
ends at the very back. Cite: `AbstractLayerDiagram.sendToBack()`. H. App:
**missing**.

**A17 Bring Forward and Send Backward.** For each selected figure that is not
a dependent: move it one position past the next figure that is not a
dependent, upward or downward. Its own dependents are re-inserted next to it.
Dependent figures are never moved on their own. Cite:
`AbstractLayerDiagram.bringForward(Fig)/sendBackward(Fig)`. H. App: **missing**.

**A18 When order and group commands are enabled.** Order commands need a
selection. Group needs 2 or more selected figures. Ungroup needs a selected
group. Cite: `LayoutActionManager.adjust(int,int,boolean)`. M. App: **missing**.

**A19 Reordering is one undoable edit.** Cite: `LEOrderAction.doAction` ->
`FigOrderEdit` (`le.ribbon.band.reorder`). H. App: **missing**.

**A20 Group.**
- Clones of the selected figures, in selection order, become the children of a
  new group with padding 0. The group's bounds are the union of the children's
  bounds.
- The original figures and their dependents are removed.
- The group is appended on top of the z-order (not at the members' old depth)
  and selected.
- All of this is one compound undo edit.

Cite: `LEGroupAction.doGroup`, `FigGroup.<init>(Editor,FigList,boolean,boolean)`,
`FigGroup.calcBounds`. H. App: **missing**.

**A21 Resizing a group scales its children.** A drag smaller than 5 pt in
both directions is ignored. A group cannot be rotated or reshaped. Cite:
`FigGroup.doResize/isResizable/isRotatable/isReshapable`. M. App: **missing**.

**A22 Ungroup.** The children are put back into the layout at the group's
offset, with the group's scale applied. The group is removed. Cite:
`FigGroup.ungroup`, `LEGroupAction.doUngroup`. M. App: **missing**.

**A23 Avoid Page Breaks.**
- Horizontal pass: figures are taken in order of position. A figure whose
  extended bounds cross a vertical page break is pushed right to the start of
  the next page. The push accumulates, so later figures move too.
- Vertical pass: the same with horizontal breaks, allowing 5 pt above the
  figure.
- Figures larger than a page and dependent figures are skipped.
- The passes repeat until nothing moves. The whole command is one undoable
  move edit.

Cite: `LayerDiagram.avoidPageBreaks(Dimension,double,boolean)`,
`LEAvoidPageBreakAction`, `le.document.avoidpagebreaks`. M. App: **missing**.

**A24 Locks.** Position-locked figures are skipped by drag and nudge. The
align code has no lock test, so align moves locked figures. Bundle keys:
`le.lock.position`, `le.lock.size`, `le.lock.content`. Cite:
`AbstractLayerDiagram.okToMove/getFigsToNudge`, `DragMove.continueDrag`
(FigSelection.isPositionLocked), `AlignableLayerDiagram.set*`. M. App:
**missing**.

---

## 3. Grid layout (G)

**G1 Size of a new grid.** Rows come from the pref `tableRows` (default 3)
and columns from `tableColumns` (default 4), with at least 1 of each. Cite:
`FigGridLayout.<init>(Rectangle,Editor)`, `FigBaseGrid.init`,
`FJPrefsFJML$Layouts`. M-H (rows-then-columns argument order inferred). App:
**missing**. The app's own grid is always 2 columns.

**G2 Grid defaults.** Cell padding 4 pt, grid lines drawn, cell contents
scaled with the cell, new contents auto-fitted, contents clipped to the cell,
no header row. Cite: `FJLayoutGrid.<init>(int,int,Dimension)`. H. App:
**missing**.

**G3 Filling the grid from a multi-node drop.**
- The first node goes into the cell under the pointer.
- Each next node goes into the next column. After the last column it wraps to
  column 0 of the next row (row-major order).
- Filling stops after the last cell. Nodes that do not fit are not placed.
- The filled cells become selected.

Cite: `FigGridLayout.dropNodes`, `FJLayoutGrid.getNextCell`. H. App:
**missing**.

**G4 Dropping onto a filled cell.** The node goes into the existing chart as
an overlay, unless it is a replace drop, which replaces the cell. Cite:
`FigGridLayout.dropNode(AppNode,int,int,...)`,
`FJLayoutGrid.getDropShouldReplace`. M. App: **missing**.

**G5 Charts in cells have no axes by default.** A cell holds a bare chart
(pref `minimalChartInGrids`, default true). With the pref off, it holds a full
chart with axes. Statistic nodes become text cells. Cite:
`FigGridLayout.makeChartFig/makeStatFig`,
`FigFactory.makeLEChartBare/makeFigChartBox`. H. App: **missing**.

**G6 Axes on the grid border.**
- "Show X Axis on Border": for each selected cell (r,c) that holds a chart,
  an X axis built from that chart becomes column c's border label, drawn under
  the grid.
- "Show Y Axis on Border": the chart's Y axis becomes row r's label, drawn at
  the left border.
- Each column or row has one label, and the last cell processed wins.

Cite: `FigGridLayout.addChartAxesToBorder`, `FigGridLayout$ActionHandler`,
`paintLabels`, `le.fig.gridlayout.xaxis/yaxis`. H. App: **missing**.

**G7 The Remove Axis Labels commands clear border labels.** They do not
remove axis labels from inner cells. "Remove X Axis labels"
(`le.fig.gridlayout.removerowlabel`) clears the X border label of each selected
cell's column. "Remove Y Axis labels" (`removecollabel`) clears the Y border
label of each selected cell's row. Cite: `FigGridLayout.clearBorderLabels`
together with the menu-to-flag mapping in `FigGridLayout$ActionHandler`. H.
App: **missing**. The "removal of inner labels" in the request comes from the
bare-chart default (G5) combined with border axes (G6).

**G8 How border labels are saved.** Labels are saved as a row-to-column map
(`Labels/Row@index,column`) and a column-to-row map
(`Labels/Column@index,row`), and are rebuilt from the source charts on load.
Cite: `FigGridLayout.getElement/restoreBorderLabels/rebuildBorderLabels`. H.
App: **missing**.

**G9 Other grid commands.** Make Rows or Columns Even (selected rows or
columns, otherwise all), Insert Rows or Columns (dialog), Delete Rows or
Columns, Clear Cells, Set Grid Dimensions, Set Cell Padding, Autofit Cells
(fit the grid to its contents), Edit Cell. "Extract Cells from Grid" removes
the grid and leaves each figure where it is. The checkboxes are "Scale Figs on
Cell Resize" and "Autofit to Dropped Figures". Cite:
`FigGridLayout$ActionHandler`, `FigBaseGrid.stripGridFromFigs`,
`GridUtil.makeRowsEven/makeColsEven`, `le.fig.gridlayout.*`. M. App: **missing**.

**G10 Grids can switch iteration on or off.** Cite:
`FigGridLayout.setIterationEnabled` (`le.stattable.iterationenabled`). L. App:
**missing**.

---

## 4. Iteration and batch: additions to specs 17.2 (I)

**I1 Graphs follow the iterated sample by population path.** Each chart
layer (a PopModel) stores its original node and that node's analysis path
string. On bind:
1. The current sample is chosen by the iteration type (I4 to I7).
2. The node is looked up by the same path in that sample's tree.
3. If the path is not found, the layer shows nothing.

Cite: `PopModel.<init>(LEChartController,GraphNode)` (`getAnalysisPathString`),
`PopModel.bind(Iteration)`, `Iteration.getCurrentNode`
(`SampleNode.findChild(StringUtil.stringToPath(path))`). H. App: **match**.
`renderLayout` looks up `populationPath` and shows "population not present in
this sample".

**I2 Control layers never iterate.** A layer marked as a control (legend "Set
Control") stays bound to its original node. Cite: `PopModel.bind` (isControl),
`LegendSetControlAction`. H. App: **missing**. Overlays always iterate.

**I3 Iteration off.** With iteration off (the default, P14), every layer
shows its original node. Cite: `PopModel.bind` (null iteration),
`Iteration.getCurrentSample`. H. App: **differs**. A layout item has no own
sample.

**I4 Sample iteration.** The current sample is the group sample whose ID is
the current iteration value. Every layer shows that sample. Cite:
`Iteration.getCurrentSample(Sample,String,int)`. H. App: **match**.

**I5 Panel iteration keeps each graph's position in the panel.**
- offset = (index of the graph's original sample in the group) mod N.
- The panel starts at floor(index of the iteration value / N) x N.
- The graph shows the sample at panel start + offset. If that is past the
  end of the group, it shows nothing.

So a layout built from tubes 1..N of one panel shows tubes 1..N of every
panel. Cite: `Iteration.getSampleByPanel`, `Iteration.getSampleModulo`,
`PopModel.getPanelModulo`. H. App: **differs**. The app renders every layout
item for every sample of the panel (`iterate` + `renderLayout` per sample).

**I6 Keyword iteration without a discriminator.**
- Take the graph's original sample S and its keyword value v0.
- k = S's position among the group samples whose keyword equals v0.
- The graph shows the k-th sample among those whose keyword equals the
  current value.

So several tubes per keyword value map across values by position. Cite:
`Iteration.getSampleByKey`. H. App: **differs**. The app renders all items for
every sample that has the value.

**I7 Keyword iteration with a discriminator keyword D.** The graph shows the
sample whose iteration keyword equals the current value and whose D equals the
original sample's D. Cite: `PopModel.bind`
(`Group.findSample(type,value,keyword,discriminator,discValue)`),
`Iteration.findSampleByKey`, `KeywordIterationDialog`. M-H. App: **missing**.

**I8 Iteration values.** For keyword iteration: the group's unique values of
the keyword (from the all-samples group when the group is missing). Otherwise:
the group's sample IDs in group order. Cite: `Iteration.getIterVals`. H. App:
**match** for keyword and sample; the value order is not verified
(`Group.getUniqueKeywordValues` not decoded).

**I9 Iteration keys.** In the layout editor: PageDown next value, PageUp
previous, Home first, End last. Cite: `LayoutEditor.isIterationControl/dispatchKeyEvent`,
`Layout.incrementIteration`. H. App: **missing**. The app uses a sample select.

**I10 Batch tiles and multiple pages per iteration value.**
- Each iteration value renders a clone of the whole layout as one tile.
- With pages placed (separate pages, or printer output), the tile pitch is
  the layout's right and bottom extent rounded up to whole pages:
  (floor(right/pageW)+1) x pageW, and the same for height. A layout spanning k
  pages therefore takes k pages per value. A layout that ends exactly on a page
  edge gets one extra page.
- Otherwise the pitch is max(bounds+1, size) + 10 pt in each direction.
- Across: column = i mod nCols, row = i div nCols. Down swaps them. The
  minor count is ceil(nTiles/N) for the chosen N.

Cite: `Batch.getLayoutOffset`, `Batch.setBatchDimension`, `Batch.processTiles`.
M-H. App: **differs**. `tilePositions` places tiles, but there is no page pitch
and the app's tiles are composed rasters.

---

## 5. Graph annotations in layouts (N)

These are checkboxes in the graph definition dialog's Annotation tab. Labels
come from `le.annotation.*` (`GraphDef` constants).

**N1 Show Annotation.** Shows a text annotation attached to the chart: a
dependent FJML text figure that can use tokens. It is saved as
`Annotation/WindowPosition@displayed`. Cite: `AnnotationPanel.install/extract`,
`FigChartAnnotation`. M (the default text was not determined). App:
**missing**. The app writes a fixed title: file / population (events).

**N2 Show Gates, with Frequencies, with Names.**
- `showGates` draws the gates defined on this population.
- `showFreqOnPlots` adds each gate's percentage.
- `showGateNameOnPlots` adds each gate's name.
- Frequencies and Names can only be set while Show Gates is on.
- All three are saved on `Graph/GraphEnvironment`.

Cite: `AnnotationPanel.install/extract/adjust`. H for the flags and enabling,
M for the drawing. App: **differs**. Gates, names and counts are always drawn
(`drawableGates`) and cannot be switched off per item.

**N3 Show Ancestry.**
- A row of small charts beside the main chart, one per ancestor level (the
  node's depth), each 140x140 pt.
- The row starts 8 pt right of the main chart. It moves right by 128 pt when
  adjunct histograms are shown, and down by the legend height when the legend
  is shown.
- "Horizontal" lays the charts in a row, otherwise in a column.
- Only enabled when the node's depth is above 0 and the chart is not a
  platform or overlay chart.

Cite: `FigChartRow.adaptToChart/getDepth/setHorizontal`,
`AnnotationPanel.adjust`. M. App: **missing**.

**N4 with Backgating.** The ancestry charts overlay the current population on
each ancestor. Variants: large (`le.chart.backgatelarge`) and contours
(`le.chart.backgatecontours`). Only enabled while ancestry is on. Cite:
`FigChartRow.isBackgating/setBackgatingLarge/setBackgatingContours`,
`AnnotationPanel.adjust`. M. App: **missing**. The app's overlays are manual
backgating per item.

**N5 Show Adjunct Histograms.** 1D distributions of the X and Y parameters
along the edges of a 2D plot, as two dependent figures. Saved as
`showAdjunctHistograms`. Cite: `FigChartAdjunctHistogram`,
`LEChart.areAdjunctHistosDisplayed/showAdjunctHistograms`. M. App: **missing**.

**N6 Show Multigraph.** A grid of other parameter combinations for the same
populations. Types: histograms, all-by, NxN, half NxN, slinky. Plots can be
dot, pseudocolor or contour. At most `multiGraphLimit` (10) parameters. Cite:
`FigChartGrid`, `ChartCommand` (`le.chart.multigraph*`, `le.chart.nxn`,
`le.chart.allby`, `le.chart.slinky`), `FJPrefsFJML$Layouts.multiGraphLimit`. M.
App: **missing**.

**N7 Hide Ticks, Numbers, Label: the axes string.** One `showAxes` string
holds these settings:
- X letters in lower case: t (ticks), n (numbers), l (label), each present
  only when shown.
- Y letters: the same in upper case.
- "H" is appended when Show Axes is off. An empty string is written as "o".
- Default "tnlTNL" (pref `axesLabels`).

Cite: `AnnotationPanel$AxisAnnoPanel.showAxes`, `AnnotationPanel.getShowAxes`,
`FJPrefsFJML$Layouts.axesLabels`. H for the encoding, M for which case is
which axis. App: **missing**.

**N8 Custom axis label text.** A user axis label is saved as the `label`
attribute on the axis element. Cite: `AnnotationPanel.extract/getXAxisElement`.
M. App: **missing**.

---

## 6. Snapping, nudge and undo (S, U)

**S1 Nudge.**
- Arrow keys, including the keypad arrows, move the selection by 1 pt.
- Alt doubles the step, Ctrl/Cmd doubles it, Shift triples it. The factors
  multiply, so the possible steps are 1, 2, 3, 4, 6 and 12 pt.
- Position-locked figures are skipped. Dependents move with their owners.
- Nudging needs the gate-edit permission; without it FlowJo shows an
  authorization failure.

Cite: `EditorKeys.keyPressed/nudge`, `AbstractLayerDiagram.nudge/getFigsToNudge/translateFigList`.
H. App: **missing**.

**S2 Nudge is not recorded as an undo edit.** No edit is added anywhere in
the nudge path. Cite: `EditorKeys.nudge`, `AbstractLayerDiagram.nudge`. M.
App: **missing**.

**S3 Other keys.** Delete or Backspace deletes the selection. Esc runs the
escape action. Space goes to the controller. PageUp, PageDown, Home and End
control iteration (I9). Cite: `EditorKeys.keyPressed/isDeleteKey`. H. App:
**missing**.

**S4 Snapping a drag to guides.** While guides are shown, a moved selection's
enclosing rectangle snaps to the nearest guide when its left or right edge
comes within 30 pt (`SNAP_RADIUS`). The same applies to the top or bottom
edge. Resizing snaps to guides in the same way. Cite: `DragMove.continueDrag`,
`LayerGuides.snap/snapResize`. H. App: **missing**.

**S5 Guides.** A new layout has one vertical and one horizontal guide, both at
250 pt. There are at most 8 guides. Guides are dragged in from the rulers.
Cite: `LayerGuides.<init>` (MAXGUIDES 8), `GuideDrag`. M-H. App: **missing**.

**S6 Grid.** The grid size is 36 pt (pref `gridSize`). Show Grid draws light
grey lines at that pitch. The `snapToGrid` pref (default false) sets
`GuideGrid` to snap, but no drag path calls the grid snap. Only Align to Grid
(A11) uses the grid. Cite: `GuideGrid.<init>/snap`, `LayerGrid.<init>`,
`FJPrefsFJML$Layouts.gridSize/snapToGrid`. M. App: **missing**.

**S7 Drag can be held to one axis.** A move can be limited to horizontal or
vertical. Cite: `DragMove.setConstraint`. L (the modifier key was not decoded).
App: **missing**.

**U1 Each layout has its own undo history.** Each layout owns its undo
manager (`Layout.fUndoMgr`, created by `LEditor.makeUndoManager` as an
`LEUndoManager`). No limit is set, so the Swing default of 100 edits applies.
After undo, redo, add or discard, the editor's action enablement is refreshed.
Cite: `Layout.getUndoMgr`, `LEUndoManager.undo/redo/addEdit/adjust`. H for per
layout, M for the limit. App: **differs**. The app has one workspace-wide
history of 100 entries (`src/ui/history.ts` HISTORY_LIMIT), shared with all
other edits.

**U2 How edits are grouped.** Edits collect into a compound edit until it is
closed (`addAndCloseEdit`, `endCurrentEdit`). Insignificant edits are dropped.
Undo or redo first closes an edit that is still in progress. Cite:
`FJUndoManager.addEdit/addAndCloseEdit/startNewEdit/endCurrentEdit/undo`. H.
App: **differs** (one snapshot per change).

**U3 What can be undone.** Add and delete (`string.deletion`), drag move,
resize, align (`string.alignment`), reorder, group (compound), and Avoid Page
Breaks. Cite: `FigAddDeleteEdit`, `FigMoveEdit`, `FigResizeEdit`,
`FigAlignEdit`, `FigOrderEdit`, `LEGroupAction.doGroup`,
`LayerDiagram.avoidPageBreaks`. M. App: **differs** (list edits only).

**U4 Temporary layouts have undo off.** Layouts built only for copy or print
get a fresh undo manager with undo disabled. Cite: `Layout.<init>(Workspace,FJUndoManager)`,
`AbstractGraphWinController.doCopy`. H. App: **n/a**.

---

## Rule counts

| Area | Rules | match | differs | missing | n/a |
|---|---|---|---|---|---|
| 1 Page model and placement (P) | 15 | 0 | 5 | 10 | 0 |
| 2 Arrange (A) | 24 | 0 | 0 | 22 | 2 |
| 3 Grid layout (G) | 10 | 0 | 0 | 10 | 0 |
| 4 Iteration and batch additions (I) | 10 | 3 | 4 | 3 | 0 |
| 5 Annotations (N) | 8 | 0 | 1 | 7 | 0 |
| 6 Snapping, nudge, undo (S, U) | 11 | 0 | 3 | 7 | 1 |
| **Total** | **78** | **3** | **13** | **59** | **3** |

---

## Minimal implementable model (priority order)

1. **Positioned items and a page.**
   - Add `x, y` (points) and an optional `w, h` to `LayoutItem`. Array order
     is the z-order (index 0 at the back). Add optional locks
     `{position, size, content}`.
   - Add `LayoutPage { paper: 'letter' | 'a4'; orientation: 'portrait' | 'landscape'; margin: 72; header/footer: off; scale: 1 }`.
     Usable page: 468x648 pt (Letter) or 451x698 pt (A4).
   - Render with page breaks. Export a vector PDF page by page instead of
     today's single composed raster. (P1 to P7)
2. **Placement rules.**
   - `addGraphs(items, point)`: lay the items in a row (or a column when
     `across` is off) with a 30 pt gap between extended bounds. Center the
     first item on the point, clamp it to 0 or more, append on top, select the
     new items.
   - "Add to layout" uses the point (200,200). Paste uses the right-click
     point, else (50,50). Pasted figures get (+4,+4) and duplicates (+8,+8).
   - The default graph frame is 256x256 pt with axes outside it. (P8 to P13)
3. **Arrange commands.** Align L/R/T/B by the selection extent. Center by the
   integer mean of the centers. Spacing by the center span, stepping left (or
   top) edges with the ends fixed. Align to Grid at 36 pt. Each is one undo
   step. Leave out Spread, or make it a no-op. (A1 to A13)
4. **Z-order and groups.** Front (append in selection order), Back (insert at
   0 in selection order), Forward/Backward one step, carrying dependents.
   Group = clones in a new group placed on top. Ungroup puts the children back.
   (A15 to A22)
5. **Nudge, snapping and guides.** Arrows move 1 pt, with Alt x2, Ctrl/Cmd x2
   and Shift x3. Guides at 250 pt, at most 8, 30 pt snap radius on the
   selection's edges. Optional grid display at 36 pt. (S1 to S6)
6. **Iteration binding.**
   - Give each layout plot an `ownSampleId` (the sample it was added from) and
     a per-layer `control` flag.
   - Iteration modes: off (own sample); sample; panel (own index mod N inside
     the current panel); keyword (position k among the samples with the same
     value, or matching on a discriminator keyword).
   - Keep the lookup by `populationPath`.
   - PageUp/PageDown/Home/End step the value.
   - Batch: one tile per value, with the tile pitch rounded up to whole pages
     when pages are placed. (I1 to I10)
7. **Per-layout undo** with compound edits for multi-figure commands. A 100
   limit is fine. (U1 to U3)
8. **Grid figure.** R x C cells (3x4 default), 4 pt padding, row-major fill
   from the drop cell, bare charts in cells, X/Y axes per column/row on the
   border, remove-label commands that clear those border axes, even rows and
   columns, insert, delete, extract. (G1 to G9)
9. **Annotation flags per graph.** `showGates`, `showFreqOnPlots`,
   `showGateNameOnPlots`, the `showAxes` string (default "tnlTNL"), custom axis
   labels, and the annotation text. Later: ancestry with backgating, adjunct
   histograms, multigraph. (N1 to N8)
10. **Avoid Page Breaks** and the mismatch check on drop. (A23, P15)

## Not determined

- The default text of the chart annotation (`FigChartAnnotation`, N1).
- Exact sizes of the axis figures (`FigXAxis`, `FigYAxis`), so the full
  extended bounds of a dropped graph (P13). The exact arithmetic of the
  ancestry row (N3).
- Which axis the lower-case letters in `showAxes` belong to (assumed X, N7).
- The ordering of `Group.getUniqueKeywordValues` (I8).
- The modifier keys behind the ribbon accelerators, and the key that holds a
  drag to one axis (A12, S7).
- Whether nudge is ever folded into an undo edit elsewhere. None was found
  (S2).
- The 5 pt height adjustment applied to the tile offset in `Batch.processTiles`
  (its condition was not decoded).
- Orientation is portrait only by inference from the Java PageFormat default
  (P4).
- `.wsp` layout XML (Layout/FigList elements) was not mapped to the app's
  model. The app ignores layouts in `.wsp` files (comparison A21).
