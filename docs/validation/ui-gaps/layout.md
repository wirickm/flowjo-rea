# Layout editor UI gaps (FlowJo 10.6.2 LECommand and ChartCommand)

Behavioural spec of the FlowJo 10.6.2 Layout Editor commands that were
PARTIAL or MISSING in flowjo-rea, decoded with `javap` from the FlowJo 10.6.2
jar (`com.treestar.flowjo.application.leditor.*`, `com.treestar.layout.*`,
`com.treestar.flowjo.charting.*`, `com.treestar.lib.*`) and written in our own
words. Class and method names are given so each rule can be checked; no
bytecode or decompiled code is reproduced. Earlier layout rules stay in
`docs/validation/flowjo-layout-model.md`, `docs/validation/flowjo-figlist-format.md`
and `docs/validation/flowjo-engine-specs.md` sections 21, 24 and 25.

Implementation: `src/ui/Layout.tsx` (editor), `src/core/layoutArrange.ts`
(geometry: handles, resize, zoom, page scaling, paste offset, unique names),
`src/core/layoutFigures.ts` (figure properties, lines and arrowheads, special
characters, live text, header / footer, figure presets, the layout list),
`src/core/wspLayout.ts`, `src/core/wsp.ts`, `src/core/wspWriter.ts` (.wsp).
Tests: `tests/layout-gaps.test.ts` (unit), `e2e/layout-gaps.mjs` (browser);
follow-up round: `src/core/layoutTables.ts`, `layoutPlate.ts`,
`layoutPrefs.ts`, `src/ui/LayoutObjects.tsx`, tests
`tests/followup-layout.test.ts` and `e2e/followup-layout.mjs`.

Status words: **Done** (with test), **Own rule** (deliberate difference and
why), **Not a gap** (FlowJo 10.6.2 does nothing), **Deferred** (why). Test names: `u:` = `tests/layout-gaps.test.ts`,
`e:` = a check in `e2e/layout-gaps.mjs`.

## Summary

| Status | Count |
|---|---|
| Done | 79 |
| Own rule | 14 |
| Not a gap (no-op in FlowJo 10.6.2) | 3 |
| Deferred | 0 |

(96 gap rows; several Done rows also carry an own-rule note, given in their section.)

## 1. Resize, locks and selection

### 1.1 Resize handles; LOCKSIZE "Lock Size"; LOCKCONTENT "Lock Content"

Proof: `Fig.pointToHandleIndex`, `Fig.resizeClick`, `Fig.shouldStartResize`,
`Fig.MIN_SIZE`, `ResizeDrag.<init>/continueDrag/complete`,
`FigEditable.doResize`, `Editor.isConstrainedDrag`, `LELockAction.doAction`,
`Fig.lock/getLock/lockSize/lockContent`, `Fig.getElement` (`sizeLock`,
`contentLock`, `aspectRatioLock`).

- A selected figure has handles numbered 1..9 row by row; a point within 6 pt
  of the left / centre / right (top / middle / bottom) picks the column (row).
  Only the four corners (1, 3, 7, 9) resize; edge midpoints act like the
  inside (move).
- Dragging a corner keeps the opposite corner fixed; the box is the rectangle
  between that corner and the pointer, so dragging past it flips the box.
  Figures are at least 4 pt each way.
- Shift (without Ctrl), or a figure whose aspect ratio is locked, keeps the
  aspect ratio: the pointer is moved to the closest point on the diagonal
  through the fixed corner with the figure's starting slope.
- A resize is one undo step (`FigResizeEdit`).
- Lock Size: a size-locked figure does not start a resize. Lock Content: the
  figure's content cannot change. Lock Position: as before (specs 21.2 A24).
  Each lock command toggles all selected figures to the opposite of the
  first selected figure's state, as one undo step.
- .wsp: `lock`, `sizeLock`, `contentLock` are written but FlowJo 10.6.2 does
  not read them back; `aspectRatioLock` is read and written.

Status: **Done** (u: resize handles tests; e: "dragging the bottom-right handle
resizes", "Shift-drag keeps the aspect ratio", "Lock Size hides the handles").
Lock Content disables every chart and text control of the figure in the
editor (own reading of "content"). Charts, text, shapes and images all resize;
a chart's image is stretched to the new box (own: FlowJo re-lays out a chart's
axes inside the new frame).

### 1.2 SELECT_ALL "Select All", SELECT_INVERT "Invert Selection"

Proof: `LESelectionAction.doAction` (`QuadLayer.selectAll`,
`QuadLayer.toggleSelection`), dictionary `le.select.all.accelerator = 65`.

Select All selects every figure of the layout (Ctrl/Cmd+A); Invert Selection
selects the unselected figures and deselects the selected ones. Both act only
while the layout canvas has focus.

Status: **Done** (u: "Invert Selection"; e: "Ctrl+A selects every figure",
"Invert Selection selects the others").

### 1.3 COPYTRANSPARENT, COPYNOTRANSPARENT, PASTE, CUT (and Copy)

Proof: `LECopyAction.doAction`, `FJClipboardUtil.copy/addImageToClipboard`,
`LEPasteAction.paste/addText`, `LECutAction.doAction`; accelerators C, V, X.

- Copy puts the focused figures, or every figure when none is selected, on
  the clipboard twice: as figures (with their dependents) and as an image of
  their union bounds. The plain Copy uses the preference "copy transparent";
  Copy Selection With Transparency writes a PNG with a transparent background,
  Without transparency an opaque JPEG.
- Cut copies the selected figures and removes them (one undo step).
- Paste of figures: if the copied figures' top-left is outside the visible
  part of the layout they are first moved so it is at the visible top-left;
  then all move by (+4, +4); they become the selection. A pasted text becomes
  a text figure at (30, 50); a pasted image or image file becomes an image
  figure at (30, 50) at its own size.

Status: **Done** for Copy / Cut / Paste within and between layouts of the
workspace (u: "Paste: +4 pt when ..."; e: "Copy + Paste adds a copy 4 pt
right and down", "Cut removes the selection", "Paste after Cut puts it
back"). **Own rule** for the two image copies: the browser clipboard takes
PNG only, so "Without transparency" is a PNG on white instead of a JPEG; when
the browser refuses clipboard access the image is downloaded instead. Paste
reads the system clipboard (image, then text) only when the layout clipboard
is empty.

## 2. Figure properties and shapes

### 2.1 FIGPROPERTIES "Properties...", COLORFILL "Fill", COLORLINE "Line", COLORGRAD "Gradient", LINEWEIGHT "Line Weight", LINESTROKE "Line Style", GRADIENTTYPE "Gradient Type"

Proof: `LEColorAction.setColor/doAction` (`FigList.setFillColor`,
`setLineColor`, `setGradientColor`), `LEFigPropAction`, `LineWeight`
(None, Hairline, Normal, Heavy, Very Heavy), `StrokeFactory` (widths 0, 0.5,
1.5, 4, 8; dash arrays 10/10 and 20/20), `StrokeFactory$LineStyle` (Solid,
Dotted, Dashed, Long-dashed, Complex, Dot-dashed), `GradientStyle` (none,
horizontal, vertical, diagonal), `Fig.getElement` attributes `fill`, `stroke`,
`lineWeight`, `lineStyle`, `gradientColor`, `gradientStyle`.

- Each command applies to every focused figure as one undo step; the colour
  buttons preview on roll-over (not reproduced).
- Line weights: None 0, Hairline 0.5, Normal 1.5, Heavy 4, Very Heavy 8 pt.
- Line styles: Solid, Dotted, Dashed (10 on 10 off), Long-dashed (20 on 20
  off), Complex, Dot-dashed.
- Gradient: the fill runs from the fill colour to the gradient colour, left to
  right (horizontal), top to bottom (vertical) or corner to corner (diagonal).
- New shapes take the preference line / fill / gradient colours
  (`FigFactory.createNewFig`).

Status: **Done** (e: "Figure Properties set fill, line weight, line style and
gradient"; u: wsp shape round trip). **Own rule**: the properties are an
inline row under the toolbar, not a dialog; the dotted, complex and
dot-dashed dash patterns are our own (not read); new shapes use a black
Normal line and no fill (FlowJo: preference colours). Properties on a chart
draw a frame around the chart box; fills under charts are hidden by the
chart's white plot.

### 2.2 ARROWHEAD_FORWARD, ARROWHEAD_BACKWARD, ARROWHEAD_DOUBLE, ARROWHEAD_NONE; drawing tools

Proof: `LEFigArrowheadAction.doAction`, `FigLine` (`x1 y1 x2 y2`, `arrow`,
`arrow_width = arrow_height = 18`, `paintArrowhead`, `trackDrag` angle step
pi / 8), `FigLine$ArrowHead` (Forward, Backward, Double-headed, None),
`FigFactory.createNewFig` and `makeFig` (Rectangle, RoundRect, Oval, Ellipse,
Line, Diamond, Triangle).

- A line runs from its first to its second point; Forward puts a filled
  18 x 18 pt triangle in the line colour with its tip on the second point,
  Backward on the first, Double-headed on both, None none.
- Shift while drawing a line snaps its angle to a multiple of 22.5 degrees.
- .wsp: `<Line x1= y1= x2= y2= arrow="Forward|Backward|Double-headed|None">`
  plus the common attributes; `<Rectangle>`, `<RoundRect>`, `<Ellipse>`
  (`<Oval>` read as an ellipse) with bounds.

Status: **Done** for rectangle, rounded rectangle, ellipse, line and arrow
(e: "an arrow is a line with a forward arrowhead", "arrowheads: ...",
"rectangles, ellipses and lines are figures"; u: arrowheads, line snapping,
wsp round trip). **Own rule**: Insert places a new shape at (30, 50),
144 x 72 pt (lines 144 pt long), to be resized with the corner handles,
instead of drawing it by dragging; diamonds, triangles and polygons are not
offered.

### 2.3 FIGPRESETAPPLY "Apply", FIGPRESETCREATE "Add", FIGPRESETREMOVE "Delete"

Proof: `LEFigTemplateAction.doAction`, `LEditor.doCreateFigPreset`
(`Fig.makePreset`, name `le.figpreset.new` = "New Preset" made unique with
`NameUtil.uniqueName`, added at the top of the list), `doApplyFigPreset`
(every focused figure, one undo step), `doDeleteFigPreset`.

Status: **Done** (u: "figure presets copy the properties and text font";
e: "Fig Presets: Add from one figure, Apply to another"). **Own rule**: a
preset holds the figure properties and the text font; FlowJo's chart and
statistic-table presets also carry chart settings. Presets are saved with
the workspace (FlowJo keeps them in preferences).

## 3. Charts after placement

### 3.1 ChartCommand.XAXIS "Chart X Axis", ChartCommand.YAXIS "Chart Y Axis"; population change; ChartCommand.REMOVEDATA

Proof: `ChartCommand` (`le.chart.xaxis`, `le.chart.yaxis`,
`le.chart.removedata` "Remove the data references from this chart, leaving
it a drop box for future data"), `LERemoveDataAction`, `LEChartController`
(graph spec), dropping a population on a chart (`LEditor.addFigsFromDrop`).

Status: **Done** (e: "Chart Y Axis changes the placed chart", "the chart can
switch population"). **Own rule**: the population is chosen from a list of
the chart's sample's populations instead of dropped from the workspace; an
emptied chart shows "Empty chart" and takes data again from that list.

### 3.2 OPENGRAPH "Open Original Graph"

Proof: `LENavAction.doAction` (`QuadLayer.openOriginalGraph`), accelerator O,
tooltip "Show this population in the gate editing window".

Status: **Done**: the layout closes and the chart's sample and population open
in a graph window (Ctrl/Cmd+O) (e: "Open Original Graph closes the layout
and selects the chart's population").

### 3.3 Legend, ancestry direction, backgating options

- ChartCommand.SHOWLEGEND "Legend" (`le.chart.legend`: toggle the legend of
  the chart). **Done** as a per-chart toggle (default on) of the overlay
  legend. **Own rule**: the legend stays inside the chart instead of being a
  separate legend figure.
- LECommand.SHOWHORIZONTAL, ChartCommand.BACKGATINGHORIZ "Horizontal",
  BACKGATINGVERT "Vertical" (`le.chart.showhorizontal`,
  `le.chart.backgate.horizontal/vertical`, `FigChartRow`; .wsp
  `Ancestry@horizontal`): the ancestry charts in a row to the right or a
  column below. **Done** (e: "Vertical ancestry puts the ancestry charts
  below").
- ChartCommand.BACKGATELARGE "Show Large Dots", BACKGATECONTOURS "Show
  Contours": the backgated population drawn as large dots, or as contours.
  **Done** (controls; contour drawing reuses the contour plot).
- LECommand.REMOVE_LAYER "Remove Layer" (`le.chart.remove.layer`): an
  overlaid population is taken off the chart. **Done** (control on charts
  with overlays).
- LECommand.SET_CONTROL "Set As Control" (`le.chart.set.control`).
  Proof: `FigLegend.buildPopup` (a check box item for the selected legend
  rows), `LegendSetControlAction` (`LegendSpec.setControl` on each, then the
  chart re-evaluates), `PopModel.bind(Iteration)`: when the layout iterates,
  every layer moves to the iteration's sample except a control layer, which
  keeps its original node. So a control layer is a fixed reference (for
  example an unstained sample) overlaid on every iterated chart; it does not
  change scaling. .wsp: `DataLayer/LegendSpec@control`. **Done**: the
  Legend dialog lists the overlaid layers with a "Set As Control" check
  box (`LayoutPlot.controls`); a control layer is drawn from the chart's own
  sample while the others follow the iteration (`renderLayout`). Test: e2e
  followup-layout "Legend Properties ..." (dialog); the binding rule is the
  same as the statistic table's (unit "iteration moves non-control rows").
  Uncertain: no e2e of an iterated overlay (needs a backgated chart).
- LECommand.OVERLAY "Overlay Mode" (`prefs.graphs.overlays`, "Sets default
  histogram mode for overlays"). Proof: `PrefsGraphs` (a combo of
  `NewOverlayEnum` AUTO_OVERLAY / MODAL / UNIT with values auto / modal /
  unit stored in `FJPrefsFJML$Graph.histoOverlayScale`, default
  `YScaleType.AUTO`), `GraphSpec.defaultGraphSpec` (a new graph's Y axis
  scaling = `YAxisPanel$YScaleType.fromString(value)`, which matches the
  keys auto, manual, modal, unitarea exactly and otherwise returns AUTO),
  `HistoScalingUtil.setGraphSpecForHistoOverlay` (Auto: every layer counted
  on one axis up to the tallest layer, then the axis is fixed; Modal: each
  layer normalised to its mode). Rule: Modal makes new histograms Normalized
  To Mode; Auto keeps counts; Unit falls back to Auto in 10.6.2 (its value
  "unit" is not "unitarea"). **Done**: "Overlay Mode" select in the Show &
  Hide band, kept as a preference (browser storage); a histogram added to the
  layout ("Add to layout") with Modal gets Normalized To Mode
  (`overlayNormalize`). Tests: unit "Overlay Mode: only Modal normalises";
  e2e "Overlay Mode is a preference". Own rule: the preference lives in the
  layout editor (FlowJo: Preferences > Graphs) and applies to layout charts
  only.
- LECommand.PROPERTIES "Properties" (`le.legend.properties`). Proof:
  `FigLegend.buildPopup` (Properties first, then Remove Layer, Set As
  Control, and for histograms Coloring, Line Weight, Line Style),
  `LegendPropertiesAction` -> `FigLegend.getInfo` -> the chart's
  `FigChartBox.getInfo` (graph settings dialog, Legend tab `LegendPanel`:
  Show Legend and the legend table, a `StatTableSettingsPanel` whose rows
  are the layers and whose columns default to Sample Name, Subset Name,
  Count, `LegendModel.DEFAULT_COLS`). **Done**: "Legend..." on a chart opens
  a Legend panel with Show Legend, the layers (Set As Control) and the
  legend columns (Add Column, Add Statistic, Add Keyword, Remove); each
  legend row is drawn as its column values (`LayoutPlot.legendColumns`).
  e2e "Legend Properties lists the legend columns", "Show Legend off turns
  the chart legend off". Own rule: the legend stays inside the chart (no
  separate legend figure); per-layer Coloring / Line Weight / Line Style are
  not offered.

### 3.4 Multigraph variants

Proof: `ChartCommand` (`HISTOGRAMS`, `NXN`, `HALFNXN`, `ALLBY`, `SLINKY`,
`MAKE_DOT_PLOT`, `MAKE_CONTOUR_PLOT`, `MAKE_PSEUDOCOLOR_PLOT`),
`FigChartGrid$GridType`, `FigChartGrid.makeAllBy/makeNxN/makeHalfNxN/makeSlinkyChart/setGrid`.

- All Parameters by Y: one row, every parameter of the list except the
  chart's Y against the chart's Y, in the chart's display type.
- Half N x N: the N x N matrix with the diagonal (histograms) and one
  triangle only. Uncertain: which triangle FlowJo keeps; we keep the cells
  below the diagonal.
- Make NxN Dot / Contour / Pseudocolor Plots: the 2-D cells' plot type.
- Slinky: an overlay of every parameter's histogram that expands on mouse
  over (interactive in FlowJo).

Status: **Done** for All by Y, half N x N and the cell types (e: "All by Y is
one row of charts; half N x N is N rows", "multigraph 2-D cells can be dot or
contour plots"). **Own rule** for Slinky: a static stack of the histograms,
each normalised to its mode, with an offset (no hover expansion).

## 4. Several layouts

### TEMPLATEADD "Add", TEMPLATEDUPLICATE "Duplicate", TEMPLATEDELETE "Delete"; rename

Proof: `LEListAction.doAction`, `SExplorer.doNewTemplate`
(`createDefaultTemplate`, default name `fj.string.layout` = "Layout"),
`doDuplicateTemplate` (copy of the template element, unique name, list
re-sorted, the copy becomes current), `doDeleteTemplate` (confirmation),
`deleteSelectedTemplates` (an empty list gets a new default layout; the row
at the same index, else the last, becomes current), `sortTemplateList`
(by name, ignoring case), `NameUtil.uniqueName`. .wsp:
`<LayoutEditor current="name">` with one `<Layout name=...>` per layout.

- Unique names: a name in use drops a trailing "-" plus one to three digits,
  then tries "-1", "-2", ... (up to 999).
- Each layout has its own figures, grids, guides, page setup and iteration.

Status: **Done** (u: "Add, select, Duplicate, Rename and Delete keep figures
with their layout", "deleting the only layout leaves an empty one", "keeps
every layout through .wsp export and import"; e: the five layout-list
checks). Model: the current layout keeps using the workspace's `layout`,
`layoutGrids`, `layoutGuides`, `layoutPage`, `layoutIteration` fields (a
workspace saved with the single `layout` array opens as one layout named
"Layout"); `layoutName` names it and `otherLayouts` holds the others. Rename
is a button (FlowJo edits the name in the list); the new name is made unique
the same way.

## 5. Text and graphics

### 5.1 Text font, size, bold, italic, colour

Proof: `LEFontAction`, `Sidebar$FontPanel`, `FigStyledText` (HTML content
with `<span style>` / `<font>` / `<b>` / `<i>`).

Status: **Done** (e: "text font size and bold apply to the text figure";
u: wsp text style round trip). **Own rule**: the style applies to the whole
text figure (FlowJo styles runs of characters); fonts SansSerif, Serif,
Monospaced. On .wsp export the style is a `<span style>` in every paragraph;
on import the first such span is read.

### 5.2 INSERT_KEYWORD "Insert Keyword", INSERT_ANNOTATION "Insert Annotation", REFERENCED_SAMPLE "Sample"

Proof: `FigStyledText$AddKeywordActionHandler(1)` (keyword list of the
figure's sample, inserts `<Key dataset= originalDataset= name=>` at the
caret), `FigStyledText$AddAnnotationActionHandler` (inserts the `<Anno name=>`
command), `fjml.types.Annotation` (Name, Subset Name, Subset Name indented,
Subset Name with Gating Path, Sample Name, Full Gating Path, Workspace
Annotation, Compensation Matrix, Title, Page Number, FlowJo Version, Time,
Date), `FJTextPane.makeFjmlTag`.

Status: **Done** (u: "Insert Keyword / Annotation fields show live values",
wsp round trip of `<input type="fjml">` Key / Anno; e: "Insert Keyword shows
the live keyword value"). Fields are stored in the text as
`{{keyword:NAME}}` and `{{anno:KEY}}` and show the value for the layout's
current iteration sample. **Own rule** for REFERENCED_SAMPLE: a field has no
sample of its own; it always follows the iteration's sample (FlowJo can pin a
command to a dataset). The population annotations show nothing on text
figures (no population).

### 5.3 SPECIALCHAR "Special Characters"

Proof: `SpecialCharacterPopupCallback` (groups Greek Letters, Signs and
Symbols, Geometric Shapes), `charsets.CommonGreek`, `Sign`, `GeometricShape`.

Status: **Done** with FlowJo's code points (e: "Special Characters inserts
the character"). FlowJo's Greek group uses some code points that do not
match their letter names (for example its capital "Alpha" is U+03A1); the
button shows and inserts the same character, so we keep FlowJo's list.

### 5.4 INSERTPICTURE "Insert Graphic..."

Proof: `LEInsertAction`, `LEditor.addImageUrl`, `FigFactory.makeFigImage`,
`FigImage` (.wsp `<Image url=...>`; the embedded binary is never written by
10.6.2).

Status: **Done**: an image file becomes an image figure at (30, 50) at its own
pixel size in points (e: "Insert Graphic adds an image figure at (30, 50) at
its own size"); `.wsp` Image figures are imported (u: "an Image figure is
imported with its URL"). **Own rule**: the image is kept as a data: URL in
the workspace and written as such in `.wsp` (FlowJo writes a file URL, which
a browser cannot read; an imported file URL shows as a placeholder).

## 6. View, page and output

### 6.1 ZOOMIN, ZOOMOUT, ZOOMFIT "Fit to Window", ZOOMMENU

Proof: `EditorZoom` (steps 12, 25, 33, 50, 66, 75, 100, 150, 200, 400 %;
`getScaleIdx` = first step >= the scale; `nextBiggerScale`,
`nextSmallerScale`, `fitWindowScale` = the step before the first step >= the
ratio fitting the figures' enclosing rectangle into the window, at least the
first), `LESetScaleAction`.

Status: **Done** (u: zoom tests; e: "Zoom In takes the next step", "Zoom Out
...", "Fit to Window picks a listed step"); Ctrl/Cmd + = / - also zoom.

### 6.2 SCALEPAGE, SCALEWIDTH, SCALEHEIGHT

Proof: `LESetScaleAction.doAction`, `LayoutEditor.setAutoPageScale`,
`PrintLayout.setContentScaling`, `SetScaleEdit`.

These set the print content scaling, not a figure size: scaling = the
figures' right extent / page width (Width), bottom extent / page height
(Height), the larger of the two (Page); if the figures extend less than 50 pt
either way the scaling is 1. A page then holds page x scaling points, so the
figures print on one page width, height or page. Undoable.

Status: **Done** (u: "Scale To Width / Height / Page"; e: "Scale To Page fits
every figure on one page"). .wsp: `PrintLayout@scaling` read and written;
`scalingMode` is written as `fj.print.scale.custom` when not 1 (uncertain:
the mode FlowJo writes for this case was not read). A 1:1 button resets.

### 6.3 SHOWPAGEBREAKS, SHOWRULERS, USEPLACEHOLDERS

Proof: `LEShowPageBreaksAction` (`Layout.setShowPageBreaks`),
`ShowRulersAction` (`Layout.toggleRulers`), `LEUsePlaceholdersAction`
(`Layout.toggleUsePlaceholders`: empty boxes stand in for graphs).

Status: **Done** (e: "Show Pagebreaks off hides the page breaks", "Show
Rulers shows a ruler"). **Own rule**: one ruler along the top in inches;
guides are still added with buttons (specs 21.2). The toggles are per
session, not saved.

### 6.4 EDITHEADER "Edit Header / Footer"

Proof: `LEEditHeaderAction`, `FJHeaderFooterDialog`, `Layout.createHeaderFooter`
and `saveToPrefs` (header and footer kept in workspace preferences
`Layouts/header`, `Layouts/footer`), dictionary
`dlog.header.footer.description` (tags `<DocumentName/> <Date/> <LongDate/>
<Time/> <Version/> <PageNumber/>`), `headerhtml` (left: FlowJo logo and name,
right: "Page <PageNumber/>"), `footerhtml` (left `<LongDate/>`, right
`<Version/>`), `LEPrintAction` (`PrintManager.configureHeaderAndFooter`).

Status: **Done** for a header and footer printed in the top and bottom
margins of every PDF page, each with a left and right text using the same
tags (u: "header tags"; e: "header preview fills in the page number", "PDF
with header exports"). **Own rule**: plain text in two parts instead of
HTML; the default header shows the document name instead of FlowJo's logo;
both are off until turned on (uncertain whether FlowJo prints them by
default); kept for the workspace (FlowJo: preferences).

### 6.5 PRINT, BATCHSELECTDESTINATION "Output Target"

Proof: `LEPrintAction.doPrint`, `Batch$BatchDestination` (Layout, Printer,
Web, Web movie, PowerPoint, PDF).

Status: **Own rule**: Print is the PDF export (open it and print from the
browser's PDF viewer; a browser has no page-setup print path for this
canvas). Output targets are PDF, PNG and SVG files. **Deferred**: the
Layout (batch into a new layout), Web, Web movie and PowerPoint targets
(no writers for those formats in this app).

### 6.6 OUTPUTFILENAME, OUTPUT_APPEND, GEOM_SEPARATE_PAGES, GEOM_ACROSS, GEOM_DOWN, GEOM_ROWS

Proof: `LEGeometryAction` (`BatchSettings.setTileOrder` ACROSS / DOWN,
`setDirection` ROWS / COLUMNS, separate pages flag),
`Batch.getLayoutOffset` (with pages: tiles step by the layout extent rounded
up to whole pages, times the page scaling; without: by the tile's width
(height) + 1 + 10 pt; Across: column = k mod columns, row = k div columns;
Down: column = k div rows, row = k mod rows; printing forces pages and
across), `LEOutputAppendAction`.

Status: **Done** for File Name (output files `<name>_<value>`; e: "File Name
sets the output name"), Across / Down, fixed rows or columns, Separate Pages
on / off. OUTPUT_APPEND "Append Output": proof `LEOutputAppendAction`
(sets `BatchSettings.append`, saved with the layout), `LEBatchBand` (check
box), `Batch.outputPowerpoint` / `PowerPointCreator` (the only reader: the
PowerPoint destination appends slides to an existing .pptx). **Own rule**: a
browser download cannot append to a file and there is no PowerPoint writer,
so with Append Output on, a PDF batch adds its pages to the pages of the
batch PDF of the same name made earlier in the session and downloads the
combined PDF (e: "Append Output adds the batch pages to the earlier PDF of
the same name"). PNG / SVG batches are not appended.

### 6.7 ITERATIONGROUPNAME "Iteration Group"

Proof: `le.iteration.groupname` ("The group of samples included in batches
or browsing of this layout"), .wsp `Iteration@groupName`
(`workspaceSelection` = the workspace's selected group).

Status: **Done**: each layout can name a group; otherwise it follows the
workspace's selected group (u: wsp round trip of `groupName`; e: "Iteration
Group offers the workspace selection and every group").

### 6.8 RIBBONSETDEFAULT "Apply Default Ribbons", RIBBONCONFIG "Customize Ribbon"

Proof: `LERibbonStructure.loadDefaults` (tasks Layout Editor: Layouts,
Iteration, Batch; File: Document, Go; Edit: Clipboard, Select, Show & Hide;
Object: Properties, Locks, Text, Figure Presets; Arrange: Reorder, Vertical
Alignment, Horizontal Alignment; Annotate exists but is not in the
default), `LERibbonCommand$Band` / `$Task`, `LERibbonConfigAction` ->
`LERibbonConfigDialog` (`FJRibbonConfigDialog`: "Drag bands to add them to
the ribbon. To remove a band, drag it off of the ribbon. To swap positions
of existing bands, drag them."), `LERibbonAddBandAction` /
`LERibbonRemoveBandAction` (`AbstractRibbonStructure.addBand`: refused with
"No band was added since it already exists in the selected task.";
`removeBand`: refused with "Unable to remove the last band from a task.";
the structure is saved to the preferences, `FJPrefs.setLERibbon`),
`LERibbonSetDefaultAction` (confirm "Are you sure? This will discard all
ribbon customizations saved to your preferences.", then the default
structure).

**Done**, self-contained for the layout editor (src/core/layoutPrefs.ts,
`RibbonDialog` in src/ui/Layout.tsx): the toolbar is five rows (the tasks)
of bands; "Customize Ribbon" lists each row's bands with swap left / right
and remove, and an "Add band..." menu per row, with FlowJo's refusals;
"Apply Default Ribbons" asks FlowJo's question and restores the default.
The structure is kept per viewer (browser storage, as preferences). Own
rules: the rows are always shown (no task tabs); Annotate holds the insert
tools (FlowJo inserts from a tool palette) and is in the default Object
row; buttons instead of drag and drop. The workspace ribbon has its own
customisation (merged from the workspace work); the two are independent.
Tests: unit "add refuses a band the row has; remove refuses the last band;
swap", "default ribbon rows"; e2e "removing a band hides it", "adding a
band a row already has is refused", "a band can be added to another row",
"swapping moves a band left", "the last band of a row cannot be removed",
"the ribbon is kept with the preferences", "Apply Default Ribbons restores
the default rows".

### 6.8a HELP, GRID_HELP, FJML_HELP, STAT_TABLE_HELP

Proof: `FJHelpAction(ActionCommand)` opens `Help.getHelpPrefix()` plus the
dictionary value of "<command>.url"; `Help.getHelpPrefix` is
`http://docs.flowjo.com/d2/` (online documentation). GRID_HELP "About
Grids..." (`FigGridLayout` popup, `le.gridlayout.help.url` =
graphical-reports/graph-options-and-annotation/le-grid/); FJML_HELP
(`FJMLEditorDialog`, `le.fjml.editor.help.url` =
graphical-reports/equations-statistics-and-tables/le-fjml/); HELP "Help"
in the graph settings dialog (`FigChartBoxInfo`, `LEGraphDefAction` calls
`Help.help("graphical-reports/graph-options-and-annotation/le-graphdef/")`).
STAT_TABLE_HELP: the enum constant is used by no 10.6.2 class.

**Done**: "About Grids..." in the grid bar, "?" next to Insert Keyword /
Insert Annotation on text figures (the FJML fields) and "Help" on charts
open those URLs in a new tab (`HELP_URLS`). e2e "FJML help opens FlowJo's
le-fjml page", "chart Help opens the graph definition page"; unit "help
URLs". STAT_TABLE_HELP: **Not a gap: no-op in FlowJo 10.6.2**.

### 6.9 ALIGN_H_SPREAD, ALIGN_V_SPREAD "Spread"

**Own rule** (unchanged): not offered; the command does nothing in FlowJo
10.6.2 (specs 21.2 A10).

## 7. Object figures

Implementation: src/core/layoutTables.ts, src/core/layoutPlate.ts,
src/core/layoutPrefs.ts (rules), src/ui/LayoutObjects.tsx (evaluation,
drawing, panels), layout object `LayoutObject` in src/core/model.ts. Object
figures are inserted from the Annotate band at (30, 50); tables and plates
take the size of their contents until resized (FlowJo's grid figures size to
their grid). Unit tests `tests/followup-layout.test.ts` (`f:` below), e2e
`e2e/followup-layout.mjs` (`fe:`).

### 7.1 Statistic table: PARAMETER, EXPECTED_RANGE "Range", ADD_COLUMN "Add Column", SET_EXPECTED_RANGE "Expected Range"

Proof: `FigStatTable` (element `StatTable`, popup "Enable Iteration"),
`StatTableModel` (rows `NodeReference`s, controls, columns `TextPresentable`s;
`getDefaultColumns` = Subset Name with Gating Path and Count; `showHeader`
default on, `enableContentIteration` default off; `getCellFig`: a Statistic
column is the row population's statistic, right-justified; Keyword and
Annotation columns are text; a GraphSpec column is a small chart; empty
cells "-"; `getHeaderCellFig`: bold, 1.1 x, centred, fill #DDDDDD to
#EEEEEE vertical; `formatCellFig`: control rows italic;
`bind(Iteration)`: with iteration enabled every non-control row moves to the
iteration's sample, same population), `StatTableSettingsPanel` ("Table Rows:
Drag Samples or Populations Here", double click sets a row as control;
"Table Columns: Drag Statistics, Keywords, or Populations here"; Show Column
Headers; Enable Iteration; Add Statistic...; Add Keyword...; ADD_COLUMN
combo of `INSERT_ITEMS` = Subset Name, Subset Name indented, Subset Name with
Gating Path, Sample Name, Workspace Annotation, Compensation Matrix, Full
Gating Path, Count, Freq. of Total, Freq. of Parent; EXPECTED_RANGE combo
"-- No Range --" plus the preference ranges, setting
`Statistic.setExpectedRangeName` on the selected statistic columns).

**Done**: rows (sample + population, control check box), columns (Add
Column, Add Statistic with parameter, Add Keyword, Remove), Range min / max
and "-- No Range --" on a statistic column (cells below the range cyan with a
down arrow, above yellow with an up arrow, the table editor's rule), Show
Column Headers, Enable Iteration. Live: values are recomputed for each
iteration value and export. f: "a new statistic table", "Add Column offers
...", "annotation cells", "iteration moves non-control rows", "expected range
cell styles"; fe: "a new Statistic Table has the columns ...", "rows show the
sample name, its count and the added Mean (FL1-A)", "Add Column (Sample Name)
and Add Keyword (Donor) add columns", "Range sets an expected range ...",
"Show Column Headers off ...", "Enable Iteration moves non-control rows ...;
a control row stays". Own rules: rows are added from sample / population
menus (FlowJo: drag and drop); expected ranges are entered on the column
(FlowJo names a preference range; as in tables.md); GraphSpec (chart)
columns and statistic presets are not offered; Workspace Annotation shows the
first line of the workspace notes. SET_EXPECTED_RANGE (in `FJMLEditorDialog`,
the range of a statistic field in text) is served by the same column range
(own rule: text figures have no statistic fields). PARAMETER: the enum
constant is used by no 10.6.2 class: **Not a gap: no-op in FlowJo 10.6.2**.
.wsp: `StatTable` is not read or written (**Deferred**: FlowJo's
NodeReference / statistic XML for table rows was not decoded; the figure is
kept in the app's workspace file).

### 7.2 Difference table: DIFF_TABLE_CONTROL_SAMPLE "Select a control sample"; table-editor tables

Proof: `FigDifferenceTable` (no header row, `isDisplayColumnIndicesDiagonal`:
column labels drawn diagonally, a statistic labelled "Δ " plus its name;
below the table "Control Sample: <name>" or "<None Set>"),
`DifferenceTableModel.getCellFig` (statistic cells are `FigStatDifference`
of the row population and the same path in the control sample),
`FigStatDifference.reparse` (text = row value minus control value; "<No
control sample>", "<No population>", "<No control>"; colour when the
statistic has a parameter: d = channel(row) - channel(control) over the
channel range, `getHeatmapColor(d, -1, 1)`: yellow with alpha 1 - (1 -
pin(d, 0, 1))^2 for d > 0, blue likewise for d < 0, transparent at 0),
`DifferenceTableSettingsPanel` (control sample "<Drag Sample Here>", popup
"Select a control sample").

**Done**: control sample menu, rows and columns as 7.1, differences and
colours (d from the display positions of the two values on the parameter's
scale). f: "difference cells ...", "difference colours ...", "difference
column labels ..."; fe: "without a control sample the cells say <No control
sample>", "Difference Table: row minus control ...".

Table-editor tables (`FigTableDisplay`, element `TETable`; from
FJTableCommand.ADD_TO_LAYOUT and TECommand.BATCHLAYOUT): **Done** as a
static table figure (header, rows, format colours; "not live"), see
tables.md. .wsp: `DifferenceTable` and `TETable` are not written
(**Deferred**, as `StatTable`).

### 7.3 Plate display: CHOOSE_PLATE_STAT, CHOOSE_HEATMAP_RANGE, CHOOSE_PLATESTAT_DISPLAY_TARGET, CHOOSE_PLATE_GROUP, CHOOSE_PLATE_DISPLAY_MODE, REFRESH_PLATE, PLATE_SHOW_SAMPLE, REMOVE_UNUSED_PLATE_STATS, REMOVE_PLATE_STAT

Proof: `FigPlateDisplay` (element `PlateDisplay`; without data a grey frame
and "(Drag Plate Statistics Here)"; `dropNodes`: dropped statistic nodes go
to `applyStatistics` and a plate without a group takes the workspace's
current group; row labels 'A' + row, columns numbered; popup Refresh;
`calculateRangeForStatistic`: the AUTO range is the min and max of the
wells' values skipping NaN, max starting at Double.MIN_VALUE),
`PlateDisplayModel` (group, display mode HEATMAP / CHERNOFF_FACE, null =
HEATMAP; `fillSampleWellMap`: each group sample in its well ID cell, errors
"Found samples with no Well ID", "Multiple samples have same Well ID", "No
Samples"; size = largest row and column used; `applyStatistics`: new
statistics get an AUTO `HeatmapRange`; Heatmap gives the first dropped
HEATMAP1 and the second HEATMAP2; Chernoff faces give each an unused
feature; `setDisplayTarget` takes the target from any other statistic;
`removeUnusedStatistics` drops statistics whose target is not shown in the
mode), `PlateDisplayStatistic$DisplayTarget` (Heatmap, Heatmap Upper Half;
Pupil Size, Eye Spacing, Head Shape, Eye Size, Eye Shape, Eyebrows, Nose,
Mouth Size, Grin, Mouth), `FigPlateWellDisplay` (Heatmap: fill with the
colour of the normalised value `CalculatedTable.getHeatMapColoring` on
0..1; Upper Half: the triangle (x, y + h), (x, y), (x + w, y); Chernoff: the
chernoff-faces `FacePainter` in the box (x - w/8, y - h/8 - 3, 1.25 w,
1.25 h) with features at FaceVector indices 1 head, 2 eye shape, 3 pupil, 4
eyebrow, 5 nose, 6 mouth, 7 eye spacing, 8 eye size, 9 mouth size, 10 grin,
neutral 0.5; sample name centred, at least 5 from the left, mid-height for
heat maps, else at the bottom, white on dark blue colours
`getContrastingHeatmapColor`), `FigPlateLegend` (a 20 pt colour bar 15 pt
right of the plate with the range), `FigPlateAnnotation` ("Sample Group:
<group>" or "<No Group Selected>", per shown statistic "Statistic: <path>"
and ":: displayed as <target> = heatmap range <min> - <max>" or "<Not
Calculated>", then the errors), `PlateDisplaySettingsPanel` (Choose Group,
Display Type, Show Sample Name, Remove Unused; per statistic: Display As,
Statistic Heatmapping Range Auto / Expected Range, Delete Statistic).

**Done**: plate figure with group, display type, Show Sample Name, add
statistic (a statistics column of the workspace stands for a statistic
node), Display As, Auto / Expected Range, Delete, Remove Unused, Refresh;
heat map, upper half, Chernoff faces (FacePainter geometry: head radius 30,
eyes at 40 / 60 radius 5, pupils, eyebrows, nose, parabolic mouth), legend
bar and annotation. f: the plate tests (wells, applyStatistics for both
modes, targets and Remove Unused, AUTO range with the MIN_VALUE start, well
colours, annotation lines, Chernoff geometry); fe: "an empty plate asks for
statistics", "dropping a statistic takes the current group and lays wells
out by WELL ID", "Heatmap: lowest well blue, highest yellow", "the
annotation names ...", "Display As Heatmap Upper Half ...", "Statistic
Heatmapping Range: Expected Range 0 - 1000", "Display Type Chernoff Face
...", "Remove Unused ...", "Delete Statistic removes it". Own rules: legend
and annotation are drawn inside the figure (FlowJo: dependent figures next
to it); an unused Chernoff feature is taken in enum order (FlowJo iterates a
hash set); expected ranges are entered on the statistic; the face's lines
use the box's y origin (FacePainter adds the x origin to the first point's
y, which would misplace them on a plate). CHOOSE_PLATE_STAT: used by no
10.6.2 class: **Not a gap: no-op in FlowJo 10.6.2**. Uncertain: the legend's
axis labels for the second statistic (lower half) are not drawn. .wsp:
`PlateDisplay` is not read or written (**Deferred**: statistic node paths of
FlowJo were not mapped to statistics columns).

### 7.4 Web page: WEB_RESET_ZOOM, WEB_RESET_POSITION, WEB_NAVIGATE_DIALOG, WEB_REFRESH_IMAGE, WEB_RELOAD_PAGE

Proof: `FigWebBrowser` (element `FigWebBrowser`: FigRect bounds plus url,
zoom, offsetX, offsetY; default url http://www.flowjo.com; a hidden native
browser renders the page, its full size measured by script, into an image
drawn at the offset and zoom, clipped to the figure; editing the figure
inside: dragging pans the offset, `WebZoomer` adds wheel rotation / 10 to
the zoom within 0.1..3; popup Navigate To... ("Enter Link:"), Refresh Image
(re-render), Reload Page, Reset Zoom (1), Reset Position (0, 0)).

**Own rule** (a web app cannot draw a cross-origin page into a canvas): on
screen the figure is a live frame of the page moved by the offset and scaled
by the zoom; "Edit inside" (or double click) lets the wheel zoom and a drag
pan, as FlowJo; Navigate To... asks for the link; Reload Page and Refresh
Image reload the frame; Reset Zoom / Reset Position as FlowJo. PNG, SVG and
PDF output draw a framed placeholder with the address. .wsp: read and
written. f: "web page zoom", "FigWebBrowser round trip"; fe: "Web Page adds
a live page figure", "Navigate To... changes the page", "the mouse wheel
zooms while editing inside", "dragging pans the page", "Reset Zoom and Reset
Position", "Reload Page keeps the figure", "exports draw the web page as a
placeholder".

## Status by command

| Command | Status |
|---|---|
| EDITHEADER | Done (own: text model) |
| PRINT | Own rule (PDF) |
| BATCHSELECTDESTINATION | Own rule (PDF/PNG/SVG); other targets Deferred |
| FIGPROPERTIES, COLORFILL, COLORLINE, COLORGRAD, LINEWEIGHT, LINESTROKE, GRADIENTTYPE | Done |
| ARROWHEAD_FORWARD / BACKWARD / DOUBLE / NONE | Done |
| INSERTPICTURE | Done |
| LOCKCONTENT, LOCKSIZE | Done |
| OPENGRAPH | Done |
| RIBBONSETDEFAULT, RIBBONCONFIG | Done (self-contained layout ribbon) |
| SCALEPAGE, SCALEWIDTH, SCALEHEIGHT | Done |
| ZOOMIN, ZOOMOUT, ZOOMFIT, ZOOMMENU | Done |
| TEMPLATEADD, TEMPLATEDUPLICATE, TEMPLATEDELETE | Done |
| FIGPRESETAPPLY, FIGPRESETCREATE, FIGPRESETREMOVE | Done (own scope) |
| ALIGN_H_SPREAD, ALIGN_V_SPREAD | Own rule (no-op in FlowJo) |
| SPECIALCHAR | Done |
| OVERLAY | Done (own: layout preference) |
| SHOWHORIZONTAL | Done |
| PROPERTIES | Done (own: legend inside the chart) |
| HELP, GRID_HELP, FJML_HELP | Done |
| STAT_TABLE_HELP | Not a gap (no-op in 10.6.2) |
| USEPLACEHOLDERS, SHOWPAGEBREAKS, SHOWRULERS | Done |
| SELECT_INVERT, SELECT_ALL | Done |
| ITERATIONGROUPNAME | Done |
| COPYTRANSPARENT, COPYNOTRANSPARENT | Own rule (PNG; download fallback) |
| PASTE, CUT | Done |
| OUTPUTFILENAME | Done |
| OUTPUT_APPEND | Own rule (PDF pages appended in the session) |
| GEOM_SEPARATE_PAGES, GEOM_ACROSS, GEOM_DOWN, GEOM_ROWS | Done |
| WEB_* (5) | Own rule (live frame on screen, placeholder in exports) |
| EXPECTED_RANGE, ADD_COLUMN, SET_EXPECTED_RANGE | Done (own: ranges entered on the column) |
| PARAMETER | Not a gap (no-op in 10.6.2) |
| REMOVE_LAYER | Done |
| SET_CONTROL | Done |
| DIFF_TABLE_CONTROL_SAMPLE | Done |
| INSERT_ANNOTATION, INSERT_KEYWORD | Done |
| REFERENCED_SAMPLE | Own rule (iteration sample) |
| plate commands (8 of 9) | Done |
| CHOOSE_PLATE_STAT | Not a gap (no-op in 10.6.2) |
| ChartCommand.SHOWLEGEND | Done (own: legend inside the chart) |
| ChartCommand.MAKE_DOT_PLOT, MAKE_CONTOUR_PLOT, ALLBY, HALFNXN | Done |
| ChartCommand.SLINKY | Own rule (static) |
| ChartCommand.REMOVEDATA | Done |
| ChartCommand.BACKGATELARGE, BACKGATECONTOURS, BACKGATINGHORIZ, BACKGATINGVERT | Done |
| ChartCommand.XAXIS, YAXIS | Done |
