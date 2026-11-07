// FlowJo 10.6.2 table editor (TECommand) and generated table window
// (FJTableCommand) through the real UI (Chromium via Playwright):
// docs/validation/ui-gaps/tables.md.
// Usage: node e2e/tables-gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5182';
const out = join(root, 'test-results', 'e2e-tables');
mkdirSync(out, { recursive: true });
const fcs = (n) => join(root, 'fixtures/flowkit/data/8_color_data_set/fcs_files', n);
const F1 = '101_DEN084Y5_15_E03_009_clean.fcs';
const F2 = '101_DEN084Y5_15_E05_010_clean.fcs';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
await context.addInitScript(() => { if (!sessionStorage.getItem('fj-init')) { localStorage.setItem('flowjo-rea.separateWindows', '0'); sessionStorage.setItem('fj-init', '1'); } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const T = (id) => page.getByTestId(id);
const headers = async (id) => (await T(id).locator('thead th').allInnerTexts()).slice(1);
const rowCells = async (id, i) => T(`${id}-row-${i}`).locator('td').allInnerTexts();
const values = async (id = 'table-preview') => {
  const n = await T(id).locator('tbody tr').count();
  const r = []; for (let i = 0; i < n; i++) r.push(await rowCells(id, i)); return r;
};
const waitValues = async (col) => page.waitForFunction(([c]) => {
  const rows = [...document.querySelectorAll('[data-testid=table-preview] tbody tr')];
  return rows.length >= 2 && rows.slice(0, 2).every((tr) => { const td = tr.querySelectorAll('td')[c + 1]; return td && td.textContent !== 'NaN' && td.textContent !== ''; });
}, [col], { timeout: 120000 });
const addStat = async ({ pop, stat, channel, ancestor, name }) => {
  await T('table-add-column').click();
  if (pop !== undefined) await T('col-pop').selectOption(pop);
  await T('col-stat').selectOption(stat);
  if (channel !== undefined) await T('col-channel').selectOption(channel);
  if (ancestor !== undefined) await T('col-ancestor').selectOption(ancestor);
  if (name) await T('col-name').fill(name);
  await T('col-ok').click();
};

await page.goto(base + '?layout=classic');
await T('open-ws').setInputFiles(join(root, 'fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp'));
await idle();
await T('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
const statThBefore = await page.locator('[data-testid=stats-table] thead th').count();
await T('open-tables').click();
await T('table-new').click();
check('New table is named "Table" (doNamedTemplate)', (await T('table-select').locator('option:checked').innerText()) === 'Table');

// 1. statistics chosen in the table editor itself (no Statistics-panel column needed)
await T('table-add-column').click();
const pops = await T('col-pop').locator('option').allInnerTexts();
const cd3 = pops.find((x) => /CD3\+$/.test(x));
const chans = await T('col-channel').locator('option').allInnerTexts();
check('Population picker lists the gating tree paths', pops.length > 3 && !!cd3, pops.slice(0, 6).join(' | '));
await T('col-pop').selectOption(cd3);
await T('col-stat').selectOption('median');
await T('col-channel').selectOption(chans[1]);
await T('col-ok').click();
await addStat({ pop: cd3, stat: 'cv', channel: chans[1] });
const anc = cd3.split('/').slice(0, -1);
await T('table-add-column').click();
await T('col-pop').selectOption(cd3);
await T('col-stat').selectOption('freqOf');
check('Freq. of without an ancestor is refused', (await T('col-error').innerText()).includes('ancestor'));
const ancOpts = await T('col-ancestor').locator('option').allInnerTexts();
check('<Ancestor> picker lists the ancestors of the population', ancOpts[0] === '<Ancestor>' && ancOpts.slice(1).join('/') === anc.join('/'), ancOpts.join(' | '));
await T('col-ancestor').selectOption(anc[0]);
await T('col-ok').click();
await addStat({ pop: '', stat: 'count' });
await waitValues(0); await waitValues(1); await waitValues(3);
const h0 = await headers('table-preview');
check('Median, CV, Freq. of and Count columns added from the table editor', h0.length === 4 && h0[0].includes('Median') && h0[1].includes('CV') && h0[2].includes(`Freq. of ${anc[0]}`), h0.join(' | '));
const v0 = await values();
check('statistic values are computed live for both samples', v0.length >= 2 && v0.slice(0, 2).every((r) => Number(r[1]) > 0 && Number(r[2]) > 0 && Number(r[4]) > 0), JSON.stringify(v0));
check('the Statistics panel did not need (or get) columns', (await page.locator('[data-testid=stats-table] thead th').count()) === statThBefore);

// Edit Column
await T('table-col-0').click();
await T('table-edit-column').click();
check('Edit Column opens with the column\'s statistic', (await T('col-stat').inputValue()) === 'median' && (await T('col-pop').inputValue()) === cd3);
await T('col-stat').selectOption('mean');
await T('col-name').fill('My mean');
await T('col-ok').click();
await page.waitForTimeout(300); await waitValues(0);
const v1 = await values();
check('Edit Column changes the statistic and the header name', (await headers('table-preview'))[0] === 'My mean' && v1[0][1] !== v0[0][1], `${v0[0][1]} -> ${v1[0][1]}`);

// Create Column Names
await T('table-col-names').click();
await T('table-naming-token').selectOption('Last Population Name');
await T('table-naming-template').fill(`${await T('table-naming-template').inputValue()} `);
await T('table-naming-token').selectOption('Statistic');
const prev = await T('table-naming-preview').innerText();
await T('table-naming-ok').click();
const h1 = await headers('table-preview');
check('Create Column Names renames every statistic column from the template', prev === 'CD3+ Mean' && h1[0] === 'CD3+ Mean' && h1[1] === 'CD3+ CV (%)' && h1[3] === 'Count', `${prev} / ${h1.join(' | ')}`);

// Select All / Clear on columns (keyword column then removed)
const fileKw = (await T('table-kw-popup').locator('option').allInnerTexts())[1];
await T('table-kw-popup').selectOption(fileKw);
check('Keywords popup adds a keyword column', (await headers('table-preview'))[4] === fileKw, fileKw);
await T('table-parmkw-popup').selectOption('$P1N');
check('Parameter keyword popup adds a $PnX column', (await headers('table-preview'))[5] === '$P1N');
await T('table-select-all').click();
check('Select All selects every column', (await T('table-columns').locator('tbody tr.sel').count()) === 6);
await T('table-col-5').click();
await T('table-clear').click();
check('Clear asks "Do you want to delete this column from resultant tables?"', (await T('question').innerText()).includes('Do you want to delete this column from resultant tables?'));
await T('answer-Delete').click();
check('Clear removes the selected column', (await headers('table-preview')).length === 5);

// Duplicate
await T('table-duplicate').click();
const opts = await T('table-select').locator('option').allInnerTexts();
check('Duplicate makes "Table-1" with the same columns', opts.includes('Table-1') && (await headers('table-preview')).length === 5, opts.join(' | '));
await T('table-select').selectOption({ label: 'Table' });
await waitValues(0); await waitValues(1); await waitValues(2);

// Formatting in the preview
await T('table-col-0').click();
await T('table-format-heat').click();
await page.waitForTimeout(300);
const bg = await T('table-preview-row-0').locator('td').nth(1).evaluate((e) => getComputedStyle(e).backgroundColor);
const bg1 = await T('table-preview-row-1').locator('td').nth(1).evaluate((e) => getComputedStyle(e).backgroundColor);
check('Heat Map colours the preview (blue to yellow)', [bg, bg1].sort().join('|') === 'rgb(0, 0, 255)|rgb(255, 255, 0)', `${bg} / ${bg1}`);
await T('table-col-1').click();
await T('table-format-range').click();
await T('table-range-min').fill('-1');
await T('table-range-max').fill('0');
await page.waitForTimeout(300);
const arrows = await T('table-preview').locator('td[data-arrow=up]').count();
check('Expected Range marks values above max with an up arrow (cyan / yellow)', arrows === 2, String(arrows));
await T('table-col-3').click();
await T('table-format-stdev').click();
await page.waitForTimeout(300);
const fw = await T('table-preview-row-0').locator('td').nth(4).evaluate((e) => getComputedStyle(e).fontStyle);
check('Standard Deviation formats outliers (two rows: each 0.71 SD off the mean: italic)', fw === 'italic', fw);
await T('table-summary').check();
check('Show Summary Stats adds Mean and Std. Deviation rows (3 samples, one not loaded)', (await T('table-preview').locator('tbody tr').count()) === 5);

// 2. generated table window
await T('table-dest').selectOption('DISPLAY');
await T('table-create').click();
check('Create Table (Display) shows the table window with live values', (await T('table-window').count()) === 1 && (await T('tw-table').locator('tbody tr').count()) === 5);
await T('tw-select-all').click();
check('Select All selects all data rows', (await T('tw-table').locator('tbody tr.sel').count()) === 3);
await T('tw-select-none').click();
check('Select None clears the selection', (await T('tw-table').locator('tbody tr.sel').count()) === 0);
await T('tw-find').click();
check('Find asks "Please enter the text to find in the table:"', (await T('tw-find-prompt').innerText()).includes('Please enter the text to find in the table:'));
await T('tw-find-text').fill('E05');
await T('tw-find-ok').click();
const selRow = await T('tw-table').locator('tbody tr.sel td').first().innerText();
check('Find selects the rows that contain the text', (await T('tw-table').locator('tbody tr.sel').count()) === 1 && selRow === F2, selRow);
await T('tw-copy').click(); await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText());
check('Copy Table to Clipboard: tab-delimited text starting "Sample:"', clip.startsWith('Sample:\t') && clip.includes(F1), clip.slice(0, 80));
await T('tw-copy-html').click(); await page.waitForTimeout(300);
const clip2 = await page.evaluate(() => navigator.clipboard.readText());
check('Copy As HTML: the HTML table as text', clip2.startsWith('<h1>Table</h1>') && clip2.includes('<table'), clip2.slice(0, 60));
await T('tw-group').click();
check('Create Group asks "What is the group named?" with "My group"', (await T('tw-group-prompt').innerText()).includes('What is the group named?') && (await T('tw-group-name').inputValue()) === 'My group');
await T('tw-group-ok').click();
const ws1 = await page.evaluate(() => document.body.innerText);
check('Create Group from Selection adds the group', ws1.includes('My group'));
await T('tw-delete').click();
check('Delete Selected Rows asks "Remove the selected row from the tables?"', (await T('question').innerText()).includes('Remove the selected row from the tables?'));
await T('answer-Remove').click();
check('Delete Selected Rows removes the row and recalculates the summary', (await T('tw-table').locator('tbody tr').count()) === 4 && (await rowCells('tw-table', 2))[0] === 'Mean' && (await rowCells('tw-table', 2))[1] === (await rowCells('tw-table', 0))[1]);

// 3. outputs
await T('table-dest').selectOption('FILE');
await T('table-format').selectOption('XML_EXCEL');
const [dl] = await Promise.all([page.waitForEvent('download'), T('table-create').click()]);
const xml = readFileSync(await dl.path(), 'utf8');
check('To File, XML Excel: a SpreadsheetML .xml workbook', dl.suggestedFilename() === 'Table.xml' && xml.includes('urn:schemas-microsoft-com:office:spreadsheet') && xml.includes(F1), dl.suggestedFilename());
await T('table-dest').selectOption('CLIPBOARD');
await page.evaluate(() => navigator.clipboard.writeText('x'));
await T('table-create').click(); await page.waitForTimeout(300);
check('To Clipboard copies the table', (await page.evaluate(() => navigator.clipboard.readText())).startsWith('Sample:\t'));
await T('table-headfoot').click();
await T('table-hf-header').fill('Run 42 header');
await T('table-hf-footer').fill('page footer');
await T('table-hf-ok').click();
await T('table-dest').selectOption('PRINT');
const [popup] = await Promise.all([page.waitForEvent('popup'), T('table-create').click()]);
await popup.waitForLoadState();
const ptxt = await popup.evaluate(() => document.body.innerText);
check('To Printer opens a print page with the header and footer', ptxt.includes('Run 42 header') && ptxt.includes('page footer') && ptxt.includes(F1));
await popup.close();
const layBefore = await T('open-layout').innerText();
await T('table-dest').selectOption('LAYOUT');
await T('table-create').click();
const layAfter = await T('open-layout').innerText();
check('Batch To Current Layout adds a (static) table to the layout', layBefore !== layAfter, `${layBefore} -> ${layAfter}`);

// 4. plots
await T('table-col-0').click();
await T('table-col-1').click({ modifiers: ['Control'] });
await T('table-plot-corr').click();
const info = await T('table-plot-info').innerText();
check('Correlation plot with R, slope and intercept', (await T('table-plot').getAttribute('data-kind')) === 'corr' && /R: .*Slope: .*Intercept: /.test(info) && (await T('regression-line').count()) === 1, info);
await T('table-plot-transpose').click();
const info2 = await T('table-plot-info').innerText();
check('Transpose Axes swaps x and y', info2 !== info, info2);
const [svg] = await Promise.all([page.waitForEvent('download'), T('table-plot-save').click()]);
check('Save as... writes the plot as SVG', svg.suggestedFilename().endsWith('.svg'));
await T('table-plot-box').click();
check('Box-n-Whisker plot: one box per selected column', (await T('table-plot').getAttribute('data-kind')) === 'box' && (await page.locator('[data-testid^=box-]').count()) === 2);
await T('table-plot-time').click();
check('Time Series plot: one series per selected column', (await T('table-plot').getAttribute('data-kind')) === 'time' && (await page.locator('[data-testid^=series-]').count()) === 2, await T('table-plot-info').innerText());

// Open Selected Samples (last: it closes the editor)
await T('table-dest').selectOption('DISPLAY');
await T('table-create').click();
await T('tw-table-row-0').click();
await T('tw-open').click();
await idle();
const sCls = await T(`sample-${F1}`).getAttribute('class'), pCls = await T('pop-CD3+').getAttribute('class');
check('Open Selected Samples opens the sample on the first column\'s population (classic layout: selects it)', (await T('tables-dialog').count()) === 0 && sCls.includes('sel') && pCls.includes('sel'), `${sCls} / ${pCls}`);

check('no uncaught page errors', errors.length === 0, errors.join('; '));
await page.screenshot({ path: join(out, 'end.png') });
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
