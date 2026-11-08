# Platforms and Plate Editor: FlowJo 10.6.2 behaviour and flowjo-rea status

Scope: `PlatformNavCommand` (except MATRIXEDITOR and COMBOGATES) and
`PECommand` (the Plate Editor). Rules were read from the FlowJo 10.6.2 jar
(`com.treestar.flowjo.application.peditor.*`,
`com.treestar.flowjo.application.graphwindow.comparison.*`,
`com.treestar.threeD.*`, `NodeFactory`, `WSPlatformAction`,
`WSActionManager`) and, for the comparison statistics, from the native engine
`libNativeEngine-3.6.2` (symbol names below). Everything here is written in
our own words; no code was copied.

Code: `src/core/plate.ts`, `src/core/compare.ts`, `src/core/calibration.ts`,
`src/ui/PlateEditor.tsx`, `src/ui/Compare.tsx`, `src/ui/ThreeD.tsx`,
`src/ui/PlatformTools.tsx` (host, Calibration, FCS Scan), new worker method
`AnalysisService.eventMatrix` (`src/core/service.ts`). App hook: one dialog
kind `{ kind: 'tool' }` and a button row in the Tools ribbon tab (flowjo
layout, band "Experiment / Biology") and in the classic Cytometry band.

Tests: `tests/plate.test.ts` (20 tests), `tests/compare.test.ts` (17 tests),
`tests/threeD.test.ts` (7), `tests/miflowcyt.test.ts` (3), `e2e/followup-3d.mjs` (26 checks, port 5191),
`e2e/platforms-gaps.mjs` (30 checks, dev server port 5186).

Status counts (63 rows; COMBOGATES belongs to the workspace area):
Done 52, Own rule 7, Deferred 3, Not a gap 1 (follow-up rounds: THREE_D and MIFLOWCYT Done, TEMPLATE a 10.6.2 no-op, RIBBONCONFIG and RIBBONSETDEFAULT done with own rules in round f2; several Done rows carry small own-rule notes).

## 1. Where the platforms live in FlowJo 10.6.2

- `WSPlatformAction.doAction`: PLATE opens the workspace's single
  `PlateEditor`; every other platform command that `isPlatformCmd` accepts goes
  to `NodeFactory.doPlatform(workspace, lookup(cmd))`.
- `NodeFactory.lookup` maps CC 0, PROLIFERATION 2, KINETICS 3, COMPARISON 4,
  QC 7, THREE_D 8, FCSSCAN 9, QB 10, CALIBRATION 11, DERIVED 12, COMP 13,
  MATRIXEDITOR 14. `doPlatform`'s switch has cases only for 0, 2, 3, 4, 8, 9
  (FCSScanController.open), 12, 13 (and 14 earlier); **QC (7), QB (10) and
  CALIBRATION (11) fall to the default branch and do nothing**. TIMESERIES is
  not accepted by `isPlatformCmd` at all.
- Ribbon (`WSActionManager.getExperimentActions` / `getBiologyActions`): the
  Experiment band holds Annotate Experiment (MIFlowCyt), Add Keyword and Plate
  Editor; the Biology band holds Cell Cycle, Kinetics, Compare Populations and
  Proliferation. No band or menu references QB, QC, CALIBRATION or TIMESERIES
  (only their dictionary strings exist, `plat.qb`, `plat.calibration.*`;
  `plat.qc` and `plat.timeseries` have no dictionary entry). 3D is reached
  from the graph window (`gw.nav.cube` "Show in 3D") and creates a
  `ThreeDNode` under the population. FCS Scan is in the Edit menu (per
  `dlog.license.file.location.local.tooltip`).

## 2. PlatformNavCommand

### QB "Q&B" - Deferred
FlowJo 10.6.2 has the enum, the label and the tooltip ("A customized
regression analysis to measure noise and linearity of the cytometer") but no
handler (NodeFactory default branch) and no ribbon entry, so the command does
nothing. There is no FlowJo behaviour to reproduce; a cytometer Q and B
regression would be a new design without a reference. Deferred.

### QC (unlabelled) - Deferred
Same as QB: `WSPlatformAction.isQC` exists but `doPlatform` ignores index 7.
The `graphwindow.qc.QCController` classes (strings `plat.qc.*`: Drift,
Spikiness, Rate, Weighted Slope) are not reachable through this command in
10.6.2. Deferred for the same reason. (Sample quality on the Instrumentation
band is a different command, `aSampleQuality`, outside this area.)

### TIMESERIES (unlabelled) - Deferred (covered by Kinetics)
`getTimeSeries()` builds the action but `isPlatformCmd` rejects the command,
so it does nothing in 10.6.2. Statistic-over-time plots are the Kinetics
platform, which flowjo-rea already implements (`src/core/kinetics.ts`,
`e2e/kinetics.mjs`). Nothing further to do.

### CALIBRATION "Create Calibration Parameter..." - Own rule
FlowJo 10.6.2: no handler (above). The dictionary describes the intended
window: intro "This window enables you to create a new parameter that is
calibrated to a known standard", columns Peak / Known MESF values, Slope,
Correlation Coefficient, button Define, suffix "Calibration".
flowjo-rea (own rule, so the dictionary's feature is usable): pick a
parameter, enter bead peaks (measured intensity and known MESF, 4 rows plus
"Add peak"), the window fits log10(MESF) = a + b log10(MFI) by least squares
over the peaks with positive values (at least two), shows Slope, Intercept and
Correlation Coefficient, and Define adds a derived parameter
`<channel>_MESF = 10^a * <channel>^b` (derived-parameter names allow letters,
digits and underscore only, so the name is not FlowJo's "Calibration"
suffix). Tests: `MESF calibration (own rule)` in `tests/compare.test.ts`;
e2e `CAL fit slope 1, r 1`, `CAL defines a derived parameter`.

### COMPARISON "Compare Populations..." - Done (with own-rule parts, section 4)

### THREE_D "3D Viewer" - Done (section 5; own-rule rendering)

### FCSSCAN "FCS Scan" - Own rule (section 6)

### PLATE "Plate Editor" - Done (section 3)

## 3. Plate Editor (PECommand)

Model (`PlateModel`, `PlateWell`, `Well`): a plate is a grid of wells, each
with a keyword list (attribute/value pairs). Plates are templates saved in the
workspace; flowjo-rea stores them in `ws.plateEditor` (edits are undoable).
The well selection is window state.

Dispatch: `PEAction.doAction` (most commands), `PEEditAction` (CUT, COPY,
PASTE_PLATE), `PEActionManager.createActions` (sizes), `PEWellAction` /
`Plate.handleRightClickOnWell` (well popup), `PESelectionArea`
(SELECT_GROUP, saved selections), `PEPerspective` (FILTER_KEYWORDS),
`PEditorWellDisplayTable` (REMOVEKEY).

### Plates band

#### TEMPLATEADD "Add New Plate" - Done
`PlateEditor.doNewTemplate` makes `PlateModel(name)`: rows/columns 0, then
`init()` takes the size from the plate-size preference (ends with "1536" =
48 x 32, "384" = 24 x 16) and otherwise 96 wells (12 x 8); plate ID "00000",
experiment ID "000-00000", format "Plate"; the default name is "Plate"
(`le.plate`, made unique). flowjo-rea: new 96-well plate named "Plate",
"Plate 2", ... and makes it current. e2e `PE Add New Plate`.

#### TEMPLATEDUPLICATE "Duplicate Plate" - Own rule (name)
Copies the current plate "with all the keywords". The copy's name rule of
the template explorer was not decoded; flowjo-rea names it "<name> copy"
(made unique).

#### TEMPLATEDELETE "Delete Plate" - Done
Confirms "Are you sure you want to delete this plate?" (`pe.delete.confirm`)
and removes the current plate. flowjo-rea keeps at least one plate (a fresh
"Plate" replaces the last one). e2e `PE Delete Plate (confirmed)`.

### Document band

#### OPEN "Open..." - Own rule (file format)
`PlateEditor.doOpen` loads a plate definition XML (`untitled plate.xml`,
"XML Plate Definition"); parse failure reports "Protocol file could not be
parsed." flowjo-rea reads its own XML (`plateXml`/`parsePlateXml`): element
names follow FlowJo's (`PlateModel` with `rows`, `columns`, `plateID`,
`expID`; wells as `Protocol format="platewell" name row column` with
`Keyword attribute value` children), but full compatibility with files saved
by FlowJo is not verified (no sample file). Test `xml round trip`.

#### SAVE "Save" - Own rule
Writes the plate definition XML; the browser downloads `untitled plate.xml`.

#### SAVEAS "Save As CSV Table" and EXPORT "Export" - Done
SAVEAS has no handler in 10.6.2; the Export command (`PECommand.EXPORT`,
tooltip "Export the well ID and assigned annotation into a CSV file") runs
`PlateEditor.doSaveAsTable` -> `PlateModel.makeTable`: comma separated, first
column "WELL ID", then one column per keyword found in any well (FlowJo uses
hash-set order; flowjo-rea sorts them), one row per well in row-major order
including empty wells, values CSV-escaped. flowjo-rea has one button "Save As
CSV Table". Tests `export table and import back`; e2e `PE Save As CSV Table`.

#### IMPORT "Import" - Done
`PlateModel.importString`: the first CSV row is the header; the well-ID
column is the header equal (case-insensitive, trimmed) to one of the well-ID
keyword names (`Sample.getWellIDKeywordPossibilities`: the preference value,
"WELL ID", "GTI$WELL", "$WELLID", "WELL_ID", "well id"; the last match wins).
No such column: error "The well id was not found in any column". Each later
row: skipped when shorter than the well column, when the well ID is empty,
not a well designation, or outside the plate; otherwise every other column
with a header and a non-empty value is added to that well. flowjo-rea also
reports the number of ignored lines. Test `import requires a well id column
and skips bad rows`.

#### TEMPLATE "Save As Template" - Not a gap: no-op in FlowJo 10.6.2
`PlateEditor.saveAsTemplate` only constructs `PlateTemplateDialog`
("Saving as Plate Template"). That dialog is a mock-up: its two keyword
tables are filled with hard-coded example pairs ($CYT = LSRII, PLATE NAME =
CD4 Treg activation; $P15S = pSTAT5, $P12S = CD4, $P9S = CD68) under "If these
keywords match files being added:" / "...these keywords will be applied to
them.", and its only action (`PlateTemplateDialog$1.doAction`) opens the help
page when the help button is pressed; Save and the other buttons do nothing
and nothing is written. It is not the workspace template (.wspt,
`src/core/template.ts`), which is unrelated. flowjo-rea offers no button.

#### CLOSE / CLOSEDLOG "Close" - Done
Closes the Plate Editor window (CLOSEDLOG has no separate handler). The plate
definitions stay in the workspace. e2e uses `pe-close`.

#### SHOW / HIDE "Show Instructions" / "Hide Instructions", TOGGLE / NOTATION "Toggle Notation" - Done
Only NOTATION is wired in 10.6.2 (tooltip "Show or hide the instructions
panel"); SHOW and HIDE have no handler. flowjo-rea: one toggle button whose
label is "Hide Instructions" / "Show Instructions"; the instructions text
follows `plat.plate.editor.instructions`.

### Plate size

#### SETDIMENSIONS "Set Plate Dimensions...", SIZE96, SIZE384, SIZE1536, SIZECUSTOM - Done
`PlateDimensionDialog`: 96 = 12 columns x 8 rows, 384 = 24 x 16, 1536 =
48 x 32; Custom has number fields "# of Columns" 1..48 and "# of Rows"
1..32. Row letters are `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef`, columns 1..48,
well IDs without zero padding ("A1", "f48"; `PlateModel.wellNotation`).
Resizing keeps the wells inside the new grid. Tests `sizes and notation`,
`set dimensions drops outside wells`; e2e `PE 384 well plate is 16 x 24`,
`PE 1536 well plate is 32 x 48`, `PE custom 6 x 4`.

### Keywords

#### ADD1KEYWORD "Add" - Done (own rule on conflicts)
`PEditorKeywordTable.addNewKeyword`: both fields must be non-empty
("Error: keyword/value must not be empty."); `addPair` inserts the pair at the
top of the "Keyword/Values - Drag to Wells" list unless already present.
Adding a pair to a well (`Well.addAttribute`): an identical pair is skipped;
a different value of an existing attribute asks "This keyword exists, do you
want to overwrite it?" (`dlog.plateeditor.wellconflict`) and overwrites on
yes. Own rule: flowjo-rea overwrites without asking (undo restores).
FlowJo assigns by dragging a pair onto a well (dropping on a selected well
adds it to every selected well); own rule: select the pair, select wells,
"Add to selected wells". e2e `PE add keyword to selected well`.

#### ADDKEYS "Add Keywords From File..." - Done
`PEditorKeywordTable.addKeywordFile`: each line split at commas; lines with
at least two fields add the pair (field 1, field 2) to the list (the tooltip
mentions a WELLID first column, but the code reads plain attribute,value
lines). Test `keyword file and table`.

#### REMOVEKEYS "Clear Selected Keywords From Table" - Done
`PlateEditor.deleteSelectedKeywords`: removes the selected pairs from the
list (wells keep their attributes).

#### REMOVEKEY "Remove Keywords" - Done
Selected-well table (`PEditorWellDisplayTable`, columns Attribute / Value /
Remove): removes that attribute from the selected well. With no single well
selected the table shows "Select a single well"; an empty well "No
attributes".

#### CLEARWELLS "Clear Selected Wells" - Done
`Plate.clearSelectedWells`: for every selected well, with a keyword filter set
only that keyword is removed, otherwise all attributes. Test `clear with and
without keyword filter`.

#### FILTER_KEYWORDS "Filter Keywords" - Done
Choosing a keyword (`PlateModel.keywordFilter`) makes each well show that
keyword's value instead of its well ID; a filter that is empty, contains
"well" or equals "all" shows the well ID (`PlateWell.getWellDisplayText`).
Test `well text follows the keyword filter`.

### Staging area

#### ADDWELL "Add Staging Well", DUPLICATEWELL, REMOVEWELL "Remove Staging Well" - Done
`PEditorStagingArea`: four staging wells at start (`nStagingWells = 4`),
named "Staging Well n" with the smallest unused n
(`StagingWell.getDefaultStagingWellName`). Add appends an empty one;
Duplicate (staging-well popup) copies its attributes into a new one; Remove
deletes the selected staging wells. Popup: Rename, Duplicate, Remove, "Add
contents to plate selection" (adds its attributes to every selected plate
well; disabled with "<no contents>"). flowjo-rea adds an "Add keyword" button
on each staging well for the selected pair (FlowJo: drag). Tests `keyword file
and table` (default names); e2e `PE staging area has 5 wells`.

### Select band and selection area

#### SELECT_ALL, DESELECT_ALL, INVERT_SELECTION - Done
`PlateModel.selectAll / selectNone / invertSelection` over all wells. Header
clicks select a row or column (instructions text). flowjo-rea also:
Shift-click selects a rectangle from the anchor, Ctrl/Cmd-click toggles one
well (own gesture rule; FlowJo's marquee drag is not reproduced). Test
`selection helpers`.

#### SELECT_GROUP "Select Group" - Done
`PESelectionArea`: choose a workspace group; selects the wells whose samples
(matched by well ID) are in it.

#### SELECTION_SAVE "Save Well Selection", SELECTION_RESTORE - Done
Asks "Enter a name to describe the selection:" and adds a button to the
Selection Area that restores that selection.

#### MAKEGROUP "Make Group..." - Done
`PEditorStagingArea.makeGroup`: needs a non-empty selection; `PlateGroupDlog`
asks for a name and creates a workspace group of the samples in the selected
wells. e2e `PE Make Group from selected wells`.

### Clipboard band

#### CUT, COPY, PASTE_PLATE - Done (paste format own rule)
Copy puts the selected wells on the clipboard; Cut also clears them. Paste
"expects either XML or tab/nl delimited text with attributes in the first row
and well ids in the first column". flowjo-rea writes and reads the tab text
(first column "WELL ID") through the system clipboard with an in-window
fallback; FlowJo's XML clipboard flavour is not supported. Test `copy and
paste tab text`.

#### FILLDOWN "Fill Down", FILLRIGHT "Fill Right" - Done
`Plate.fillDown`: per column, find the topmost selected well; copy all its
attributes into each following selected well, stopping at the first
unselected one. Quirk kept: a column is skipped when its topmost selected
well is in the last two rows (FlowJo compares the 1-based row with height
minus 1). `fillRight` does the same along rows. Tests `fill down copies...`,
`fill down skips ... (FlowJo quirk)`, `fill right`; e2e `PE fill down`.

#### TITRATE "Dilution Series..." - Done
`PlateTitrationDlog` ("Fold Dilution Keyword Generator"): Keyword (default
"Concentration (ug/ml)" with a micro sign), Starting Value, Number of
Replicates, Dilution Multiplier, Sequence Incrementer; buttons Fill Down /
Fill Right. `Plate.fillSeries`: per column (down) or row (right) of the
selection, every well from the first to the last selected one (wells between
them too) gets keyword = value written as Java `Double.toString` ("1.0",
"0.5", "1.0E-4"); after each `replicates` wells the value becomes value x
multiplier + incrementer. Quirk kept: Fill Right multiplies but never adds
the incrementer. Tests `dilution series down...`, `dilution series right
ignores the increment`, `java double formatting`; e2e `PE dilution series`.

### Experiment band (workspace links)

Sample well IDs: `Sample.getWellID` reads the first present keyword of the
well-ID list above and parses it with `WellID.fromString` (letters and digits
collected separately; row = first letter, case-insensitive; column = digits;
both 0..200), so "A01", "a1" and "1A" are all A1.

#### ATTACH_SAMPLES_FROM_GROUP "Read Samples from Group" - Done
`PlateEditor.attachSamplesFromGroup`: for each well, the current group's
sample with that well (`WSSampleMgr.findSampleByWell`) is attached; attached
wells draw a circle (`PlateWell.paintComponent` drawOval). flowjo-rea: circle
marker and the file name in the well tooltip. e2e `PE Read Samples from
Group matches wells by WELL ID keyword`.

#### FROM_WORKSPACE "Read Attributes from Group" - Done
`PlateEditor.fillWellsFromWorkspace`: if any group sample lacks a well ID,
notifies "Unable to read attributes from all samples in group: %d missing Well
ID(s)" and continues. For every well with exactly one matching sample, adds
that sample's keywords that are "interesting"
(`KeywordedParameterList.isInteresting`: non-empty, not starting with FJ_FCS,
AUTOBS, APPLY COMP, WINDOW EXTENSION, $DATATYPE, $BEGIN, $END, $NEXT, $MODE,
$BYTEORD, LASER, "P<digit>", and of the $Pn keywords only those ending in S
or N) and not common to the whole group. The plate ID, plate name and
experiment ID come from the group's common keywords (PLATE ID / $PLATEID /
..., PLATE_NAME / ..., EXPERIMENT_NAME / ...). Uncertain: the exact $Pn
rule (read from a branch sequence). Test `read attributes from group...`;
e2e `PE Read Attributes from Group`.

#### MOVE "Apply Plate Keywords to Group" - Done
`PEAction.wellsToWorkspace`: each plate well's keywords are added to the
group sample in that well (`WSSampleMgr.addProtocol`). flowjo-rea writes
them as sample annotations. e2e `PE Apply Plate Keywords to Group annotates
samples`.

#### MIFLOWCYT "Annotate Experiment..." - Done
Opens the MIFlowCyt experiment annotation editor (`PEAction.annotate` ->
`MIFlowCytDialog`); the same dialog as WSCommand.MIFlowCyt, specified in
workspace.md ("Annotate Experiment"). From the Plate Editor FlowJo also copies
the result to the plate (`PlateModel.setMetadata`); flowjo-rea keeps the one
workspace annotation (own rule). Button `open-miflow` in the Experiment band;
tests `tests/miflowcyt.test.ts`, e2e `MIFlowCyt ...` in `e2e/followup-3d.mjs`.

### Settings band and well display

#### SHOWNENTRIES, PETHICK, PEHEATMAP, PEENUM - Done
Per-plate toggles saved with the plate (`showNEntries`, `peThickBorders`,
`peHeatmap`, `peShowEnums`; defaults from preferences). Show number of
attributes: the count in the well's bottom-right corner. Borders: when a
pair is selected in the keyword list, wells with that exact pair get one
border colour, wells with the attribute but another value a second colour
(thicker pens with PETHICK; `PlateWell.syncBordersForPaint`). Heat map of the
filtered numeric keyword: range starts at [0, 0] and widens with each
numeric value (`PlateModel.getWellValueRange`), colour from
`CalculatedTable.getHeatMapColoring`: u = clamp((max - v) / (max - min), 0,
1), blue = int(255 u), red = green = 255 - blue (yellow at max, blue at min;
an empty range gives yellow). Categorical borders: one colour per text value
(`Plate$StringColorMap`; flowjo-rea uses its own palette). Tests `heat map:
range from 0...`; e2e `PE heat map: maximum value is yellow`.

#### Statistic heat map (layout plate tool) - Done (own placement)
FlowJo shows a statistic across a plate in the Layout Editor's plate tool
(`le.plate.display.*`: drag a statistic, Heatmap display). flowjo-rea adds a
"No Statistics / <statistics column>" chooser to the Plate Editor: each well
with a loaded sample shows that column's value, heat-coloured with the rule
above. Placing it in the Plate Editor rather than the layout is an own rule.

#### WELL_ADD_KEYS_TO_TABLE, WELL_CLEAR_KEYS, WELL_CREATE_STAGING_WELL - Done
Well popup (right click): "Add attributes to table" (pairs into the keyword
list), "Clear attributes" (all of that well), "Create Staging Well from
attributes" (new staging well with a copy).

#### RIBBONCONFIG "Configure Ribbon", RIBBONSETDEFAULT "Apply Defaults" - Done (own rule)
Ribbon customisation (`PERibbonConfigDialog`, `PERibbonAddBandAction`,
`PERibbonRemoveBandAction`, `PERibbonDropTargetListener`; defaults
`PERibbonStructure`: Plates: Plates, Experiment; File: Document; Edit:
Clipboard, Select; Tools: Configure, Settings, Keywords; "Are you sure? This
will discard all ribbon customizations saved to your preferences."). Rules as
the workspace ribbon: docs/validation/ui-gaps/workspace.md section F2.3.
flowjo-rea: "Configure Ribbon" (`pe-ribbon-config`) at the end of the band
strip; remove / add / reorder bands, Apply defaults. Own rule: the plate
editor's bands are one strip (one task) of the app's fieldsets (Plates,
Document, Clipboard, Select, Experiment, Plate size, Settings); no Commit to
Preferences (PECommand has none). Tests: e2e `e2e/followup-f2.mjs` "plate
editor: removing a band hides it", "plate editor: drag moves a band",
"plate editor: Apply defaults".

## 4. Compare Populations (COMPARISON)

FlowJo: `NodeFactory.doPlatform` case 4 adds a `ComparisonNode` under the
selected population and opens `ComparisonFrame`. The sample population is
compared with one or more comparator ("control") populations dropped on the
window or set from a group ("Set control group"). Defaults
(`ComparisonNode(GraphNode)`): multivariate bins 300, show histogram on, tint
off, plot difference off, merge controls off, smoothing 13 (graphs). Table
columns (`ComparisonStat`, default list): SE Dymax %Positive, Overton
%Positive, Chi-Squared T(X), K-S Max Difference, K-S Max at Intensity
(formerly "K-S Chi Squared Value"), K-S Probability; Chi-Squared Max T,
Multivariate T(X) / Max T / Num Bins, Distribution and the match-ratio
measures can be added.

Engine rules (`Comparison::CalcUnivariateStats`): for each parameter both
populations are histogrammed with 256 buckets on the parameter's transformed
scale; several comparators are summed into one control histogram.

- **K-S** (`KolmogorovSmirnoff::Calculate`): cumulative histograms S, C;
  D = max over buckets of |S(i)/Ns - C(i)/Nc| (first bucket reaching it);
  N = Ns*Nc/(Ns+Nc) in integer arithmetic; lambda = D sqrt(N).
  "K-S Max at Intensity" is the scale value of that bucket (channel range x
  bucket / 256 through the scale). Probability (`CalcQsubKS`): lambda 0 ->
  "0%"; below 1.0727 -> "less than 80%"; between consecutive critical values
  1.0727, 1.2238, 1.3581, 1.5174, 1.6276, 1.7317, 1.8585, 1.9526 ->
  "between 80% and 90%", ..., "between 99.8% and 99.9%"; from 1.9526 ->
  "greater than 99.9%".
- **Overton %Positive** (`BasicHistogram::OvertonPositive`): per bucket
  d = s/Ns - c/Nc; a negative d is cancelled against positive d of lower
  buckets, lowest first, as far as it goes; result = 100 x sum of positive d.
- **SE Dymax %Positive**: with cumulative S, C: m = bucket of the largest
  C(i)/(C(top) - C(0)) - S(i)/(S(top) - S(0)); m2 = the same over buckets
  0..m using the cumulative counts up to m; with c = C(m)/Nc, s = S(m)/Ns:
  100 (1 - s/c + (C(m2)/Nc) s / c^2 - S(m2)/(Ns c)); 0 when c is 0.
- **Chi-squared** (`KolmogorovSmirnoff::ChiSquared(sample, control, 50)`):
  50 probability bins built on the sample histogram (each takes buckets until
  it holds at least Ns/50 events); chi = sum (p - q)^2/(p + q) over bins;
  T(X) = max(0, (chi - B/N)/(sqrt(B)/N)) and Max T = (2 - B/N)/(sqrt(B)/N)
  with B = 50 and N = min(Ns, Nc).
- **Multivariate** (`MultiDimCompare::BuildComparisonTree`,
  `FilterSampleThroughTree`, `ChiSquare`): probability binning tree built on
  the control events over all listed parameters, the sample filtered through
  it, T(X) as above with B = number of bins. Footer: "Chi-squared Test:
  T(X) = ... (Max T Value = ..., #Bins = ...)", "Number of bins" field.

flowjo-rea (`src/core/compare.ts`, `src/ui/Compare.tsx`): univariate rules
as above in float32 like the engine (Done; tests in
`tests/compare.test.ts` against hand-computed values: K-S, probability text,
Overton, SE Dymax, chi-squared and T(X)). Own rules: the multivariate tree
splits the dimension of largest variance at its median until the requested
number of bins (FlowJo's split order was not decoded), with each parameter
scaled to its display range; histograms use this app's display scale and
off-scale events pile into the edge buckets. UI: comparator picker (sample +
population), Set control group, Reset control populations; Remove Scatter /
Uncompensated / Non-fluorescents / Unselected, Reset; add/remove statistic
columns, Reset statistics; Show graph, Show CDF, Plot Difference (green),
Tint Sample, Tint Control, Merge control histograms; multivariate footer and
bins. e2e `CP ...` checks.

**Multivariate (decoded, follow-up round; replaces the earlier own rule).**
`Comparison::CalcMultivariateStats` -> `MultiDimCompare::ChiSquare`,
`BuildComparisonTree`, `DivideTree`, `SortPartition`,
`FilterSampleThroughTree`, `FilterEventThroughLeaf`, `CleanUpLeafCounts`,
`BasicHistogram::ChannelStdDev` / `ChannelMedian` / `AddDataValue` (native
engine, read with Ghidra headless; output kept out of the repo):

- Each event's value on each listed parameter is stored as a 16-bit integer
  v = (channel << 10) / channel range, i.e. its position on the parameter's
  scale times 1024 (flowjo-rea: trunc(1024 u), u the display-scale position
  clamped to 0..1).
- Minimum leaf size = trunc(max(Nc / bins, 5)) with Nc the summed event count
  of all control populations and bins the "Number of bins" field (300).
- Split mode 1 (the `LeafComparison` built by ChiSquare): at each node a
  1024-bin histogram of every parameter is made from the node's events; the
  parameter with the largest histogram standard deviation (bin index units,
  n - 1 denominator, strictly larger wins, so ties keep the first) is cut at
  its median bin, the first bin whose running count reaches n x 50 x 0.01,
  at least 1. Events with v < cut go left.
- A node whose cut leaves one side empty becomes a terminal leaf. Otherwise
  each side becomes a terminal leaf when it has fewer events than the minimum
  leaf size, else it is divided again (left first, nodes appended
  post-order).
- A tree is built on every control population in turn into the same node
  list; filtering starts at the last node, the root of the last tree. The
  controls are filtered one by one into the same count vector, which
  `CleanUpLeafCounts` clears each time, so the control counts are those of
  the last control while Nc is the sum of all controls (engine behaviour,
  reproduced). Bins B = the number of terminal leaves of all trees.
- chi = sum over leaves of (p - q)^2 / (p + q) in float, with p = s x (1/Ns),
  q = c x (1/Nc), leaves with p + q = 0 skipped; T(X) and Max T as above with
  N = min(Ns, Nc).

flowjo-rea: `multivariateChi` in `src/core/compare.ts`, all events of each
population (the earlier 20000-event subsample is gone). Tests `multivariate
tree: largest-sd parameter, median bin split, ...`, `multivariate with
several controls: last control counts, Nc summed`.

**Population measures - Done.** `ComparisonNode.evalMeasureStat` sends one
request per comparator (`ComparisonRequest(node, pop, "FMeasure" |
"MatchRatio")`) with the comparison's own population in role "correct" /
"consensus" and the comparator as "candidate"; `Comparison::ProcessQuery`
takes the first population as the event base, so the event set is every
event of that population's sample, indexed by event number (a population
with no gate, "All events", contains every event and counts as size 1).

- Match Ratio (`Comparison::MatchRatio`): per event f = (number of consensus
  populations holding it) x (1 / number of consensus populations) and
  weight w = |f - 0.5|; a population scores w for each event where it agrees
  with the majority (in it and f > 0.5, or not in it and f < 0.5; a gate-less
  population scores when f > 0.5). The per-population score rows are laid out
  with a stride of (populations - 1) instead of the event count, so they
  overlap; with one consensus and one candidate the reported value is
  score(consensus row) / sum w = (1 + agreements over events 0..N-2) / N.
  Reproduced literally.
- FMeasure (`CalculateMatchingMatrix`, `Comparison::FMeasure`,
  `FMeasureStatisticInfo::ToXML`): M = events in both; precision = M /
  |candidate|, recall = M / |correct|, value = 2PR / (P + R) (0 when P + R =
  0), totalFMeasure = sum over correct populations of |correct| / N times its
  best F (one pair: |correct| / N x F). Precision and Recall are separate
  table statistics read from the same result.
- V-Measure: **Not a gap: no-op in FlowJo 10.6.2**. The engine has
  `Comparison::VMeasure`, but `ComparisonNode.gIncludeVMeasure` is the
  compile-time constant false, so the request is never sent and the column
  never gets a value.
- "Include Sample in Match Ratio" (`INCLUDE_SAMPLE`,
  `setIncludeSampleInMatchRatioControls`): **Not a gap: no-op in FlowJo
  10.6.2**; the flag is saved on the node but no request reads it.

flowjo-rea (`matchRatio`, `fMeasure` in `src/core/compare.ts`; worker
`populationMask`): a "Comparator" table under the parameter table with Match
Ratio, FMeasure, Precision, Recall and Total FMeasure per comparator. Own
rule: FlowJo shows these as table-editor statistics of the comparison node;
flowjo-rea has no comparison node, so they appear in the window. Tests
`match ratio (one consensus, one candidate) reproduces the row stride`,
`F-measure, precision, recall and total`; e2e `CP Match Ratio and F-measure
per comparator`.

**Add To Group - Own rule.** `ComparisonController.addToGroup` copies the
comparison node (`getElement` -> `NodeFactory.create`) to the current group
(`GroupNode.addAnalysisNode`), so every member sample gets the comparison at
the same population. flowjo-rea has no platform nodes; "Add To Group" runs
the comparison for every loaded member at this population path and lists
multivariate T(X), Max T, bins and the Match Ratio / FMeasure per comparator,
one row per sample. e2e `CP Add To Group lists the comparison for each group
sample`.

**Set source group / Clear source group - Done.**
`ComparisonController.setSourceControlGroup(true)` sets both
`setSourceGroupNode` and `setControlGroupNode` to the group population
(Set control group sets only the latter); `clearSourceGroup` sets the source
to null. With a source group, `ComparisonNode.addComparisonElement` writes a
"sample" population for every group member that has the path, and
`Comparison::ProcessQuery` keeps the last one, so the sample side is the
population in the last member of the group. flowjo-rea: "Set source group..."
does the same (last loaded member; controls = the group's samples at the
path), "Clear source group" reverts to the window's sample. e2e `CP Set
source group ...`, `CP Clear source group reverts`. Uncertain: whether the
parent population is also written when a source group is set (if so, it
would come last and win).

Still deferred: chart size buttons and graph smoothing (cosmetic).

## 5. 3D Viewer (THREE_D) - Done (own-rule rendering)

Decoded from `com.treestar.threeD.*` (`ThreeDController`, `ThreeDFrame`,
`ThreeDJPlot`, `Plot3DJ`, `ThreeDDataModel`, `ThreeDSettings`,
`ThreeDGradient`, `ThreeDScatterBuilder`, `ThreeDBubbleBuilder`,
`ThreeDSurfaceBuilder`, `MouseRotate`, `RotateBehavior`, `ThreeDNode`,
`actions.ThreeDActionManager` and the 27 `actions.ThreeDCommand`s) and
`PrefsFJML$ThreeD`. Rules in `src/core/threeD.ts`, viewer
`src/ui/ThreeD.tsx`.

Commands (`ThreeDActionManager.createActions` registers SAVE, SAMPLEPREV,
SAMPLENEXT, BOXSHOWHIDE, LABELSHOWHIDE, RESETAXES, SETCOLORPARAM,
SETSIZEPARAM, SETSIZEVALUE, ADDCOLOR, REMOVECOLOR, SAVEIMG, WIGGLE,
SETPOPCOLOR, OPENCLUSTERPANEL, TOGGLEPOPENABLED, HELPVIEWER; the button bar
`ThreeDFrame.BTN_BAR_ACTIONS` is Export..., Labels, Cube, Reset, Help, plus
the graph-type combo SETGRAPHTYPE; the side panel holds Point Scale, Size
Parameter, the colour row (Color Parameter + Color gradient) and the
population list):

| Command | 10.6.2 rule | flowjo-rea |
|---|---|---|
| SETGRAPHTYPE | `ThreeDController$PlotType` POINTCLOUD, BUBBLE, TERRAIN | Done (select) |
| (Voxel Plot) | dictionary only, no PlotType | Not a gap |
| BOXSHOWHIDE "Cube" | wireframe box on/off, default on | Done |
| LABELSHOWHIDE "Labels" | axis labels on/off | Done |
| RESETAXES "Reset" | `Plot3DJ.resetCamera` -> `createDefaultOrientation` = identity (X right, Y up, Z toward the viewer) | Done (also stops a spin) |
| SAVEIMG "Export..." | image file "<sample>+..." | Done (PNG) |
| WIGGLE "Wiggle..." | `saveWiggle`: frame 1 = view turned by -EYE_ANGLE (0.03 rad) about its Y axis, frame 2 = current view, written by `HtmlMovieCreator` (frame delay 500 ms, auto play) although the tooltip says GIF; registered but on no button or menu | Own rule: offered as a button, one self-contained HTML file |
| SAMPLEPREV / SAMPLENEXT | sibling navigation | Done (loaded samples) |
| SETXPARAM / SETYPARAM / SETZPARAM | right-click an axis ("Choose %s Parameter") | Own rule: X / Y / Z selects |
| SETCOLORPARAM, SETCOLORGRAD "Color" | colour axis: parameter + one of 9 gradients (Black, Red, Green, Blue, Spectrum, Black -> Transparent, Transparent -> Black, Black -> White, Black -> Red); `getColorAtLocation` mixes the nearest control points | Done |
| ADDCOLOR / REMOVECOLOR | `doThreeDAction` is empty | Not a gap: no-op |
| SETSIZEPARAM "Size Parameter" | bubble plots only ("Static" or a parameter) | Done |
| SETSIZEVALUE "Point Scale" | slider 0..100 -> sizeFactor 0..1 | Done |
| SETPOPCOLOR / TOGGLEPOPENABLED | population list colour / on-off | Done |
| OPENCLUSTERPANEL | opens `ThreeDGradientEditor`; on no button | Not a gap (unreachable) |
| SAMPLEUP, MAKEANIMATION, TOGGLEZUP, TOGGLEAUTOROTATE, SETCOLORGRAD (as action), TOGGLELOGLIN, CLOSE, SETXPARAM.. as actions | no action registered (CLOSE only in the File menu) | Not a gap |
| HELPVIEWER | help page | not offered |

Rules:

- Population data (`ThreeDController.addPop` ->
  `ThreeDDataModel.appendAxis(GParameter, GraphNode)`): every parameter of the
  sample, values from the engine normalised to the parameter's scale (0..1);
  the model then subtracts the minimum and multiplies (not divides) by the
  range, so a population that does not span its scale is drawn shrunk toward
  the cube corner. Reproduced (`populationAxis`). Uncertain: that the
  engine's "normalize" output is the 0..1 scale position.
- Defaults (`ThreeDNode.setDefaults`, `ThreeDSettings`): X and Y from the
  graph, Z and the colour parameter unused parameters, colour gradient the
  preference `ThreeD/plotdefaultColor` = Spectrum (violet 0.1, blue 0.25,
  cyan 0.35, green 0.45, yellow 0.65, red 0.9), point scale 0.01, cube and
  axes on, background white. flowjo-rea picks unused parameters
  fluorescent-first (exact `Sample.chooseUnusedParameter` order not read).
- Several populations (`computeMultiPlot`): each added population gets the
  next quick colour (red, orange, yellow, green, cyan, blue, magenta); with
  two or more enabled, points take their population's colour instead of the
  colour axis.
- Point Cloud (`ThreeDScatterBuilder`): points of round(180 x sizeFactor x 0.1
  + 1) pixels (1 px at the default, 15 px for tables, 19 px at full scale).
- Bubble Plot (`ThreeDBubbleBuilder`): spheres of radius u^2 x sizeFactor x
  0.1 + 0.01 cube units (u = size parameter) or sizeFactor x 0.1 + 0.01 when
  static, at most `bubbleMaxEvents` (1000) spheres, every
  (n / min(n, 1000))-th event.
- Terrain Plot (`ThreeDSurfaceBuilder`, `$ThreeDBinnedData`): X and Z binned
  into `contourResolution` (50) bins; height(i, j) = binsX[i] x binsZ[j] /
  largest product (the product of the marginals, not a joint histogram); a
  quad mesh between bin centres, one lit material colour (the first event's
  colour when a colour axis is set); no Y axis.
- Rotation (`MouseRotate`, `RotateBehavior`): drag rotates 0.008 rad per
  pixel from the press position; after a drag whose last horizontal step was
  2 px or more the plot keeps turning about its own Y axis every 40 ms by
  clamp(0.005 dx, +-0.08) rad until the next press. Perspective of Java 3D's
  nominal view (field of view pi/4).
- Not kept: the workspace `ThreeDNode` (attributes ThreeDVersion, type,
  xaxis, yaxis, zaxis, sizeaxis, sizevalue, matrix, showaxis, showcube, zup);
  flowjo-rea has no platform nodes, so the viewer's settings are not saved
  (own rule).

Own rules: drawn on a 2D canvas with a per-pixel depth buffer (points),
depth-sorted shaded discs (bubbles) and depth-sorted lit quads (terrain)
instead of Java 3D; at most 100000 events per population; axis tick labels
are not drawn (names only).

Entry points: Platforms "3D Viewer", graph window "Show in 3D" (graph.md),
table editor "3D Plot" (tables.md). Tests `tests/threeD.test.ts` (7), e2e
`3D ...` in `e2e/followup-3d.mjs` and `e2e/platforms-gaps.mjs`.

## 6. FCS Scan (FCSSCAN) - Own rule

FlowJo (`FCSScanController`, `FCSScanPanel`): drop a folder (or scan the
local file system / a FlowJo Enterprise server) to list its FCS files with
keyword columns; Find, Add keywords / Remove keyword / Reset keywords, Show
duplicates, Update column widths, Open parent folder, Save to workspace /
spreadsheet / database, Load remote files.

flowjo-rea (`FcsScanDialog` in `src/ui/PlatformTools.tsx`): "Choose
folder..." (browser directory picker) or "Choose files..."; each .fcs/.lmd
file's TEXT segment is read from its header offsets only (no data parsed);
columns Path, $FIL, $DATE, $TOT, $PAR, $CYT, $SRC plus added keywords; Find
filters on path and any keyword value; Show duplicates (same $FIL, $TOT and
size); Save to workspace adds the selected files; Save to spreadsheet
downloads a CSV of the selected (or all listed) files. Own rule because a
browser cannot scan the file system. Deferred: database, Enterprise server,
Open parent folder. e2e `SCAN ...` checks.

## 7. Uncertain points

- Exact $Pn keyword rule of `isInteresting` (Read Attributes from Group).
- FlowJo plate XML compatibility of Open/Save (element names followed, not
  verified against a FlowJo-saved file).
- Multivariate: the exact channel quantisation (FlowJo's channel step before the x1024 scaling).
- The K-S "K-S Probability" column: the engine produces both a numeric p (the
  table's lower bound of the interval) and the text; flowjo-rea shows the text.
