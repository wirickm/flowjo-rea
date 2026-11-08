// Layout editor follow-up gaps (docs/validation/ui-gaps/layout.md section 7
// and 3.3, 6.5, 6.8): statistic and difference tables, plate display, web page
// figure, legend Properties and Set As Control, Overlay Mode, help links,
// Append Output, ribbon customisation, table-editor tables and Copy To New
// Layout from the matrix editor.
// Usage: node e2e/followup-layout.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5195';
const out = join(root, 'test-results', 'e2e-followup-layout');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Minimal FCS 3.1 writer (float32 list mode), as in e2e/platforms-gaps.mjs.
const fcsBytes = (file, names, ranges, rows, extra) => {
  const buf = Buffer.alloc(rows.length * names.length * 4);
  rows.forEach((row, e) => row.forEach((v, c) => buf.writeFloatLE(v, (e * names.length + c) * 4)));
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(rows.length), $NEXTDATA: '0', $FIL: file, ...extra };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: String(ranges[i]), [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  return Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]);
};
// Two wells: FL1 centred on 200 (A1) and 600 (B2).
const mk = (shift) => Array.from({ length: 4000 }, (_, i) => [400 + ((i * 37) % 100), 400 + ((i * 53) % 100), shift + ((i * 7919) % 600) - 300, (i * 13) % 1000]);
const P = ['FSC-A', 'SSC-A', 'FL1-A', 'FL2-A'], R = [1024, 1024, 1024, 1024];
writeFileSync(join(out, 'a.fcs'), fcsBytes('a.fcs', P, R, mk(200), { 'WELL ID': 'A01', Donor: 'D1' }));
writeFileSync(join(out, 'b.fcs'), fcsBytes('b.fcs', P, R, mk(600), { 'WELL ID': 'B02', Donor: 'D2' }));

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1800, height: 1200 }, acceptDownloads: true });
await context.addInitScript(() => { localStorage.setItem('flowjo-rea.separateWindows', '0'); });
// Help pages are FlowJo's online documentation: answer them locally.
const opened = [];
await context.route('http://docs.flowjo.com/**', (r) => { opened.push(r.request().url()); r.fulfill({ status: 200, contentType: 'text/html', body: '<p>help</p>' }); });
await context.route('http://www.flowjo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<h1>FlowJo</h1>' }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/clipboard|ERR_|Failed to load resource/i.test(m.text()) && errors.push(m.text()));
let promptAnswer = null;
page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? (promptAnswer ?? d.defaultValue()) : undefined));
const T = (id) => page.getByTestId(id);
const idle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const card = (kind) => page.locator(`[data-testid=layout-card][data-kind=${kind}]`).last();
const cells = async (kind) => JSON.parse((await card(kind).getAttribute('data-cells')) ?? '[]');
const waitCells = (kind, fn) => page.waitForFunction(([k, f]) => { const c = [...document.querySelectorAll(`[data-testid=layout-card][data-kind=${k}]`)].pop(); if (!c?.dataset.cells) return false; return new Function('c', `return ${f}`)(JSON.parse(c.dataset.cells)); }, [kind, fn], { timeout: 60000 }).catch(() => {});
const pick = async (loc) => { await loc.dispatchEvent('mousedown', { bubbles: true }); await loc.dispatchEvent('mouseup', { bubbles: true }); await page.waitForTimeout(150); };
const download = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); return readFileSync(await d.path()); };
const pdfPages = (buf) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await T('add-fcs').setInputFiles([join(out, 'a.fcs'), join(out, 'b.fcs')]);
await idle();
await T('sample-a.fcs').click();
await idle();
// A statistics column (the plate's statistic): Mean of FL1-A of all events.
await T('stat-kind').selectOption('mean');
await T('stat-channel').selectOption('FL1-A');
await T('add-stat').click();
await idle();

// --- table editor: Batch To Current Layout places a table figure
await T('open-tables').click();
await T('table-new').click();
await T('table-add-column').click();
await T('col-stat').selectOption('count');
await T('col-ok').click();
await page.waitForFunction(() => { const td = document.querySelector('[data-testid=table-preview] tbody tr td:nth-child(2)'); return td && td.textContent !== 'NaN' && td.textContent !== ''; }, null, { timeout: 60000 }).catch(() => {});
await T('table-dest').selectOption('LAYOUT');
await page.waitForFunction(() => { const td = document.querySelector('[data-testid=table-preview] tbody tr td:nth-child(2)'); return td && td.textContent !== 'NaN' && td.textContent !== ''; }, null, { timeout: 60000 }).catch(() => {});
await T('table-create').click();
await T('tables-close').click();
await T('open-layout').click();
await page.waitForTimeout(500);
const te = await cells('tetable').catch(() => []);
check('Batch To Current Layout adds a table figure (TETable) with the header and rows', te[0]?.[0] === 'Sample' && te.length === 3 && te.some((r) => r[0] === 'a.fcs' && r[1] === '4000'), JSON.stringify(te));
await pick(card('tetable'));
check('the table figure says it is not live', (await page.locator('.layout-selrow').innerText()).includes('not live'));
await T('layout-remove').click();

// --- statistic table
await T('layout-add-stattable').click();
await waitCells('stattable', 'c.length === 1');
let st = await cells('stattable');
check('a new Statistic Table has the columns Subset Name with Gating Path and Count', JSON.stringify(st[0]) === JSON.stringify(['Subset Name with Gating Path', 'Count']), JSON.stringify(st));
await T('stattable-row-sample').selectOption({ label: 'a.fcs' });
await T('stattable-add-row').click();
await T('stattable-row-sample').selectOption({ label: 'b.fcs' });
await T('stattable-add-row').click();
await T('stattable-stat-kind').selectOption('mean');
await T('stattable-stat-channel').selectOption('FL1-A');
await T('stattable-add-stat').click();
await waitCells('stattable', "c.length === 3 && c[0].length === 3 && c[1][2] !== '-'");
st = await cells('stattable');
check('rows show the sample name, its count and the added Mean (FL1-A)', st[1]?.[0] === 'a.fcs' && st[1]?.[1] === '4000' && st[0]?.[2] === 'Mean (FL1-A)' && Number(st[2]?.[2]) > Number(st[1]?.[2]), JSON.stringify(st));
await T('stattable-add-column').selectOption({ label: 'Sample Name' });
await T('stattable-add-keyword').selectOption('DONOR').catch(async () => T('stattable-add-keyword').selectOption('Donor'));
await waitCells('stattable', 'c[0].length === 5');
st = await cells('stattable');
check('Add Column (Sample Name) and Add Keyword (Donor) add columns', st[0]?.[3] === 'Sample Name' && st[1]?.[4] === 'D1' && st[2]?.[4] === 'D2', JSON.stringify(st));
await T('stattable-col-list').selectOption({ index: 3 });
await T('stattable-range-min').fill('0');
await T('stattable-range-max').fill('300');
await page.waitForTimeout(300);
check('Range sets an expected range on the selected statistic column', (await T('stattable-col-list').locator('option').nth(3).innerText()).includes('[0..300]'));
await T('stattable-headers').uncheck();
await waitCells('stattable', 'c.length === 2');
check('Show Column Headers off drops the header row', (await cells('stattable')).length === 2);
await T('stattable-headers').check();
// Iteration: control row stays, the other follows the iteration sample.
await T('stattable-row-control').first().check();
await T('stattable-iterate').check();
await T('layout-iter').selectOption('SAMPLE');
await T('layout-sample').selectOption({ label: 'b.fcs' });
await waitCells('stattable', "c[1][0] === 'a.fcs' && c[2][0] === 'b.fcs'");
st = await cells('stattable');
check('Enable Iteration moves non-control rows to the iteration sample; a control row stays', st[1]?.[0] === 'a.fcs' && st[2]?.[0] === 'b.fcs', JSON.stringify(st.map((r) => r[0])));
await T('stattable-row-control').first().uncheck();
await T('layout-sample').selectOption({ label: 'b.fcs' });
await waitCells('stattable', "c[1][0] === 'b.fcs'");
check('without the control both rows show the iteration sample', (await cells('stattable'))[1]?.[0] === 'b.fcs');
await T('layout-iter').selectOption('OFF');

// --- difference table
await T('layout-add-difftable').click();
await waitCells('difftable', 'c.length === 0');
await T('difftable-row-sample').selectOption({ label: 'b.fcs' });
await T('difftable-add-row').click();
await T('difftable-stat-kind').selectOption('mean');
await T('difftable-stat-channel').selectOption('FL1-A');
await T('difftable-add-stat').click();
await waitCells('difftable', 'c.length === 1');
check('without a control sample the cells say <No control sample>', (await cells('difftable'))[0]?.[1] === '<No control sample>', JSON.stringify(await cells('difftable')));
await T('difftable-control').selectOption({ label: 'a.fcs' });
await waitCells('difftable', "c[0][1] === '0'");
await waitCells('difftable', "Number(c[0][2]) > 300");
const dt = await cells('difftable');
check('Difference Table: row minus control (count 0, mean FL1 about +400)', dt[0]?.[1] === '0' && Number(dt[0]?.[2]) > 300 && Number(dt[0]?.[2]) < 500, JSON.stringify(dt));

// --- plate
await T('layout-add-plate').click();
await page.waitForTimeout(400);
check('an empty plate asks for statistics (no group, no data)', (await card('plate').getAttribute('data-wells')) === '[]');
await T('plate-add-stat').selectOption({ index: 1 });
await page.waitForFunction(() => { const c = [...document.querySelectorAll('[data-testid=layout-card][data-kind=plate]')].pop(); return c && JSON.parse(c.dataset.wells || '[]').length === 2 && JSON.parse(c.dataset.wells).every((w) => w.c1); }, null, { timeout: 60000 }).catch(() => {});
let wells = JSON.parse(await card('plate').getAttribute('data-wells'));
const A1 = wells.find((w) => w.r === 0 && w.c === 0), B2 = wells.find((w) => w.r === 1 && w.c === 1);
check('dropping a statistic takes the current group and lays wells out by WELL ID', wells.length === 2 && !!A1 && !!B2, JSON.stringify(wells));
check('Heatmap: lowest well blue, highest yellow (AUTO range)', A1?.c1 === 'rgb(0,0,255)' && B2?.c1 === 'rgb(255,255,0)', `${A1?.c1} ${B2?.c1}`);
let lines = JSON.parse(await card('plate').getAttribute('data-lines'));
check('the annotation names the group, statistic, target and range', lines[0] === 'Sample Group: All Samples' && lines.some((l) => l.includes('displayed as Heatmap = heatmap range')), JSON.stringify(lines));
await T('plate-stat-target').selectOption('HEATMAP2');
await page.waitForTimeout(800);
wells = JSON.parse(await card('plate').getAttribute('data-wells'));
check('Display As Heatmap Upper Half colours the split triangle', wells.every((w) => !w.c1 && w.c2), JSON.stringify(wells));
await T('plate-stat-range').selectOption('EXPECTED_RANGE');
await T('plate-stat-min').fill('0');
await T('plate-stat-max').fill('1000');
await page.waitForTimeout(800);
lines = JSON.parse(await card('plate').getAttribute('data-lines'));
check('Statistic Heatmapping Range: Expected Range 0 - 1000', lines.some((l) => l.includes('heatmap range 0 - 1000')), JSON.stringify(lines));
await T('plate-show-sample').check();
await T('plate-mode').selectOption('CHERNOFF_FACE');
await T('plate-stat-target').selectOption('CHERNOFF_MOUTH');
await page.waitForTimeout(800);
wells = JSON.parse(await card('plate').getAttribute('data-wells'));
check('Display Type Chernoff Face draws a face in each well', wells.every((w) => w.face), JSON.stringify(wells));
await page.screenshot({ path: join(out, 'followup-objects.png') });
await T('plate-mode').selectOption('HEATMAP');
await T('plate-remove-unused').click();
check('Remove Unused drops statistics not shown in this mode', (await T('plate-stat').count()) === 0);
await T('plate-add-stat').selectOption({ index: 1 });
await T('plate-stat-remove').click();
check('Delete Statistic removes it', (await T('plate-stat').count()) === 0);
await T('plate-refresh').click();

// --- web page figure
promptAnswer = 'http://www.flowjo.com/';
await T('layout-add-web').click();
await page.waitForTimeout(300);
check('Web Page adds a live page figure', (await T('layout-web-frame').last().getAttribute('src')) === 'http://www.flowjo.com/');
promptAnswer = 'http://www.flowjo.com/other';
await T('web-navigate').click();
await page.waitForTimeout(300);
check('Navigate To... changes the page', (await T('layout-web-frame').last().getAttribute('src')) === 'http://www.flowjo.com/other');
await T('web-editing').check();
const cover = T('layout-web-cover').last();
const cb = await cover.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.mouse.wheel(0, 100);
await page.waitForTimeout(300);
check('the mouse wheel zooms while editing inside (1 + 0.1)', (await T('web-zoom').innerText()) === '110%', await T('web-zoom').innerText());
await page.mouse.down(); await page.mouse.move(cb.x + cb.width / 2 + 30, cb.y + cb.height / 2 + 20, { steps: 4 }); await page.mouse.up();
await page.waitForTimeout(300);
check('dragging pans the page', (await T('layout-web').last().getAttribute('data-offset')) !== '0,0', await T('layout-web').last().getAttribute('data-offset'));
await T('web-reset-zoom').click();
await T('web-reset-position').click();
await page.waitForTimeout(300);
check('Reset Zoom and Reset Position', (await T('web-zoom').innerText()) === '100%' && (await T('layout-web').last().getAttribute('data-offset')) === '0,0');
await T('web-reload').click();
check('Reload Page keeps the figure', (await T('layout-web-frame').count()) === 1);
const png = await download(() => T('layout-export').click());
check('exports draw the web page as a placeholder (PNG made)', png.length > 1000);

// --- help links
const helpPopup = async (fn) => { const [pp] = await Promise.all([context.waitForEvent('page'), fn()]); await pp.waitForLoadState().catch(() => {}); const u = pp.url(); await pp.close(); return u; };
await T('layout-add-text').click();
const fjml = await helpPopup(() => T('layout-fjml-help').click());
check('FJML help opens FlowJo\'s le-fjml page', fjml === 'http://docs.flowjo.com/d2/graphical-reports/equations-statistics-and-tables/le-fjml/', fjml);
await T('layout-remove').click();

// --- ribbon customisation
check('the default ribbon has five rows', (await page.locator('[data-testid^=layout-task-]').count()) === 5);
await T('layout-ribbon-config').click();
const editRow = T('ribbon-task-EDIT');
await editRow.locator('[data-band=SELECT] [data-testid=ribbon-band-remove]').click();
check('removing a band hides it', (await T('layout-band-SELECT').count()) === 0 && (await T('layout-select-all').count()) === 0);
await T('ribbon-add-EDIT').selectOption('CLIPBOARD');
check('adding a band a row already has is refused', (await T('ribbon-message').innerText()).includes('already exists'));
await T('ribbon-add-FILE').selectOption('SELECT');
check('a band can be added to another row', (await T('layout-task-FILE').locator('[data-testid=layout-band-SELECT]').count()) === 1);
const goRow = T('ribbon-task-FILE');
await goRow.locator('[data-band=SELECT] [data-testid=ribbon-band-left]').click();
const fileBands = await T('layout-task-FILE').locator('.layout-band').evaluateAll((e) => e.map((x) => x.dataset.testid));
check('swapping moves a band left', fileBands.join(',') === 'layout-band-DOCUMENT,layout-band-SELECT,layout-band-GO', fileBands.join(','));
for (const b of ['GO', 'SELECT']) await goRow.locator(`[data-band=${b}] [data-testid=ribbon-band-remove]`).click();
await goRow.locator('[data-band=DOCUMENT] [data-testid=ribbon-band-remove]').click();
check('the last band of a row cannot be removed', (await T('ribbon-message').innerText()).includes('last band'));
const saved = await page.evaluate(() => localStorage.getItem('flowjo-rea.layoutRibbon'));
check('the ribbon is kept with the preferences', !!saved && JSON.parse(saved).FILE.join() === 'DOCUMENT');
await T('layout-ribbon-default').click();
check('Apply Default Ribbons restores the default rows', (await T('layout-task-EDIT').locator('[data-testid=layout-band-SELECT]').count()) === 1 && (await page.evaluate(() => localStorage.getItem('flowjo-rea.layoutRibbon'))) === null);
await T('ribbon-close').click();

// --- Overlay Mode
await T('layout-overlay-mode').selectOption('modal');
check('Overlay Mode is a preference', (await page.evaluate(() => localStorage.getItem('flowjo-rea.overlayMode'))) === 'modal');

// --- Append Output: two PDF batches into one file
for (const c of await page.locator('[data-testid=layout-card]').all()) void c;
await T('layout-iter').selectOption('SAMPLE');
await T('layout-batch-format').selectOption('pdf');
await T('layout-tiles').fill('2');
const first = await download(() => T('layout-batch').click());
await T('layout-append').check();
const second = await download(() => T('layout-batch').click());
check('Append Output adds the batch pages to the earlier PDF of the same name', pdfPages(second) === 2 * pdfPages(first) && pdfPages(first) > 0, `${pdfPages(first)} -> ${pdfPages(second)}`);
await T('layout-append').uncheck();
await T('layout-tiles').fill('0');
await T('layout-iter').selectOption('OFF');
await page.getByRole('dialog', { name: 'Layout editor' }).getByRole('button', { name: 'Close', exact: true }).click();

// --- chart: legend Properties, Set As Control, Help
await T('add-to-layout').click();
await T('open-layout').click();
await page.waitForTimeout(500);
await pick(card('chart'));
await T('layout-legend-props').click();
check('Legend Properties lists the legend columns (Sample Name, Subset Name, Count)', (await T('legend-columns-label').innerText()) === 'Sample Name | Subset Name | Count');
await T('legend-show').uncheck();
check('Show Legend off turns the chart legend off', !(await T('layout-legend').isChecked()));
await T('legend-close').click();
const gd = await helpPopup(() => T('layout-chart-help').click());
check('chart Help opens the graph definition page', gd.endsWith('graph-options-and-annotation/le-graphdef/'), gd);
await page.getByRole('dialog', { name: 'Layout editor' }).getByRole('button', { name: 'Close', exact: true }).click();

// --- Copy To New Layout from the matrix editor
await T('open-comp').click();
await T('comp-identity').click();
await T('comp-identity-create').click();
await T('comp-copy-layout').click();
await page.waitForTimeout(800);
check('Copy To New Layout opens a new layout "Comp-<group>"', (await T('layout-list').locator('option:checked').innerText()) === 'Comp-All Samples', await T('layout-list').locator('option:checked').innerText().catch(() => ''));
const n = await page.locator('[data-testid=layout-card][data-kind=chart]').count();
check('the new layout holds the preview grid (N x N charts)', n === 4, String(n));
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length >= 4, null, { timeout: 60000 }).catch(() => {});
check('the copied charts render', (await page.locator('[data-testid=layout-card] img').count()) >= 4);
await page.screenshot({ path: join(out, 'followup-layout.png') });

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
