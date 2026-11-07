# Workspace window (WSCommand) gaps: FlowJo 10.6.2 behaviour and status

Source: the FlowJo 10.6.2 jar read with `javap` (class and method names below;
no FlowJo code is reproduced here) and the UI strings in
`com/treestar/flowjo/core/flowjodictionary*.properties`. Command enum:
`com.treestar.flowjo.application.workspace.actions.WSCommand`; the action that
handles each command is created in `WSActionManager` (constructor and the
`make*Actions` methods). "Not wired" means 10.6.2 defines the command but
creates no reachable action for it.

Status words: **Done** (matches; test named), **Own rule** (deliberate
difference, reason given), **Deferred** (reason given).

Implementation: `src/core/booleanExpr.ts`, `src/core/workspaceTable.ts`,
`src/core/template.ts`, `src/core/zip.ts`, `src/core/xlsx.ts`,
`src/ui/WorkspaceTools.tsx`, workspace-window parts of `src/ui/App.tsx`,
`src/ui/GroupDialog.tsx`, `src/ui/Dialogs.tsx` (Find), `src/core/wsp.ts` /
`src/core/wspWriter.ts` (`<Columns>`), `src/core/service.ts` (`rawBytes`).
Tests: `tests/workspace-gaps.test.ts` (18 tests), `e2e/workspace-gaps.mjs`
(38 checks).

## B. Boolean gates

### B1. Names of AND / OR / NOT / identity nodes (all boolean commands)

- `AndOrNode.generateName(list, nameMap, combo)`: operand names joined by the
  node's connector, `" & "` for AND (`AndNode.getNameConnector`) and `" or "`
  for OR; no connector for combination gates. An operand name (or its
  abbreviation from the naming map) that contains `" or "`, `" and "` or
  `" not "` after its first character is put in brackets. After each operand
  a `+` is appended (a `-` for a NOT node) unless the name already ends with
  that sign (`CombinationGatesDlog.superPlus` = `+`, `superMinus` = `-`; plain
  ASCII in 10.6.2). The fixture `8_color_ICS_boolean_gate_testing.wsp` has
  `CD107a+ & IFNg+`, `CD107a+ or IFNg+` and `IL2+-`, as the rule gives.
- `NotGateNode(PopNode)`: name = operand name + `-`.
- `IdentityNode(PopNode)`: an OR node of the one operand, name = operand name + `=`.
- New names go through the sibling-unique rule (specs 6.7).
- Status: **Done** (`tests/workspace-gaps.test.ts` "boolean gate names"). The
  earlier names `A & B`, `A | B`, `NOT A` were this app's own and are replaced;
  `e2e/step2.mjs` a2-09 now expects `Rect 2-`.

### B2. Make And / Or Gate naming dialog (GATEAND, GATEOR; context for B4)

- `WSBoolGateAction.askUserForNames` opens `ComboGateNodeNamingDialog`
  ("Boolean Gate Naming Dialog", columns "Subset Name" / "Abbreviation"); the
  abbreviation defaults to the name, only changed non-empty ones go into the
  map, and the map is remembered (a static map) for later dialogs. Cancel
  aborts. AND / OR need 2 or more selected populations (`SoundUtil.failure`
  otherwise); the node goes under the first operand's parent.
- Status: **Done** (e2e "AND asks for abbreviations and names T+ & CD3+=+").
  Remembered for the browser session.

### B3. BOOLEANCREATE "Boolean Expression..." (tooltip "Create unique Boolean gates")

- FlowJo 10.6.2: `WSBoolGateAction.doBooleanGates("create")` opens
  `BooleanGateDlog` ("Boolean Gate Definition", instructions "Under
  construction: Type CellQuest-like boolean expressions here"), a formula
  panel whose error line is preset to "!!!DOES NOT WORK YET!!!";
  `okayActionPerformed` reads the formula and only repaints the layout
  editor, `makePopReferences` returns an empty list: no gate is made. The
  action (`aBooleanDialog`) is created but never put in a menu or band.
- This app (**Own rule**, asked for in the gap list): a Boolean Expression
  dialog takes `and`, `or`, `not` (or `&`, `|`, `!`) and brackets over
  population names (double quotes for names with spaces or operator words;
  bare words are joined into one name). It is compiled into FlowJo's own node
  types so the result stays a FlowJo-style tree: each `not X` becomes a NOT
  node `X-`, each nested and / or an AND / OR node named by B1, all siblings
  of the selected population; an equivalent existing sibling (same operator,
  same operands) is reused instead of duplicated. The top node gets the B1
  name. Unknown names and syntax errors are reported in the dialog.
- Status: **Own rule** (tests "Boolean Expression (own rule)"; e2e "a mixed
  expression becomes FlowJo AND / OR nodes, reusing the equivalent AND node").

### B4. BOOLEANEDIT (edit an existing boolean gate)

- FlowJo 10.6.2: `doBooleanGates("edit")` has an empty branch: nothing happens.
- This app (**Own rule**): "Edit boolean..." (button and right-click "Edit
  Boolean Gate...") opens B3's dialog with the gate written as an expression
  (`exprOfGate`); OK replaces the gate's definition in place (its name, id,
  children and statistics stay), adding intermediate nodes as in B3. A gate
  cannot use itself or its own children.
- Status: **Own rule** (e2e "Edit boolean shows the gate as an expression",
  "the edited gate is recalculated").

### B5. GATECOMBINATION "Create Combination Gates" (tooltip "Mix the positive and negative gates of all selected populations.")

- `WSBoolGateAction.makeCombinationGates`: refuses fewer than 2 or more than
  12 selected populations (error "This was too complex of a request to
  believe you mean it."); asks for abbreviations (B2); for each selected
  population makes a NOT node named `<abbreviation>-`; then one AND node per
  sign pattern from `getCombos(n)`: positive before negative, the first
  population varying slowest (2^n nodes), each named with no connector
  (`CD4+CD8-`). All nodes become children of the first selection's parent.
- Status: **Done** (tests "Create Combination Gates"; e2e "adds 2 NOT and 4 AND nodes").

### B6. GATEIS "Identical Gate" (tooltip "Create a cloned reference to each selected gate for placement in other parts of the analysis tree.")

- `WSBoolGateAction.addIdentityGates`: for every selected population with a
  parent, an `IdentityNode` (OR of that one population, name `<name>=`) added
  beside it; it can then be dragged elsewhere.
- Status: **Done** (button "Identical", right-click "Identical Gate"; e2e
  "Identical Gate adds CD3+=" and "the identical gate has the same count").
  Accelerators (`=` for identity, `,` for combination) are not bound: both
  collide with browser zoom / settings keys.

## T. Workspace table

### T1. EDITCOLUMNS "Edit Columns..." (Ctrl/Cmd+K in FlowJo)

- `WSEditColumns.doAction` -> `ColumnDP.editColumns`: a dialog with "All
  Column Values" (the special columns `AppNodePropertyKey.possibleColumnArray`,
  then the current group's keywords, `SampleColumnModel.buildColumnChoiceArray`)
  and "Columns To Display", buttons Add Columns, Remove Columns, Remove All,
  Default ("Reset to default columns."), and "Use as workspace default"
  (`FJPrefs.setDefaultColumns`). Columns are saved in the .wsp as
  `<Columns><TColumn width=".."><Property key="fj.appnode.prop.*"/>` or
  `<Keyword name=".."/>` (`STreeColumn.getElement`, `SampleKeywordProxy.getElement`).
  Keyword cells are editable except FCS structure keywords
  (`SampleKeywordProxy.isEditable`); edits change the sample's keyword.
- This app: the dialog with Add / Remove / Remove All / Default; special
  columns offered are Name, Statistic, #Cells, File Name, Compensation Matrix,
  Owner Group, Gating Parameters, $TOT, Well ID, Collection Time; keyword
  columns show the sample value and are edited by double-click (stored as
  annotations, as Replace does, specs 22.4). Columns are read from and written
  to `.wsp` `<Columns>`; the fixtures' "Compensation Matrix" column now shows.
- Status: **Done** with **Own rule** parts: gate coordinates, graph spec,
  transformation, sample state and quality columns are not offered; "Use as
  workspace default" is not offered (column choice is saved with the
  workspace). Tests: "workspace table columns" (wsp round trip); e2e "Edit
  Columns adds a keyword column", "a keyword cell is edited in place".

### T2. TREESORT / TREESORTASCENDING / TREESORTDESCENDING "Sort", "Sort Ascending", "Sort Descending"

- `STreeMgr.handleColumnHeadClick`: a double-click on a header sorts the
  samples by that column; on the column already sorted it reverses the
  direction, otherwise ascending (descending with Shift). The Statistic
  column cannot be sorted (a "clunk" sound). A double-click on a column edge
  resets the widths (T4). A right-click on a header shows Sort Ascending,
  Sort Descending, a separator and Edit Columns...
  (`WSActionManager.getTableHeaderActions`); the sort items call
  `SampleTreeTable.rightClickSort(ascending)` for the clicked column.
- `SampleComparator.compare`: only samples are reordered; a missing value
  sorts first in both directions; `$DATE` is compared as a date (formats
  dd-MMM-yy, dd_MM_yyyy, dd-MMM-yyyy, dd MMM yyyy, yyyy-MM-dd, yyyy-MMM-dd);
  everything else with `StringUtil.macStyleCompare` (case-insensitive, digit
  runs as numbers). The sort is saved (`sortPriority`, `wsSortAscending`).
- Status: **Done** (tests "natural order and FCS dates", "missing values sort
  first"; e2e "double-click on a header sorts; again reverses"). The sort is
  saved in the workspace file (not in .wsp: own rule, the attribute layout
  was not checked against a FlowJo-written sorted workspace).

### T3. SORT1 / SORT2 / SORT3 (ws.sort.primary / secondary / tertiary)

- FlowJo 10.6.2: enum constants only, no action is created (not wired).
  `WSTreeTableAction.doSortBandSort` builds a keyword popup whose items carry
  the command `keywordPopup:<sort>=<keyword>`, which no branch handles.
- This app (**Own rule**, asked for): Workspace tab, band "Columns / Sort":
  Sort 1, 2, 3 choose a column each with asc / desc; samples are sorted by
  the keys in turn (ties keep group order). A header sort becomes Sort 1 and
  keeps the others.
- Status: **Own rule** (test "multi-key sort"; e2e "Sort 1 (none) restores the group order").

### T4. TREEREMOVECOLUMN "Remove Column" and COLUMNWIDTH "Reset Column Widths"

- Remove Column: `WSTreeTableAction` removes the active column
  (`SampleTreeTable.removeColumn`), but 10.6.2 never creates the action (not
  in `WSActionManager`); columns are removed in Edit Columns.
  **Own rule**: offered in the header right-click menu (not for Name); e2e
  "Remove Column (header menu) removes the column".
- Reset Column Widths ("Calculate the appropriate columns widths based on the
  information present in the current group."): `SampleTreeTable.clrResized`
  + `autocalc`. Here headers can be dragged wider / narrower (widths are saved
  as `TColumn width`); Reset clears them so the browser sizes the columns to
  their content, also on a double-click on a header's right edge.
  **Done** (button "Reset Column Widths").

### T5. TREEEXPANDLEVEL / TREECOLLAPSELEVEL "Expand Selection" / "Collapse Selection"

- `STreeTable.collapseLevel(expand)`: every selected row of the table and its
  whole subtree (`STree.setExpandedDeep`), then the table is rebuilt.
- This app keeps a table multi-selection (Ctrl/Cmd or Shift click adds or
  removes rows, across samples); Edit tab, band Expand: Expand Selection /
  Collapse Selection act on every selected sample row (its populations) and
  population row (its subtree).
- Status: **Done** (e2e "Collapse Selection folds every selected sample; Expand Selection opens them").

### T6. SELECTALLNODES "Select All" (Ctrl/Cmd+A; "Select all nodes in the workspace.")

- `NodeSelectionAction` -> `SampleTreeTable.selectAll`: every row.
- This app: every sample and population row of the current group; the samples
  are also checked (the app's cross-sample selection used by paste) and the
  current sample's populations join the multi-selection.
- Status: **Done** (e2e "Ctrl/Cmd+A selects every node").

### T7. TOGGLESTATS / TOGGLECOMP / TOGGLEPLATFORMS / TOGGLEDERIVEDPARMS

- `WSToggleSettings` -> `WSViewMgr.doToggleShowStats / doToggleShowComp /
  doToggleShowPlatforms / doToggleShowDerivedParameters`;
  `PopTreeTableModel.shouldShowNode` hides statistic nodes, compensation
  matrix nodes (`CompMatrixNode`), platform nodes and derived-parameter nodes.
  Defaults (`PopTreeTableModel.<init>`): statistics shown, compensation nodes
  hidden, platforms shown, derived parameters shown. View state only (not
  saved). Labels: "Hide Stats", "Show Compensation Nodes", "Hide Platforms",
  "Hide Derived Parameters" (the button text flips with the state here).
- This app: compensation node = one row "Compensation: <matrix>" under each
  compensated sample; derived-parameter nodes = one row per derived parameter
  under each sample; platform nodes = the Kinetics node of a population (the
  only platform kept as a node here; cell cycle and proliferation fits are
  not stored as nodes).
- Status: **Done** (e2e "Hide Stats hides the statistic nodes", "Show
  Compensation Nodes adds a compensation row per sample").

## S. Statistics

### S1. ADDSTAT "Add Statistic..." (Ctrl/Cmd+B; "Open the Add Statistic dialog for selected sample(s).")

- `WSAddStat` -> `WSController.addStatNodes`: a dialog to add statistics to
  the selected nodes.
- This app: Workspace tab, band Statistics, "Add Statistic..." (also the
  right-click menu): check several statistics and several parameters; one
  statistic node per statistic x parameter (statistics without a parameter
  once) for every selected population (table selection, multi-selection, or
  the selected population). Duplicates are skipped. Freq. of and Correlation
  stay in the Statistics panel (they need an ancestor / second parameter).
  Ctrl/Cmd+B keeps adding the panel's one statistic (unchanged).
- Status: **Done** (e2e "Add Statistic counts statistics x parameters",
  "three statistic nodes under CD3+ in each sample").

### S2. RECALALLSTATS "Recalculate Statistics" ("Refresh all statistics in this workspace")

- `WSRecalcAction` -> `WSSampleMgr.touchAll` (every sample recalculated).
- This app: the button clears the cached analyses and recomputes counts and
  statistics for the group. Status: **Done** (e2e "Recalculate keeps the statistics").

## K. Groups and keywords

### K1. ADDKEYTOGROUP "Add Keyword to Group"

- FlowJo 10.6.2: `WSActionManager.makeKeywordActions` creates a
  `WSGroupAction(ADDKEYTOGROUP)` and drops it; `WSGroupAction.doAction` has
  no branch for it (not wired). Add Keyword (GROUPADDKEY) adds to every sample.
- This app (**Own rule**): "Add Keyword to Group" asks for a name (Add
  Keyword's rules: trimmed, "Off" / "Sample" / "Panel" get "_"), adds it with
  an empty value to the current group's samples only (an existing value is
  kept) and shows it as a table column. e2e "Add Keyword to Group adds a Dose column".

### K2. GROUPPASTEKEY "Paste keyword to group" ("Copy the keyword from the system clipboard to all samples in the current group.")

- `WSGroupAction` -> `KTreeTable.pasteFromSystemClipboard`: the clipboard text
  is parsed as tab or CSV; a header row of keyword names adds columns
  (`addPastedHeaderKeywords`); rows fill down from the selected row; a single
  value fills the selected rows.
- This app: the text paste (specs 20) is unchanged; the band button "Paste
  keyword to group" reads the clipboard and pastes into the current group in
  table order from the selected sample; a single value fills the first
  keyword column of every group sample. Status: **Done** (the paste rules are
  covered by `tests/paste-annotations.test.ts`; the button needs clipboard
  permission, so it is not driven by the e2e script).

### K3. COPYTOGROUP "Copy value to group" ("Apply this keyword value to all members of the current group.")

- `WSGroupAction.copySelectedNodesToGroup()`: while a keyword cell is being
  edited, its value is set for every sample of the current group
  (`Group.setKeyValue`; a reagent column sets the stain); with no cell being
  edited it copies the selected nodes to the group (Copy analysis to group).
- This app: right-click a keyword cell, "Copy value to group". **Done** (e2e
  "Copy value to group sets the value in every member").

### K4. GROUPVALUESERIES "Create keyword value series..." ("Make a new keyword whose values are derived from the samples place in the sequence.")

- `WSDialogAction.doValueSeries` -> `KeywordValueSeriesDialog` ("Create a
  Series of Values"): Keyword, Starting Value, Increment, Multiplier, "Fill N
  value(s) starting from current sample", "Use the value R time(s) before
  changing to next value", "Start over every S samples from the starting
  value". `getValueSeries(n, start, inc, mult, R, S)`: at least 2 values; each
  value used R times; next = (previous + increment) x multiplier; after every
  S samples (S > 1) back to the start. Values are formatted with
  `ParseUtil.engineFormat` and written into the keyword column from the
  current sample down in table order (`nextSample`).
- This app: the Rules tab as above; the keyword column is added if missing.
  The Equation and Numerical Keys tabs are not implemented (**Own rule**).
  Status: **Done** (test "keyword value series"; e2e "the series preview
  follows the rules", "fills the samples in table order"). Whole numbers are
  written without a decimal point (engineFormat's exact digits not checked).

### K5. MULTIPLE "Multiple" (group dialog; "Make a new group for each of the selected stain combinations.")

- `GroupDlog.createMultipleGroups`: enabled with 2 or more stain sets
  selected; for each, a new group named by the stain set, with the dialog's
  criteria plus that one stain set, its live / synchronized / font settings;
  a new colour per group (`setFirstUnusedColor`).
- This app: a "Multiple" button in Create Group (not when modifying), same
  rule; names made unique. **Own rule**: groups get no automatic colour. Not
  in the e2e script (the fixtures share one stain set).

### K6. REMOVEGROUPANALYSIS

- `WSGroupAction` -> `STreeMgr.deleteSelectedGroupAnalyses` (the group node's
  analysis, with the Allocate / Delete confirmation, specs 7.2).
- This app has no group node in the table, so the command is the right-click
  item "Remove Group Analysis" on a group-owned population, using the existing
  confirmation (Allocate To Samples / Allocate To First Sample / Delete
  Entirely). Status: **Done** (rules covered by `tests/group-analysis.test.ts`).

## E. Export, documents

### E1. EXPORT_POPULATIONS "Export / Concatenate Populations" (Ctrl/Cmd+E)

- `WSExportAction`: every selected population in the sample table
  (`ExportNodesPopsModel`), shown in `ExportDialog2`; one file each (or
  concatenated).
- This app: the export dialog's "Selected populations (N), one file each"
  takes the table multi-selection; one CSV / FCS per population, named
  `<sample>_<path>`; more than one file is downloaded as one ZIP (**Own rule**:
  a browser cannot write into a folder). Status: **Done** (e2e "Export Populations").

### E2. EXPORT_GROUP "Export / Concatenate Group" (Ctrl/Cmd+Shift+X)

- `WSExportAction` with `ExportNodesGroupModel`: the node selected in the
  group table; for a group node every sample of the group, for a group-owned
  population the population with the same path in each sample that the group
  owns there.
- This app: "Each sample of the group (N), one file each": the selected
  population's path in every group sample with data (matched by path; this
  app has no group-owned node in the group table). Ctrl/Cmd+Shift+X opens the
  dialog in this mode. ZIP as in E1. Status: **Done** (e2e "Export Group").

### E3. EXCEL "Export to Excel (XLS)"

- `SampleTreeTable.writeExcel` / `buildTableData`: the visible table rows; a
  first column "Depth" (`ws.sample.treetable.depth`) of `>` repeated by the
  node depth, then the table's columns; a statistic row's name is its label,
  other rows' names their path (`getPresentablePathString`); written with
  `TableGenerator.createTableAsExcel` to `<workspace>.xls` and opened.
- This app (**Own rule**): the same table as an Office Open XML workbook
  (`.xlsx`, `src/core/xlsx.ts`, no dependency); numbers are numeric cells.
  The depth of a sample row is taken as 1 (FlowJo's node depth for samples was
  not checked). e2e "Export to Excel writes an .xlsx workbook".

### E4. TEMPLATE "Export as Template (WSPT)" and applying a template

- `WSDocument.saveTemplate` -> `doSave(.wspt)`; `Workspace.getElement(true)`
  leaves out the sample list (groups, their analyses, matrices, columns,
  layouts and tables stay). Opening a `.wspt` gives an untitled workspace
  (`convertTemplateToWorkspace` renames it to `.wsp`); samples added later
  join the groups and get the group analysis.
- This app: the template is this app's workspace file without samples, each
  group keeping its group-owned analysis (and the ancestors it hangs from) in
  `group.analysis`; opening a `.wspt` (this format, or FlowJo XML read as a
  .wsp) starts a new workspace; added samples that join a group receive the
  analysis (`applyGroupTemplates`, then the usual group-owned copy for later
  members). **Own rule**: the file is JSON, not FlowJo XML. Status: **Done**
  (test "template keeps group analysis without samples"; e2e "Export as
  Template", "a template opens empty; added samples join its groups").

### E5. ACS "Save as Archive (ACS)"

- `WSDocument.doSaveACS`: an Archival Cytometry Standard container (ISAC;
  ZIP based) of the workspace and its data files.
- This app (**Own rule**): a ZIP with `workspace.frea.json` and `FCS/<file>`
  for every loaded sample (`src/core/template.ts`, stored entries); opening
  the ZIP (or `.acs`) restores the workspace and loads its FCS files in one
  step. The ACS table of contents is not written. e2e "Save as Archive",
  "an archive opens with its data".

### E6. REVERT "Revert" ("Revert workspace to original state")

- `WSDocument.revert`: confirmation "Are you sure you want to discard changes
  made to this workspace?", then the file is read again from disk.
- This app (**Own rule**): same question; the workspace returns to the state
  it had when last opened or saved in this session (a browser cannot re-read
  the file). e2e "Revert discards changes since the last save".

### E7. CLOSE "Close" ("Closes this current workspace and all of its associated windows. Exits the program if there are no other open workspaces.")

- `WSCloseAction` -> `SWorkspace.close`.
- This app (**Own rule**): asks when there are samples or changes, then an
  empty workspace replaces it (one workspace per page; a page does not exit).
  e2e "Close leaves an empty workspace".

## O. Other commands

| Command | FlowJo 10.6.2 | Status |
|---|---|---|
| REPLACE "Replace" | `KeywordFindRelpaceDialog.getReplaceAction` -> `replaceSelectedRows`: only the selected result rows (Replace All selects all first) | **Done**: Find dialog "Replace" changes the highlighted result (annotation keywords only, as Replace All); e2e "Replace changes only the selected result" |
| BROWSESAMPLES "Search for FCS files..." | `WSDialogAction.doBrowseForSamples`: traverse local folders or the network for a filtered list of FCS files | **Own rule**: File tab "Search for FCS files..." opens the browser's folder picker; every `.fcs` / `.lmd` file under the folder is added (no network search) |
| AUTOCC "Create Cell Cycle Gates" | Not wired (no action in `WSActionManager`); tooltip: 5 regions from DNA and S-phase markers | **Deferred**: unreachable in 10.6.2 and needs a bivariate DNA / BrdU model this app does not have; the cell cycle platform stays univariate |
| CHECKSAMPLEQUALITY "Check Sample Quality" | `WSSampleQualityAction`: marks each sample of the current group; `SampleQualityControl` asks the native engine for rate / trend / kinetic consistency, shown in the sample badge | **Deferred**: the engine's quality metrics were not decoded |
| IMPORT_CSV_CLR "Import Parameters from CSV/CLR..." | `WSDialogAction.importCsvClr` -> `FlowCAPUtil.importExternalParameter`; file read by the native engine (`Sample::CreateImportCsvParameter`, `Sample::CreateImportClrParameter`) | **Done** (rules in O1): File tab "Import Parameters from CSV/CLR..."; unit "Import Parameters from CSV/CLR", e2e "CSV import adds a parameter named from the header" |
| CONSENSUS_DP "Consensus Gate", CLUSTER_FREQ_DP "Cluster Frequency" | `WorkspaceAction` -> `FlowCAPUtil.createClusterComparisonParameter` / `createClusterConsensusParameter` / `doClusterComparisonQuery`; values from the native engine (`Sample::CreateConsensusGateParameter`, `Sample::CreateClusterFrequencyParameter`) | **Done** (rules in O2): Workspace tab, Derived Parameters band; unit "Consensus Gate and Cluster Frequency", e2e "Consensus Gate creates ...", "Cluster Frequency uses the focused population as primary" |
| MIFlowCyt "Annotate Experiment..." / MIFLOW | `WSAction` delegating to `WSController` (MIFlowCyt metadata dialog, bundle key `test.debug.miflowcyt`) | **Deferred**: the MIFlowCyt field list was not decoded; free annotations and keywords remain |
| REPORTEDITOR "Report Editor" | `FJNavAction` to the report editor window | **Deferred**: a separate editor (report layout and export) |
| SCRIPTEDITOR "Script Editor" | `WSScriptAction`: FlowJo scripting console | **Deferred**: needs FlowJo's scripting language |
| EXPORT_DIVA / IMPORT_DIVA | `ExportDivaCommand` / `ImportDivaCommand` -> `DivaXMLManipulator.ExportToDiva` / `DivaXMLImporter.ImportFromDivaXML` | **Done** (rules in O3, two own rules): File tab "Import from FACSDiva" / "Export to FACSDiva"; unit "FACSDiva import", "FACSDiva export ... and round trip", e2e "Export ...", "Import from FACSDiva adds the gates" |
| RIBBONCONFIG "Customize Ribbon", RIBBONSETDEFAULT "Apply defaults", RIBBONCOMMITTOPREFS "Commit to Preferences" | `WSRibbonConfigDialog`, `WSRibbonSetDefaultAction`, `WSRibbonCommitToPrefsAction` | **Deferred**: cosmetic; the ribbon is fixed |

## O1. IMPORT_CSV_CLR "Import Parameters from CSV/CLR..."

Evidence: `WSDialogAction.importCsvClr` (one selected sample, a file chooser
filtered to "Parameter Files (*.csv, *.clr)", `WSDialogAction$1`),
`FlowCAPUtil.importExternalParameter` (three overloads),
`FlowDxDerivedParameterRequest` (DerivedParameter name / importFile / type
importCsv or importClr), and in the native engine 3.6.2
`Sample::CreateImportCsvParameter` and `Sample::CreateImportClrParameter`
(read with headless Ghidra; output kept out of the repo).

- Name: the file name without its extension; if it starts with the sample's
  file name without ".fcs", that prefix and the next character are removed
  (`Tube1_CD4.csv` on `Tube1.fcs` gives `CD4`).
- Delimiter: tab when the first line contains a tab, else comma.
- Header: the first line is a header when any field holds a character other
  than a digit, `.` or carriage return. Header fields are trimmed of blanks
  (CSV also drops `"`); an empty header field, or every column when there is
  no header, takes the file-derived name.
- Data: each line is split on the delimiter and each field read as a number
  (C++ stream: leading blanks skipped, a non-number gives 0). More fields than
  columns is an error. Reading stops at the end of the file or once the event
  count ($TOT) is reached; the number of data rows must equal $TOT, otherwise
  no parameter is added.
- CSV values are stored as read; the parameter's data range is the largest
  value truncated to an integer. CLR (cluster membership) values: 0 becomes
  0.001, then every value is multiplied by 9800; range 10000; the engine also
  records whether every value was 0 or 1 (hard assignment).
- The new parameter belongs to that sample only; importing again replaces it
  (`Sample::CreateOrReplace`).
- flowjo-rea: `src/core/paramImport.ts`; values are kept in the workspace as
  base64 float32 per sample (`DerivedParameter.imported`) and other samples
  see NaN. **Own rules**: (1) with several unnamed columns FlowJo appends the
  column index as a raw control character; this app appends the 1-based
  column number. (2) FlowJo then runs `doGateOnPeaks` (histogram peak finder,
  range gates per peak) on imported parameters; the peak finder is not
  decoded, so no gates are made automatically. (3) Imported parameters are
  not written to .wsp (FlowJo re-reads the file by path).

## O2. CONSENSUS_DP "Consensus Gate", CLUSTER_FREQ_DP "Cluster Frequency"

Evidence: `WorkspaceAction$1` -> `FlowCAPUtil.createClusterComparisonParameter`,
`createClusterConsensusParameter`, `getSampleToPopNodeMap`,
`doClusterComparisonQuery`; `FlowDxDerivedParameterRequest` (type consensus
or clusterFrequency, PrimaryGate, gate queries); native
`Sample::CreateConsensusGateParameter`, `Sample::CreateClusterFrequencyParameter`
(constants read from the engine's constant pool).

- Populations: Consensus takes the selected populations per sample and needs
  at least two. Cluster Frequency takes the focused (anchor) population as the
  primary and the other selected populations of the same sample, and needs at
  least one other.
- Name: each population name followed by `.` (primary first), then
  `Consensus` or `ClusterFreq` (`A.B.Consensus`).
- Consensus value per event: (number of the populations containing the event)
  / (number of populations); 0 is replaced by 0.001. Stored as float32.
- Cluster Frequency value: 10 outside the primary population; inside it,
  30 + 100 x (fraction of the other populations containing the event), or 30
  with no others. A second pass multiplies every value by
  float(3723.636282928721 / largest value).
- The engine gives both a data range of 4096.
- flowjo-rea: `src/core/clusterParams.ts`, evaluated live by the analysis
  engine (`DerivedParameter.gateDerived`), so the values follow gate edits.
  **Own rules**: the Consensus axis defaults to linear 0..1 (FlowJo's 4096
  data range would squash the 0..1 values); FlowJo's follow-up
  `doGateOnPeaks` is not run (see O1).

## O3. EXPORT_DIVA / IMPORT_DIVA (FACSDiva experiment XML)

Evidence: `com.flowjo.diva`: `ImportDivaDialog`, `DivaXMLImporter`
(`ImportFromDivaXML`, `addDivaDataToFJSample`, `getWorksheetTemplate`,
`getInstrumentSettingsNode`), `ExportDivaDialog`, `DivaXMLManipulator`
(`ExportToDiva`, `CreateWorksheetTemplate`, `CreateGateNode`,
`CreateRegionNodeForGate`, `CreateQuadGateParentNode`, `generateQuadID`,
`SetParametersForExistingSampleNode`), `FJtoDivaGateMapper`,
`DivaParamSetting`, `DivaParamSettingList` (`syncParameterScalingFromFJ`),
`DivaCompensationMapper`, `DivaBiexCalculator`, `DivaConstants`.

Import (one sample):
- The user picks a worksheet template
  (`/bdfacs/experiment/acquisition_worksheets/worksheet_template[@name]`) and
  the tube whose `data_filename` is the sample's FCS file; options "Import
  parameter settings only" (no gates) and "Correct height and width scatter
  parameters" (swaps FSC-H/FSC-W and SSC-H/SSC-W names).
- Parameters come from that tube's `instrument_settings/parameter`. Scale:
  `is_log` false is linear; log scatter (FSC*, SSC*) is log; any other log
  parameter is biex with width = -10^(log10(s / 262144) + 4.5), where s is
  `comp_biexp_scale` (compensated parameters) or `biexp_scale` when
  `use_auto_biexp_scale` is true, else `manual_biexp_scale`. FlowJo axes:
  linear 0..262143, log 1..262144, biex (max 262144, 4.5 decades, no extra
  negative decades); widths below -1000 are reset to -1000 with a warning.
- Compensation: the `compensation_coefficient` rows of the parameters that
  have them are the inverse of the spillover; FlowJo inverts them into a
  matrix named `DivaCompMtx_<sample>` and applies it to the sample.
- Gates (in order, `All Events` skipped): parent from the `parent` text (last
  `\` segment, matched by name among gates already made; `All Events` is the
  root). A gate's `is_x_parameter_log` / `_scaled` set the parameter's scale
  (log and scaled: biex; log: log). Region types: RECTANGLE (bounds = point
  extremes), POLYGON, INTERVAL (1-D range from the x extremes). Coordinates
  are Diva scale units: linear values, log10 values, or biex channels of
  FlowJo's 4096-channel table. `Composite_Classifier` (BINNER_REGION) is a
  quadrant group: centre = first point, `bin` 0..3 = upper-left, upper-right,
  lower-left, lower-right (`RectGate.quadFromPoint` with 2, 3, 0, 1), and the
  four quadrant gate elements that follow are skipped.

Export:
- The result is a modified copy of an existing experiment that must contain
  the sample's FCS file; not a Diva file: "The input XML file is not a valid
  Diva experiment file." Options: experiment name, gates to export, "Apply
  compensation and scaling to all files in experiment", "Correct height and
  width scatter parameters", plot style.
- `experiment@name` and the prefix of each `list_data` become the new name;
  `date` / `export_time` the current time (`yyyy-MM-ddTHH:mm:ss`).
- The tube's parameters take FlowJo's scales (Linear 0, Logarithmic 1, Biex 2
  with `manual_biexp_scale` = round(262144 x 10^(log10(-w) - (log10(262144) -
  1))) = round(-10 w)); other scale types leave Diva unchanged with a message.
  FSC-A/H and SSC-A/H must share log scaling; -W cannot be log. `is_log`,
  `min`/`max` follow the scale (linear 0..262143, else 0..5.4185380935668945),
  `use_auto_biexp_scale` becomes false. Compensation: for the compensated
  parameters (not FSC, SSC, Time, -W), separately for -A and -H, the inverse
  of the sample's spillover submatrix is written as each parameter's
  coefficient row. "Apply to all" copies these parameters to every tube with
  the same parameter list.
- A worksheet template named "FlowJo Exported Gates" (copy of the first
  template, its gates and sort layouts removed) gets an `All Events` gate
  (`EventSource_Classifier`, total count) and one `Region_Classifier` gate
  per exported population: `fullname` = `All Events\path`, children name,
  colour (`DIVA_COLORS[i % 12]`), visible, dotsize 0, enabled (false for
  quadrant gates), num_events, parent, `region` (name, xparm, yparm, type
  RECTANGLE_REGION, POLYGON_REGION or INTERVAL_REGION, `points` in Diva
  scale units as Java doubles, clamped to 0..262143 linear and 0..4095
  log / biex), `is_x/y_parameter_scaled` (biex), `is_x/y_parameter_log` (not
  linear), `x/y_parameter_scale_value`, `input` (parent full name). Ellipses
  become a 20-point polygon from their four axis end points
  (`calcEllipsePointsFromAxes`); a 1-D range has y = 100. Quadrant groups
  under the root and the exported populations become a
  `Composite_Classifier` named `$` + 13 random digits (BINNER_REGION centre
  point repeated three times, four `bin` full names) followed by the four
  quadrant gates (open sides at the scale limits, `input` = the group).
- flowjo-rea: `src/core/diva.ts`, `src/ui/FormatTools.tsx`. **Own rules**:
  (1) the browser downloads the modified experiment as `<name>.xml`; FlowJo
  writes a folder with the XML and copies of the FCS files, and adds an
  analysis worksheet with plots (`AddNewWorksheet`), which is not written.
  (2) Biex coordinates with widths beyond -1000 use FlowJo's -1000 table
  instead of `DivaBiexCalculator`. Imported Diva polygons are gated exactly
  (no gate grid). Uncertain: the colour index FlowJo gives quadrant gates.

## Counts

Of the 51 gap rows: Done 30, Own rule 12 (CLOSE, REVERT, EXCEL, ACS,
BROWSESAMPLES, ADDKEYTOGROUP, BOOLEANCREATE, BOOLEANEDIT, SORT1-3,
TREEREMOVECOLUMN), Deferred 9 (REPORTEDITOR, SCRIPTEDITOR, AUTOCC,
CHECKSAMPLEQUALITY, MIFlowCyt, MIFLOW, RIBBONCONFIG, RIBBONSETDEFAULT,
RIBBONCOMMITTOPREFS). IMPORT_CSV_CLR, CONSENSUS_DP, CLUSTER_FREQ_DP,
EXPORT_DIVA and IMPORT_DIVA were closed in the follow-up round (O1-O3, with
own-rule notes). Some Done rows carry small own-rule notes, stated above.
