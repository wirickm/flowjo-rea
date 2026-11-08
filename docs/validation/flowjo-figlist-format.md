<!-- FlowJo 10.6.2 layout figure XML (<Layout>/<FigList>) described for the
clean-room importer / exporter; no FlowJo code, disassembly or decompiled
text. Decoded from the writers and readers; no fixture holds figures. Specs
section 25.4 lists what is implemented. -->

# FlowJo 10.6.2 layout figures: the `<Layout>/<FigList>` XML format

Written from the 10.6.2 Java classes (`javap` on the classes in
`/tmp/claude-0/fj/jar` plus `fjlib-2.3.0`). This is a behavioral and format
description in my own words. It contains no FlowJo code. Citations give
`Class.method`.

Confidence tags:
- **[H]** high: read directly from a writer and its matching reader.
- **[M]** medium: read from one side only, or depends on a library's runtime behavior (Swing, JDK).
- **[L]** low: inferred or guessed.

No fixture contains a non-empty `<FigList>`, so none of this has been checked
against a file FlowJo actually saved.

---

## 0. Serialization conventions (apply everywhere)

| Topic | Behavior | Source |
|---|---|---|
| Booleans | Written as `"1"` / `"0"`. On read, `"1"` and `"true"` mean true; anything else, including a missing attribute, means false unless the reader passes a default. [H] | `SElement.setBool`, `SElement.getBool(String)`, `getBool(String,boolean)` |
| Integers | Plain decimal. A missing value reads as 0 unless the reader passes a default. [H] | `SElement.setInt/getInt` |
| Doubles | Formatted with pattern `#.##########` (up to 10 decimals, no grouping, no exponent, so `1`, `0.5`, `1.5707963268`). [H] | `SElement.setDouble` -> `ParseUtil.engineFormat` |
| Colors | ARGB hex. Opaque colors are `#rrggbb`. Colors with alpha below 255 are `#aarrggbb`. A null color is written as fully transparent white, `#00ffffff`. [H] | `ColorUtil.colorToString` |
| Strings | `setString(name, null)` writes `name=""`. An attribute with an empty *name* is dropped. An empty *value* is still written. [H] | `SElement.setString`, `SElement.setAttribute` |
| Re-setting an attribute | Replaces the value in place, so the attribute keeps its first position. [H] | `SElement.setAttribute` |
| Writer layout | One element per line, indented. Attributes are separated by two spaces and the tag closes as ` />`, the same as the fixture files. Element text is trimmed and XML-escaped once more at write time (see the text figure notes). [M] | `SElement.toWriter` |
| Rectangles | `x`, `y`, `width`, `height` attributes, all integers. [H] | `SElement.setRect/getRect` |
| Line weight (on Figs) | `NoLine`, `Hairline`, `Normal`, `Heavy`, `Thick`. The reader upper-cases the value and also accepts `VERY HEAVY`. Unknown values become Hairline. [H] | `LineWeight.toString/fromString`, `SElement.setLineWeight` |
| Line style (on Figs) | `Solid`, `Dotted`, `Dashed`, `Long Dashed`, `Complex`. [H] | `StrokeFactory.lineStyleToString` |
| Gradient style | `le.gradientstyle.none`, `.horizontal`, `.vertical`, `.diagonal`. [H] | `GradientStyle.toString` (the command string) |
| Chart fill | `le.chartfill.none`, `le.chartfill.tinted.20`, `.tinted.40`, `.tinted.60`, `.tinted.80`, `le.chartfill.filled`. [H] | `ChartFill.toString` |

**Units.** All geometry is in integer layout canvas units: Java `Rectangle` and
`Point` ints. At zoom 1 these are PostScript points (1/72 in). The sibling
`<PrintLayout width="612" height="792">` is US Letter in points. **[M]**
Rotation is in **radians**, stored as a double: the UI converts integer degrees
with `deg*pi/180` in `Fig.setRotation(int)`, and the hit-testing code uses the
value directly with `atan2/cos`. **[H]**

---

## 1. `<FigList>`: the top-level container

- **Writer:** `Layout.writeProperties` adds `FigList.getElement()`, which
  `Layout.getFigList()` gets from `LayoutEditor.getFigLayerContents()`. [H]
- **Reader:** `Layout.readProperties` takes the `FigList` child and keeps it as
  the initial state. `Layout.loadSavedFigList` then walks its children **in
  document order**. For each child it calls `FigFactory.makeFig(child, editor)`,
  then `FigList.addWithDependents`. [H]
- **The element name selects the figure kind.** There is no `type` or `class`
  attribute. [H] (`FigFactory.makeFig`, `Fig.getElementName` overrides)
- **Z-order is document order.** The first child is at the back. For each
  top-level figure, `FigList.getElement` writes `z="<index>"`, where index is
  the position in the editor's flat list. That list also holds chart dependents
  (axes, legend, ...), which serialize to nothing, so the `z` values have gaps.
  `Fig.setElementSelf` reads `z` into a field, but no code uses it to reorder.
  A reader should ignore `z` and use document order. A writer should emit
  `z = 0, 1, 2, ...` (gaps are harmless). [H]
- A figure whose `getElement()` returns null is skipped. Those are the chart
  axes, the chart annotation, the legend and the adjunct histograms: they are
  saved *inside* their chart element instead. [H] (`FigAxis/FigChartAnnotation/FigLegend/FigChartAdjunctHistogram.getElement`)
- Unknown child names make `makeFig` return null, so the reader skips them. [H]

### Element-name table (FigFactory.makeFig = reader, getElementName = writer)

| Element | Class | Written by 10.6.2? | Notes |
|---|---|---|---|
| `ChartData` | `FigChartBox` (chart with axes/legend/annotation) | yes | the normal chart figure [H] |
| `Chart` | `FigLightweightChartBox` (bare chart, no dependents) | yes | same reader as ChartData [H] |
| `ChartGroup` | read only | legacy | bounds taken from the group; the chart comes from its `Chart` child [H] |
| `StyledText` | `FigStyledText` | yes | the normal text tool; also used for dropped statistics [H] |
| `SimpleText`, `TextBoxBase` | `FigTextBox` | SimpleText yes | plain-text box [H] |
| `SimpleFJML` | `FigLightweightText` | yes | text plus a `TextTraits` child [H] |
| `FigStatistic`, `ParsedText` | read as `FigStyledText` | legacy | [H] |
| `FigList`, `Group` | `FigGroup` | `FigList` | a group is a nested `FigList` element [H] |
| `GridLayout`, `table2` | `FigGridLayout` | `GridLayout` | [H] |
| `HeatMapGridLayout` | `FigHeatMapGridLayout` | yes | not decoded |
| `StatTable` | `FigStatTable` | yes | section 9.1 |
| `DifferenceTable` | `FigDifferenceTable` | yes | section 9.2 |
| `TETable` | `FigTableDisplay` | yes | section 9.3 |
| `PlateDisplay` | `FigPlateDisplay` | yes | section 9.4 |
| `FigWebBrowser` | `FigWebBrowser` | yes | FigRect bounds plus url, zoom, offsetX, offsetY (ui-gaps/layout.md 7.4) |
| `FigMultigraphColorTable` | `FigMultigraphColorTable` | yes | not decoded |
| `Image` | `FigImage` | yes | section 4.2 |
| `Rectangle`, `RoundRect`, `Oval`, `Ellipse`, `Diamond`, `Triangle`, `Line` | shapes | yes | common attributes only (not decoded further) |
| `Polygon` | `FigPoly` | written | **not in `makeFig`**, so 10.6.2 cannot read back a saved polygon shape [H] |

---

## 2. Common attributes of every figure (`Fig.getElement` / `Fig.setElementSelf`)

Writing happens in two steps: `Fig.getGUIElement` first, then `Fig.getElement`
adds more. Subclasses call `super.getElement()` and append their own content.
The attribute order below is the write order. [H]

| Attr / child | Type, units | Written | Read | Meaning |
|---|---|---|---|---|
| `x`, `y`, `width`, `height` | int, points | always, **except on dependent figs** (axis, legend, annotation, ancestry, multigraph) | yes; applied only when width>0 and height>0 | bounds, top-left origin [H] |
| `lineWeight` | enum string (sec. 0) | yes | yes | stroke weight [H] |
| `fill` | color | yes | yes (the legacy no-fill color is mapped) | fill color [H] |
| `stroke` | color | yes | yes | line color [H] |
| `lineStyle` | enum string | yes | yes | dash style [H] |
| `gradientColor` | color | yes | yes | second gradient color [H] |
| `gradientStyle` | `le.gradientstyle.*` | yes | yes | [H] |
| `enabled` | bool, default 1 | yes | yes | [H] |
| `xScale`, `yScale` | double | yes | **no**. The reader looks for `scaleH`/`scaleV` instead (as a percent, default 100%) | write-only in the base Fig [H] |
| `aspectRatioLock` | bool | yes | yes | lock aspect ratio [H] |
| `alpha` | double 0..1, default 1 | yes | yes | opacity [H] |
| `figID` | string | yes | yes (kept if present) | opaque ID, shaped `<javaClass>@<hexHash>#<epochMillis>`. Nothing cross-references it in these classes [H] |
| `rotation` | double, radians | yes | yes (as float) | [H] |
| `lock` | bool | yes | **no** | position lock: write-only in 10.6.2 [H] |
| `sizeLock` | bool | yes | **no** | size lock: write-only [H] |
| `contentLock` | bool | yes | **no** | content lock: write-only [H] |
| `wantsDrops` | bool | yes | no | [H] |
| `enableContentIteration` | bool, default 1 | only when false (`"0"`) | yes | batch iteration turned off for this fig [H] |
| `z` | int | added by the parent `FigList` (top level only, not inside groups) | stored, unused | [H] |
| `<FigShadow radius= opacity= color= angle= distance=/>` | int, float, color, float, int | only when the shadow is visible | yes | drop shadow [H] (`FigShadow.getElement`) |

**Group ID:** there is no attribute for it. Grouping is purely structural: the
group's members are child elements of a nested `FigList` (section 5). [H]

**Dependents:** chart axes, legend, annotation, ancestry row and multigraph
are not siblings in the FigList. They are child elements of their chart
element (section 3.4). [H]

---

## 3. Chart figures (`ChartData`, `Chart`)

### 3.1 How the element is built (writer)

`FigChartBox.getElement` calls `FigLightweightChartBox.getElement`, which takes
the common-attribute element from section 2 and passes it to
`LEChartController.getElement(el)`. That method adds, in this order: [H]

1. the `<Graph>` child (`GraphSpec.getElement(sample, false)`, added through `addOrReplace`);
2. the dependent children, from `LEChart.extractDependents`: `<Annotation>`, `<Legend>`, `<Ancestry>`, `<Multigraph>`;
3. `dependents` (bool): true when the chart has a dependents set (an `LEChart`);
4. the chart attributes (`ChartAttributes.extract`, table in 3.2);
5. `panelIndex` (int);
6. `<PopModelList>` (the data layers);
7. `<WindowPosition>`: the main plot's bounds.

`FigChartBox` then sets `dependents="1"` again.

### 3.2 Chart-level attributes (`ChartAttributes.extract` / `.install`, `LEChartController.setElement`, `FigFactory.makeFigChartBox`)

| Attr | Type | Meaning | Notes |
|---|---|---|---|
| `x`, `y`, `width`, `height` | int pt | bounds of the **main plot area**. The axes and annotation are separate figures positioned relative to it | Rewritten here from the main chart's bounds. Then `width`/`height` are rewritten again from the stored chart size. [H] |
| `scaleH`, `scaleV` | double | plot width / 256 and plot height / 256 | **On read, the plot size comes from these, not from width/height:** size = trunc(256 x scale). A value <= 0 or missing means 1, so 256. A value > 50 is treated as a percent and divided by 100. The reader also overwrites `width`/`height` in the element with that result. Writers must keep scaleH = width/256 and scaleV = height/256. [H] |
| `aspectRatioLock` | bool | | [H] |
| `rotation` | double rad | | read in `install` [H] |
| `flipH`, `flipV` | bool | mirror the chart | written; reader not located [M] |
| `alpha` | double | | read in `install` [H] |
| `showSampleName` | bool, default **1** on read | annotation shows the sample name | [H] |
| `showFullPath` | bool | annotation shows the population with its full path | [H] |
| `showPopulationName` | bool | annotation shows the population name | [H] |
| `showFreq`, `showCount` | bool | annotation shows frequency or count | [H] |
| `showGraphTitle` | bool | annotation shows the title | [H] |
| `showMedians` | bool | | [H] |
| `useShortName` | bool | forced true on read when neither keyword nor statistic is shown | [H] |
| `showKeyword` / `keyword` | bool / string (written even when empty) | annotation keyword | [H] |
| `showStatistic` / `statistic` | bool / string | annotation statistic | [H] |
| `offsetHistograms`, `offsetX`, `offsetY` | bool, int, int | staggered overlay offset. The legacy `offsetAmount` is read into both offsets | [H] |
| `showAdjunctHistograms` | bool | show the marginal (adjunct) histograms on a 2D plot | [H] |
| `path` | string | **population analysis path** (3.3) | read by `FigFactory.makeFigChartBox` to find the graph node [H] |
| `sampleID` | string | sample ID of the base layer | written; the factory reads the sample ID from the first `DataLayer` instead [H] |
| `panelIndex` | int | | [H] |
| `dependents` | bool, default 1 on read | true: build a `FigChartBox` with axes, legend and annotation. false: build a bare `FigLightweightChartBox` | [H] |
| `fShowFlags` | int bit mask | **legacy, read only.** 0x40 = show ancestry, 0x80 = horizontal, 0x4000000 = backgating. The reader turns these into an `<Ancestry>` child | [H] |

### 3.3 How the sample and population are referenced

- **Sample:** by the workspace **sample ID** string, the same value as
  `<DataSet sampleID=...>` (`Sample.getSampleID`). It goes in
  `DataLayer@sampleID` and is also written in `ChartData@sampleID`. **No file
  URI is stored** with the chart. [H]
  (`PopModel.getElement`, `Sample.setSelf`, `WSSampleMgr.findSampleForID`)
- **Population:** `path`, built by `AppNode.getAnalysisPathString`. It is the
  list of node names from the node up to, but not including, the sample's root
  node. Each name has `/` replaced by `_`. The names are joined with `/`, with
  no leading or trailing slash: for example `Lymphocytes/Single Cells/CD4+`.
  An ungated sample has the empty string. On read,
  `SampleNode.findAnalysisNodeDeep(path)` resolves it. [H]
  (`AppNode.getPath`, `StringUtil.pathToString`, `StringUtil.replaceSlashesWithUnderscore`)
- If the sample or the node is not found, the chart is built with a null node.
  It renders empty but stays in the layout. [M]
- With batch iteration on, each `DataLayer` also gets `sampleGMID`: the index
  of the referenced sample within the layout's iteration group. [M]
  (`PopModel.getElement`, `Group.getIndexOfSample`)

### 3.4 Children of a chart element

**`<Graph>`**: the same `Graph` element that FlowJo writes under each node in
`SampleList` (the fixtures have hundreds of examples). [H] (`MiniGraphSpec.stateToElement/addAttributes/addContent`, `GraphSpec.addAttributes/addContent`, `AxisSpec.getElement`, `GraphSettings.getElement`, `GraphEnvironment.writeEnvironment`)
- `Graph@smoothing` (int; contour plots force 13), `backColor`, `foreColor`
  (colors), optional `heatMapStatistic` / `heatMapStatParameter`,
  `type` (display type: `Pseudocolor`, `Contour`, `Density`, `Zebra`,
  `DotPlot`, `Histogram`, `TimeSeries`, `CDF`, `HeatmapStatistic`; the reader
  also accepts the spaced forms `Dot Plot`, `Timeseries`, `Heatmap Statistic`),
  and `fast` (bool).
- `<Axis dimension="x|y" name="<param name>" label="" auto="auto|manual|modal" [min= max=]/>`.
  `name` is the parameter name (for example `FSC-A`). `min`/`max` are written
  only when scaling is not auto, and default to 0 and 100 on read. For 1D
  graphs the y axis name is cleared on read.
- `<GraphSettings level= smoothingHighResolution= contourHighResolution= histogramSmoothingCount= graphResolution= showOutliers= drawLargeDots= dotsToDraw= tint= lineWeight= lineStyle= [colorTable=] [pseudoLevels=]/>`
- `<GraphEnvironment showGrid= showAxes= showGates= showFreqOnPlots= showGateNameOnPlots= showMedians= showUncomped= addEventParam= lastYAxisName=>` with `<TextTraits name="Labels|LayoutGates|Numbers|Legend" .../>` children.
  The chart writer passes "include environment", so this block is present. [H]
- **`showAxes` string** (read in `LEChart`): lowercase `t`/`n`/`l` turn on
  x-axis ticks, numbers and label. Uppercase `T`/`N`/`L` do the same for the
  y axis. `H` hides both axes. The default is `tnlTNL`. [H]
- **Transforms are not stored in the chart.** Axis scaling comes from the
  referenced sample's parameter transforms (`<Transformations>` on the sample)
  plus the `Axis` min/max/auto settings. [M]

**`<PopModelList>`**: the data layers: base layer, overlays and control. [H]
(`PopModelList.getElement/setElement`, `PopModel.getElement/setElement`, `LegendSpec.getElement/setElement`)
- One `<DataLayer>` per layer. The first is the base population. Each later
  one is an **overlay**.
- `DataLayer@path` (analysis path, as in 3.3), `@panelValue` (int,
  multi-panel modulo), `@discriminatorValue` (string), `@sampleGMID` (int,
  optional), `@sampleID` (string; written only when the layer has a node
  reference).
- Child `<LegendSpec color= text= chartFill= lineWeight= lineStyle= control=/>`:
  `color` is the layer color (for the base layer, the reader falls back to
  `Graph@foreColor`). `text` is the legend text. `chartFill` is a
  `le.chartfill.*` value. `lineWeight` and `lineStyle` use the Fig enums.
  **`control="1"` marks the control layer**, used for histogram-overlay
  comparisons. [H]
- A `DataLayer@path` of `Kinetics` switches on the kinetics axis. [H]

**`<WindowPosition x= y= width= height= displayed= panelState=/>`**: under
the chart, the absolute plot bounds. When this rectangle is not empty, the
factory uses it **instead of** the chart's own `x/y/width/height`. Sizes are
then still taken from `scaleH`/`scaleV`. [H] (`WindowStateElement.<init>(WindowState)`, `FigFactory.makeFigChartBox`)

**Dependent children** (`LEChart.extractDependents` / `LEChart.setElement`).
Each dependent carries the common Fig attributes **without**
`x/y/width/height`. Each also carries a `<WindowPosition>` whose `x`/`y` are
**relative to the main plot's top-left**, whose `width`/`height` are the size,
and whose `displayed` attribute says whether the dependent is shown. [H]
(`WindowState.setRelativePosition`, `Fig.setPosition`)
- `<Annotation>`: a `FigChartAnnotation`, which is a `StyledText` (section 4.1:
  `autoFitContents`, `autoMinimumSize`, `padding`, `<Content>`). Its HTML
  contains the annotation FJML tags `<Title/>`, `<PopulationName/>`,
  `<PopulationNameWithPath/>`, `<SampleName/>`, `<Count/>` and
  `<Frequency/>`, driven by the chart's `show*` flags. [M]
  (`ChartAttributes.getAnnotationText`)
- `<Legend>`: a `FigLegend`, which is a stat table without the model. It has
  the grid attributes of section 5.2 and a `<Columns>` child (column
  definitions), plus `showHeader` (bool). [M]
- `<Ancestry backgating= horizontal= backgatingLargeDots= backgatingContours=>`
  with a `<WindowPosition>`: the ancestry row of backgated parent plots.
  `displayed` turns the ancestry row on. [H] (`FigChartRow.extract/setElementSelf`)
- `<Multigraph type= displayType= rows= columns=>` with `<WindowPosition>` and
  `<Parameters><Parameter name=.../></Parameters>`. `type` is the enum name:
  `NONE`, `SLINKY`, `HISTOS`, `ALLBY`, `HALFNXN` or `NXN`. The reader matches
  it against the FCML or command forms and also accepts legacy labels, so the
  round trip for these values is [M]. `displayType` is a display type.
  Multigraph also writes the shape attributes of a `Rectangle`. [H/M]
  (`FigChartGrid.extract/setElement`)
- **Axes** (`FigXAxis`/`FigYAxis`) are not saved. They are rebuilt from
  `Graph` and `showAxes`. [H]

### 3.5 GraphDef and annotation flags: where each one lives

| Flag | Location |
|---|---|
| showGates, showFreqOnPlots, showGateNameOnPlots, showGrid, showMedians (on plot), showUncomped, showAxes | `Graph/GraphEnvironment@...` [H] |
| ancestry | `Ancestry` child (`WindowPosition@displayed`, `@backgating`, `@horizontal`) [H] |
| adjunct histograms | `ChartData@showAdjunctHistograms` [H] |
| annotation contents | `ChartData@show*` attributes and the `Annotation` child's HTML [H] |
| annotation, legend, multigraph visibility | `WindowPosition@displayed` of each dependent [H] |

---

## 4. Text, image and statistic figures

### 4.1 `StyledText` (`FigStyledText` extends `FigTextBox` extends `FigBaseText`)

Writer: `FigBaseText.getElement`. Reader: `FigBaseText.setElement`, then
`FigStyledText.setElement`. [H]

| Attr / child | Type | Meaning |
|---|---|---|
| common Fig attributes | | section 2 |
| `autoFitContents` | bool, default 0 | resize the box to fit the text [H] |
| `autoMinimumSize` | bool | [H] |
| `padding` | `"top,right,bottom,left"` ints, comma-separated with no spaces | inner padding in pt. The reader parses the values as doubles. [H] |
| `<Content>` | text | the document text, escaped (see below) [H] |
| `text` (attribute) | FJML string | **legacy, read only**. When present, it is converted to HTML and replaces the Content. [H] |

**What is in `<Content>`:**
- For `StyledText` it is the Swing `JTextPane` HTML of the document
  (content type `text/html`; `FigStyledText.DEFAULT_CONTENT_TYPE`). That is a
  full `<html><head></head><body><p style="margin-top: 0">...</p></body></html>`
  document with Swing's own whitespace and indentation, and `<font>`/`<b>`/
  `<i>`/`<span style>` markup for styling. [M]
- Live values (FJML) are embedded as
  `<input type="fjml" value="<URL-encoded FJML expression>">`. [H] (`FJTextPane.makeFjmlTag`)
- When FJML text is set, newlines in literal text become `</p><p style='margin-top:0'>` or `<br>`. [H] (`FJTextPane.fjmlToHtml`)
- For `SimpleText` (`FigTextBox`, content type `text/plain`) the Content is
  plain text. [H]

**Escaping (important):** `FigBaseText.getElement` escapes the text once with
`ParseUtil.escapeXmlText` (`&`->`&amp;`, `"`->`&quot;`, `'`->`&apos;`,
`<`->`&lt;`, `>`->`&gt;`, newline->`&#xA;`) before storing it as element text.
The workspace writer `SElement.toWriter` trims the text and escapes it
**again**. On disk the HTML therefore appears double-escaped, for example
`&amp;lt;html&amp;gt;`. On read, the XML parser undoes one level and
`FigBaseText.setElement` undoes the second with `unescapeXmlText`, then trims
the result. An importer must unescape twice. An exporter must escape twice:
escape the HTML once, then let a normal XML writer escape it again. [M-H]

### 4.2 `Image` (`FigImage`)

| Attr / child | Meaning |
|---|---|
| common Fig attributes | |
| `url` | the image URL, as a string (`file:/...`, `http...` or `envoyref://...`). On read, if the URL does not resolve, FlowJo tries the name relative to the workspace folder (both raw and URL-decoded), then relative to the plugin folder. [H] |
| `file` | read only, for `envoyref://` URLs [H] |
| `<Binary dt:dt="binary.base64" binaryDataSize=...>` | read if present. The payload is a **Java-serialized `javax.swing.ImageIcon`** in base64, not a PNG. **10.6.2 never writes it** (the embed flag is hard-coded off). Ignore it on import and do not write it. [H] (`FigImage.getElement/getImage/getImageElement`) |

### 4.3 Statistic figures

- **A statistic dropped onto a layout is a `StyledText` figure.**
  `LayoutEditor` builds an FJML string, calls `FigFactory.makeFigFjmlText`,
  and inserts it with `FigStyledText.insertFJML`. [H]
- The FJML for one statistic (`StatisticNode.getFjmlString`) is
  `<b>` + a population-name annotation tag + `</b>: ` + the statistic's display
  name + ` : ` + a statistic tag. [H]
  - The statistic tag is `<Statistic dataset="<sampleID>" originalDataset="<sampleID>" path="<analysis path>" name="<stat key>" [id="<parameter>"] [percent="<p>"] [ancestor="<name>"]/>`. [H] (`StatisticNode.getStatisticElement`, `PopNode.setDatasetAttributes`)
  - The population-name tag is an `Annotation` FJML element with the same
    `dataset`/`path` attributes. [M]
- Inside `<Content>` each tag is an `<input type="fjml" value="...">` with the
  value URL-encoded, and the whole thing is double-escaped as in 4.1. [M]
- `FigStatistic` (legacy) is read as `StyledText`. [H]
- **`StatTable`** (table of statistics): the grid attributes of 5.2 plus a
  `<StatTableModel showHeader= enableContentIteration=>` child. The child holds
  `<Populations>`, `<Columns>` and `<TextTraits name="Content" .../>`.
  `<Columns>` holds `Statistic`, `Graph`, `Key` (keyword) and `Anno`
  (annotation) entries. Decoded in section 9.1.
  (`FigStatTable.getElement(boolean)`, `StatTableModel.getElement/getColumnDefsElement/setColumnDefsElement`)

### 4.4 `SimpleFJML` (`FigLightweightText`)

This is `FigBaseText` (4.1) plus a `<TextTraits .../>` child that sets the
font for the whole box. [H]

---

## 5. Groups and grids

### 5.1 Group: a nested `<FigList>` element (`FigGroup`)

- Writer `FigGroup.getElement`: the common Fig attributes (including the
  group's own `x/y/width/height`), then each member's element in member order
  (back to front), with no `z` attribute. [H]
- Reader `FigGroup.<init>(SElement,Editor,true,true)`: applies the common
  attributes, then calls `makeFig` on every child element in order. Children
  that are not figures (for example `FigShadow`) return null and are skipped.
  A chart member also brings its dependents into the group. [H]
- `Group` is accepted as an alias on read. Groups may nest. There is no group
  ID, padding or extra state: `setElementSelf` is empty. [H]

### 5.2 `GridLayout` (`FigGridLayout` extends `FigBaseGrid`)

Writers: `FigBaseGrid.getElement`, `FigGridLayout.getElement`. Readers:
`FigBaseGrid.<init>(SElement,...)`, `restoreSettings`, `restoreContent`,
`restoreSizes`, `FigGridLayout.restoreBorderLabels`. [H]

| Attr / child | Type | Meaning |
|---|---|---|
| common Fig attributes | | |
| `rows`, `columns` | int | grid size. When missing, the defaults come from preferences (`tableRows`/`tableColumns`) [H] |
| `drawGrid` | bool, default 1 | draw cell lines [H] |
| `autoFitContents` | bool | auto-fit dropped content [H] |
| `<RowSizes><Size index="i" value="h"/>...</RowSizes>` | double, pt | row heights, clamped to at least 15 on read [H] (`XMLUtil.arrayToElement/readArrayFromElement`) |
| `<ColSizes><Size index="j" value="w"/>...</ColSizes>` | double, pt | column widths, same clamp [H] |
| `<Content><Cell row="r" col="c"><AnyFig/></Cell>...</Content>` | | one `Cell` for each **non-empty** cell, row-major, 0-based. Each holds exactly one figure element (ChartData, StyledText, ...). On read, the first child of each `Cell` goes through `makeFig`. Cells outside the grid are ignored. [H] |
| `<Labels><Row index="r" column="c"/>...<Column index="c" row="r"/>...</Labels>` | | border axis labels. `Row index=r column=c`: the Y axis of the chart at (r,c) is drawn on the grid's left border for row r. `Column index=c row=r`: the X axis of the chart at (r,c) is drawn on the bottom border for column c (`addChartAxesToBorder`). Written by `FigGridLayout` only. [H for structure, M for which axis] |

**Cell padding is not saved.** `FigBaseGrid.setCellPadding` changes only the
live `FJLayoutGrid`, and no attribute for it is written or read. After a
reload the padding exists only through the stored cell and row sizes. [M]
It is not known what happens to a figure that spans several cells (it may be
written once for each cell it covers). [L]

---

## 6. Example: chart figure (my own example, as 10.6.2 would write it)

This is a 2D pseudocolor plot of `Lymphocytes/Single Cells` from sample ID 3,
with a CD4 overlay layer, annotation and axes on, and ancestry and multigraph
off. Attribute order follows section 3.1. The values are illustrative.
Escaping in the Annotation `Content` is shown double-escaped and is
abbreviated with `...`.

```xml
<FigList>
  <ChartData x="72"  y="90"  width="160"  height="160"  lineWeight="Hairline"  fill="#ffffff"  stroke="#000000"  lineStyle="Solid"  gradientColor="#ffffff"  gradientStyle="le.gradientstyle.none"  enabled="1"  xScale="1"  yScale="1"  aspectRatioLock="0"  alpha="1"  figID="com.treestar.flowjo.charting.FigChartBox@5e3a9f#1730000000000"  rotation="0"  lock="0"  sizeLock="0"  contentLock="0"  wantsDrops="1"  dependents="1"  showSampleName="1"  showFullPath="0"  showFreq="1"  showCount="0"  showPopulationName="1"  showGraphTitle="0"  showMedians="0"  useShortName="1"  showKeyword="0"  keyword=""  showStatistic="0"  statistic=""  offsetHistograms="0"  offsetX="0"  offsetY="0"  flipH="0"  flipV="0"  showAdjunctHistograms="0"  path="Lymphocytes/Single Cells"  sampleID="3"  scaleH="0.625"  scaleV="0.625"  panelIndex="0"  z="0" >
    <Graph smoothing="0"  backColor="#ffffff"  foreColor="#000000"  type="Pseudocolor"  fast="1" >
      <Axis dimension="x"  name="CD3"  label=""  auto="auto" />
      <Axis dimension="y"  name="CD4"  label=""  auto="auto" />
      <GraphSettings level="5%"  smoothingHighResolution="1"  contourHighResolution="1"  histogramSmoothingCount="0"  graphResolution="256"  showOutliers="0"  drawLargeDots="0"  dotsToDraw="0"  tint="le.chartfill.tinted.40"  lineWeight="le.lineweight.normal"  lineStyle="le.linestyle.solid" />
      <GraphEnvironment showGrid="0"  showAxes="tnlTNL"  showGates="1"  showFreqOnPlots="1"  showGateNameOnPlots="1"  showMedians="0"  showUncomped="0"  addEventParam="0"  lastYAxisName="" >
        <TextTraits font="SansSerif"  size="11"  name="Labels"  style="plain"  color="#000000"  background="#00ffffff"  just="left" />
        <TextTraits font="SansSerif"  size="11"  name="LayoutGates"  style="plain"  color="#000000"  background="#00ffffff"  just="left" />
        <TextTraits font="SansSerif"  size="9"  name="Numbers"  style="plain"  color="#000000"  background="#00ffffff"  just="left" />
        <TextTraits font="SansSerif"  size="9"  name="Legend"  style="plain"  color="#000000"  background="#00ffffff"  just="left" />
      </GraphEnvironment>
    </Graph>
    <Annotation lineWeight="NoLine"  fill="#00ffffff"  stroke="#000000"  lineStyle="Solid"  gradientColor="#ffffff"  gradientStyle="le.gradientstyle.none"  enabled="1"  xScale="1"  yScale="1"  aspectRatioLock="0"  alpha="1"  figID="com.treestar.flowjo.charting.FigChartAnnotation@1b2c3d#1730000000001"  rotation="0"  lock="0"  sizeLock="0"  contentLock="0"  wantsDrops="0"  autoFitContents="1"  autoMinimumSize="1"  padding="0,0,0,0" >
      <Content>&amp;lt;html&amp;gt;...&amp;lt;SampleName/&amp;gt;...&amp;lt;/html&amp;gt;</Content>
      <WindowPosition x="0"  y="-18"  width="160"  height="16"  displayed="1"  panelState="" />
    </Annotation>
    <Legend ... >
      <WindowPosition x="170"  y="0"  width="80"  height="40"  displayed="0"  panelState="" />
      ...
    </Legend>
    <Ancestry ...  backgating="0"  horizontal="1"  backgatingLargeDots="0"  backgatingContours="0" >
      <WindowPosition x="0"  y="200"  width="160"  height="80"  displayed="0"  panelState="" />
    </Ancestry>
    <Multigraph ...  type="NONE"  displayType="Histogram"  rows="0"  columns="0" >
      <WindowPosition x="0"  y="0"  width="0"  height="0"  displayed="0"  panelState="" />
      <Parameters/>
    </Multigraph>
    <PopModelList>
      <DataLayer path="Lymphocytes/Single Cells"  panelValue="0"  discriminatorValue=""  sampleID="3" >
        <LegendSpec color="#000000"  text=""  chartFill="le.chartfill.tinted.40"  lineWeight="Normal"  lineStyle="Solid"  control="0" />
      </DataLayer>
      <DataLayer path="Lymphocytes/Single Cells/CD4+"  panelValue="0"  discriminatorValue=""  sampleID="3" >
        <LegendSpec color="#ff0000"  text=""  chartFill="le.chartfill.none"  lineWeight="Normal"  lineStyle="Solid"  control="0" />
      </DataLayer>
    </PopModelList>
    <WindowPosition x="72"  y="90"  width="160"  height="160"  displayed="1"  panelState="" />
  </ChartData>
</FigList>
```

Confidence for this snippet:
- Element and attribute names, and their order: [H].
- `z` position: `z` is added last (it is set on the finished element), so it
  is the final attribute. [H]
- `Ancestry`/`Multigraph` shape attributes, shown as `...`: [H] that they are
  present (each writes the common Fig attributes), not spelled out here.
- The `Legend` body: [M].
- Dependent offsets, colors and defaults (fill, lineWeight, wantsDrops, chart
  fill): [L], illustrative only.
- `width/height` vs `scaleH/scaleV`: 160 = 0.625 x 256, which keeps them
  consistent. [H] for the rule.
- Whether an empty-parameter Multigraph writes `<Parameters/>`: [M] (it
  always adds the element).

Minimal importable chart (what the reader needs): `<ChartData x y width
height scaleH scaleV path dependents="1">` with a `<Graph>` child and a
`<PopModelList><DataLayer path sampleID/></PopModelList>` child. Every other
attribute has a reader default. [M: inferred from the reader's defaults; not
run]

## 7. Example: text figure (my own example)

A text box reading "CD4 T cells" in bold, followed by a live
frequency-of-parent value for `Lymphocytes/CD4+` in sample 3. The `<Content>`
holds Swing HTML, double-escaped as on disk. For readability, the
single-escaped form (what an XML parser hands back) is shown first.

The text an XML parser returns for `<Content>` (still escaped once;
`FigBaseText.setElement` then applies `unescapeXmlText` to get the raw
`<html>...` markup):
```
&lt;html&gt;&#xA;  &lt;head&gt;&#xA;&#xA;  &lt;/head&gt;&#xA;  &lt;body&gt;&#xA;    &lt;p style=&quot;margin-top: 0&quot;&gt;&#xA;      &lt;b&gt;CD4 T cells&lt;/b&gt;: &lt;input type=&quot;fjml&quot; value=&quot;%3CStatistic+dataset%3D%223%22+originalDataset%3D%223%22+path%3D%22Lymphocytes%2FCD4%2B%22+name%3D%22Freq.+of+Parent%22%2F%3E&quot;&gt;&#xA;    &lt;/p&gt;&#xA;  &lt;/body&gt;&#xA;&lt;/html&gt;
```

As written to the .wsp (escaped once more by the writer):
```xml
<StyledText x="300"  y="96"  width="180"  height="24"  lineWeight="NoLine"  fill="#00ffffff"  stroke="#000000"  lineStyle="Solid"  gradientColor="#ffffff"  gradientStyle="le.gradientstyle.none"  enabled="1"  xScale="1"  yScale="1"  aspectRatioLock="0"  alpha="1"  figID="com.treestar.layout.presentation.FigStyledText@7f00aa#1730000000002"  rotation="0"  lock="0"  sizeLock="0"  contentLock="0"  wantsDrops="0"  autoFitContents="0"  autoMinimumSize="1"  padding="2,2,2,2"  z="1" >
  <Content>&amp;lt;html&amp;gt;&amp;#xA;  &amp;lt;head&amp;gt;&amp;#xA;&amp;#xA;  &amp;lt;/head&amp;gt;&amp;#xA;  &amp;lt;body&amp;gt;&amp;#xA;    &amp;lt;p style=&amp;quot;margin-top: 0&amp;quot;&amp;gt;&amp;#xA;      &amp;lt;b&amp;gt;CD4 T cells&amp;lt;/b&amp;gt;: &amp;lt;input type=&amp;quot;fjml&amp;quot; value=&amp;quot;%3CStatistic+dataset%3D%223%22+originalDataset%3D%223%22+path%3D%22Lymphocytes%2FCD4%2B%22+name%3D%22Freq.+of+Parent%22%2F%3E&amp;quot;&amp;gt;&amp;#xA;    &amp;lt;/p&amp;gt;&amp;#xA;  &amp;lt;/body&amp;gt;&amp;#xA;&amp;lt;/html&amp;gt;</Content>
</StyledText>
```

Confidence for this snippet:
- Element and attribute names and order: [H].
- `<input type="fjml" value=URL-encoded>`: [H]. The exact URL encoder (`+` or
  `%20` for spaces) is `UrlUtil.urlEncode`, not checked: [M].
- The Swing HTML skeleton and whitespace: [M]. This is JDK `HTMLWriter`
  behavior; a reader should parse the HTML loosely.
- The double escaping: [M-H] (from `FigBaseText.getElement` together with
  `SElement.toWriter`).
- The FJML statistic tag attributes: [H]. The `name` value (`Freq. of Parent`)
  is the `StatKey.toString` presentation form: [L].
- Default text-box styling values (NoLine, transparent fill, padding): [L].

---

## 8. Open points and things not determined

1. No real FlowJo-saved `FigList` was available. Nothing here has been checked
   against an actual file.
2. `lock`, `sizeLock` and `contentLock` are written but never read back in
   10.6.2, and the base Fig writes `xScale`/`yScale` but reads `scaleH`/`scaleV`.
   An importer can still honor the locks.
3. The default values FlowJo puts on new figures (line weight, fill, chart
   size) were not traced through the preference defaults.
4. The `StatTable` column and row schema is decoded in section 9.1; the
   `Legend` columns use the same column elements (not checked further).
5. `HeatMapGridLayout`, `FigMultigraphColorTable` and the shape subclasses (`Line` endpoints and arrowheads,
   `RoundRect` radius, `Polygon` points) were not decoded.
6. The reader for `flipH`/`flipV` was not located.
7. Cell padding in grids is not persisted (as far as these classes show), and
   the behavior of a figure spanning several grid cells is unknown.
8. `Group.getIndexOfSample` and the meaning of `sampleGMID` when iteration is
   OFF were not traced.
9. Exact Swing HTML text, and how fonts and colors appear in it, depend on the
   JDK (FlowJo 10.6.2 bundles its own JRE).

---

## 9. Object figures: `StatTable`, `DifferenceTable`, `TETable`, `PlateDisplay`

All four extend `FigBaseGrid`, so each starts with the common Fig attributes
(section 2) and the grid attributes of `FigBaseGrid.getElement`: `rows`,
`columns`, `drawGrid`, `autoFitContents`, `<RowSizes>`, `<ColSizes>`, then
the element returned by `getContentElement`. For `StatTable`,
`DifferenceTable` and `PlateDisplay` that content element is null (nothing
is written); the grid dimensions are recomputed from the model on read. [H]

### 9.1 `StatTable` (`FigStatTable.getElement(boolean)`, `createModel`; `StatTableModel.getElement / setElement / getNodesElement / setNodesElement / getColumnDefsElement / setColumnDefsElement`)

After the grid attributes comes one `<StatTableModel>` child: [H]

| Attr / child | Meaning |
|---|---|
| `showHeader` | bool; read with default 1 [H] |
| `enableContentIteration` | bool; read with default 0. Separate from the common Fig attribute of the same name [H] |
| `<Populations>` | the rows: one `<NodeReference>` each, in row order [H] |
| `<Columns>` | the columns in order; when the element is missing the reader uses the default columns (Subset Name with Gating Path, Count) [H] |
| `<TextTraits name="Content" .../>` | the cell font (`TextTraits.getAsElement`: `font`, `size`, `name`, `style` plain / bold / italic / bold-italic, `color`, `background`, `just` left / center / right; defaults SansSerif 11 plain) [H] |

`<NodeReference>` (`NodeReference.getElement`, `PopModelNodeReference.getElement`, `NodeReference.<init>(Workspace, SElement)`): [H]
- `rootID`: the FlowJo `sampleID` of the row's sample (for a group node, the
  group name with `isGroup="1"`). On read, an empty `rootID` falls back to
  `sampleID`, then `groupName`.
- `path`: the node's analysis path (`AppNode.getAnalysisPathString`, the
  node names below the sample joined by `/`, as `DataLayer@path`); empty for
  the sample itself.
- `control="1"` (written by `StatTableModel.getNodesElement` for control rows;
  `setNodesElement` puts such rows in the control list).
- `discriminatorValue`, `panelValue` (only when set) and an
  `<OriginalNodeReference>` child: iteration state of `PopModelNodeReference`.

Column elements (`setColumnDefsElement` dispatches on the element name): [H]
- `<Anno name="fj.anno.*"/>`: annotation (`Annotation`, an
  `AttributeValuePair`: `name`, optional `value`). Keys `fj.anno.popname`,
  `.indentedpopname`, `.popnamewithpath`, `.samplename`, `.wsanno`,
  `.compmatname`, `.fullpath`.
- `<Key name="<keyword>"/>`: an FCS keyword (`Keyword`, also an
  `AttributeValuePair`).
- `<Statistic .../>` (`Statistic.addToElement(SElement, false)`, read as
  `TableStatistic`): `name` = the StatKey string (as Statistic nodes in the
  sample tree: `Count`, `Median`, `fj.stat.freqofparent`, ...), `id` =
  parameter name cut at `::` (`StringUtil.truncateToColons`), `percent` for
  percentile statistics, `ancestor`, `correlate` (second parameter),
  `expectedRange` (the name of a preference range); no `value` (the boolean
  is false). `TableStatistic` adds `subPopulation` (a statistic of a
  sub-population relative to the row) when not empty.
- `<Graph .../>`: a `GraphSpec` chart column.

### 9.2 `DifferenceTable` (`FigDifferenceTable.createModel`, `DifferenceTableModel.getElementName / getElement / setElement`)

As 9.1, but the model element is named `<Model>` (`DifferenceTableModel`
overrides the element name and `FigDifferenceTable.createModel` reads the
`Model` child). After the TextTraits it holds `<Control sampleID="..."/>`
when a control sample is set; on read the sample is found by that ID. [H]

### 9.3 `TETable` (`FigTableDisplay` extends `FigGridLayout`; `install(TableData)`)

Written by `FigGridLayout`, so the content is a GridLayout `<Content>` with
one `<Cell row col>` per figure and an (empty) `<Labels>` (section 5.2); the
reader is the GridLayout reader. `install` builds the cells: [H]
- `rows` = table rows + 1, `columns` = table columns.
- Row 0: a `StyledText` per column made with `makeFigFjmlText` from the
  column header (`ColumnSpec.nodeToHeader`, or the formula text of an
  unnamed formula column); column 0's header is empty. Font: the
  `tables` text style size and family, no background.
- Rows 1..n: a `SimpleFJML` (`FigLightweightText`, section 4.4) per cell with
  the cell text as `<Content>` (escaped twice like StyledText), padding
  `1,4,1,4`, the table font, and the format's `FontOptions`
  (`TableData.getFontOptions`): the background becomes the figure's `fill`
  (white becomes no fill), the foreground colour and bold / italic go to the
  `<TextTraits>` (`color`, `style`). `FontOptions` has no arrow, so the table
  editor's expected-range arrows are not part of the figure. [H]
- Cell padding of the grid is 0 (`FigTableDisplay.init`; not saved). [M]

### 9.4 `PlateDisplay` (`FigPlateDisplay.getElement`; `PlateDisplayModel.getElement / setElement`; `PlateDisplayStatistic.getElement / setElement`; `HeatmapRange.getElement / <init>(SElement)`)

After the grid attributes, one `<PlateDisplayModel>`: [H]
- `groupName`: the sample group shown.
- `displayMode`: `DisplayMode.toFCML`, the dictionary keys
  `le.plate.display.mode.heatmap` / `le.plate.display.mode.chernoffface`
  (a null mode is written as heatmap). Read with `FJMLUtil.find`, which
  compares `toFCML` ignoring case.
- `<Statistics>`: one `<PlateStatisticReference>` per statistic:
  - `path`: the statistic node's full path (`StringUtil.pathToString` of
    `AppNode.getPath`: the names of the population nodes and then the
    statistic node, joined by `/`). The statistic node's name is
    `Statistic.getDescription(sample)`: the statistic label (StatKey text,
    for example `Freq. of Parent`, `Median`; Freq. of adds the ancestor),
    ` (<percentile as a Java double>)` for percentiles, ` : ` and the
    parameter's stain or name when the statistic has a parameter, and
    ` / <second parameter>` for correlations. [H for the structure, M for the
    exact name text]
  - `displayTarget` (only when set): `DisplayTarget.toFCML`, keys
    `le.plate.display.comp.heatmap1`, `.heatmap2`, `.face.pupilsize`,
    `.face.eyespacing`, `.face.headshape`, `.face.eyesize`,
    `.face.eyeshape`, `.face.eyebrows`, `.face.nose`, `.face.mouthsize`,
    `.face.grin` (CHERNOFF_MOUTH_HEIGHT), `.face.mouth`.
  - child `<HeatmapRange method= range=/>`: `method` =
    `fj.heatmap.method.auto` or `fj.heatmap.method.expectedrange`, `range`
    = the preference range name (only when not empty).
- Show Sample Name is **not** saved (`fShowSampleName` starts false and is
  not in `getElement`). [H]

### 9.5 flowjo-rea import and export

`src/core/wspLayout.ts` reads and writes all four (tests
`tests/wsp-objects.test.ts`). Own rules: an expected range is written as the
range name `"<min> - <max>"` and such a name is read back as numbers (other
names are FlowJo preference ranges: reported, not applied); the table
editor table's name and the plate's Show Sample Name are kept in extra
attributes (`TETable@name`, `PlateDisplayModel@showSampleName`) that FlowJo
does not read; plate statistics are statistics columns of the workspace,
matched by the node path or added; group rows, Graph columns and
sub-population statistics are reported and skipped on import. The written
`TextTraits` use the default SansSerif 11 font [L for FlowJo's own table
font].
