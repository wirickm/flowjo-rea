// Workspace window gaps (docs/validation/ui-gaps/workspace.md): boolean
// expression / edit / combination / identical / naming dialog, Edit Columns,
// sorting, view toggles, Select All, Expand / Collapse Selection, Add
// Statistic, keywords for the group, exports (Excel, template, archive,
// several populations, group), Revert, Close, single Replace.
// Usage: node e2e/workspace-gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5185';
const out = join(root, 'test-results', 'e2e');
mkdirSync(out, { recursive: true });
const dir = join(root, 'fixtures/flowkit/data/8_color_data_set');
const FILES = ['101_DEN084Y5_15_E01_008_clean.fcs', '101_DEN084Y5_15_E03_009_clean.fcs', '101_DEN084Y5_15_E05_010_clean.fcs'];
const F1 = FILES[1];
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
const heads = async () => (await page.getByTestId('sample-table').locator('thead th').allInnerTexts()).map((t) => t.trim());
const sampleOrder = async () => page.locator('[data-testid=sample-table] tr.sample').evaluateAll((rs) => rs.map((r) => r.getAttribute('data-testid').slice(4)));
const popRow = (sample, name) => page.locator(`[data-testid^="row-${sample}/"][data-testid$="/${name}"]`).first();
const download = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(out, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), bytes: readFileSync(p) }; };
const tab = (t) => page.getByTestId(`ribbon-tab-${t}`).click();
const answer = async (label) => { await page.getByTestId('question').getByRole('button', { name: label, exact: true }).click(); await idle(); };

await page.goto(base);
await tab('File');
await page.getByTestId('open-ws').setInputFiles(join(dir, '8_color_ICS_simple.wsp'));
await idle();
await page.getByTestId('add-fcs').setInputFiles(FILES.map((f) => join(dir, 'fcs_files', f)));
await idle();
check('imported <Columns> show as table columns (Compensation Matrix)', (await heads()).join('|').startsWith('Name|Statistic|#Cells|Compensation Matrix'), (await heads()).join('|'));

// --- Edit Columns, sort, Remove Column -----------------------------------------
await tab('Workspace');
await page.getByTestId('edit-columns').click();
await page.getByTestId('cols-all').selectOption('kw:$DATE');
await page.getByTestId('cols-add').click();
await page.getByTestId('cols-ok').click();
check('Edit Columns adds a keyword column', (await heads()).includes('$DATE'), (await heads()).join('|'));
check('a keyword cell shows the sample value', (await page.getByTestId(`cell-${F1}-$DATE`).innerText()).length > 0);
const order0 = await sampleOrder();
await page.getByTestId('col-Name').dblclick();
const asc = await sampleOrder();
await page.getByTestId('col-Name').dblclick();
const desc = await sampleOrder();
check('double-click on a header sorts; again reverses', asc.join() === [...order0].sort().join() && desc.join() === [...asc].reverse().join(), desc.join(' / '));
check('the sort column shows its direction', (await page.getByTestId('col-Name').innerText()).includes('▼'));
await page.getByTestId('sort-1').selectOption('');
check('Sort 1 (none) restores the group order', (await sampleOrder()).join() === order0.join());
await page.getByTestId('col-$DATE').click({ button: 'right' });
await page.getByTestId('ctx-Remove Column').click();
check('Remove Column (header menu) removes the column', !(await heads()).includes('$DATE'));

// --- Add Statistic dialog, Hide Stats, Recalculate -----------------------------
await popRow(F1, 'CD3+').click();
await page.getByTestId('open-add-stat').click();
await page.getByTestId('as-stat-count').check();
await page.getByTestId('as-stat-median').check();
await page.locator('[data-testid^=as-param-]').nth(3).check();
await page.locator('[data-testid^=as-param-]').nth(4).check();
check('Add Statistic counts statistics x parameters', (await page.getByTestId('as-count').innerText()).startsWith('3 '), await page.getByTestId('as-count').innerText());
await page.getByTestId('as-ok').click();
await idle();
const statRows = () => page.locator('[data-testid=sample-table] tr.stat').count();
const nStat = await statRows();
check('three statistic nodes under CD3+ in each sample', nStat === 9, String(nStat));
await page.getByTestId('toggle-stats').click();
check('Hide Stats hides the statistic nodes', (await statRows()) === 0 && (await page.getByTestId('toggle-stats').innerText()) === 'Show Stats');
await page.getByTestId('toggle-stats').click();
await page.getByTestId('recalc-stats').click();
await idle();
check('Recalculate keeps the statistics', (await statRows()) === 9);
await page.getByTestId('toggle-comp').click();
check('Show Compensation Nodes adds a compensation row per sample', (await page.locator('[data-testid=sample-table] tr.comp').count()) === 3);
await page.getByTestId('toggle-comp').click();

// --- Select All, Expand / Collapse Selection -----------------------------------
await page.getByTestId(`row-${F1}`).click();
await page.keyboard.press('Control+a');
const sampleRows = await page.locator('[data-testid=sample-table] tr.sample').count();
const nodeRows = await page.locator('[data-testid=sample-table] tr.fj-row:not(.stat)').count();
const marked = await page.locator('[data-testid=sample-table] tr.multi, [data-testid=sample-table] tr.sel').count();
check('Ctrl/Cmd+A selects every node', marked === nodeRows && sampleRows === 3, `${marked}/${nodeRows}`);
const rowsBefore = await page.locator('[data-testid=sample-table] tr').count();
await tab('Edit');
await page.getByTestId(`row-${FILES[0]}`).click();
await page.getByTestId(`row-${FILES[2]}`).click({ modifiers: ['Control'] });
await page.getByTestId('collapse-selection').click();
const rowsCollapsed = await page.locator('[data-testid=sample-table] tr').count();
await page.getByTestId('expand-selection').click();
check('Collapse Selection folds every selected sample; Expand Selection opens them', rowsCollapsed < rowsBefore - 4 && (await page.locator('[data-testid=sample-table] tr').count()) === rowsBefore, `${rowsBefore} -> ${rowsCollapsed}`);

// --- Booleans --------------------------------------------------------------------
await tab('Workspace');
await popRow(F1, 'CD3+').click();
await page.getByTestId('bool-identity').click();
await idle();
check('Identical Gate adds "CD3+=" beside CD3+', (await popRow(F1, 'CD3+=').count()) === 1);
const cd3 = (await popRow(F1, 'CD3+').locator('td').allInnerTexts())[2];
const same = (await popRow(F1, 'CD3+=').locator('td').allInnerTexts())[2];
check('the identical gate has the same count', cd3 === same && cd3 !== '', `${cd3} / ${same}`);
await popRow(F1, 'CD3+').click();
await popRow(F1, 'CD3+=').click({ modifiers: ['Control'] });
await page.getByRole('button', { name: 'AND', exact: true }).click();
await page.getByTestId('abbr-CD3+').fill('T');
await page.getByTestId('naming-ok').click();
await idle();
check('AND asks for abbreviations and names "T+ & CD3+="', (await popRow(F1, 'T+ & CD3+=+').count()) === 1);
await popRow(F1, 'CD3+').click();
await popRow(F1, 'CD3+=').click({ modifiers: ['Control'] });
const before = await page.locator(`[data-testid^="row-${F1}/"]`).count();
await page.getByTestId('bool-combo').click();
await page.getByTestId('abbr-CD3+').fill('');
await page.getByTestId('abbr-CD3+=').fill('R');
await page.getByTestId('naming-ok').click();
await idle();
check('Create Combination Gates adds 2 NOT and 4 AND nodes', (await page.locator(`[data-testid^="row-${F1}/"]`).count()) === before + 6 && (await popRow(F1, 'CD3+R-').count()) === 1, String((await page.locator(`[data-testid^="row-${F1}/"]`).count()) - before));
await popRow(F1, 'CD3+').click();
await page.getByTestId('bool-expr-open').click();
await page.getByTestId('bool-expr').fill('CD3+ and not');
check('the expression dialog reports a parse error', (await page.getByTestId('bool-expr-error').count()) === 1 && await page.getByTestId('bool-expr-ok').isDisabled());
await page.getByTestId('bool-expr').fill('(CD3+ and R-) or CD3+=');
await page.getByTestId('bool-expr-ok').click();
await idle();
const mixed = popRow(F1, 'CD3+R-+ or CD3+=+');
check('a mixed expression becomes FlowJo AND / OR nodes, reusing the equivalent AND node CD3+R-', (await mixed.count()) === 1, (await page.locator(`[data-testid^="row-${F1}/"]`).evaluateAll((r) => r.map((x) => x.dataset.testid.split('/').pop()))).join(','));
await mixed.click();
await page.getByTestId('bool-edit').click();
check('Edit boolean shows the gate as an expression', (await page.getByTestId('bool-expr').inputValue()).includes(' or '), await page.getByTestId('bool-expr').inputValue());
await page.getByTestId('bool-expr').fill('CD3+ and not CD3+=');
await page.getByTestId('bool-expr-ok').click();
await idle();
const edited = (await mixed.locator('td').allInnerTexts())[2];
check('the edited gate is recalculated (CD3+ and not itself = 0)', edited === '0', edited);

// --- keywords for the group ----------------------------------------------------
const tableOrder = await sampleOrder();
await page.getByTestId(`row-${tableOrder[0]}`).click();
await page.getByTestId('add-key-group').click();
await page.getByTestId('add-keyword-name').fill('Dose');
await page.getByTestId('add-keyword-ok').click();
check('Add Keyword to Group adds a Dose column', (await heads()).includes('Dose'));
await page.getByTestId('open-series').click();
await page.getByTestId('vs-keyword').fill('Dose');
await page.getByTestId('vs-start').fill('10');
await page.getByTestId('vs-inc').fill('5');
check('the series preview follows the rules', (await page.getByTestId('vs-preview').innerText()).includes('10, 15, 20'), await page.getByTestId('vs-preview').innerText());
await page.getByTestId('vs-ok').click();
const doses = await Promise.all(tableOrder.map((f) => page.getByTestId(`cell-${f}-Dose`).innerText()));
check('Create keyword value series fills the samples in table order', doses.join() === '10,15,20', doses.join());
await page.getByTestId(`cell-${tableOrder[1]}-Dose`).click({ button: 'right' });
await page.getByTestId('context-menu').getByRole('menuitem', { name: /Copy value to group/ }).click();
const doses2 = await Promise.all(FILES.map((f) => page.getByTestId(`cell-${f}-Dose`).innerText()));
check('Copy value to group sets the value in every member', doses2.join() === '15,15,15', doses2.join());
await page.getByTestId(`cell-${FILES[2]}-Dose`).dblclick();
await page.getByTestId('cell-editor').fill('99');
await page.getByTestId('cell-editor').press('Enter');
check('a keyword cell is edited in place', (await page.getByTestId(`cell-${FILES[2]}-Dose`).innerText()) === '99');

// --- Find: single Replace -------------------------------------------------------
await tab('File');
await page.getByTestId('open-find').click();
await page.getByTestId('find-what').fill('15');
await page.getByTestId('find-context').selectOption('Dose');
await page.getByTestId('find-results').locator('tbody tr').first().click();
await page.getByTestId('find-replace').fill('7');
await page.getByTestId('find-replace-one').click();
await page.keyboard.press('Escape');
const doses3 = await Promise.all(FILES.map((f) => page.getByTestId(`cell-${f}-Dose`).innerText()));
check('Replace changes only the selected result', doses3.filter((d) => d === '7').length === 1 && doses3.filter((d) => d === '15').length === 1, doses3.join());

// --- exports ----------------------------------------------------------------------
const xl = await download(() => page.getByTestId('export-excel').click());
check('Export to Excel writes an .xlsx workbook', xl.name.endsWith('.xlsx') && xl.bytes.subarray(0, 2).toString() === 'PK' && xl.bytes.includes('xl/worksheets/sheet1.xml') && xl.bytes.includes('>Depth<'), xl.name);
const tpl = await download(() => page.getByTestId('export-template').click());
const tj = JSON.parse(tpl.bytes.toString());
check('Export as Template writes a .wspt without samples', tpl.name.endsWith('.wspt') && tj.samples.length === 0 && tj.groups.length >= 1, tpl.name);
await popRow(F1, 'CD3+').click();
await popRow(F1, 'Singlets').click({ modifiers: ['Control'] });
await page.getByTestId('open-export').click();
await page.getByTestId('exp-mode-pops').check();
const pops = await download(() => page.getByTestId('export-csv').click());
check('Export Populations: one file per selected population, in one ZIP', pops.name.endsWith('.zip') && pops.bytes.includes('CD3_.csv') && pops.bytes.includes('Singlets.csv'), pops.name);
await page.getByTestId('exp-mode-group').check();
const grp = await download(() => page.getByTestId('export-fcs').click());
check('Export Group: the population of each group sample, one file each', grp.name.endsWith('.zip') && FILES.every((f) => grp.bytes.includes(f.replace('.fcs', ''))), grp.name);
await page.keyboard.press('Escape');
const arc = await download(() => page.getByTestId('save-archive').click());
await idle();
check('Save as Archive writes the workspace and the FCS files', arc.name.endsWith('.zip') && arc.bytes.includes('workspace.frea.json') && FILES.every((f) => arc.bytes.includes(`FCS/${f}`)), arc.name);

// --- Revert, Close, open archive and template -------------------------------------
await tab('Workspace');
await page.getByTestId(`row-${FILES[0]}`).click();
await page.getByTestId('add-key-group').click();
await page.getByTestId('add-keyword-name').fill('Later');
await page.getByTestId('add-keyword-ok').click();
await tab('File');
await page.getByTestId('revert-ws').click();
await answer('Revert');
check('Revert discards changes since the last save', !(await heads()).includes('Later') && (await heads()).includes('Dose'), (await heads()).join('|'));
await page.getByTestId('close-ws').click();
await answer('Close');
check('Close leaves an empty workspace', (await page.locator('[data-testid=sample-table] tr.sample').count()) === 0);
await page.getByTestId('open-ws').setInputFiles(join(out, arc.name));
await idle();
await page.waitForTimeout(500);
await idle();
const reopened = await page.getByTestId(`row-${F1}`).locator('td').allInnerTexts();
check('an archive opens with its data (no FCS files to add)', reopened[2] && reopened[2] !== '' && !reopened[0].includes('data missing'), reopened.join(' | '));
await page.getByTestId('open-ws').setInputFiles(join(out, tpl.name));
await answer('Open');
await page.getByTestId('add-fcs').setInputFiles([join(dir, 'fcs_files', F1)]);
await idle();
check('a template opens empty; added samples join its groups', (await page.locator('[data-testid=sample-table] tr.sample').count()) === 1 && (await heads()).includes('Dose'), (await heads()).join('|'));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await page.screenshot({ path: join(out, 'workspace-gaps.png') });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
