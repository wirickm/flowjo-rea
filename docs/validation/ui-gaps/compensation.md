# Compensation editor: FlowJo 10.6.2 behaviour and flowjo-rea status

Scope: `com.treestar.flowjo.application.compeditor.*` (the compensation wizard
`CompController` / `CompPerspective`, and the Matrix Editor `MatrixController`
/ `MatrixEditorPerspective`), command enum
`compeditor.actions.CompCommand`, plus `WSCommand.EDITMATRIX` and
`PlatformNavCommand.MATRIXEDITOR` which open the editor. Read with `javap` on
the FlowJo 10.6.2 jar (class and method names below are the evidence); UI
strings from `flowjodictionary*.properties`. Implemented independently.

Code: `src/core/compEditor.ts` (rules), `src/ui/CompEditor.tsx` (plot grid,
weights panel), `src/ui/Dialogs.tsx` `CompensationDialog` (editor UI),
`src/core/service.ts` `compPreview` (preview events), `src/core/compensation.ts`
(weights, SSM fields). Tests: `tests/comp-editor.test.ts` (unit),
`e2e/comp-gaps.mjs` (31 checks).

Which action handles which command: `MatrixActionManager.createActions`
builds `MatrixAction` for APPLYWORKSPACE, APPLYGROUP, SHOWHTML, MAKEMOVIE,
SAVE, SSM, EDIT, RESET, COMPARE and SHOWALLPARAMS; `CompActionManager`
builds `CompensationAction` (SAVE, SSM, CALCSSM, RESET, CALCULATE,
APPLYWORKSPACE, APPLYGROUP, PREFS, OPTIMIZEWT), `CompSetScaleAction`
(ZOOMIN, ZOOMOUT, ZOOMFIT, ZOOM100) and `AddToLayoutAction` (ADDTOLAYOUT).
`MatrixListPanel.initUI` adds NEWMATRIX / DUPMATRIX / REMOVEMATRIX and the
add popup LOAD_FILE / IDENTITY_MATRIX; `PresentationTypeCombo` handles NXN,
ALLBY, HISTOS; `MatrixEditorNavPanel` handles PREVIEW_SAMPLE and
PREVIEW_POP_PATH; `SpectralWeightsDialog.createActions` handles
S_WEIGHTS_CLOSE / IMPORT / EXPORT.

Status legend: Done (test), Own rule (deliberate difference), Deferred
(reason), Not in 10.6.2 UI (enum constant that no 10.6.2 class uses).

## 1. Editor and live preview (EDITMATRIX, MATRIXEDITOR, NXN, ALLBY, HISTOS, SHOWOVERLAY, PREVIEW_SAMPLE, PREVIEW_POP_PATH)

### WSCommand.EDITMATRIX "Edit Compensation Matrix", PlatformNavCommand.MATRIXEDITOR "Matrix Editor"
- FlowJo: opens the Matrix Editor (`MatrixController`, frame
  `CompEditorFrame`, `MatrixEditorPerspective`): matrix list on the left,
  editable matrix (`MatrixEntryPanel`) above, plot preview
  (`MatrixNxNPanel`) below. Tooltip `plat.matrixeditor.tooltip`: "adjust
  spectral overlap correction in many dimensions by eye".
- Live update: a cell edit (`MatrixEntryPanel.extractMatrixField` on focus
  lost / Enter) changes the matrix, and
  `MatrixEditorPerspective.notifyMatrixValueChanged` refreshes the plot
  editor's background evaluator, so the plots recompensate before the matrix
  is applied anywhere.
- flowjo-rea: Done (`e2e/comp-gaps.mjs` "editing a cell recompensates the
  preview at once"). The Compensation dialog now has a Matrix Editor section
  with the matrix table and a preview grid. The worker returns raw values of
  the matrix detectors for an evenly spaced subsample (at most 3000 events)
  of the preview population (`AnalysisService.compPreview`); the dialog
  compensates them with the unsaved matrix on every edit
  (`compensateEvents`). Own rule: the subsample cap keeps edits instant.

### CompCommand.NXN "N x N View" (default), ALLBY "All By...", HISTOS "Histograms"
- FlowJo (`MatrixController` constructor: presentation type NxN;
  `PresentationTypeCombo.actionPerformed`; `MatrixNxNPanel.layoutNxN`,
  `layoutRow`, `makeFigChartBox`):
  - N x N: the upper triangle of the visible channels. Row i (0..n-2) holds
    one plot per later channel j > i, with x = channel j and y = channel i,
    placed in column j; column headers name channels 1..n-1. Plots are dot
    plots with the default tint fill, 256 points square on a 260 point column
    (`PLOT`, `COLWIDTH`).
  - All By: a submenu of the visible channels (the "Comp-" prefix stripped);
    one row of plots, x = every other channel, y = the chosen channel.
  - Histograms: one row, one histogram per visible channel.
  - Data: the editor's "confirmation node" (the preview population).
- flowjo-rea: Done (`gridCells` unit test; e2e "N x N view", "All By PE-A",
  "Histograms"). The View select offers N x N View, "All By... <channel>" per
  visible channel, Histograms.

### CompCommand.SHOWOVERLAY "Show Overlay"
- FlowJo 10.6.2: the enum constant is not used by any class (the tooltip
  describes a third column of control graphs in an older wizard). The visible
  overlay control is the nav panel check box `plat.comp.matrix.overlay.raw`
  "Overlay Uncompensated" (action command `overlayRaw`,
  `MatrixController.actionPerformed`), initialised from the preference
  `ceOverlay` (default on). With it, `MatrixNxNPanel.createUncompedLayer`
  adds a layer whose axes are each channel's uncompensated primary detector.
- flowjo-rea: Done (e2e "Overlay Uncompensated is on by default"). Raw
  events are drawn under the compensated ones in a second colour. Own rule:
  spectral matrices get no overlay (a fluorochrome has no single primary
  detector in this app's model).

### CompCommand.PREVIEW_SAMPLE "Preview Sample", PREVIEW_POP_PATH "Preview Population"
- FlowJo (`MatrixEditorNavPanel$1`, `$2`, `MatrixEditorPerspective.makePreviewPanel`):
  the preview sample list is every workspace sample, sorted; choosing a
  sample keeps the current population path when that sample has it
  (`SampleNode.findDescendant`). The population list is the sample's
  population paths plus the ungated sample. Initial node: the node the editor
  was opened from, else the first sample of the current group, else of All
  Samples.
- flowjo-rea: Done (e2e "Preview Population limits the preview"). Initial
  preview: the current sample and selected population. A sample whose data
  is not loaded is disabled; a preview sample without the matrix detectors
  shows "Preview sample lacks: ..." (FlowJo `setParameterMismatch`).

### CompCommand.ZOOMIN "Zoom In", ZOOMOUT "Zoom Out", ZOOMFIT "Scale To Fit", ZOOM100 "Reset Scale"
- FlowJo: the plot area starts at 50% (`CELayout.setScale(0.5)` in the
  `MatrixNxNPanel` constructor). `EditorZoom` steps through 12, 25, 33, 50,
  66, 75, 100, 150, 200, 400%: Zoom In = next larger step from the closest
  step, Zoom Out = next smaller, Reset Scale = 100%. Scale To Fit in the
  Matrix Editor (`MatrixNxNPanel.scaleToFit`) = editor width / (260 x visible
  channels), not snapped to a step (the wizard's `CompSetScaleAction` fits the
  content height instead).
- flowjo-rea: Done (`zoomIn`/`zoomOut`/`fitZoom` unit tests; e2e "zoom").
  Plots are 256 px at 100%.

## 2. Matrix management

### CompCommand.IDENTITY_MATRIX "New Identity Matrix"
- FlowJo (`MatrixAction.createIdentityMatrix`,
  `MatrixController.createIdentityMatrix`): a parameter selection dialog over
  the workspace's collected uncompensated parameters; the new matrix has 1 on
  the diagonal, name `uniqueName("New Matrix")`, a unique colour, and is
  displayed.
- flowjo-rea: Done (unit "identity and duplicate matrices"; e2e "New Identity
  Matrix"). The picker lists the current sample's parameters with the
  fluorescence ones preselected (own rule: FlowJo's initial selection was not
  read).

### CompCommand.DUPMATRIX "Duplicate Matrix", NEWMATRIX, REMOVEMATRIX
- FlowJo (`MatrixController.duplicate`, `NameUtil.getCopyName`,
  `NameUtil.uniqueName`): each selected matrix is copied as an editable
  matrix named name + "-copy" (not added again when the name already ends
  with it), then made unique: a taken name loses a trailing "-<1 or 2
  digits>" and gets "-1", "-2", ... Remove Matrix deletes the selected
  matrices.
- flowjo-rea: Done (unit "copyName", "uniqueName"; e2e "Duplicate Matrix").
  The SSM is copied with the matrix. Delete matrix existed already.

### CompCommand.RESET "Reset"
- FlowJo 10.6.2: `MatrixAction.resetMatrix` and the wizard path are empty
  (no-ops) although the tooltip says "Remove any edits made here and replace
  them with the values from the acquisition-defined matrix".
- flowjo-rea: Own rule (e2e "Reset restores the saved values"). Reset
  discards this dialog's unsaved edits to the selected matrix, restoring the
  last saved version; disabled when nothing changed or the matrix was never
  saved. Chosen because a no-op button is useless and the tooltip's intent
  maps onto "undo my edits".

### CompCommand.COMPARE "Compare"
- FlowJo 10.6.2: `MatrixAction.compareMatrix` is empty; comparison happens by
  selecting several matrices in the list (`MatrixController.getDisplayMatrix`,
  `ComparisonMatrix`, `ComparisonMatrix$Method`): 2 matrices show
  "Difference" = second - first, 3 or more show the population "Standard
  Deviation" (`MathUtil.stddev`, divides by n); values rounded to 8 decimals;
  channels from the first matrix, matched by name; errors "This comparison
  requires at least %d matrices" and "%d channels from the first matrix are
  not present in the others". Status "Displaying %s of %d matrices". The
  result cannot be applied to data.
- flowjo-rea: Done (unit "compare matrices"; e2e "Compare 2 / 3 matrices").
  Compare check boxes per matrix; the read-only result replaces the matrix
  table while 2 or more are checked.

### CompCommand.SHOWALLPARAMS "Show All" (and per-parameter visibility)
- FlowJo (`MatrixEntryPanel`, `MatrixController.setChannelVisible`,
  `isChannelVisible`, `setShowAllChannels`): each parameter row has a check
  box; unchecked parameters are hidden from the matrix and the plots unless
  Show All is checked (default unchecked, nothing hidden). A label shows
  "(%d hidden)" (`ws.comp.params.numhidden`).
- flowjo-rea: Done (e2e "hiding a parameter", "Show All"). Own layout: the
  check boxes sit in a row above the matrix rather than inside its rows.

### CompCommand.APPLYWORKSPACE "Apply To Workspace", APPLYGROUP
- FlowJo: "Set all samples in the experiment to refer to this matrix"
  (`CompensationAction` -> `CompController.applyMatrix`). The Matrix Editor's
  Apply To Group is a popup of all groups (`MatrixEditorPerspective$1`,
  `Group.applyMatrix`). (`MatrixAction` builds an APPLYWORKSPACE action but
  does not handle it.)
- flowjo-rea: Done (e2e "Apply To Workspace", "Apply To Group"). Buttons
  Apply To Workspace (every sample) and Apply To Group with a group select;
  the earlier "Save and apply to sample / group" buttons remain. Unsaved
  matrices are saved first.

### CompCommand.APPLYDRAG "Matrix Icon"
- FlowJo (`MatrixEditorPerspective.enableDragButton`, `LDragSourceListener`,
  `MatrixTransfer`): a flat button that is a drag source; dropping it on
  samples or groups applies the matrix ("Drop this on samples or groups to
  apply this matrix.").
- flowjo-rea: Done (e2e "dropping the Matrix Icon on a sample"). The
  draggable "Matrix Icon" saves the dialog's matrices, then lets the drop
  pass under the dialog to sample, population or group nodes, which set the
  compensation of that sample or of every sample of the group.

### CompCommand.ADDTOLAYOUT "Copy To New Layout"
- FlowJo (`AddToLayoutAction.createFigsInLayout`): from the wizard, a new
  Layout Editor layout named from the compensation prefix and current group,
  filled with the wizard's control validation figures
  (`CompController.makeCompValidationFigs`).
- flowjo-rea: Deferred. The app has one layout (no "new layout"), layout
  plots cannot carry a matrix override, and the layout module is owned by
  another change; the plots would not show the matrix being edited.

### CompCommand.REMOVE, REMOVEUNUSED, REMOVEUNEG, PARAMETERS "Parameter"
- FlowJo 10.6.2: the CompCommand constants REMOVE, REMOVEUNUSED and
  REMOVEUNEG are used by no class. The visible features are in the wizard's
  row sample menu (`AssignmentRow.popupSamples` / `handleSamplePopup`),
  built from dictionary keys: "<Remove This Parameter>"
  (`ParameterEntryList.removeParameter`), "<Remove Unused Parameters>"
  (`removeUnassignedEntries`, offered only when some parameter has no
  sample), "<Reset This Parameter>", "<Reset All>", "Choose Parameters"
  (`CompController.chooseParameters`). The "Parameter" header (PARAMETERS,
  `AssignmentPanel$ParamHeaderHandler`) pops up Choose Parameters and Reset
  All. REMOVEUNEG has no label at all.
- flowjo-rea: Done for the visible features (e2e "Remove This Parameter",
  "Remove Unused Parameters"): the FlowJo wizard has a "Parameter (k of n)"
  section with a check box per parameter (Choose Parameters), Remove Unused
  Parameters, Reset All, and a Remove button per assigned control row that
  drops its parameter and clears the row. Only checked parameters are offered
  and calculated. REMOVEUNEG: Not in 10.6.2 UI.

## 3. SSM and preferences

### CompCommand.SSM "SSM", SSM_VIEW "Display SSM", SSM_CLOSE, SSM_SAVE "Export SSM"
- FlowJo (`MatrixAction` SSM popup; `MatrixController.viewSSMMatrix`,
  `closeSSMMatrix`, `saveSSMMatrix`; `MatrixEditorPerspective.adjust`): the
  SSM button is enabled when the displayed matrix has an SSM (one made by the
  wizard; the SSM is saved with the matrix, `CompensationMatrix.getElement`).
  Display SSM shows it in the matrix grid with a Sum row (column sums) and a
  Sum column (row sums) (`MatrixEntryPanel.sumSSM`), status "Displaying SSM
  of matrix '%s'"; the check item switches back; Export SSM writes
  "SSM_<name>.csv". A matrix without SSM gives "SSM matrix does not exist.".
- flowjo-rea: Done (unit "SSM Sum row and column"; e2e "SSM view", "a saved
  wizard matrix still offers Display SSM after reopening"). The FlowJo wizard
  stores its SSM on the new matrix (`SpilloverMatrix.ssm`, saved in the
  workspace); Display SSM / Display Matrix toggle and Export SSM work for any
  saved matrix that has one and are disabled (with the FlowJo tooltip)
  otherwise.

### CompCommand.PREFS "Preferences..."
- FlowJo: in the wizard opens the workspace preferences
  (`FJPrefsAction.doPrefs`); in the Matrix Editor it does nothing. The
  Compensation preference pane (`PrefsCompensation.getMatrixEditorPanel`,
  `FJPrefsFJML$Compensation`) has, under Matrix Editor: Overlay Uncompensated
  (`ceOverlay`, default on), Show Status (`ceShowStatus`, on), Confirm Edit
  (`meConfirmEdits`, on), Use Percent for spillover (`usePercent`, on); plus
  compensation group keyword rules (`keyVals`, default
  `$FIL^^comp^^$FIL^^unstained`).
- flowjo-rea: Done for Overlay, Show Status, Use Percent (e2e "Use Percent
  for spillover off shows fractions", "matrix cells show percent by
  default"); a Preferences... button in the editor toggles them, stored per
  browser (`flowjo-rea.compPrefs`). With Use Percent, cells show and accept
  percent (`MatrixEntryPanel` multiplies by 100). Own rule: Confirm Edit is
  omitted because it only guards editing an uneditable acquisition matrix
  (`MatrixAction.askOKtoEdit`), and this app never edits one in place ("New
  matrix from file keyword" makes the copy explicitly). Group keyword rules:
  out of this area (group criteria exist elsewhere).

## 4. Spectral weights, optimisation, animation

### S_WEIGHTS_IMPORT "Import Weights", S_WEIGHTS_EXPORT "Export Weights", S_WEIGHTS_CLOSE "Close", S_WEIGHTS_OK "OK"
- FlowJo (`CompPerspective$3` "Weights" button: "Preview, import or export
  weights for the weighted least square unmixing algorithm used for spectral
  compensation"; `SpectralWeightsDialog`): a "Weights Preview" table with
  columns S#, Detectors, Weights, not editable. Export writes "Detector
  Name,Weights" then "name,weight" lines with CRLF to `detectorweights.csv`.
  Import reads a row-based file (name,weight lines) or a column-based one
  (names line, weights line); errors "Data Format is not Valid" and "Detector
  Names Don't match the detector names of the sample(s) in the Workspace...".
  Close (button or window close) stores the weights on the workspace and
  marks the matrix for recalculation. S_WEIGHTS_OK is never used (no OK
  button in 10.6.2).
- flowjo-rea: Done (unit "spectral weights"; e2e "Export Weights", "Import
  Weights ... weighted least squares", "a weights file with other detectors
  is refused"). For a spectral matrix a Weights button opens the panel; Close
  stores the weights on the matrix (`SpilloverMatrix.weights`) and unmixing
  becomes weighted least squares, M = W S^T (S W S^T)^-1. Own rule: default
  weights are 1 (ordinary least squares); FlowJo's defaults come from its
  native engine and were not decoded. S_WEIGHTS_OK: Not in 10.6.2 UI.

### CompCommand.OPTIMIZEWT "Optimize Weights"
- FlowJo (`CompensationAction` OPTIMIZEWT, `OptimizeWeightDialog`,
  `WeightIOptimizationAttributeModel`, `WeightOptimizationThread`): a dialog
  chooses NoOptimization, SSM-based or event-based optimisation (event-based
  only when enabled in preferences); the request goes to the native engine,
  up to 50 iterations ("typically converges in about 10-15 iterations").
- flowjo-rea: Deferred. The optimisation runs in libNativeEngine, its
  objective and update rule were not decoded and there are no reference
  outputs to check against.

### CompCommand.MAKEMOVIE "Animate"
- FlowJo (`MatrixAction.makeWebMovie`, `CompAnimationBatch(controller, 15,
  0.001, 4.0)`): renders the plot grid for spillover scale factors starting
  at 0.1%, multiplied by log10((1/0.001)/15) per frame while below 1 (at most
  15 frames), then 1, 2 and 4 (frames past 100% outlined in blue), each
  labelled "Scale: x%", and writes an HTML movie file. The scale multiplies
  every coefficient sent to the engine (`CompensationChannel.getElement`).
- flowjo-rea: Own rule (unit "animation scales"; e2e "Animate steps the
  preview from Scale: 0.1%"). Animate plays the same scale sequence in the
  preview grid (350 ms per frame, label "Scale: x%") and ends at 100%; no
  file. The scale multiplies the off-diagonal spillover only (uncertain: it
  is not known whether FlowJo's engine renormalises the diagonal; scaling the
  diagonal too would only rescale the data).

### CompCommand.SHOWHTML, CALCULATE, CALCSSM, LOAD_FILE, SAVE*, EDIT, ADDTOGROUP, ADDFCS2, ADDFCS3
Not in the gap list. LOAD_FILE / SAVE_FJFORMAT / SAVE_CSVFORMAT, CALCULATE
and the SSM calculation existed before (specs section 14). ADDTOGROUP,
ADDFCS2, ADDFCS3: Not in 10.6.2 UI.

## Summary

| Command | Status |
|---|---|
| WSCommand.EDITMATRIX, PlatformNavCommand.MATRIXEDITOR | Done |
| NXN, ALLBY, HISTOS, SHOWOVERLAY (as Overlay Uncompensated) | Done |
| PREVIEW_SAMPLE, PREVIEW_POP_PATH | Done |
| ZOOMIN, ZOOMOUT, ZOOMFIT, ZOOM100 | Done |
| IDENTITY_MATRIX, DUPMATRIX, COMPARE, SHOWALLPARAMS | Done |
| APPLYWORKSPACE, APPLYDRAG | Done |
| REMOVE, REMOVEUNUSED, PARAMETERS (wizard row menu equivalents) | Done |
| SSM, SSM_VIEW | Done |
| PREFS | Done (Confirm Edit omitted, own rule) |
| S_WEIGHTS_IMPORT, S_WEIGHTS_EXPORT, S_WEIGHTS_CLOSE | Done (default weights: own rule) |
| RESET | Own rule (no-op in 10.6.2) |
| MAKEMOVIE | Own rule (in-place animation) |
| ADDTOLAYOUT | Deferred |
| OPTIMIZEWT | Deferred |
| REMOVEUNEG, S_WEIGHTS_OK | Not in 10.6.2 UI |
