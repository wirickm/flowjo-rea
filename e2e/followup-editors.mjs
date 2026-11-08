// Follow-up editors (docs/validation/ui-gaps/workspace.md, SCRIPTEDITOR): the
// Script Editor's script list (imported <Scripts>, New, Duplicate, Delete,
// Open, Save), Run against the workspace (counts, statistics fetched on
// demand, groups and gates made by a script, undo), the console (persistent
// variables, _, history, Ctrl+C interrupt) and Clear; then the rest of the
// API: display, annotation, not / magnetic, add / remove, fileMask with an
// attached file, chart display / export and HTML movies.
// Usage: node e2e/followup-editors.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5194';
const out = join(root, 'test-results', 'e2e');
mkdirSync(out, { recursive: true });
const dir = join(root, 'fixtures/flowkit/data/8_color_data_set');
const FILES = ['101_DEN084Y5_15_E01_008_clean.fcs', '101_DEN084Y5_15_E03_009_clean.fcs', '101_DEN084Y5_15_E05_010_clean.fcs'];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('flowjo-rea.separateWindows', '0'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const tab = (t) => page.getByTestId(`ribbon-tab-${t}`).click();
const download = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(out, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), text: readFileSync(p, 'utf8') }; };
const consoleText = () => page.getByTestId('script-console').innerText();
const items = () => page.locator('[data-testid^=script-item-]').allInnerTexts();
const waitConsole = async (re, timeout = 30000) => { try { await page.waitForFunction((src) => new RegExp(src).test(document.querySelector('[data-testid=script-console]')?.textContent ?? ''), re.source, { timeout }); return true; } catch { return false; } };
const setScript = async (text) => { await page.getByTestId('script-text').fill(text); };

await page.goto(base);
await tab('File');
await page.getByTestId('open-ws').setInputFiles(join(dir, '8_color_ICS_simple.wsp'));
await idle();
await page.getByTestId('add-fcs').setInputFiles(FILES.map((f) => join(dir, 'fcs_files', f)));
await idle();

// --- script list ----------------------------------------------------------------
await page.getByTestId('open-scripts').click();
check('Script Editor opens with the welcome message', (await consoleText()).includes('Welcome to the FlowJo core'));
check('the imported <Scripts> entry is listed as "New Script (0 lines)"', (await items()).join('|') === 'New Script (0 lines)', (await items()).join('|'));
await page.getByTestId('script-new').click();
// The imported name is "New Script" plus blanks, so the new one (exact name
// "New Script") does not clash, as in FlowJo (NameUtil compares exactly).
check('New Script adds a script', (await items()).join('|') === 'New Script (0 lines)|New Script (0 lines)', (await items()).join('|'));
await page.getByTestId('script-new').click();
check('a second New Script gets a -1 suffix (NameUtil.uniqueName)', (await items())[2] === 'New Script-1 (0 lines)', (await items()).join('|'));
await page.getByTestId('script-delete').click();
await page.getByTestId('script-item-1').click();
await page.getByTestId('script-name').fill('Counts');
await setScript('var s = workspace.samples;\nconsole.log(s.length + " samples");\ns.names');
await page.getByTestId('script-name').click();
check('the list shows the name and line count', (await items())[1] === 'Counts (3 lines)', (await items()).join('|'));
await page.getByTestId('script-dup').click();
check('Duplicate Script copies the selected script with its name', (await items()).join('|') === 'New Script (0 lines)|Counts (3 lines)|Counts (3 lines)', (await items()).join('|'));
await page.getByTestId('script-delete').click();
check('Delete Script removes the selected script', (await items()).length === 2);

// --- run ------------------------------------------------------------------------
await page.getByTestId('script-item-1').click();
await page.getByTestId('script-run').click();
const ran = await waitConsole(/--- Counts ---[\s\S]*3 samples\n\[101_DEN084Y5_15_E0\d_0\d\d_clean\.fcs, /);
check('Run prints console.log output and the result under the script name', ran, (await consoleText()).slice(-200));
await setScript('var p = workspace.samples[0].populations("**")[0];\np.name + ": " + p.count + " / median " + Math.round(p.stat(stats.median("FSC-A")))');
await page.getByTestId('script-run').click();
const med = await waitConsole(/: \d+ \/ median \d+/);
check('statistics are computed on demand (stats.median)', med, (await consoleText()).slice(-120));
await setScript('nosuch.value');
await page.getByTestId('script-run').click();
check('a script error is printed in red with its line', await waitConsole(/nosuch[^\n]*\(line 1, column \d+\)/), (await consoleText()).slice(-120));

// Groups and gates made by a script, then undo.
await setScript('var g = workspace.groups.create("Scripted");\ng.add(workspace.samples.slice(0, 2));\nworkspace.samples[0].gating.range("ScriptRange", "FSC-A", 50000, 150000).name');
await page.getByTestId('script-run').click();
await waitConsole(/ScriptRange\n/);
await page.getByTestId('script-close').click();
await idle();
const grp = page.getByTestId('grow-Scripted');
check('a script creates a group with two samples', (await grp.count()) === 1 && /\b2\b/.test(await grp.innerText()), (await grp.count()) ? await grp.innerText() : 'missing');
const gateRow = page.locator('[data-testid^="row-"][data-testid$="/ScriptRange"]');
check('a script adds a range gate to the first sample', (await gateRow.count()) === 1);
await page.getByTestId('undo').click();
await idle();
check('Undo removes everything one script run changed', (await page.getByTestId('grow-Scripted').count()) === 0 && (await gateRow.count()) === 0);

// --- console --------------------------------------------------------------------
await page.getByTestId('open-scripts').click();
const prompt = page.getByTestId('script-prompt');
await prompt.fill('var n = workspace.samples.length');
await prompt.press('Enter');
await waitConsole(/>>> var n = workspace\.samples\.length/);
await prompt.fill('n * 10');
await prompt.press('Enter');
check('console variables persist and results print as "= value"', await waitConsole(/>>> n \* 10\n\s+= 30/), (await consoleText()).slice(-120));
await prompt.fill('_ + 1');
await prompt.press('Enter');
check('the last result is kept in _', await waitConsole(/= 31/));
await prompt.press('ArrowUp');
check('Up recalls the previous command', (await prompt.inputValue()) === '_ + 1', await prompt.inputValue());
await prompt.press('ArrowUp');
check('Up again goes further back', (await prompt.inputValue()) === 'n * 10', await prompt.inputValue());
await prompt.fill('while (true) {}');
await prompt.press('Enter');
await page.waitForTimeout(500);
await prompt.press('Control+c');
check('Ctrl+C interrupts a running command', await waitConsole(/User interrupt/), (await consoleText()).slice(-80));
await prompt.fill('workspace.samples.length');
await prompt.press('Enter');
check('the console works again after an interrupt', await waitConsole(/>>> workspace\.samples\.length\n\s+= 3/));
await page.getByTestId('script-clear').click();
check('Clear empties the output console', (await consoleText()).trim() === '');

// --- save / open ----------------------------------------------------------------
await page.getByTestId('script-item-1').click();
await page.getByTestId('script-save-options').click();
const saved = await download(() => page.getByTestId('script-save').click());
check('Save Selected Script downloads name.fjs with the script text', saved.name === 'Counts.fjs' && saved.text.includes('workspace.groups.create("Scripted")'), saved.name);
const fjs = join(out, 'Loaded script.fjs');
writeFileSync(fjs, 'workspace.name');
await page.getByTestId('script-open').setInputFiles(fjs);
await page.waitForTimeout(300);
check('Open Script loads a .fjs file named after the file', (await items()).includes('Loaded script (1 lines)'), (await items()).join('|'));
await page.getByTestId('script-run').click();
check('a loaded script runs', await waitConsole(/--- Loaded script ---/));
await page.getByTestId('script-close').click();

// --- follow-up: display, annotation, not / magnetic, add / remove, fileMask, charts, movies ---
await page.getByTestId('open-scripts').click();
await page.getByTestId('script-new').click();
const runScript = async (code) => { await setScript(code); await page.getByTestId('script-run').click(); };
const winsBefore = await page.getByTestId('graph-window').count();
await runScript('var w = workspace.samples[0].display("FSC-A", "SSC-A"); w.location(500, 60); w.name');
await waitConsole(/: Ungated\n/);
await page.waitForTimeout(500);
check('node display() opens the graph window of the node', (await page.getByTestId('graph-window').count()) === winsBefore + 1, `${winsBefore} -> ${await page.getByTestId('graph-window').count()}`);
await runScript('var p = workspace.samples[0].populations("**")[0]; p.annotation = "checked by script"; var g = workspace.samples[0].gating.range("NotRange", "FSC-A", 50000, 150000); g.not = true; g.magnetic = true; workspace.samples[1].add(p); "done"');
await waitConsole(/done\n/);
await runScript('workspace.samples[0].populations("**")[0].annotation + " | " + workspace.samples[0].populations("NotRange")[0].not + " | " + workspace.samples[0].populations("NotRange")[0].magnetic');
check('annotation and not / magnetic flags are stored in the workspace', await waitConsole(/checked by script \| true \| true\n/), (await consoleText()).slice(-120));
await runScript('workspace.samples[1].populations("*").length + workspace.samples[0].populations("*").length');
await page.getByTestId('script-close').click();
await idle();
const notRow = page.locator('[data-testid^="row-"][data-testid$="/NotRange"]');
check('a script gate with not = true shows as an exclusion gate', (await notRow.count()) === 1 && /\[excl\]/.test(await notRow.innerText()), (await notRow.count()) ? await notRow.innerText() : 'missing');
await page.getByTestId('open-scripts').click();
await page.getByTestId('script-item-0').click();
await runScript('var t = workspace.samples[1]; var n = t.populations("*").length; var first = workspace.samples[0].populations("*")[0].name; var c = t.populations(first)[0]; var had = !!c; t.remove(c); had + " " + (t.populations("*").length - n)');
check('add() copied the population to another sample and remove() deletes it', await waitConsole(/true -1\n/), (await consoleText()).slice(-80));

// fileMask: a mask file attached in the editor.
const maskFile = join(out, 'script-mask.csv');
writeFileSync(maskFile, 'inGate\n' + Array.from({ length: 1000 }, (_, i) => (i % 2 ? 0 : 1)).join('\n') + '\n');
await page.getByTestId('script-attach').setInputFiles(maskFile);
await page.waitForTimeout(300);
check('Attach Files lists the attached file', (await page.getByTestId('script-files').innerText()).includes('script-mask.csv'));
await runScript('var g = workspace.samples[0].gating.fileMask("Masked", "C:/data/script-mask.csv"); g.typeName + " " + g.file');
check('gating.fileMask makes a FileMaskGate from the attached file', await waitConsole(/FileMaskGate C:\/data\/script-mask\.csv\n/), (await consoleText()).slice(-100));
await page.getByTestId('script-close').click();
await idle();
await page.getByTestId('open-scripts').click();
await runScript('workspace.samples[0].populations("Masked")[0].count');
check('the file mask gate counts the marked events (500 of the first 1000)', await waitConsole(/\n500\n/), (await consoleText()).slice(-60));

// Charts and movies.
const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), fn()]); const pth = join(out, d.suggestedFilename()); await d.saveAs(pth); return { name: d.suggestedFilename(), buf: readFileSync(pth) }; };
const png = await dl(() => runScript('var c = workspace.chart(); c.type = "Histogram"; c.parameters = ["FSC-A"]; var s = workspace.samples[0]; c.layer(s); c.layer(s.populations("**")[0], 0xff0000); c.export("/tmp/script-chart.png"); c.parameters'));
check('chart.export writes the chart as a PNG', png.name === 'script-chart.png' && png.buf.slice(1, 4).toString() === 'PNG', `${png.name} ${png.buf.length}`);
const svg = await dl(() => runScript('var c = workspace.chart(); c.layer(workspace.samples[0]); c.export("chart2", "svg"); 1'));
check('chart.export with a type writes SVG', svg.name === 'chart2.svg' && svg.buf.toString().includes('<svg'), svg.name);
await runScript('var c = workspace.chart(); c.layer(workspace.samples[0].populations("**")[0]); c.type = "DotPlot"; var w = c.display(); w.name');
check('chart.display opens the first layer in a graph window', await waitConsole(/: [^\n]+\n$/), (await consoleText()).slice(-80));
const movie = await dl(() => runScript('var m = movie.create(); workspace.samples.forEach(function (s) { var c = workspace.chart(); c.layer(s); m.append(c); }); m.frameDelay = 300; m.export("/tmp/script-movie"); m.name'));
const html = movie.buf.toString();
check('movie.export writes an HTML movie with one frame per appended chart', movie.name === 'script-movie.html' && (html.match(/class="f"/g) ?? []).length === 3 && html.includes('d=300'), `${movie.name} frames=${(html.match(/class="f"/g) ?? []).length}`);
await page.getByTestId('script-close').click();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
