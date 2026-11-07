<!-- Behavioral description of FlowJo 10.6.2 written for the clean-room
reimplementation; no FlowJo code, disassembly or decompiled text. Implemented
subset and own rules: flowjo-engine-specs.md section 19. The accelerator
table's App column is current; the "App:" notes inside numbered rules were
written before the batch, and sections 19 and 20 supersede them. -->

# FlowJo 10.6.2 interaction model (keyboard, dispatch, undo, clipboard)

Scope: behavioral rules for the flowjo-rea clean-room reimplementation. Source:
static reading of `FlowJo-10.6.2.jar` and `fjlib-2.3.0.jar` (same installer)
with `javap -p -c -constants`, plus the resource bundles
`com/treestar/flowjo/core/flowjodictionary*.properties`. FlowJo was not run, so
every rule is "static, unconfirmed at runtime". Citations name the class and
method (or bundle key) that shows the behavior. No FlowJo code or disassembly
is reproduced; all text is my own description.

"Menu key" = the platform menu-shortcut modifier (Cmd on macOS, Ctrl on
Windows/Linux). Confidence: high = read directly from control flow; medium =
inferred from names, call sites or partial flow; low = guess.

App status refers to the flowjo-rea tree after the 2026-11-07 interaction batch (specs 19 lists what it implemented): `src/ui/App.tsx`
(`onKey`, around line 138), `src/ui/Plot.tsx` (`onKeyDown`, around line 474),
`src/ui/history.ts`, `src/core/project.ts` (`copyPopulations`,
`pastePopulations`), `src/ui/GateActions.tsx`.

Already decoded elsewhere and only referenced here: specs 6.7 (Escape only in
the rename dialog, undo restore notes), 10.1 (gate tool letters S E F A P I R Q
X C, manual gate menu key + G), 10.7 (WSClipboard copy/paste content rules),
16.4 (implemented shortcuts), 18 (navigation, gating path), and
comparison-2026-11.md section 5 (C16 keyboard, C17 Escape, C21 drop).

## Corrections to existing specs found on the way

- Specs 18.5 / comparison C4 say Next Sample is PageUp and Previous Sample is
  PageDown. As accelerators those two values carry the menu key (rule K1), so
  the menu shortcuts are Menu+PageUp = Next Sample, Menu+PageDown = Previous
  Sample. The plain keys in the graph go the other way: plain PageDown = next
  sample, plain PageUp = previous sample (rule K9). The app's plain PageUp =
  next is therefore reversed relative to FlowJo's plain keys.
- Comparison C16 says "Cmd+G group". That is the workspace window
  (`ws.newgroup` = Create Group...). In the graph window Menu+G is Manually
  Enter Gate. The app maps Ctrl/Cmd+G to the manual gate only.
- Comparison section 5 says the modifier rule was "inferred, medium". It is now
  read from code (K1, high).

## 1. Keyboard shortcuts

### 1.1 Rules

1. **K1 Modifier rule.** An action's shortcut is read from `<command key>.accelerator`
   after trimming whitespace. If the value parses as an integer it is a Java
   virtual-key code and the shortcut is Menu + that key. If it is a single
   upper-case letter the shortcut is Menu + Shift + that letter. A single
   lower-case letter means Menu + that letter. Any other single character
   (`,`, `=`) is used as the key code of that character, with Menu. An empty or
   longer non-numeric value gives no shortcut. There is a variant without the
   menu key, but nothing calls it, so every bundle shortcut includes the menu
   key. No shortcut is set in headless mode.
   Citation: fjlib `FJAction.lookupAccelerator(String, boolean)`,
   `FJAction.getMask`, `FJAction.shiftmask`, `FJAction.loadActionProps`.
   Confidence: high. App: match for the few keys implemented (Ctrl or Cmd
   accepted, Shift only on redo).
2. **K2 Numbers are key codes, not characters.** So `33`/`34` are
   PageUp/PageDown, `127` Delete, `10` Enter, `59` `;`, `44` `,`, `46` `.`,
   `45` `-`, `61` `=`, `91` `[`, `92` `\`, `93` `]`, and `48`-`57` the digits.
   Three values do not do what they appear to intend: `gw.graph.prevy = 121`
   is F10 (Previous Y is Menu+F10, not Menu+Y); `ws.find.next = 2` parses as
   code 2, which no key produces (Find Next has no working shortcut);
   `le.nav.zoomin = 43` is not a key code either.
   Citation: `FJAction.lookupAccelerator` with the bundle values. Confidence:
   high (the F10 one is almost certainly a FlowJo bug; do not copy it).
   App: n/a.
3. **K3 Duplicate bundle key.** `te.batch.flowjo.accelerator` appears twice
   (68 then 53); the later one wins (Menu+5). Citation: bundle
   `flowjodictionary.properties`, standard properties loading. Confidence:
   high. App: n/a.
4. **K4 Ribbon windows: who receives the key.** Workspace, layout editor, table
   editor and plate editor are ribbon frames. Each registers its actions'
   shortcuts in a per-frame map and installs a global key dispatcher that acts
   only while that frame is the focused window. Citation: fjlib
   `FJRibbonFrame.addAcceleratorToFrame`, `FJRibbonFrame$1.dispatchKeyEvent`,
   `FJRibbonActionManager.loadAccelerators`. Confidence: high. App: single
   page, one global handler (own rule).
5. **K5 Ribbon shortcuts fire on key release, with a debounce.** The key press
   is swallowed; the command runs on release, only if the action is active,
   and only if at least `Diagnostics/actionDelay` ms (default 2000) have passed
   since that same shortcut last fired (also measured from when it was
   registered). A repeat within 2 s is ignored. If the shortcut is tied to a
   ribbon button, the button is clicked; otherwise the action runs directly.
   Citation: fjlib `ActionAcceleratorListener.dispatchKeyEvent`,
   `PrefsFJML$Diagnostics.delay`. Confidence: high (code), medium (felt
   effect). App: fires on keydown, no debounce. Differs, but low impact;
   recommend not copying the 2 s debounce (own rule).
6. **K6 Conflicts in one window: first registered wins.** When two actions in
   one ribbon frame share a keystroke, the second is not registered and a
   conflict line is printed. Registration walks the action map in hash order,
   so the winner is effectively arbitrary. Known same-window clashes:
   workspace Menu+Shift+V (Paste keyword to group / Check Sample Quality);
   layout editor Menu+C (Copy / Copy Selection With Transparency), Menu+O
   (Spread vertically / Open Original Graph), Menu+- (Delete report / zoom
   out, if wired). Citation: fjlib `FJRibbonFrame.addAcceleratorToFrame`.
   Confidence: high (mechanism), low (which one wins). App: n/a; pick one.
7. **K7 Menu windows.** The graph window (and kinetics, comparison, platform
   windows) use a Swing menu bar built from action arrays, so shortcuts come
   from the same bundle values but fire through normal Swing menu handling
   (on press, no debounce). Citation: `GraphWinMenuBar`, fjlib
   `FJMenuBar.makeItem`, `GWActionManager.getFileActions/getEditActions/
   getGraphActions/getGoActions/getDisplayActions`. Confidence: medium.
   App: n/a.
8. **K8 Shared edit keys.** Cut, Copy, Paste and Select All in every window
   take the layout-editor keys `le.action.cut/copy/paste/selectall` (Menu+X,
   C, V, A); Undo, Redo, Clear, Save, Save As, New, Open, Print, Close, Quit
   come from `fj.action.*`. Citation: fjlib `FJCommand` (enum constants),
   `FJActionManager.createActions`. Confidence: high. App: Undo/Redo/Save
   match; Cut/Copy/Paste/Clear keys missing (Copy/Paste exist only as
   buttons).
9. **K9 Graph window plain keys (no modifier).** While the graph window is
   focused:
   - Tool letters as in specs 10.1 (bound on the plot component only).
   - Arrow keys nudge the selected gate(s) by 1 step; Alt doubles, Ctrl
     doubles, Shift triples, and they multiply (all three = 12). Nothing
     happens with no gate selected; if gate editing is locked by preferences
     an authorization message is shown instead.
   - Delete or Backspace deletes the selected gate(s).
   - Escape cancels the current drawing mode (aborts a polygon in progress).
   - Space shows the next sample; Shift, Ctrl or Alt + Space the previous one
     (not in the derived-parameter window).
   - PageDown shows the next sample, PageUp the previous one.
   - While a polygon is being drawn: Delete/Backspace removes the last vertex,
     Escape aborts, Space closes the polygon (and does not change sample).
   Citation: `GWFrame$GWKeyDispatcher.dispatchKeyEvent`,
   `EditorKeys.keyPressed`, `EditorKeys.nudge`, `EditorKeys.initKeys`,
   `EditorController.doSpaceBar`, `EditorController.doPageUpDown`,
   `GraphEditor.doEscapeAction`, `PolygonDrag.doEscapeAction`.
   Confidence: high. App: tool letters match; Escape clears a polygon draft
   (match); PageUp = next / PageDown = previous (differs: reversed); Space
   navigation, arrow nudge, Delete/Backspace gate delete, polygon
   Backspace/Space missing (app closes a polygon by double-click).
10. **K10 Workspace tree plain keys.** F1 opens help; Delete or Backspace
    deletes the selection in the focused tree (sample tree or group tree; the
    normal delete confirmations apply). Citation: `KTreeTable.keyPressed`,
    `WSViewMgr` (F1 bound on the root pane), `STreeMgr.deleteSelection`.
    Confidence: high. App: missing (delete is a button).
11. **K11 Layout editor plain keys.** Menu+Escape aborts a polygon, Menu+Space
    completes it, Escape toggles chart editing, arrows nudge as in K9.
    Citation: `EditorKeys.initKeys` (non-graph branch). Confidence: medium.
    App: missing (layout is a list, not a canvas; own rule).
12. **K12 Dead keys.** These bundle keys have no class that references their
    command, so they do nothing: `string.undo` (value `ctrl Z` does not parse
    anyway), `gw.save`, `gw.export.figure`, `le.nav.fitinwindow`,
    `le.nav.showat100`, `le.nav.zoomin`, `le.nav.zoomout`, `te.edit.clear`,
    `plat.3d.voxel`, `plat.panel`, `plat.cc.calculate/home/prefs`,
    `test.test.*`. `ws.group.createfromselection` is empty. Citation: string
    search over all classes of both jars. Confidence: medium (a command could
    be built by concatenation). App: n/a.
13. **K13 OS-reserved combinations.** Several FlowJo shortcuts collide with
    macOS or browser keys: Menu+, (Create Combination Gates; macOS
    Preferences), Menu+Shift+Q (Q&B; macOS log out), Menu+Q/W/N/T/L/R in a
    browser. Citation: bundle values via K1. Confidence: high (values), low
    (what FlowJo does on macOS). App: own rule already in comparison C16
    (browser-reserved keys stay unmapped).

### 1.2 Accelerator table

Keystroke column applies K1. Window: where the command lives. "Defined in"
is the command enum or class that references the key. App column: match /
differs / missing. 168 entries (bundle order; `plat.*` from
`flowjodictionary_plat.properties`).

| Key in bundle | Value | Keystroke | Command | Window | Defined in | App |
|---|---|---|---|---|---|---|
| `ws.anno.publish` | `83` | Menu+S | Publish... | experiment annotation dialog | MIFlowCytActionManager$MIFlowCytCommand | missing (window not modelled) |
| `ws.anno.share` | `85` | Menu+U | Share... | experiment annotation dialog | MIFlowCytActionManager$MIFlowCytCommand | missing (window not modelled) |
| `gw.export.figure` | `53` | Menu+5 | Save As Figure | graph window | GWCommand (GWActionManager, menu items) | missing |
| `fj.action.clear` | `127` | Menu+Delete | Clear | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.close` | `w` | Menu+W | Close | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.new` | `78` | Menu+N | New Workspace | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.open` | `79` | Menu+O | Open... | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.print` | `80` | Menu+P | Print... | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.quit` | `81` | Menu+Q | Quit | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.redo` | `Z` | Menu+Shift+Z | Redo | every window (FJActionManager) | FJCommand / FJActionManager.createActions | match (Ctrl/Cmd+Shift+Z; app also Ctrl+Shift+Y, own) |
| `fj.action.save` | `83` | Menu+S | Save | every window (FJActionManager) | FJCommand / FJActionManager.createActions | match (Ctrl/Cmd+S) |
| `fj.action.saveas` | `S` | Menu+Shift+S | Save As... | every window (FJActionManager) | FJCommand / FJActionManager.createActions | missing |
| `fj.action.undo` | `90` | Menu+Z | Undo | every window (FJActionManager) | FJCommand / FJActionManager.createActions | match (Ctrl/Cmd+Z) |
| `fj.tableaction.close` | `87` | Menu+W | Close | generated table window | FJTableCommand (FJTableActionManager) | missing |
| `fj.tableaction.print` | `80` | Menu+P | Print... | generated table window | FJTableCommand (FJTableActionManager) | missing |
| `fj.tableactionmanager.add` | `76` | Menu+L | Add to Layout | generated table window | FJTableCommand (FJTableActionManager) | missing |
| `fj.tableactionmanager.copy` | `67` | Menu+C | Copy Table to Clipboard | generated table window | FJTableCommand (FJTableActionManager) | match as a button (Copy table: HTML + text) |
| `fj.tableactionmanager.delete` | `127` | Menu+Delete | Delete Selected Rows | generated table window | FJTableCommand (FJTableActionManager) | missing |
| `fj.tableactionmanager.find` | `70` | Menu+F | Find | generated table window | FJTableCommand (FJTableActionManager) | missing |
| `fj.tableactionmanager.group` | `71` | Menu+G | Create Group from Selection | generated table window | FJTableCommand (FJTableActionManager) | missing |
| `gw.add.statistic` | `66` | Menu+B | Add Statistic... | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.close.all` | `W` | Menu+Shift+W | Close All Graph Windows | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.close.this` | `87` | Menu+W | Close Window | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.copy.histogram` | `70` | Menu+F | Copy Histogram Function | graph window | GWCommand (GWActionManager, menu items) | match (plot focused; specs 20.4) |
| `gw.copy.layout` | `76` | Menu+L | Copy to Layout Editor | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.copy.picturetransparency` | `67` | Menu+C | Copy Image | graph window | GWCommand (GWActionManager, menu items) | match (Ctrl/Cmd+C with the plot focused; specs 19.4) |
| `gw.doc.saveas` | `69` | Menu+E | Export Graphic As... | graph window | GWCommand (GWActionManager, menu items) | differs (app Ctrl/Cmd+E opens data export, not graphic export) |
| `gw.edit.clear` | `127` | Menu+Delete | Clear | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.export.movie` | `77` | Menu+M | Make Movie... | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.gate.manual` | `71` | Menu+G | Manually Enter Gate... | graph window | GWCommand (GWActionManager, menu items) | match (Ctrl/Cmd+G with the plot focused) |
| `gw.gate.scale.decrease` | `45` | - | Decrease Size | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.gate.scale.increase` | `61` | Menu+= | Increase Size | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.graph.nextcolor` | `93` | Menu+] | Next Color | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.graph.nextx` | `75` | Menu+K | Next X | graph window | GWCommand (GWActionManager, menu items) | match (plot focused) |
| `gw.graph.nexty` | `89` | Menu+Y | Next Y | graph window | GWCommand (GWActionManager, menu items) | match (plot focused) |
| `gw.graph.prevcolor` | `91` | Menu+[ | Previous Color | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.graph.prevx` | `74` | Menu+J | Previous X | graph window | GWCommand (GWActionManager, menu items) | match (plot focused) |
| `gw.graph.prevy` | `121` | Menu+F10 | Previous Y | graph window | GWCommand (GWActionManager, menu items) | differs (Ctrl/Cmd+Shift+Y; FlowJo value 121 is F10, see K2) |
| `gw.graph.transpose` | `84` | Menu+T | Transpose Axes | graph window | GWCommand (GWActionManager, menu items) | match (plot focused) |
| `gw.nav.child` | `79` | Menu+O | Open Child Population | graph window | GWCommand (GWActionManager, menu items) | match (plot focused; selected gate) |
| `gw.nav.cube` | `51` | Menu+3 | Show in 3D | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.nav.duplicategw` | `68` | Menu+D | Duplicate View | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.nav.home` | `48` | Menu+0 | Show Workspace | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.nav.nextsibling` | `33` | Menu+PageUp | Next Sample | graph window | GWCommand (GWActionManager, menu items) | match (Ctrl/Cmd+PageUp; plain PageDown) |
| `gw.nav.parent` | `85` | Menu+U | Up to Parent Population | graph window | GWCommand (GWActionManager, menu items) | match (plot focused) |
| `gw.nav.prefs` | `,` | Menu+, | Preferences | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.nav.prevsibling` | `34` | Menu+PageDown | Previous Sample | graph window | GWCommand (GWActionManager, menu items) | match (Ctrl/Cmd+PageDown; plain PageUp) |
| `gw.print` | `80` | Menu+P | Print... | graph window | GWCommand (GWActionManager, menu items) | missing |
| `gw.save` | `83` | Menu+S | Save as... | graph window | GWCommand (GWActionManager, menu items) | missing |
| `le.action.copy` | `67` | Menu+C | Copy | every window (Cut/Copy/Paste/Select All) and layout editor | FJCommand.CUT/COPY/PASTE/SelectAll; LECommand | match in the workspace (populations; specs 19.4) |
| `le.action.copy.figure` | `53` | Menu+5 | Save Figure | layout editor | LECommand | missing (window not modelled) |
| `le.action.copy.transparent` | `67` | Menu+C | Copy Selection With Transparency | layout editor | LECommand | missing (window not modelled) |
| `le.action.cut` | `88` | Menu+X | Cut | every window (Cut/Copy/Paste/Select All) and layout editor | FJCommand.CUT/COPY/PASTE/SelectAll; LECommand | match in the workspace (one population) |
| `le.action.paste` | `86` | Menu+V | Paste | every window (Cut/Copy/Paste/Select All) and layout editor | FJCommand.CUT/COPY/PASTE/SelectAll; LECommand | match in the workspace (current and checked samples) |
| `le.action.selectall` | `65` | Menu+A | Select All | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.bottoms` | `92` | Menu+\ | Bottom | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.hcenters` | `46` | Menu+. | Center | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.hspacing` | `74` | Menu+J | Spacing | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.hspread` | `44` | Menu+, | Spread | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.lefts` | `76` | Menu+L | Left | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.rights` | `82` | Menu+R | Right | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.tops` | `84` | Menu+T | Top | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.vcenters` | `34` | Menu+PageDown | Center | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.vspacing` | `75` | Menu+K | Spacing | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.align.vspread` | `79` | Menu+O | Spread | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.document.saveas` | `69` | Menu+E | Export Image | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.fig.properties` | `73` | Menu+I | Properties... | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.nav.fitinwindow` | `50` | Menu+2 | Fit In Window | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.nav.opengraph` | `79` | Menu+O | Open Original Graph | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.nav.showat100` | `49` | Menu+1 | Show At 100% | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.nav.workspace` | `48` | Menu+0 | View Workspace | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.nav.zoomin` | `43` | Menu+VK 43 (no key) | (no label) | layout editor | LECommand (LEActionManager) | n/a |
| `le.nav.zoomout` | `45` | - | (no label) | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.order.bringforward` | `70` | Menu+F | Bring Forward | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.order.bringtofront` | `F` | Menu+Shift+F | Bring to Front | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.order.group` | `71` | Menu+G | Group | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.order.sendbackward` | `66` | Menu+B | Send Backward | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.order.sendtoback` | `B` | Menu+Shift+B | Send to Back | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.order.ungroup` | `85` | Menu+U | Ungroup | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.print` | `80` | Menu+P | Print | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.select.all` | `65` | Menu+A | Select All | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.template.add` | `78` | Menu+N | Add | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.template.delete` | `45` | - | Delete | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `le.template.duplicate` | `61` | Menu+= | Duplicate | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `string.undo` | `ctrl Z` | - | (no label) | - | none | n/a |
| `te.batch.clipboard` | `75` | Menu+K | To Clipboard | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.batch.flowjo` | `53` | Menu+5 | Display | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.batch.layout` | `76` | Menu+L | Batch To Current Layout | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.batch.printer` | `80` | Menu+P | To Printer | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.batch.server` | `70` | Menu+F | To File | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.calculated.table.save.figure` | `53` | Menu+5 | Save As Figure | generated table window | FJTableCommand | missing (window not modelled) |
| `te.calculated.table.showsummarystats` | `72` | Menu+H | Show Summary Stats | generated table window | FJTableCommand | missing (window not modelled) |
| `te.columns.add` | `N` | Menu+Shift+N | Add Column | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.columns.edit` | `69` | Menu+E | Edit Column... | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.edit.clear` | `127` | Menu+Delete | Clear | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.edit.selectall` | `65` | Menu+A | Select All | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.ribbon.config` | `93` | Menu+] | Customize Ribbon | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `le.ribbon.config` | `93` | Menu+] | Customize Ribbon | layout editor | LECommand (LEActionManager) | missing (window not modelled) |
| `te.template.add` | `78` | Menu+N | Add | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.template.delete` | `45` | - | Delete | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `te.template.duplicate` | `61` | Menu+= | Duplicate | table editor | TECommand (TEActionManager) | missing (window not modelled) |
| `test.debug.miflowcyt` | `47` | Menu+/ | Annotate Experiment... | workspace | WSCommand (WSActionManager) | missing (window not modelled) |
| `test.test.clear` | `68` | Menu+D | Clear Output | workspace | WSCommand (WSActionManager) | missing (window not modelled) |
| `test.test.copy` | `67` | Menu+C | Copy | workspace | WSCommand (WSActionManager) | missing (window not modelled) |
| `test.test.paste` | `86` | Menu+V | Paste | workspace | WSCommand (WSActionManager) | missing (window not modelled) |
| `test.test.save` | `83` | Menu+S | Save | workspace | WSCommand (WSActionManager) | missing (window not modelled) |
| `ws.addsamples` | `59` | Menu+; | Add Samples... | workspace | WSCommand (WSActionManager) | missing |
| `ws.addstat` | `66` | Menu+B | Add Statistic... | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+B) |
| `ws.boolean.and` | `A` | Menu+Shift+A | Make And Gate | workspace | WSCommand (WSActionManager) | match |
| `ws.boolean.combo` | `44` | Menu+, | Create Combination Gates | workspace | WSCommand (WSActionManager) | missing |
| `ws.boolean.identity` | `=` | Menu+= | Identical Gate | workspace | WSCommand (WSActionManager) | missing |
| `ws.boolean.not` | `N` | Menu+Shift+N | Make Not Gate | workspace | WSCommand (WSActionManager) | match (browsers may reserve Ctrl+Shift+N) |
| `ws.boolean.or` | `O` | Menu+Shift+O | Make Or Gate | workspace | WSCommand (WSActionManager) | match |
| `ws.close` | `87` | Menu+W | Close | workspace | WSCommand (WSActionManager) | missing |
| `ws.comp.editmatrix` | `M` | Menu+Shift+M | Edit Compensation Matrix | workspace | WSCommand (WSActionManager) | missing |
| `ws.dlog.export.populations` | `69` | Menu+E | Export / Concatenate Populations | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+E opens Export) |
| `ws.dlog.export.group` | `X` | Menu+Shift+X | Export / Concatenate Group | workspace | WSCommand (WSActionManager) | missing |
| `ws.find` | `70` | Menu+F | Find | workspace | WSCommand (WSActionManager) | missing |
| `ws.find.next` | `2` | Menu+VK 2 (no key) | Find Next | workspace | WSCommand (WSActionManager) | n/a |
| `ws.group.copygate` | `G` | Menu+Shift+G | Copy analysis to group | workspace | WSCommand (WSActionManager) | match |
| `ws.group.createfromselection` | `` | - | Group selected samples | workspace | WSCommand (WSActionManager) | n/a |
| `ws.group.createfromvalue` | `74` | Menu+J | Create group from keyword value | workspace | WSCommand (WSActionManager) | missing |
| `ws.group.keywordadd` | `I` | Menu+Shift+I | Add Keyword | workspace | WSCommand (WSActionManager) | missing |
| `ws.group.keywordvalueseries` | `54` | Menu+6 | Create keyword value series... | workspace | WSCommand (WSActionManager) | missing |
| `ws.group.pastekey` | `V` | Menu+Shift+V | Paste keyword to group | workspace | WSCommand (WSActionManager) | missing |
| `ws.nav.layouteditor` | `76` | Menu+L | Layout Editor | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+L) |
| `ws.nav.opengraph` | `10` | Menu+Enter | Gate | workspace | WSCommand (WSActionManager) | missing |
| `ws.nav.tableeditor` | `84` | Menu+T | Table Editor | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+T) |
| `ws.nav.wstofront` | `48` | Menu+0 | Workspace | workspace | WSCommand (WSActionManager) | missing |
| `ws.newgroup` | `71` | Menu+G | Create Group... | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+G outside the plot) |
| `ws.ribbon.config` | `93` | Menu+] | Customize Ribbon | workspace | WSCommand (WSActionManager) | missing |
| `ws.sample.properties` | `73` | Menu+I | Inspect... | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+I opens Keywords) |
| `ws.sample.rename` | `82` | Menu+R | Rename... | workspace | WSCommand (WSActionManager) | missing |
| `ws.select.allnodes` | `65` | Menu+A | Select All | workspace | WSCommand (WSActionManager) | missing |
| `ws.select.equivalentnodes` | `E` | Menu+Shift+E | Select Equivalent Nodes | workspace | WSCommand (WSActionManager) | missing |
| `ws.settings.editcolumns` | `K` | Menu+Shift+K | Edit Columns... | workspace | WSCommand (WSActionManager) | missing |
| `ws.settings.prefs` | `89` | Menu+Y | Preferences... | workspace | WSCommand (WSActionManager) | match (Ctrl/Cmd+Y) |
| `ws.settings.togglestats` | `B` | Menu+Shift+B | Hide Stats | workspace | WSCommand (WSActionManager) | missing |
| `ws.tree.collapseall` | `U` | Menu+Shift+U | Collapse All | workspace | WSCommand (WSActionManager) | missing |
| `ws.tree.expandall` | `85` | Menu+U | Expand All | workspace | WSCommand (WSActionManager) | missing |
| `plat.3d` | `51` | Menu+3 | 3D Viewer | 3D window | ThreeDController$PlotType | missing (window not modelled) |
| `plat.3d.bubble` | `61` | Menu+= | Bubble Plot | 3D window | ThreeDController$PlotType | missing (window not modelled) |
| `plat.3d.pointcloud` | `75` | Menu+K | Point Cloud | 3D window | ThreeDController$PlotType | missing (window not modelled) |
| `plat.3d.terrain` | `63` | Menu+VK 63 (no key) | Terrain Plot | 3D window | ThreeDController$PlotType | missing (window not modelled) |
| `plat.3d.voxel` | `62` | Menu+VK 62 (no key) | Voxel Plot | 3D window | ThreeDController$PlotType | missing (window not modelled) |
| `plat.comparison` | `92` | Menu+\ | Compare Populations... | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.compensation` | `77` | Menu+M | Compensation | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.derived` | `D` | Menu+Shift+D | Derive Parameters... | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.fcsscan` | `F` | Menu+Shift+F | FCS Scan | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.kinetics` | `75` | Menu+K | Kinetics... | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.matrixeditor` | `91` | Menu+[ | Matrix Editor | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.panel` | `P` | Menu+Shift+P | Panel Wizard | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.plate` | `57` | Menu+9 | Plate Editor | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.copy` | `67` | Menu+C | Copy | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.cut` | `88` | Menu+X | Cut | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.menubar.addwell` | `85` | Menu+U | Add Staging Well | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.menubar.setdims` | `68` | Menu+D | Set Plate Dimensions... | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.paste` | `86` | Menu+V | Paste | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.ribbon.config` | `93` | Menu+] | Configure Ribbon | plate editor | PECommand | missing (window not modelled) |
| `plat.plate.selection.save` | `82` | Menu+R | Save Well Selection | plate editor | PECommand | missing (window not modelled) |
| `plat.proliferation` | `56` | Menu+8 | Proliferation Modeling... | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.qb` | `Q` | Menu+Shift+Q | Q&B | workspace (platform launch) | PlatformNavCommand (WSActionManager.makePlatformActions) | missing (window not modelled) |
| `plat.samplequality.check` | `V` | Menu+Shift+V | Check Sample Quality | workspace | WSCommand (WSActionManager) | missing (window not modelled) |
| `plat.cc` | `68` | Menu+D | Cell Cycle... | cell cycle window | CCCommand | missing (window not modelled) |
| `plat.cc.calculate` | `61` | Menu+= | Calculate | cell cycle window | CCCommand | missing (window not modelled) |
| `plat.cc.home` | `48` | Menu+0 | Show Workspace | cell cycle window | CCCommand | missing (window not modelled) |
| `plat.cc.prefs` | `TBD` | - | Preferences... | cell cycle window | CCCommand | missing (window not modelled) |
| `plat.cc2d` | `50` | Menu+2 | 2D Cell Cycle... | cell cycle window | CCCommand | missing (window not modelled) |

## 2. Command dispatch and enable/disable rules

### 2.1 Routing

1. **D1 One action object per command.** Every command is an `FJAction` whose
   action-command string is its dictionary key (for example `ws.addstat`).
   Its label, tooltip (`<key>.tooltip`), mnemonic (`<key>.mnemonic`) and
   shortcut (`<key>.accelerator`) come from the bundles and are reloaded on a
   locale change. Citation: fjlib `FJAction.loadActionProps`,
   `AbstractActionManager.add/get/fjEvent`. Confidence: high. App: no command
   objects; buttons and the key handler call functions directly. Differs
   (architecture; a small command registry would let buttons, menus and keys
   share enable state).
2. **D2 Same action from every entry point.** Ribbon buttons, menu items,
   context-menu items and shortcuts are all bound to the same `FJAction`
   instance, so they share enabled state. A ribbon shortcut tied to a button
   clicks that button; otherwise it runs the action. Citation:
   `ActionAcceleratorListener.dispatchKeyEvent`, `SampleTreeTable.buildPopup`
   (adds the manager's actions), `FJMenuBar.makeItem`. Confidence: high.
   App: keys and buttons are separate code paths (Ctrl+S clicks the save
   button, others open dialogs directly). Differs.
3. **D3 Execution path.** Running an action logs it (action logger), bumps a
   per-action use counter, then either runs the subclass's own handler or
   forwards the event to the window's controller. Citation: fjlib
   `FJAction.actionPerformed`, `FJAction.doAction`. Confidence: high. App:
   n/a (the app has its own log of results, not of commands).
4. **D4 Controllers switch on the command string.** Workspace controller:
   Cut, Copy, Paste go to the workspace clipboard; Clear deletes the
   selection; Add Statistic, Open graph window (one window per selected
   node), the annotation dialog. Graph controller: parent / child navigation,
   Undo / Redo (on the workspace's undo manager). Graph actions handle
   Transpose, Manual gate, Add statistic, the copy commands, Copy to Layout,
   Close, Close All, Reset size. Citation: `WSController.actionPerformed`,
   `AbstractGraphWinController.actionPerformed`, `GWAction.doAction`.
   Confidence: high. App: equivalent functions exist for Add statistic,
   manual gate, copy/paste, delete. Match in substance.
5. **D5 One action manager per window type.** `WSActionManager` (workspace
   ribbon), `GWActionManager` (graph window), `LEActionManager`,
   `TEActionManager`, `FJTableActionManager` (generated tables),
   `PEActionManager`, plus platform managers. All inherit the common set from
   `FJActionManager`: Undo, Redo, Cut, Copy, Paste, Clear, Select All, New,
   Open, Save, Save As, Print, Close, Quit, Preferences. Citation:
   `FJActionManager.createActions` and field list, class list under
   `*/actions/*ActionManager`. Confidence: high. App: one window. Own rule.
6. **D6 Graph window menus.** File: Close, Close All, Reset, Reset All, -,
   Save As (graphic), -, Print. Edit: Undo, Redo, -, Clear, -, Copy Image,
   Copy Image Without Transparency, Copy Histogram Function, Copy to Layout
   Editor, -, Add Statistic, -, Preferences. Graph: Duplicate View, Transpose,
   Manually Enter Gate, Increase Size, Decrease Size, -, Make Movie. Go: Show
   Workspace, Up to Parent, Open Child, -, Previous Sample, Next Sample, -,
   Previous/Next X, Previous/Next Y, Previous/Next Color. Display: grid, large
   dots, frequencies, names, medians, uncompensated, event count. Citation:
   `GWActionManager.getFileActions` ... `getDisplayActions` (null entries are
   separators). Confidence: high (content), medium (separator placement).
   App: plot panel has axis selectors, manual gate, add to layout, export;
   no Transpose, Next/Prev X/Y buttons, Clear, Copy Image. Missing.
7. **D7 Workspace context menu.** On a population or sample: Copy, Paste,
   Rename, Delete, Duplicate, Add Keyword, Add Statistic, (sample: import
   CSV/CLR), -, Inspect, -, Copy analysis to group, -, Select Equivalent
   Nodes, column widths, export / import DIVA, Export / Concatenate, -,
   BifurGate, plus a "locate file" entry for a sample whose file is missing.
   Citation: `SampleTreeTable.buildPopup`. Confidence: medium (order and
   conditions read only partially). App: no context menu. Missing.
8. **D8 When enable states are recomputed.** After selection or model
   changes the workspace view computes a few facts and posts the update to the
   event thread: which tree is focused, how many sample-tree rows are
   selected, whether the first selected node is a population / sample /
   statistic, whether the selected group is All Samples, whether all selected
   nodes are from one sample and none is a root, whether a keyword cell is
   being edited. Skipped while startup commands run. Citation:
   `WSViewMgr.adjust`, `WSActionManager.adjust(boolean,int,...)`,
   `WSActionManager$1.run`. Confidence: high. App: React derives disabled
   flags per render. Match in effect.

### 2.2 Workspace enable rules

"First" = the first selected node in the sample tree. Citation for all:
`WSActionManager$1.run` with the arrays from `getSelectionActions`,
`getCombineActions`, `getNonEmptyActions`; later assignments override earlier
ones (the final state is listed).

9. **E1 Population-first commands.** Enabled only when the first selected
   node is a population: Gate (open graph window), Add Statistic, the
   statistic popups (median, CV, frequency), Select Alternating, Cell Cycle,
   Kinetics, Proliferation, Export / Concatenate Populations, 3D, Compare
   Populations, Identity gate, expand / collapse one level, Group from
   selection, Q&B, t-SNE, export / import DIVA, plugins. Note it tests the
   first node, not "any". Confidence: high. App: Add statistic, export and
   plot work from the selected population; with no population the plot shows
   the sample ("All events"). Differs slightly (app allows sample-level
   statistics and plots; keep, own rule).
10. **E2 No-sample state.** With an empty workspace (no rows): Select All,
    Expand All, Collapse All, Cut, Copy, Check Sample Quality and Keyword
    Value Series are disabled; Create Group stays enabled; Paste and Clear
    are not managed here (always enabled; Paste checks content when run).
    Confidence: high. App: most buttons disabled without a sample. Match in
    spirit.
11. **E3 Several populations.** AND, OR and Create Combination Gates need at
    least two selected rows, all from the same sample (combination gates also
    need no sample-level row). Confidence: high. App: AND/OR need two or more
    Ctrl-clicked populations of the current sample. Match; combination gates
    missing.
12. **E4 Sample-first commands.** Inspect and Matrix Editor need the first
    selected node to be a sample; Derive Parameters needs every selected node
    to be a sample. NOT and Identity are disabled when the first selected is
    a sample. Rename is disabled when the first selected is a sample.
    Confidence: high. App: Keywords and Derive Parameters open without a
    selection (app-wide); rename is inline on populations only. Differs
    (harmless; own rule).
13. **E5 Group commands.** Edit Group and Rename (group) need exactly one
    group selected that is not All Samples, with the group table focused.
    Export / Concatenate Group needs any group row selected. Compensation
    (wizard) needs the current group to have the Compensation role and at
    least one sample. Confidence: high for the conditions, medium for the
    focus condition (it combines group-table focus with the sample-tree
    selection count). App: group edit/delete act on the chosen group; All
    Samples cannot be deleted. Match; compensation-role gating missing.
14. **E6 Copy analysis to group.** Enabled when something is selected, every
    selected node has a parent, and none already belongs to the current
    group. Confidence: high. App: "Copy analysis to group" needs a selected
    population only. Differs (app does not disable when the analysis is
    already group-owned).
15. **E7 Keyword-cell commands.** Create group from keyword value and Set
    group value are enabled only while a keyword cell is being edited in the
    sample tree. Confidence: medium. App: group-by-keyword works from a
    dropdown. Own rule.
16. **E8 Undo / Redo** enabled exactly when the workspace undo manager can
    undo / redo. Calibration is always disabled. Confidence: high. App:
    match (buttons disabled on empty history).

### 2.3 Graph window enable rules

Citation for all: `GWActionManager.adjust`.

17. **E9** Up to Parent is disabled on the ungated sample. Confidence: high.
    App: the crumb root is always clickable (harmless). Match in effect.
18. **E10** Previous / Next Sample are enabled only when another sample has an
    equivalent node at the same path. Confidence: high. App: buttons stay
    enabled and fall back to All events. Differs (minor).
19. **E11** Clear, Increase Size, Decrease Size and Open Child need a selected
    gate. Confidence: high. App: no gate selection concept on the plot
    beyond the selected population. Missing.
20. **E12** Copy Histogram Function only on a 1-D plot; Transpose only on a
    2-D plot; Reset Size when the window was resized; Reset All when any
    window was resized. Confidence: high. App: features missing.


## 3. Undo / redo

1. **U1 Managers.** Each workspace owns one `WSUndoManager` (a fjlib
   `FJUndoManager`, itself a Swing `UndoManager`), created with the workspace.
   Graph windows undo and redo on that same manager, so workspace and graph
   edits share one history. The layout editor has its own `LEUndoManager`
   (separate history). `WorkspaceUndoManager` (layout-package based) is never
   constructed. Citation: `Workspace` constructor (creates `fUndoMgr`),
   `AbstractGraphWinController.actionPerformed` (undo/redo go to
   `Workspace.getUndoMgr`), `LEUndoManager`, absence of callers of
   `WorkspaceUndoManager`. Confidence: high. App: one history for
   everything, including layout and table edits. Match for workspace + graph;
   differs for layout (minor).
2. **U2 Limit.** No class sets a limit, so the Swing default of 100 applies,
   counted in user actions (compound edits). Already in specs 6 (undo items).
   Citation: `FJUndoManager.startNewEdit`; no `setLimit` on these managers.
   Confidence: high. App: `HISTORY_LIMIT = 100` snapshots. Match.
3. **U3 One step per user action.** The first significant edit opens a
   compound edit; later edits join it until the code that began the action
   closes it (gate drags, node manager, group dialog, statistic dialog,
   sample adding, drops, text paste, compensation and derived-parameter
   controllers all close their edit). Undo or Redo while a compound is still
   open closes it first. Insignificant edits are not recorded. Citation:
   `FJUndoManager.addEdit`, `startNewEdit`, `endCurrentEdit`, `undo`, `redo`;
   callers of `endCurrentEdit` (`GraphEditor`, `WSNodeMgr`, `GroupDlog`,
   `StatDialog`, `SampleAddingThread`, `TreeTableDropListener$UndoableDropRunnable`,
   `CompensationNode`, `DerivedParameterController`). Confidence: high
   (mechanism), medium (exact boundaries per command). App: one snapshot per
   `setWs` call; a gate drag commits once on mouse-up. Match.
4. **U4 No merging across actions.** There is no time-based or same-kind
   coalescing: two separate nudges or renames are two undo steps. Citation:
   `FJUndoManager.addEdit` (no merge logic beyond the open compound).
   Confidence: medium. App: no merging. Match.
5. **U5 Redo dropped by a new edit** (Swing behavior). Citation: Swing
   `UndoManager.addEdit` via `FJUndoManager.startNewEdit`. Confidence: high.
   App: `pushHistory` clears `future`. Match.
6. **U6 Undoable edits (workspace history).** Edit classes that exist for the
   workspace domain: gate move/resize (`GateMovedEdit`), gate type
   conversion (`GateConvertEdit`), add/remove population (`AddChildEdit`,
   `RemoveChildEdit`, `AddRemoveNodeEdit`), add/remove sample
   (`AddRemoveSampleEdit`), add/remove group (`AddRemoveGroupEdit`), group
   membership (`AddRemoveSampleToGroupEdit`), group ownership of a node
   (`SetGroupEdit`), rename (`WSRenameAction$WSRenameEdit`), add workspace
   keyword (`AddWorkspaceKeywordEdit`), table cell / keyword value
   (`TableSetValueAtEdit`), column setup (`WorkspaceColumnInfoEdit`), font
   (`WSFontEdit`), axis transform (`TransformEdit`, `CytometerTransformEdit`),
   contour level (`SetContourLevelEdit`), gate line weight
   (`SetLineWeightEdit`), graph display settings (`AbstractSetGraphSpecEdit`
   and the chart edits). Citation: classes extending Swing
   `AbstractUndoableEdit` in the FlowJo jar. Confidence: medium (inferred from
   class names and call sites; not every command was traced). App: every
   workspace change is a snapshot, so all of these are undoable. Match
   (superset).
7. **U7 Group auto-apply is not a separate step.** While a sample is being
   added to a group, recording is switched off and restored afterwards, so
   the group's analysis landing on the new sample is not its own undo step.
   Citation: `Group.addSample(Sample, boolean)` (toggles the manager's enabled
   flag). Confidence: high. App: group sync happens inside the same snapshot
   (`setWs` runs `syncLiveGroups`). Match.
8. **U8 What clears history.** Nothing calls `discardAllEdits` on the
   workspace manager: saving does not clear history; history ends when the
   workspace closes; New / Open start with a fresh manager. Citation: no
   callers of `WSUndoManager.discardAllEdits` in either jar. Confidence: high
   (static). App: opening a workspace resets history (`App.tsx` around line
   295); save keeps it. Match.
9. **U9 "Disable Undo" preference.** `Workspace/noUndo` (default off) is read
   once, when the workspace's undo manager is built. When on, nothing is
   recorded, so Undo and Redo stay disabled for that workspace. Turning it on
   or off later does not change already-open workspaces (no preference code
   updates the manager). Headless runs never record. Citation:
   `Workspace.undoEnabled` (reads `FJPrefsFJML$Workspace.noUndo`),
   `FJUndoManager` constructor and `canModify`; setters of the enabled flag
   only in `Group`, `Layout`, `Batch`, `CELayout`. Confidence: medium-high.
   App: applies immediately and also wipes existing history on the next edit
   (`App.tsx` `setWs`). Differs (minor). Recommendation: apply the preference
   at workspace open/new, or at least do not wipe existing history.
10. **U10 Labels.** The workspace and graph-window commands are labelled just
    "Undo" and "Redo" (`fj.action.undo` / `fj.action.redo`), tooltips
    "Restore the workspace state to before the previous action occurred." and
    "Restore the change most recently undone."; no edit name is appended in
    these windows. (A layout-package manager can show "Undo <edit name>", and
    the action-level compound edit can build "Undo <name>", but the workspace
    path does not push that text to the menu.) Citation:
    `FJCompoundEdit.getUndoPresentationName` (actions package),
    `UndoRedoManager.updateActions`, `WSUndoManager.adjust` (only refreshes
    enable state), bundle keys. Confidence: medium. App: buttons "Undo" /
    "Redo" with tooltips naming the keys. Match (consider FlowJo's tooltip
    text).
11. **U11 Keys.** Undo Menu+Z, Redo Menu+Shift+Z in the workspace (ribbon,
    on release) and the graph window (menu). Menu+Y is Preferences, not Redo.
    Citation: K1 with `fj.action.undo/redo`, `ws.settings.prefs`.
    Confidence: high. App: match; Ctrl+Shift+Y also redoes (own, harmless).
12. **U12 After undo/redo** the workspace view refreshes enable states and
    notifies undo listeners (open windows repaint). Citation:
    `WSUndoManager.undo/redo/adjust`, `WSUndoManager$UndoRedoEvent`.
    Confidence: high. App: React re-renders from the restored snapshot.
    Match.


## 4. Clipboard

### 4.1 Workspace populations (gates)

1. **C1 Copy takes the whole selection.** Copy takes every selected node in
   the sample tree (any number, any samples), adds the sibling quadrants of
   any selected quadrant, and stores the list. With nothing selected the
   clipboard is left unchanged. Citation: `WSClipboard.copy`,
   `NodeList.addSiblingQuads`. Confidence: high. App: copies only the one
   selected population (`onCopy` passes `[sel.popId]`; quads handled).
   Differs.
2. **C2 Internal clipboard, not the system one.** The copied list is kept in
   a process-wide slot shared by all open workspaces; the system clipboard is
   not touched by a population copy. It stays after pasting (paste again at
   will) and is lost on quit. Citation: `WSClipboard` (static
   `sFlowjoClipboard`, `copy`, `getFlowJoNodeClipboard`). Confidence: high.
   App: React state `clip`, survives opening another workspace in the same
   tab, lost on reload. Match.
3. **C3 Content is built at paste time.** The XML for the copied nodes is
   produced when the clipboard is read, not when Copy is pressed: a node
   whose ancestor is also selected is nested under that ancestor instead of
   being pasted twice; each top element records its source sample's file
   URI, its analysis path and, for quadrants, its quad id. So a gate edited
   after Copy pastes in its edited form. Citation:
   `NodeTransfer.getTransferData`, `NodeTransfer.makeNodeRefList`,
   `NodeTransfer.isChildPath`. Confidence: medium (lazy build read from
   code; effect not observed). App: snapshot at copy time
   (`copyPopulations` clones). Differs (edge case; low impact).
4. **C4 Formats.** A population copy offers two flavors: an in-process node
   list and plain text (the nodes' text forms joined by newlines). It is not
   Gating-ML. Other internal flavors exist for drag and drop (analysis node,
   analysis parent, sample node, compensation template, layout figure list).
   Citation: `NodeTransfer` static flavors, `getFlavorArrayForObject`,
   `convertTransferDataToString`. Confidence: high (flavors), medium (exact
   text). App: no system-clipboard text. Missing (low impact; only matters
   if the text is pasted elsewhere, which FlowJo does not do on Copy anyway,
   see C2).
5. **C5 Cut = Copy, then Clear** (delete the selection, with the normal
   confirmation). Citation: `WSClipboard.cut`. Confidence: high. App: no
   Cut. Missing.
6. **C6 Paste: nodes first, else text.** If the internal clipboard holds
   nodes they are pasted; otherwise, if the system clipboard holds text, the
   text is pasted into the focused table (C10). Citation:
   `WSClipboard.paste`, `WSClipboard.pastable`, `WSViewMgr.pasteText`.
   Confidence: high. App: nodes only. Differs (text paste missing).
7. **C7 Paste targets.** Each copied element is pasted under each selected
   node of the workspace (selection may span samples; samples and
   populations both work as targets). With nothing selected, the elements
   are pasted onto the group selected in the group list. The sample list is
   rebuilt afterwards. Citation: `WSClipboard.internalPaste`
   (`WSViewMgr.getSelectedNodes`, `GroupTreeTable.getSelectedNode`,
   `STreeTable.addElementToTree`). Confidence: high. App: targets are the
   Ctrl-clicked populations of the current sample, or the selected
   population (`App.tsx` `onPaste`); no cross-sample targets, no group
   fallback. Differs (high impact: FlowJo users select many samples and
   paste once).
8. **C8 What a paste creates.** A pasted population loses its group
   ownership; a copied sample element dropped on a group adds that sample to
   the group. Name clash and missing-parameter rules: specs 10.7. Citation:
   `STreeTable.addElementToTree` (clears the group name),
   `STreeTable.groupElementDrop`, `SampleTreeTable.addDroppedNode`.
   Confidence: high. App: `pastePopulations` clears `owningGroup`, skips name
   clashes, refuses missing parameters. Match.
9. **C9 Enabled state.** Copy and Cut are enabled whenever the workspace has
   rows (E2); Paste is always enabled and checks content when run.
   Citation: `WSActionManager.getNonEmptyActions`, `WSClipboard.pastable`.
   Confidence: high. App: Copy needs a selected population, Paste needs a
   non-empty clip. Differs (app is stricter; fine, own rule).
10. **C10 Pasting text into the workspace table.** Text from the system
    clipboard is split into rows and tab- or comma-separated cells; a header
    row can add keyword columns; values fill editable cells starting at the
    selected (or edited) row; the whole paste is one undo step. Citation:
    `KTreeTable.pasteFromSystemClipboard`, `KTreeTable.addPastedHeaderKeywords`,
    `StringUtil.parseTabOrCsvString`. Confidence: medium. App: annotations
    are typed one key/value at a time. Missing (useful for sample
    annotation from a spreadsheet).
11. **C11 Drag and drop is the other copy path.** Populations dragged onto
    samples, populations or groups are applied there (undoable); drops
    between workspaces carry XML elements; compensation matrices dropped on a
    sample or group apply; files dropped on the tree are opened by type (FCS,
    workspace, zip, xml, mtx/csv/clr matrices, images). Citation:
    `TreeTableDropListener` (`initiateNodeDrop`, `interWorkspaceNodeDrop`,
    `compDrop`, `processDropFile`), `GroupTableDropListener.drop`.
    Confidence: medium. App: no drag and drop (comparison C21 covers file
    drop). Missing.

### 4.2 Graphs, statistics and tables

12. **C12 Copy Image (graph window).** Menu+C copies the graph as a raster
    image (image flavor only) to the system clipboard. "Copy Image" keeps
    transparency (PNG-type raster); "Copy Image Without Transparency" makes
    an opaque raster. On failure: "There was an error adding the image to the
    system clipboard." Citation: `GWAction.doAction` (`COPYPICTURETRANS`,
    `COPYPICTURENOTRANS`), `GateWinController.doCopy`,
    `FJClipboardUtil.addImageToClipboard`, `ImageSelection`. Confidence:
    high (flavor), medium (raster type per option). App: PNG download only.
    Missing (browsers can write `image/png` via the async clipboard API).
13. **C13 Text copies from the graph.** Copy Histogram Function (Menu+F, 1-D
    only) puts the X-parameter histogram as text, in display coordinates.
    Copy Statistics puts the population's statistic values as text. Copy
    Selected Gate puts the graph node's XML as text. The last two are not in
    the graph menus. Citation: `GWAction.copyText`, `GWAction.copyStatistics`,
    `GWAction.copy`, `PopNode.collectStatNodeString`,
    `Histogram.toString(CoordinateTransformer)`. Confidence: medium. App:
    missing (statistics export to CSV exists).
14. **C14 No gate paste in the graph window.** A "Paste" command key exists
    (`gw.edit.paste`) but no menu entry or handler uses it; gates are copied
    and pasted in the workspace tree. Citation: `GWCommand.PASTEGATE` has no
    reference outside the enum; `GWActionManager.getEditActions`.
    Confidence: medium. App: paste lives with the population actions. Match.
15. **C15 Layout editor.** Copy puts the selected figures on the system
    clipboard as a raster image and keeps the figures in an internal
    clipboard. Paste uses the internal figures; if the workspace clipboard
    holds populations, Paste in the layout creates graphs for them (sample
    found by file URI, node by path; statistic nodes become statistic
    figures) at the right-click point; text becomes a text figure.
    Citation: `FJClipboardUtil.copy`, `LEPasteAction`. Confidence: medium.
    App: layout items are added by "Add to layout". Missing (own layout
    model).
16. **C16 Tables to the clipboard.** "Copy Table to Clipboard" (generated
    table, Menu+C) and the table editor's "To Clipboard" (Menu+K) place the
    table as HTML, optionally RTF, and plain text. Citation:
    `FormattedTextTransferable` (flavors), `TableController`, bundle
    `te.batch.clipboard`, `fj.tableactionmanager.copy`. Confidence: medium.
    App: CSV/TAB/HTML download only (specs 17.3 lists clipboard as not
    implemented). Missing.
17. **C17 Keyword paste to group.** "Paste keyword to group" (Menu+Shift+V)
    copies a keyword from the system clipboard to all samples in the group.
    Citation: bundle `ws.group.pastekey` and tooltip, `WSCommand`.
    Confidence: low (behavior from the tooltip only). App: missing.


## 5. Top gaps by user impact

1. Paste onto many targets: selection across samples, and the
   "nothing selected = paste to the selected group" fallback (C7), plus
   copying several populations at once (C1).
2. Keyboard Copy / Paste / Cut / Delete for populations in the workspace
   tree (K8, K10, C5); Cut is missing entirely.
3. Graph keys: Delete/Backspace deletes the selected gate; arrow keys nudge
   it with the Alt/Ctrl/Shift multipliers (K9).
4. Sample stepping: plain PageDown = next, PageUp = previous (app is
   reversed), Space / Shift+Space next / previous, Menu+PageUp/PageDown in
   the menus (K9, corrections section).
5. Polygon drawing keys: Backspace removes the last vertex, Space closes the
   polygon (K9).
6. Copy graph image to the system clipboard (C12) and copy tables to the
   clipboard (C16).
7. Workspace shortcuts not yet mapped: Menu+B Add Statistic, Menu+I Inspect,
   Menu+R Rename, Menu+Enter open graph, Menu+Shift+A/O/N AND/OR/NOT,
   Menu+Shift+G Copy analysis to group, Menu+U / Menu+Shift+U expand /
   collapse, Menu+Shift+E Select Equivalent Nodes, Menu+F Find; and the
   Menu+G context split (workspace = Create Group, graph = Manual gate).
8. Graph-window shortcuts and commands: Menu+T Transpose, Menu+K/J next /
   previous X, Menu+Y next Y (previous Y is Menu+F10 in FlowJo; use a sane
   key), Menu+] / [ colour axis, Menu+U parent, Menu+O child, Menu+- / =
   gate size, Menu+D duplicate view (D6, E11, E12).
9. Pasting tab/CSV text into keyword columns (C10).
10. Enable-state details: Copy analysis to group disabled when already
    group-owned (E6); Next/Previous Sample disabled when no equivalent node
    exists (E10); "Disable Undo" applied per workspace without wiping history
    (U9).

## 6. Could not determine

- Runtime behavior of anything here (FlowJo not run): in particular the felt
  effect of the 2 s accelerator debounce and release-time firing (K5).
- Which action wins each same-window shortcut conflict (hash order, K6).
- Whether macOS's screen menu bar duplicates the workspace ribbon shortcuts,
  and what happens to OS-reserved combinations (K13).
- Exact compound-edit boundaries for each command (U3) and whether every
  edit class in U6 is actually reached from a user command.
- The exact plain-text form of a population copy (C4), the raster resolution
  and exact format per Copy Image option (C12), and the text layout of Copy
  Histogram Function / Copy Statistics (C13).
- Where Copy Statistics and Copy Selected Gate are offered in the UI (no
  menu entry found; C13).
- Exact order and conditions of the workspace context menu (D7) and the
  graph window's right-click menu (`GatePanel`, not read).
- Keyword paste-to-group details (C17) beyond the tooltip.
- Whether `le.nav.*` zoom keys are wired through a different command name
  (K12).

