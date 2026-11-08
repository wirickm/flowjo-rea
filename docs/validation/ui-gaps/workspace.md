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
| MIFlowCyt "Annotate Experiment..." / MIFLOW | `WSController.openMIFlowCytDialog` -> `MIFlowCytDialog`; see "Annotate Experiment (MIFlowCyt)" below | **Done** (`tests/miflowcyt.test.ts`, e2e `MIFlowCyt ...` in `e2e/followup-3d.mjs`) |
| REPORTEDITOR "Report Editor" | `FJNavAction` to the report editor window | **Deferred**: a separate editor (report layout and export) |
| SCRIPTEDITOR "Script Editor" | `WSScriptAction`: FlowJo scripting console | **Deferred**: needs FlowJo's scripting language |
| EXPORT_DIVA / IMPORT_DIVA | `WSExportDivaAction` / `WSImportDivaAction`: gates and compensation to / from a FACSDiva experiment | **Deferred**: vendor format, no sample experiment file |
| RIBBONCONFIG "Customize Ribbon", RIBBONSETDEFAULT "Apply defaults", RIBBONCOMMITTOPREFS "Commit to Preferences" | `WSRibbonConfigDialog`, `WSRibbonSetDefaultAction`, `WSRibbonCommitToPrefsAction` | **Deferred**: cosmetic; the ribbon is fixed |

## Counts

Of the 51 gap rows: Done 27, Own rule 12 (CLOSE, REVERT, EXCEL, ACS,
BROWSESAMPLES, ADDKEYTOGROUP, BOOLEANCREATE, BOOLEANEDIT, SORT1-3,
TREEREMOVECOLUMN), Deferred 12 (REPORTEDITOR, SCRIPTEDITOR, AUTOCC,
CHECKSAMPLEQUALITY, IMPORT_CSV_CLR, CONSENSUS_DP, CLUSTER_FREQ_DP, EXPORT_DIVA, IMPORT_DIVA, RIBBONCONFIG, RIBBONSETDEFAULT,
RIBBONCOMMITTOPREFS). Some Done rows carry small own-rule notes, stated above.

## Annotate Experiment (MIFlowCyt) - follow-up round

Classes: `WSController.openMIFlowCytDialog`, `MIFlowCytDialog` (+ panels
Overview / Specimen / Instrument / Analysis / Figures, `MIFlowCytTTPane`),
`MIFlowCytElement`, `MIFlowCytAction`, `MIFlowCytActionManager$MIFlowCytCommand`,
`FigureListPanel`, `FigureSpec`, `com.treestar.flowjo.core.fcs.MIFLOW`,
`Workspace.getElement` / `setElement`, `FJPrefs.saveMIFlowCyt` / `getMIFlowCyt`.

- Open: the workspace annotation when it has children, otherwise the
  preference default (`FJPrefs.getMIFlowCyt`).
- Fields (element name: label). Overview, written directly under
  `<experiment>`: id: ID, name: Experiment, project: Project, created: Date and
  date_end: to (both default to today, `FCSTimeDateUtil.getCurrentDateString`),
  primary_researcher: Researcher, primary_investigator: Lab, organization:
  Organization, keywords: Keywords, purpose, conclusion,
  quality_control_measures (Quality Control), comments. `<specimen>`:
  description (Sample Description), source, organism, age, gender,
  phenotype, genotype, characteristics, treatment_long (Treatment
  Description). `<instrument>`: model, vendor (Manufacturer), location,
  flow_cell, panel; compensation is shown (drop a sample to append its
  matrix) and read but not written by FlowJo's `extract`. `<analysis>`:
  protocol (default "FlowJo <version>  (FlowJo, LLC, Ashland OR)"), gating
  (drop a sample to append its gating tree), groups (`autoFillGroups`: the
  group names, one per line). `<figures>`: `<figure id mimetype
  description>` with embedded Image / Table / HTML children, made from
  graphs, layouts or tables. A `WindowPosition` element keeps the dialog
  bounds and tab.
- Workspace: `<experiment>` is a child of `<Workspace>`, read in
  `Workspace.setElement` (`getChild("experiment")` -> `setMetaData`) and
  written by `getElement` when present.
- Commands: OK (`doOK`: store and close), Cancel, Open (`doOpen`: a MIFlowCyt
  XML file), Save As (`doSaveAs`: "<workspace> Summary.xml"), Print
  (`doPrint`: `MIFlowCytElement.toHTML`, one table per section), Save to
  Preferences as Default (`saveToPrefs`: preference + workspace), Auto-fill
  groups, NAV0-4 (tabs), Previous / Next, HELP1-3 (help page, MIFlowCyt
  paper, FlowRepository), SHARE / PUBLISH (Fluorish / FlowRepository upload).
- flowjo-rea (`src/core/miflowcyt.ts`, `src/ui/Experiment.tsx`, `wsp.ts`,
  `wspWriter.ts`, `Workspace.experiment`): all fields, tabs, OK / Cancel,
  Open / Save As XML, Print (HTML page), Save to Preferences as Default
  (browser storage), Auto-fill groups, "Append gating tree / compensation of
  selected sample" buttons for the two drop targets, Figures as a list of
  name / type / description rows (own rule: no embedded images). Own rules:
  compensation is written too; WindowPosition is not kept; Share and
  Publish (online services) are not offered.
