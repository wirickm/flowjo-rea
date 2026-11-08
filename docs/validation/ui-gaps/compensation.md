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
`e2e/comp-gaps.mjs` (51 checks). Optimize Weights: `src/core/weightOptimizer.ts`
(rules), `src/ui/CompEditor.tsx` `OptimizeWeightsPanel`, `src/core/service.ts`
`weightOptStart` / `weightOptStep` and `eventOptStart` / `eventOptStep`
(worker), `tests/weight-optimizer.test.ts`; event-weighted unmixing in
`src/core/compensation.ts` (`eventLambdas`, `unmixEventWeighted`).

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
S_WEIGHTS_CLOSE / IMPORT / EXPORT; `OptimizeWeightDialog.createActions`
builds its Close button from S_WEIGHTS_CLOSE and its OK button from
S_WEIGHTS_OK.

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
- FlowJo detail (`AddToLayoutAction.getLayout`): the layout editor is
  shown, `LEditor.doNewTemplate` adds a layout, its iteration is turned off,
  the page-break layer is hidden and the layout is renamed "Comp-" plus the
  current group's name (`Compensation.getPrefix` + `Group.getName`), or
  "Compensation" without a current group. `makeCompValidationFigs` puts one
  `ParameterEntryFigGroup` per control row (parameter name, the control's
  scatter chart, the positive range-gate chart and the negative chart) 20 pt
  apart down the page.
- flowjo-rea: **Done with an own rule** for the contents. "Copy To New
  Layout" in the Matrix Editor's preview bar saves the matrices, adds a new
  layout named "Comp-<current group>" ("Compensation" without one; made
  unique in the list), iteration off, and opens the layout editor. It holds
  the preview grid (N x N, All by, or Histograms; at most 10 parameters,
  150 pt cells) of the preview sample and population, each chart compensated
  with the edited matrix (`LayoutPlot.compMatrix`). Own rule: flowjo-rea has
  no wizard control rows to copy, so the Matrix Editor's own validation view
  is copied; page breaks stay as set in the editor. Code:
  `compGridItems`, `compLayoutName`, `newLayoutWith`
  (src/core/layoutFigures.ts), button `comp-copy-layout`
  (src/ui/Dialogs.tsx). Tests: unit "a new layout named Comp-<group>,
  iteration off, holding the preview grid" (tests/followup-layout.test.ts);
  e2e followup-layout "Copy To New Layout opens a new layout", "the new
  layout holds the preview grid", "the copied charts render".

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
  marks the matrix for recalculation. The weights dialog has no OK button;
  S_WEIGHTS_OK ("OK", `plat.comp.io.spectralweights.ok`) is the OK button of
  `OptimizeWeightDialog` ("Weight Optimization Selection", see OPTIMIZEWT):
  `OptimizeWeightDialog.createActions` makes `OptimizeWeightDialog$2` from
  it, whose `doAction` calls `runOptimization`; Close
  (`OptimizeWeightDialog$1`, S_WEIGHTS_CLOSE) and the window close
  (`OptimizeWeightDialog$3.windowClosing`) call `closeDialog`.
- flowjo-rea: Done (unit "spectral weights"; e2e "Export Weights", "Import
  Weights ... weighted least squares", "a weights file with other detectors
  is refused"). For a spectral matrix a Weights button opens the panel; Close
  stores the weights on the matrix (`SpilloverMatrix.weights`) and unmixing
  becomes weighted least squares, M = W S^T (S W S^T)^-1. Default weights:
  Done (matches). In libNativeEngine 3.6.2 `CompensationSpec::FromXML`
  creates one weight per detector set to 1.0 and overrides only the detectors
  named in the matrix's `weights` element (attribute `weight`, default 1.0),
  and `EigenSolver` (built by `Compensator::PreCompensate` for a spectral
  matrix) solves (S W S^T) M = S W with a column-pivoting Householder QR, so
  with no stored weights FlowJo unmixes by ordinary least squares, as this
  app does. S_WEIGHTS_OK: Done (e2e "with the preference on, Optimize opens
  "Weight Optimization Selection" ...", "Close in the method dialog runs
  nothing", "OK with Lambda 2.5 stores it ...", "OK with Lambda 0 runs the
  event-based optimisation ..."; rules in OPTIMIZEWT below).

### CompCommand.OPTIMIZEWT "Optimize Weights"
Evidence: Java `CompensationAction` (OPTIMIZEWT branch,
`runSSMBasedOptimization`, `isEventOptimizationEnabledInPrefs`),
`CompPerspective.shouldOptimize`, `OptimizeWeightDialog` (+ `$1`..`$4`),
`WeightIOptimizationAttributeModel`, `CompController.calculateOptimizedWeightAndApply`
/ `createWeightOptRequests`, `WeightOptimizationThread.setOptimizedWeights`;
native libNativeEngine 3.6.2 `WeightOptimizer::ProcessQuery`,
`OptimizeWeights(double)`, `CalculateSSM`, `CalculateSSMCoefficient`,
`EvaluateSSM`, `SetCurrentBestWeights`, `setProgress`, constants
`MAX_ITERATIONS` = 50, `TOTALSTEPSCOUNT` = 100 (decompiled with headless
Ghidra outside the repo).

Java side (what the user sees):
- Before anything, `shouldOptimize`: when any stored detector weight lies
  strictly between 0 and 1 ("customized weights") FlowJo asks "Optimizing
  weights take some time to finish. You already have customized weights for
  this workspace. Do you want to overwrite them?". Anything but Yes aborts;
  Yes clears the stored weights first. Weights of 1 or above do not count.
- The request type defaults to SSMBasedOptimizationProcessing and no dialog
  is shown. `isEventOptimizationEnabledInPrefs` is true only when the
  application preferences have a `WeightOptimization` child whose `type` is
  EventBasedOptimizationProcessing and whose `show` is true. No preferences
  panel writes that element (no FlowJo 10.6.2 class besides
  `CompensationAction` reads it; a hidden preference, off by default). The
  preference is read on every OPTIMIZEWT, and each time a new
  `OptimizeWeightDialog` opens.
- `OptimizeWeightDialog` (title "Weight Optimization Selection", modal,
  `initWizard`): a method combo (`OptimizeWeightDialog$4`, choices "Sample
  Based Weight Optimization" and "Event Based Weight Optimization", current
  value from the model's request type, so Sample Based first). Choosing Event
  Based adds the centre row: label "Lambda", a `RangedDoubleTextField`
  (min 0, max 3.4028234663852886E38 = Float.MAX_VALUE, shown value 0) and the
  bold note "<Lambda = 0 means use variance based lambda.>"; choosing Sample
  Based removes it. Buttons OK (S_WEIGHTS_OK) and Close (S_WEIGHTS_CLOSE).
- Lambda field validation (`DoubleTextFieldDocument`, `RangedDoubleVerifier`):
  only digits, the decimal separator, the minus sign and the exponent
  separator can be typed. When the field loses focus, text that is not a
  number or lies outside 0..Float.MAX_VALUE is replaced by the last good
  value and focus stays in the field (the error label is not shown in this
  dialog), so the click that left the field does nothing.
- Close or the window close (`closeDialog`): request type NoOptimization,
  nothing runs (the overwrite answer has already cleared the weights).
- OK (`runOptimization`): Sample Based: useLambda and useEngineBaseLambda off;
  `CompensationAction` then runs the SSM-based optimisation, which first
  removes any event-based model from the workspace and the matrix
  (`runSSMBasedOptimization`). Event Based: the field value is cast to float;
  useLambda on, useEngineBaseLambda = (lambda == 0), lambda stored. The model
  goes onto the workspace and the wizard matrix
  (`setWeightOptimizationModel`), and the engine runs only when
  useEngineBaseLambda is on (lambda 0), with an empty progress note. Any
  other lambda is kept on the matrix without a run.
- The model (`WeightIOptimizationAttributeModel`; constructor defaults: type
  null, useLambda off, useEngineBaseLambda on, lambda 0.001, which the dialog
  always overrides) is written on the matrix element
  (`CompensationMatrix.getElement` via `getAttributeMap`) as attributes
  `type`, `engineBasedLambda` ("1"/"0", only with useLambda) and `lambda`
  (only when engineBasedLambda is off), plus a `lambdas` child with one
  `lambda` element (`name`, `value`) per variable lambda;
  `CompensationMatrix` reads it back the same way.
- Event-based result (`WeightOptimizationThread.setOptimizedWeights`, no
  `weights` child): lambda = the result's `lambda` attribute (absent, so 0,
  `SElement.getDouble`), useEngineBaseLambda off, useLambda on, the SSM
  stored (`setSSM`) and the returned `lambdas` kept as variable lambdas. The
  detector weights are not changed.
- The SSM-based request (`createWeightOptRequests`) sends the wizard's
  compensation matrix and one CompControl per parameter entry with its
  positive and negative population (gate queries), and runs on a progress
  thread with the note "The progress bar is based on the maximum of 50
  iterations, however, the weight optimization typically converges in about
  10-15 iterations."
- The result (`setOptimizedWeights`) stores the returned detector weights on
  the workspace and the wizard matrix (`setWeightsElement`), and the returned
  SSM on the matrix (`setSSM`), so Display SSM shows it.

Engine (SSM-based processing):
- Unmixing is weighted least squares with the trial weights (see the default
  weights rule above). The objective is the sum of all entries of the SSM of
  the controls: for control j and fluorochrome i, with percentiles 50 and 84
  of the unmixed populations (positive P, negative N),
  SSM = sqrt((P84_P,i - P50_P,i)^2 - (P84_N,i - P50_N,i)^2) /
  sqrt(|P50_P,j - P50_N,j|), only when P50_P,j - P50_N,j > 0, else 0; NaN
  (negative radicand) is 0; the diagonal is 0. Statistics are the engine's
  population percentiles of the unmixed parameter (4096-channel histogram
  on the parameter's scale).
- Progress messages: 0.5% "Compensating.", 1% "Compensation Completed.", 1%
  "Calculating SSM.", 2% "Evaluating SSM ", then before each detector
  "Iteration N : Optimizing detector K, current best SSM sum is X. " at 3%
  plus 1.94% / (number of detectors) per detector visited, and "Done." at
  100% (progress is clamped to 0..1). Cancel ends the search.
- Search (`OptimizeWeights`): all weights start at 1.0 and the best sum is
  the initial SSM sum (float32). A factor pair (f, 1/f) starts at f = 0.6667.
  A sweep visits every detector in order: with the other weights fixed it
  evaluates f x w_d and (1/f) x w_d (both from the current w_d) and keeps the
  trial whose sum (cast to float32) is lower than the best so far, updating
  the best; the kept weight is used for the following detectors. After a
  sweep: if best >= 0.99 x (best at the start of the sweep), and the 0-based
  sweep index is 5 or more, the stall count rises; the third stall stops the
  search, the first switches the factor to 0.3333 and the damping from 0.9 to
  0.5 (permanently). A sweep improving by 1% or more resets the stall count.
  The search also stops after sweep index 50 (so at most 52 sweeps; the
  progress bar is full near sweep 50). Then f becomes (f - 1) x damping + 1
  (float32) and 1/f is recomputed. Weights are unbounded positive numbers
  (multiplicative updates).
Engine (event-based processing; `WeightOptimizationRequestTypes::
LookupProcessingType`: OnlySSMProcessing 0, SSMBasedOptimizationProcessing
1, EventBasedOptimizationProcessing 2; `WeightOptimizationRequest::FromXML`
keeps one (positive, negative) population pair per CompControl;
`ProcessQuery` calls `RunVariableLambdaProcessing` for type 2 when the
matrix has engineBasedLambda):
- Progress: 0.5% "Compensating.", then at 100% "Current best SSM sum is X. "
  with X the SSM sum written as a C++ float (6 significant digits).
- Variance based lambdas: for each detector of the matrix, lambda_d = mean
  over the controls of SD^2, SD being the engine's SD statistic (type 7,
  `Statistic::LookupStatType("SD")`; the histogram SD of specs 8.2) of the
  raw detector in the control's negative population. A universal negative
  counts once per control.
- The controls are then unmixed with event weighting using these lambdas
  (the request matrix copied with type EventBasedOptimizationProcessing and
  the lambdas list) and the SSM is computed as for the SSM-based method; the
  result carries the lambdas (detector name, value), the SSM, and lambda
  0.001 internally, which `WeightOptimizationResult::ToXML` does not write
  when there are lambdas.
- Event-weighted unmixing (`Compensator::PreCompensate` builds a solver with
  the matrix and the spec lambda instead of the static weights;
  `Compensator::Compensate`; `EigenSolver::Solve` with weights): for every
  event, w_d = 1 / (x_d + lambda_d) with x_d the raw detector value, then
  weighted least squares (S W S^T) f = S W x. lambda_d is entry d of the
  lambdas list (by position) when the matrix's engineBasedLambda is set and
  the list is not empty, otherwise the matrix lambda for every detector;
  `CompensationSpec::FromXML` reads a lambda of 0.001 or less as 0.001.
  Static detector weights are not used. Values where x_d + lambda_d is 0 or
  negative are not guarded (infinite or negative weights).
- Consequence in 10.6.2: after an event-based run the Java side writes
  engineBasedLambda 0 and lambda 0, so the matrix unmixes with lambda 0.001
  for every detector and the variance based lambdas are stored but not used.

flowjo-rea: Done (unit `tests/weight-optimizer.test.ts`: stall rule, factor
pairs and damping, 52-sweep limit, progress, SSM formula on unmixed
populations, synthetic optimisation and determinism; e2e "customized weights
(0.5) ask before overwriting", "Optimize Weights finishes with Done. and
stores new weights", "progress messages", "stores the SSM", "deterministic").
For a spectral matrix the editor shows Optimize Weights; its panel asks for
the positive and negative population of each fluorochrome's control (any
loaded sample, so a universal negative works), asks the overwrite question
inline when weights are customized, and runs the search in the analysis
worker in short slices with a progress bar, the engine's messages and the
progress note. The result sets the matrix weights (unmixing becomes weighted
least squares) and its SSM (Display SSM). Own rules and uncertainty:
- The engine returns the SSM of its last evaluated trial; flowjo-rea stores
  the SSM at the final (best) weights, which is what the weights produce
  (uncertain whether FlowJo recalculates it before display).
- Cancel discards the run (the matrix keeps its weights); the engine on
  cancel returns its current trial vector, and it is not known whether the
  Java side applies it.
- Population membership is taken once from the current analysis; the engine
  recompensates the control samples for each trial, which only matters for
  gates drawn on unmixed parameters.
- An unmixed fluorochrome without a display transform uses the default
  logicle scale (T 262144, W 0.5, M 4.5) for its percentiles.
- Event-based optimisation and its dialog: Done (unit
  `tests/weight-optimizer.test.ts` "event-weighted unmixing", "method
  dialog", "variance based lambdas and the event-based run"; e2e
  `e2e/comp-gaps.mjs` checks from "with the preference on, Optimize opens
  ..." to "Sample Based from the dialog runs the SSM search and removes the
  event weighting", and "Preferences offer Event Based Weight Optimization
  ..."). Preferences has "Offer Event Based Weight Optimization" (off by
  default; Own rule: FlowJo has no UI for its hidden prefs-file element, so
  this app shows a checkbox; it is kept in this browser like the other
  preferences). With it on, Optimize (after the overwrite question) shows the
  "Weight Optimization Selection" panel with the method combo, the Lambda
  field and OK / Close as above. The event-based run happens in the analysis
  worker in slices (lambdas, one control population per slice, then the SSM)
  with the engine's two progress messages. The model is stored on the matrix
  (`SpilloverMatrix.weightOptimization`) and every unmixing of that matrix
  (analysis and the editor preview) uses event weighting; the editor
  describes it ("per-event weighted least squares, weights 1 / (value +
  lambda) with lambda ..."). Own rules and uncertainty:
  - The per-event system is solved by Gaussian elimination with partial
    pivoting (FlowJo: QR on the same normal equations); a singular system
    gives NaN for that event.
  - A detector without a FlowJo scale uses the exact sample SD for its
    lambda.
  - The model is kept in this app's workspace (not written to .wsp, like the
    detector weights).
  - A lambdas list shorter than the detector list makes the engine read past
    its end (undefined); this app uses the matrix lambda for the missing
    entries.

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
| S_WEIGHTS_IMPORT, S_WEIGHTS_EXPORT, S_WEIGHTS_CLOSE | Done (default weights 1: matches) |
| S_WEIGHTS_OK | Done (OK of the Weight Optimization Selection dialog) |
| RESET | Own rule (no-op in 10.6.2) |
| MAKEMOVIE | Own rule (in-place animation) |
| ADDTOLAYOUT | Done (own rule: copies the preview grid) |
| OPTIMIZEWT | Done (SSM-based and event-based with the method dialog; preference checkbox own rule) |
| REMOVEUNEG | Not in 10.6.2 UI |
