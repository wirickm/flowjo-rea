# Table editor and generated table window (FlowJo 10.6.2)

Behavioural spec for FlowJo 10.6.2's table editor (`TEditor`, commands in
`com.treestar.flowjo.application.teditor.actions.TECommand`) and the
generated table window (`CalculatedTable`, commands in
`...teditor.generation.view.FJTableCommand`). Read with `javap` on the 10.6.2
jar (fjlib 2.3.0 for `SExplorer`, `FontOptions`) and the resource bundle
`flowjodictionary.properties`; implemented independently. Rules live in
`src/core/tableEditor.ts`, the UI in `src/ui/TableEditor.tsx` (re-exported
from `src/ui/Editors.tsx`). Tests: `tests/tables-gaps.test.ts` (unit),
`e2e/tables-gaps.mjs` (Playwright, 42 checks).

Status words: **Done** (test named), **Own rule** (deliberate difference and
why), **Deferred** (why). A command with no action wired in 10.6.2 is said
so: the enum constant exists but no `*Action` class matches it (checked by
grepping every `TECommand.<NAME>` reference across the decompiled
`teditor` package).

## How the 10.6.2 editor is organised

- The template's columns are shown as the *rows* of a list
  (`TEditorTable`, `TEditorModel.getColSpecAt`). "Select All" and "Clear"
  act on that list, and the Formatting and Plots buttons act on the
  selected columns (`TEFormatAction.doAction` loops over
  `TEditorTable.getSelectedRows`; `TEPlotAction.doAction` takes
  `TEditorTable.getColumnSpecs`). flowjo-rea shows the same list
  (`table-columns`, click / Ctrl-click / checkbox to select).
- A statistic column is a `ColumnSpec`: population (analysis path),
  statistic, parameter, percentile, ancestor; it does not need a statistic
  in the workspace. flowjo-rea's statistic column carries the same fields
  (`TableColumn.stat`, a `StatColumn` without id) and computes its values
  in the analysis worker for every loaded sample, live (recomputed when the
  samples, matrices, derived parameters or transforms change). Older tables
  whose columns point at a Statistics-panel column (`statColumnId`) still
  work.

## 1. Columns

### TECommand.COLUMNEDIT "Edit Column..." (and COLUMNADD "Add Column")
- `TEColumnAction.doAction`: COLUMNADD calls `ColumnInfoDialog.show(editor,
  true)`, COLUMNEDIT `show(editor, false)` on the current column. The dialog
  (`ColumnInfoDialog`, `ColumnInfoTTPane`) has three types: statistics
  ("Add Statistics information from the workspace"), keywords and formula
  ("Compute algebraic expressions based on other columns").
- `StatisticSelectionPanel`: statistic list = every statistic
  (`StatKey.getStatNameArray`), "Parameter:" combo from a sample,
  "Percentile:" field (default `"90"`, range 0 to 100), "Ancestor:" combo
  (None / parent / grandparent / total / named ancestors), population chosen
  from a sample's tree (`PopulationPopup`, "Choose...").
  `testValidity` refuses an incomplete choice.
- Header: the column's own name (`ColumnSpec.setRename`) or the automatic
  header.
- flowjo-rea: "Add Column..." / "Edit Column..." (or double-click a column)
  open `table-column-dialog`: type radio, Population (all gating paths of
  the workspace plus All events), Statistic (every statistic the app
  computes), Parameter, Percentile (default 90), "with" parameter for
  Correlation, `<Ancestor>` for Freq. of, Name (empty = automatic). OK is
  disabled with a message while the choice is incomplete. Editing keeps the
  column's format. **Done** (e2e "Edit Column changes the statistic and the
  header name", "Freq. of without an ancestor is refused").

### TECommand.STATMEDIAN "Median", TECommand.STATCV "CV"
- No action is wired to these two constants in 10.6.2 (no ribbon button);
  Median and CV are chosen in the statistic list of the column dialog.
- flowjo-rea: chosen in the column dialog, with every other statistic; no
  Statistics-panel column is needed (the Statistics panel is unchanged).
  **Done** (e2e "Median, CV, Freq. of and Count columns added from the table
  editor", "the Statistics panel did not need (or get) columns").

### TECommand.STAT_CHANGEPOP "Population:", TECommand.STAT_CHANGEANCESTER "<Ancestor>"
- `StatisticSelectionPanel` (the only users of these constants): the
  population popup and the ancestor combo ("Select the ancestor population
  to add Freq. of to....").
- flowjo-rea: `col-pop` and `col-ancestor` (the ancestors of the chosen
  population, first entry `<Ancestor>`). **Done** (e2e "Population picker
  lists the gating tree paths", "<Ancestor> picker lists the ancestors").

### TECommand.ADDKEYWORDPOPUP "Keywords", TECommand.ADDPARMKEY "Add Parameter Keyword"
- ADDKEYWORDPOPUP is a `TEEditAction` ("Include FCS or custom keywords from
  the sample files into the table"). ADDPARMKEY has no action in 10.6.2;
  parameter keywords are offered in the column dialog's "Parameter
  Keywords" list next to "File Keywords" (`ColumnInfoTTPane`,
  `KeywordSelectionPanel`).
- flowjo-rea: "Keywords..." popup (file keywords of all samples),
  "Parameter keywords..." popup (`$PnX` keywords, with the first sample's
  value), both also in the column dialog; typing a keyword still works.
  **Done** (e2e "Keywords popup adds a keyword column", "Parameter keyword
  popup adds a $PnX column").

### TECommand.EDIT_COL_NAMES "Create Column Names"
- `TEEditAction` calls `ColumnNamingDialog.show(template)` (only when the
  table has columns). The dialog "Column Header Naming" has a template text,
  a "< Add To Column Header >" combo that inserts tokens (`ColumnSpecUtil.
  populateFunctionComboBox`): `'Last Population Name'`, `'Complete Gating
  Path'`, `'Statistic'`, `'Parameter Name'`, `'Parameter Stain'`, a preview
  of the first statistic column, Clear / OK / Cancel.
- OK (`extract`): stores the template on the table (`autoColumnName`) and
  renames every column that is not a formula or keyword column with
  `getHeaderStrForColumn`: last population name, full path, the statistic's
  presentation name (Freq. of followed by the ancestor; a percentile
  prefixed with its value), parameter name, stain (the name when there is no
  stain).
- flowjo-rea: `table-naming-dialog` with the same tokens and preview;
  `headerFromTemplate`; the stain is the first sample's `$PnS`. An empty
  template restores automatic names. The template also names new columns.
  **Done** (unit "replaces the quoted tokens"; e2e "Create Column Names
  renames every statistic column").

### TECommand.EDITSELECTALL "Select All", TECommand.EDITCLEAR "Clear"
- `TEEditAction`: Select All selects every row of the column list; Clear
  calls `TEditor.doRowDelete`: confirm "Do you want to delete this column
  from resultant tables?" (`te.strings.query`), then removes the selected
  columns.
- flowjo-rea: `table-select-all`, `table-clear` with the same question.
  **Done** (e2e "Select All selects every column", "Clear asks ...", "Clear
  removes the selected column").

### TECommand.TEMPLATEDUPLICATE "Duplicate"
- `TEListAction` calls `SExplorer.doDuplicateTemplate`: copy of the
  selected (else current) template, named `uniqueTemplateName(name)`
  (`NameUtil.uniqueName`), selected afterwards. New tables are named
  "Table" (`doNamedTemplate("Table")`), uniquely.
- flowjo-rea: `table-duplicate`; names via the app's `uniqueName` (FlowJo's
  NameUtil rule, "Table" then "Table-1"). **Done** (unit "Duplicate keeps
  the columns"; e2e "Duplicate makes Table-1").

## 2. Generated table window (FJTableActionManager / FJTableAction)

`TableFactory.makeTable` with destination DISPLAY builds a `TableFrame`
holding a `CalculatedTable` that recalculates live. flowjo-rea shows it in
the editor (`table-window`) with live values. **Done** (e2e "Create Table
(Display) shows the table window with live values").

| Command | 10.6.2 rule | flowjo-rea |
|---|---|---|
| SELECT_ALL "Select All" / SELECT_NONE "Select None" | `CalculatedTable.selectAll` / `clearSelection` | row click, Ctrl/Cmd toggle, Shift range; buttons. **Done** (e2e) |
| DELETE_SELECTED_ROWS | confirm "Remove the selected row from the tables?" (plural "...rows..."), each row's name is added to the omit list (`TableData.omit`), summary statistics recomputed | same; omitted rows live in the window (not saved). **Done** (e2e "Delete Selected Rows removes the row and recalculates the summary") |
| FIND, FIND_MESSAGE | input "Please enter the text to find in the table:" (remembers the last text); trimmed, empty does nothing; clears the selection and selects every row with a cell that contains the text (case sensitive) | `findRows`, inline prompt. **Done** (unit "Find", e2e) |
| MAKE_GROUP "Create Group from Selection" | asks "What is the group named?" default "My group", unique group name, group of the samples named in the selected rows' first column | same, inline prompt. **Done** (e2e) |
| OPENSAMPLES "Open Selected Samples" | opens each selected row's sample at the analysis path of the first column | opens a graph window per sample on the first statistic column's population (classic layout: selects it). **Done** (e2e) |
| COPY "Copy Table to Clipboard" | `FormattedTextTransferable`: HTML (the part of the HTML output between `<body>` and `</body>`) plus TAB text | same (`text/html` + `text/plain`). **Done** (e2e) |
| COPY_HTML "Copy As HTML" | HTML body as both the HTML and the plain text flavour | same. **Done** (e2e) |
| SHOW_SUMMARY_STATS | toggles Mean / Std. Deviation rows | toggle bound to the table's Show Summary Stats. **Done** |
| SAVEAS | save in the template's output format | `tw-save`. **Done** |
| ADD_TO_LAYOUT | `FJTableAction.addToLayout`: shows the layout editor, deselects all, `FigFactory.makeTable` adds a `FigTableDisplay` (element `TETable`), `TableController.addFigTable`, `FigTableDisplay.install(TableData)`: a grid of the column headers and the rows with their format colours (padding 4); notifies once "Calculated tables added to the layout are not live and will not update." | **Done**: a table figure (layout object `tetable`, `teTableSpec`) with a Sample column, the headers and the values with the column formats, at (40, 40); not live. e2e followup-layout "Batch To Current Layout adds a table figure (TETable)"; unit "a table-editor table becomes a static TETable". .wsp: not written (Deferred, see layout.md 7.2) |
| PRINT "Print..." | Swing print of the table with header / footer | **Own rule**: opens the HTML table with the header and footer in a new window and calls the browser's print dialog. e2e "To Printer opens a print page with the header and footer" |
| GRAPH "Graph" | registered in `FJTableActionManager` but no branch in `FJTableAction.doAction` in 10.6.2 | **Not a gap: no-op in FlowJo 10.6.2** (the editor's Plots band covers graphing of columns) |
| SELECT_TABLE_IN_LAYOUT "Select Table in Layout" | the enum constant (`fj.tableactionmanager.select`) is referenced by no other 10.6.2 class: neither `FJTableActionManager` nor `FJTableAction` handles it (`TableController.getFigTables` keeps the placed tables but nothing selects them) | **Not a gap: no-op in FlowJo 10.6.2**. Placed tables are real table figures now (ADD_TO_LAYOUT) and are selected in the layout as any figure |
| SAVE_FIGURE "Save As Figure" | registered in `FJTableActionManager` (accelerator 5) but `FJTableAction.doAction` has no branch for it in 10.6.2; `FigureSpec(TableData, name, description)` (id = next figure number, mimetype "text/table", Table and HTML children) exists but is never called | **Own rule** (coordinated with the MIFlowCyt work): "Save As Figure" in the table window adds the table to the experiment figure list (`Workspace.experiment.figures`, `addTableFigure` in src/core/miflowcyt.ts) as FigureSpec would: next number as id, "text/table", the table name as description; the data is not embedded. e2e followup-layout "Batch to Figure and Save As Figure store the table as experiment figures"; unit "Save As Figure / Batch to Figure" |

## 3. Output targets and formatting

### TECommand.BATCHSELECTDESTINATION "Output Target", BATCHCLIPBOARD, BATCHPRINTER, BATCHLAYOUT
- `TableTemplate$TableDestination`: DISPLAY "Display", CLIPBOARD "To
  Clipboard", FILE "To File", LAYOUT "To Current Layout", PRINT "To
  Printer" (`toDisplay`, `toClipboard`, ... in the XML). `TableFactory.
  makeTable`: DISPLAY and PRINT build the table frame (PRINT prints it);
  FILE saves `createTableByFileType(outputFormat)`; CLIPBOARD puts the Copy
  Table transferable on the clipboard; LAYOUT sends the table data to the
  layout.
- flowjo-rea: `table-dest` select and "Create Table" (`te.batch`), saved on
  the table (`destination`, default Display). **Done** (e2e for each
  destination); LAYOUT a table figure (Done), PRINT as the Own rule above.

### TECommand.BATCHEXT "File Type:", TECommand.OUTPUTFORMAT
- `TEFileFormatComboBox` lists `FJDocumentType` values; `createTableByFileType`
  writes CSV, TAB, HTML, EXCEL (Apache POI HSSF, binary .xls), XML_EXCEL
  (SpreadsheetML 2003: `mso-application progid="Excel.Sheet"`, a Worksheet
  named after the table, a "Sample" header cell, cells typed Number or
  String), XML_FLOWJO and SQL. OUTPUTFORMAT has no action in 10.6.2.
- flowjo-rea: File Type CSV, TAB, HTML, XML Excel (`tableExcelXml`, `.xml`,
  opens in Excel). **Own rule** for Excel: the SpreadsheetML format is
  written instead of binary .xls (no new dependency; it is FlowJo's own XML
  Excel output). FlowJo XML and SQL: **Done** (follow-up round, decoded
  from `TableGenerator.createTableAsFlowJoXML` / `createTableAsSQL`; unit
  "table output FlowJo XML and SQL", e2e followup-formats "To File, FlowJo
  XML", "To File, SQL"):
  - XML (`.xml`, label "XML"): `<Table name>` with `<Columns>`, one
    `<Column id>` per column (`customRename` when the header differs from the
    automatic one; `keyword`; or `analysisPath`, `statistic`, `population`,
    `parameterName`, `stain` looked up on the first row's sample; or
    `formula`), then one `<Row sample workspaceTitle>` per table row with an
    `<Entry colId>` per column. Printed as `SElement.toWriter` does: no XML
    declaration, two spaces per level, empty elements as `/>`.
  - SQL (`.sql`): per row `INSERT INTO '<name>' ('<h1>',...) VALUES
    ('<v1>',...)` and a line break; single quotes in the name become double
    quotes, values are not escaped, empty headers are left out, nothing is
    written without rows or headers, summary rows count as rows. FlowJo
    pairs header i with TableData cell i, whose cell 0 is the sample name,
    so the values are (sample, columns 1..n-1) and the last column is not
    written; kept as FlowJo does. HTML output now follows `createTableAsHTML` (grey
  header, white header text, format colours, bold / italic). **Done** (unit
  "XML Excel", e2e "To File, XML Excel").

### TECommand.BATCHOPTIONS "Batch Options"
- No action is wired in 10.6.2. **Own rule**: nothing to show; the output
  target and file type cover the batch choices.

### TECommand.FORMATHEATMAP, FORMATSTDEV, FORMATEXPECTEDRANGE
- `TEFormattingBand`: three toggles (one at a time) applied to the selected
  columns (`extract` sets `setHeatMap`, `setStdDevFormat`,
  `setExpectedRange(name)`).
- Colours (`ColumnSpec.getFontOptions(double)`,
  `CalculatedTable.getHeatMapColoring`, `getContrastingHeatmapColor`,
  `TableData.computeSummaryStats` for the column range, mean and SD):
  - Heat Map: u = clamp((max - v) / (max - min), 0, 1), blue = int(255 u),
    red = green = 255 - blue (max yellow, min blue); text white when blue >
    128 and red < 128, else black.
  - Standard Deviation: z = |v - mean| / SD; red text when z > 2, bold when
    z > 1, italic when z > 0.5, white background.
  - Expected Range: a named range from the preferences; below min cyan and a
    down arrow (`CustomLabel.set`), above max yellow and an up arrow;
    frequency values are divided by 100 before the comparison.
- flowjo-rea: radio None / Heat Map / Standard Deviation / Expected Range
  for the selected columns, shown in the editor preview, the table window
  and the HTML output. **Done** (unit "formatting", e2e "Heat Map colours
  the preview", "Expected Range ...", "Standard Deviation ..."). **Own
  rule** for Expected Range: min and max are entered on the column (the
  app's preferences have no named range list), in the column's displayed
  units (no division by 100).

## 4. Table plots

### TECommand.PLOTBOXWHISKERS "Box-n-Whisker Plot"
- `FJBoxAndWhiskerFrame.showWhiskerBoxPlot`: a JFreeChart box and whisker
  chart, one box per selected column, median and mean shown. Quartiles,
  whiskers and outliers follow JFreeChart's `BoxAndWhiskerCalculator`
  (Q1 / Q3 = medians of the lower / upper half, an odd count includes the
  median in both; whiskers at the extreme values within 1.5 IQR; outliers
  beyond, far outliers beyond 2 IQR).
- Every plot first refuses a selected column with SD < 1e-4: "Can't plot
  variables that are all the same value." (`te.plot.samevalerror`).
- flowjo-rea: SVG plot (`boxStats`). **Done** (unit "box and whisker", e2e).

### TECommand.PLOTREGRESSIONPLOT "Correlation", SCATTER_TRANSPOSE, SCATTER_SAVE
- `ScatterPlotController` on a template of the selected columns with a
  regression: scatter, fitted line, "R:", "Slope:", "Intercept:".
  `TEScatterAction`: Transpose Axes swaps x and y, Save as... saves the
  plot.
- flowjo-rea: the first two selected columns (x, y), least-squares line and
  Pearson R (`regression`); Transpose; Save as... downloads SVG (**Own
  rule**: SVG instead of FlowJo's image formats). **Done** (unit, e2e).

### TECommand.PLOTTIMESERIES "Time Series"
- `QCController` on the selected columns: values over acquisition time,
  "Start Time:" / "End Time:".
- flowjo-rea: one line per selected column against `$DATE` + `$BTIM`;
  when a sample lacks them, against row order (**Own rule**: FlowJo's QC
  window, limits and annotations are not reproduced). **Done** (e2e "Time
  Series plot").

### TECommand.PLOTPOINTCLOUD "3D Plot"
- `TEPlotAction.plot`: refused with "Can't plot variables that are all the
  same value." when a selected column's standard deviation is in [0, 1e-4);
  otherwise `ThreeDDataModel(TableData)` makes one axis per selected column
  (min / max; an empty cell fails with "Plot error: The data in column '%s'
  can not be plotted.  Try batching the table first to check for empty
  cells."; a frequency column spans 0..100; else a range under 0.001 becomes
  [min, min + 1] and the range is widened 10% each side), then a
  `ThreeDController` with point scale 0.8 and the colour axis on the third
  column with the Spectrum gradient.
- flowjo-rea: "3D Plot" in Plots (selected columns, at least three; X, Y, Z =
  the first three) opens the 3D Viewer (platforms.md section 5). **Done**
  (unit `table axes: widening, tiny range, frequency, empty cells`; e2e
  "Table 3D Plot ..." in `e2e/followup-3d.mjs`).

## 5. Print, header / footer, figures

### TECommand.EDITHEADER "Edit Header / Footer"
- `TEEditAction` opens `FJHeaderFooterDialog` for the table ("Edit the
  information that appears in your table print outs"); saved as the
  template's `header` / `footer`.
- flowjo-rea: one header and one footer text per table, printed above and
  below the table (**Own rule**: FlowJo's dialog has left / centre / right
  fields and variables). **Done** (e2e "To Printer opens a print page with
  the header and footer").

### TECommand.BATCHPRINTER "To Printer", FJTableCommand.PRINT "Print..."
- **Own rule**: browser print of the HTML table (see section 2).

### TECommand.BATCHTOFIGURE "Batch to Figure", FJTableCommand.SAVE_FIGURE
- FlowJo 10.6.2: BATCHTOFIGURE ("Generate the table and store it in the list
  of figures in the Experiment Annotation window") appears only in the
  `TECommand` enum; SAVE_FIGURE is registered but `FJTableAction.doAction`
  has no branch for it; the figure list (`FigureListPanel`,
  `FigureListTable`, `FigureSpec`) is filled only from a read
  `<experiment><figures>` element. Both commands do nothing in 10.6.2.
- flowjo-rea: **Own rule**, implemented as the tooltip describes, on the
  experiment figure list of the MIFlowCyt work (`Workspace.experiment`,
  src/core/miflowcyt.ts, src/ui/Experiment.tsx; the storage is shared with
  that module): "Batch to Figure" in the editor and "Save As Figure" in the
  table window add `{ id: next number, mimetype: "text/table", description:
  table name }` (`addTableFigure`). Tests as in section 2.

### TECommand.BATCHLAYOUT "Batch To Current Layout", FJTableCommand.ADD_TO_LAYOUT
- **Done**: a table figure in the current layout (section 2; layout.md 7.2).

## Uncertain

- Find's case sensitivity follows `String.contains` (case sensitive); the
  cell text compared is FlowJo's displayed text, flowjo-rea compares its own
  number formatting.
- The Clear confirmation in 10.6.2 has no Don't Ask Again key; flowjo-rea
  asks every time.
- The Statistics columns' NaN for samples whose data are not loaded is this
  app's convention (FlowJo always has its samples' data).


### TECommand.RIBBONCONFIG "Customize Ribbon", TECommand.RIBBONSETDEFAULT "Apply defaults" (follow-up f2)
- `TEActionManager` creates `TERibbonConfigAction(RIBBONCONFIG)` and
  `TERibbonSetDefaultAction(RIBBONSETDEFAULT)` (confirm
  `te.ribbon.setdefaults.confirm`, new `TERibbonStructure`, save preferences,
  reload the ribbon). `TERibbonAddBandAction` / `TERibbonRemoveBandAction`
  change the structure and save it to the `TERibbon` preference;
  `TERibbonCommitToPrefsAction` exists but no TECommand constant wires it.
  Defaults (`TERibbonStructure`): Table Editor: Tables, Iteration, Output;
  Edit: Columns; Visualize: Formatting, Plots. Add / remove / drop rules as
  the workspace ribbon (docs/validation/ui-gaps/workspace.md section F2.3).
- flowjo-rea: "Customize Ribbon" (`te-ribbon-config`) in the table editor;
  the Formatting, Iteration, Output and Plots bands can be removed, added
  back and reordered; Apply defaults. **Done** with own rules: one strip (one
  task) of the app's fieldsets; the table list and the column list are the
  editor body and stay fixed; no Commit to Preferences. Tests: e2e
  `e2e/followup-f2.mjs` "table editor: removing the Plots band hides it",
  "table editor: bands reorder", "table editor: Apply defaults restores the
  bands".
