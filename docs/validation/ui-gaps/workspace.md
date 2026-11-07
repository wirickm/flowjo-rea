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
| IMPORT_CSV_CLR "Import Parameters from CSV/CLR..." | `WSDialogAction.importCsvClr` | **Deferred**: no CSV / CLR parameter file sample to define the format against (compatibility matrix own rule kept) |
| CONSENSUS_DP "Consensus Gate", CLUSTER_FREQ_DP "Cluster Frequency" | `WorkspaceAction` -> `FlowCAPUtil.createClusterComparisonParameter`: derived parameters of per-event inclusion probability across populations (FlowCAP tooling) | **Deferred**: FlowCAP comparison tooling, outside the analysis workflow; formula not decoded |
| MIFlowCyt "Annotate Experiment..." / MIFLOW | `WSAction` delegating to `WSController` (MIFlowCyt metadata dialog, bundle key `test.debug.miflowcyt`) | **Deferred**: the MIFlowCyt field list was not decoded; free annotations and keywords remain |
| REPORTEDITOR "Report Editor" | `FJNavAction` built and discarded; its `doAction` has no REPORTEDITOR branch and no report editor class exists (see O1) | **Not a gap: no-op in FlowJo 10.6.2** |
| SCRIPTEDITOR "Script Editor" | `WSScriptAction` -> `Workspace.getScriptEditor().setVisible(true)`: JavaScript (Rhino) script list, editor and console (see O2) | **Done** (core API; rest recorded in O2): taskbar "Script Editor"; tests `tests/scriptEditor.test.ts`, e2e `e2e/followup-editors.mjs` |
| EXPORT_DIVA / IMPORT_DIVA | `WSExportDivaAction` / `WSImportDivaAction`: gates and compensation to / from a FACSDiva experiment | **Deferred**: vendor format, no sample experiment file |
| RIBBONCONFIG "Customize Ribbon", RIBBONSETDEFAULT "Apply defaults", RIBBONCOMMITTOPREFS "Commit to Preferences" | `WSRibbonConfigDialog`, `WSRibbonSetDefaultAction`, `WSRibbonCommitToPrefsAction` | **Deferred**: cosmetic; the ribbon is fixed |

### O1. REPORTEDITOR "Report Editor" ("Open the Report Editor")

- `WSCommand.REPORTEDITOR` (dictionary `ws.nav.reporteditor`, mnemonic R).
  `WSActionManager` constructs `new FJNavAction(WSCommand.REPORTEDITOR,
  workspace)` and drops the result (it is not stored in a field).
  `FJNavAction.doAction` only handles LAYOUTEDITOR (`LEditor.select`),
  TABLEEDITOR (`TEditor.select`), OPENGRAPH (`WSController.openGraphWindows`)
  and WSTOFRONT (`SViewMgr.bringToFront`); any other command returns without
  doing anything. No class in the 10.6.2 jars or fjlib is a report editor
  (searched for Report / REditor: only `TestGatingMLReporter`, a cell cycle
  test helper), and nothing else references REPORTEDITOR or
  `ws.nav.reporteditor`.
- Rule: choosing Report Editor in FlowJo 10.6.2 does nothing.
- This app: **Not a gap: no-op in FlowJo 10.6.2**. Nothing is built; reports
  are made with the Layout Editor and Table Editor, as in FlowJo 10.6.2.

### O2. SCRIPTEDITOR "Script Editor" ("Edit and manage FlowJo Scripts and query this workspace with the FlowJo Scripting Console")

Evidence: `WSScriptAction.doAction`, `Workspace.getScriptEditor` /
`getScriptEvaluator`, `com.treestar.flowjo.application.scripting`
(`ScriptEditorController`, `ScriptEditorController$ScriptConsoleThread`,
`ScriptEvaluator`, `WSScriptEvaluator`, `ConsoleWriter`, `FJScript`,
`ScriptAPIFactory`), `scripting.ui` (`ScriptEditorPerspective`,
`ScriptView`, `ScriptView$Handler`, `ScriptView$ScriptOutputHandler`,
`actions.ScriptEditorCommand`, `ScriptListAction`, `ScriptViewAction`),
fjlib `com.treestar.lib.scripting.FJScriptContext` and the API classes in
`fj-scripting-api-2.0.0.jar` (`com.treestar.flowjo.api.*`).

Language and safety.
- Scripts are JavaScript. `FJScript.lang` is always `text/javascript`;
  `ScriptEvaluator.run` refuses anything else ("Unsupported scripting
  language: ..."), enters a Mozilla Rhino 1.7R4 `Context`, creates fresh
  standard objects per run and evaluates the text. `FJScriptContextFactory`
  only lets scripts see Java classes in `com.treestar.flowjo.api`,
  `MathUtil`, `ConsoleWriter`, `String`, `HashMap` and `ArrayList`.
- This app runs scripts in a dedicated Web Worker
  (`src/worker/script.worker.ts`), never on the page: the worker gets a JSON
  snapshot of the workspace and returns console output plus a list of
  changes, which the app applies with `updateWs` as one undoable step. The
  script's scope also hides `self`, `fetch`, `postMessage`, `importScripts`
  and similar names. **Own rule**: FlowJo runs Run on the UI thread; here a
  run never blocks the page.

Scope (`ScriptEvaluator.prepareScope`, `WSScriptEvaluator.prepareScope`).
- `console` (`ConsoleWriter`: `log(obj)`, `log(obj, color)`, `error(obj)` in
  red), `stats` (`StatAPICreator`), `math` (`MathUtil`), `movie`
  (`MovieAPICreator`), `workspace` (`WorkspaceAPI`). The standard `Math`
  object is deleted from the scope. **Own rule**: `Math` stays available
  (harmless superset).
- Rhino exposes each `getX()` also as the property `x`, and
  `ScriptIndexed` / `ScriptStringIndexed` types as `list[0]` /
  `list["name"]`; both forms work here. `BaseAPI.toString` prints
  `Type(name)`, e.g. `PopulationList(3 nodes)`; Java lists print as
  `[a, b]`.

Documented core API (implemented, `src/core/scriptApi.ts`).
- `workspace`: `name`, `samples` (population list of samples, from the All
  Samples group), `groups` (group manager), `chart()`.
- Population list (`PopulationListAPI`, docs `fj.apidocs.poplist.*`):
  `length`, `get(i)` / `[i]`, `get(name)` / `["name"]` (name or full path),
  `slice(start, end[, step])` (negative indices from the end), `paths`,
  `names`, `counts`, `stats(stat)`, `populations(pattern)`, `filter(fn)`
  (fn called with each node; truthy keeps it), `indices`.
- Node (`AppNodeAPI`, `PopulationAPI`, `SampleAPI`): `name`, `identifier`,
  `path` (below the sample), `fullPath` (with the sample name), `parent`,
  `children`, `sample`, `workspace`, `findAll(pattern)` and
  `populations(pattern)`: the pattern is split on "/", `*` matches any child,
  `**` any descendant, other parts match the child's name; `count`,
  `stat(stat)`, `stats([stat...])`, `setName(name)`, `gating`.
- Sample: `keywords` (`get(k)` / `["k"]`, `set(k, v)` / `["k"] = v`,
  `remove(k)`, `indices`), `parameters` (`names`, `longNames`, `get(name or
  index)`, `withStain(s)`; a parameter has `name`, `stain`, `longName`,
  `index`), `stains`.
- `stats`: `count()`, `freqOfTotal()`, `freqOfParent()`, `median(p)`,
  `mean(p)`, `mode(p)`, `geometricMean(p)`, `robustCV(p)`, `cv(p)`,
  `stddev(p)`, `robustSD(p)`, `percentile(p, n)`, `correlation(p, q)`.
  Values come from the app's statistics (`AnalysisService.stats`). A value
  not yet computed reads NaN during the run; the app computes the requested
  statistics and runs the script again (at most 6 rounds), showing only the
  last round's output. An unloaded sample gives NaN.
- Groups (`GroupMgrAPI`, `GroupAPI`): `names`, `get(name)` / `["name"]`,
  `create(name)` (empty name gives nothing; an existing name returns that
  group), `remove(name)`; a group has `name`, `samples`, `add(sample or
  list)`, `remove(sample or list)`.
- Gating (`GateAPICreator`): `rectangle(name, x, y[, xmin, xmax, ymin,
  ymax])`, `range(name, p[, min, max])` add a child gate (bounds in data
  units, default 0 because `RectGate(PopNode, x, y)` / `RangeGate` leave the
  Java fields at 0; the name gets a sibling "-N" suffix when taken); the
  returned node has `minX`/`maxX`/`minY`/`maxY` or `min`/`max`/`parameter`
  setters. Applied as rectangle gates on the channel's display transform.
- `math`: `abs`, `acos`, `asin`, `atan`, `atan2`, `ceil`, `cos`, `exp`,
  `floor`, `log`, `log10`, `log2`, `pow`, `random`, `round`, `sin`, `sqrt`,
  `tan`, `sqr`, `max`, `min`, `sum`, `mean`, `median`, `stddev`, `pin`,
  `inRange`.

Not implemented (calls print an error): `workspace.chart()` (`ChartAPI`,
`ChartWindowAPI`, `ChartLayerSettingsAPI`: build and export graphs),
`movie.create()` (`MovieAPI`: HTML movies of charts), node `display()`
(opens graph windows), node `add` / `remove` of analysis nodes,
`fileMask(name, file)` gates, node `annotation`, `GatedPopulationAPI`
`not` / `magnetic` flags, the remaining `MathUtil` geometry helpers
(`getLineAngle`, `slopeIntercept`, `computeLocalAngleDegrees` and similar).

Editor commands (`ScriptEditorCommand`, 11 constants).
- NEW_SCRIPT "New Script": adds a script named `NameUtil.uniqueName("New
  Script")` (exact-name check, "-N" suffix) and selects it. Done.
- LOAD_SCRIPT "Open Script": file chooser for `.fjs` (several files); each
  becomes a script named after the file without its extension. Done.
- DUP_SCRIPT "Duplicate Script": copy of the selected script, same name
  (`FJScript(FJScript)` copies name and text). Done.
- DELETE_SCRIPT "Delete Script": removes the selected script, no question.
  Done.
- SAVE_OPTIONS "Save Options": popup with SAVE "Save Selected Script" and
  SAVE_ALL_TO_DIR "Save All". Files are `name.fjs` (`/` and `\` become `_`,
  `.fjs` added when missing). Done; **Own rule**: Save All downloads one
  `.fjs` per script instead of asking for a folder.
- RUN "Run": runs the selected script if it is not empty; `console.log`
  output, then the script's result (if not undefined) in blue, errors in red
  as "message (line L, column C)". Each run has a fresh scope. Done.
- CLEAR_CONSOLE "Clear": empties the output console. Done.
- STOP and CLEAR_CONSOLE_SCOPE: declared in the enum but no button, menu or
  action handles them (`ScriptViewAction` handles RUN and CLEAR_CONSOLE,
  `ScriptListAction` the list commands). **Not a gap: no-op in FlowJo
  10.6.2**; stopping is Ctrl+C in the prompt (below).

Window and console.
- Frame "FlowJo Script Editor": list "FlowJo Scripts" (each row "name (N
  lines)", `FJScript.getPresentationString`), "Script Editor" text (monospace
  11), "Output Console" (monospace, last 2000 outputs) and the ">>>" prompt.
  The console starts with "Welcome to the FlowJo core". Output from a new
  writer (a script name or "FlowJo Scripting Console") starts with a
  "--- name ---" line.
- The prompt (`ScriptConsoleThread`) keeps one scope for the session:
  variables persist between commands and `_` holds the last result. It
  echoes ">>> command" and "      = result" (blue) unless the result is
  undefined. Enter runs; Up / Down walk the history (150 commands, empty
  commands and a repeat of the last one are not added). Ctrl+C
  (`ScriptView$Handler.handleKey`, key 67) interrupts: "User interrupt" in red.
  **Own rule**: here Ctrl+C stops the worker, so console variables are lost
  after an interrupt (FlowJo keeps them); it also stops a long Run. A
  console command that needs statistics not yet computed is run again once
  they are (see stats above), so JavaScript side effects before the first
  missing statistic in that command can happen twice.
- Workspace: `<Scripts><Script lang="text/javascript" name="...">text
  </Script></Scripts>` under `<Workspace>` (`ScriptEditorController.
  getElement` / `setElement`); FlowJo always holds at least the initial New
  Script. Read and written (`src/core/wsp.ts`, `src/core/wspWriter.ts`);
  names are kept verbatim (FlowJo's default name carries trailing blanks).
  **Own rule**: an untouched workspace shows one New Script but writes no
  `<Scripts>` until a script is edited.
- `TemplateFunction.applyScripts` runs every non-empty script when a
  template is applied. Not done here (templates are applied without running
  scripts).
- Tests: `tests/scriptEditor.test.ts` (list rules, file names, `.wsp`
  read/write, history, API, statistics rounds, operations, console scope);
  e2e `e2e/followup-editors.mjs` (24 checks).

## Counts

Of the 51 gap rows: Done 26 (SCRIPTEDITOR added in the follow-up round),
Own rule 12 (CLOSE, REVERT, EXCEL, ACS, BROWSESAMPLES, ADDKEYTOGROUP,
BOOLEANCREATE, BOOLEANEDIT, SORT1-3, TREEREMOVECOLUMN), Not a gap 1
(REPORTEDITOR: no-op in FlowJo 10.6.2), Deferred 12 (AUTOCC,
CHECKSAMPLEQUALITY, IMPORT_CSV_CLR, CONSENSUS_DP, CLUSTER_FREQ_DP, MIFlowCyt,
MIFLOW, EXPORT_DIVA, IMPORT_DIVA, RIBBONCONFIG, RIBBONSETDEFAULT,
RIBBONCOMMITTOPREFS). Some Done rows carry small own-rule notes, stated above.
