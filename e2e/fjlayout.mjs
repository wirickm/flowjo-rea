// FlowJo-style workspace window (specs 23): ribbon tabs, group table above the
// sample tree-table (Name / Statistic / #Cells), graph windows per node.
// Usage: node e2e/fjlayout.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e');
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
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const at = async (fx, fy) => { const b = await page.getByTestId('plot-canvas').boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };
const cells = async (testid) => page.getByTestId(testid).locator('td').allInnerTexts();

await page.goto(base);
check('the FlowJo layout is the default: ribbon tabs and the sample table', (await page.getByTestId('ribbon-tab-Workspace').count()) === 1 && (await page.getByTestId('sample-table').count()) === 1);
const heads = await page.getByTestId('sample-table').locator('thead th').allInnerTexts();
check('the sample table has the columns Name, Statistic, #Cells', heads.join('|') === 'Name|Statistic|#Cells', heads.join('|'));
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
const g = await page.getByTestId('group-table').locator('thead th').allInnerTexts();
const all = await page.getByTestId('grow-All Samples').locator('td').allInnerTexts();
check('the group pane is a table: Group, Role, Size', g.join('|') === 'Group|Role|Size' && all[2] === '2', `${g.join('|')} / ${all.join('|')}`);
const r1 = await cells(`row-${F1}`);
check('each sample is a row with its event count', r1[0].includes(F1) && r1[2] === '283,969', r1.join(' | '));

// Double-click a sample: a graph window opens with the plot
await page.getByTestId(`row-${F1}`).dblclick({ position: { x: 40, y: 6 } });
await idle();
check('double-clicking a sample opens its graph window', (await page.getByTestId('graph-window').count()) === 1 && (await page.getByTestId('plot-canvas').count()) === 1);

// Gate in the window; the population appears under the sample with its frequency
await page.getByTestId('tool-rect').click();
const [x0, y0] = await at(0.2, 0.05); const [x1, y1] = await at(0.75, 0.38);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
const pr = await cells(`row-${F1}/Rect 1`);
check('the new population is a row under the sample: Statistic = freq. of parent, #Cells = count', /^\d+(\.\d+)?$/.test(pr[1]) && Number(pr[2].replace(/,/g, '')) > 1000, pr.join(' | '));

// Double-click the population: a second window; the first keeps a picture
await page.getByTestId(`row-${F1}/Rect 1`).dblclick({ position: { x: 40, y: 6 } });
await idle();
check('double-clicking a population opens a second graph window; the other shows its last view', (await page.getByTestId('graph-window').count()) === 2 && (await page.getByTestId('gw-snapshot').count()) === 1);
const title = await page.locator('[data-testid=graph-window][data-active="1"] .fj-gw-title span').first().innerText();
check('the active window is titled sample: gating path', title === `${F1}: Rect 1`, title);

// Duplicate View
await page.locator('[data-testid=graph-window][data-active="1"]').getByTestId('gw-duplicate').click();
await idle();
check('Duplicate View opens another window for the same population', (await page.getByTestId('graph-window').count()) === 3);

// Single click in the table selects without moving a window
await page.getByTestId(`row-${F2}`).click({ position: { x: 40, y: 6 } });
await idle();
check('a single click in the table selects; no window follows it', (await page.locator('[data-testid=graph-window][data-active="1"]').count()) === 0 && (await page.getByTestId(`row-${F2}`).getAttribute('class')).includes('sel'));

// Clicking a window brings it back to life
await page.locator('[data-testid=graph-window]').first().click({ position: { x: 200, y: 8 } });
await idle();
check('clicking a window makes it the live one again', (await page.locator('[data-testid=graph-window][data-active="1"]').count()) === 1 && (await page.getByTestId('plot-canvas').count()) === 1);

// Ribbon: Workspace tab hosts the population commands
await page.getByTestId(`row-${F1}/Rect 1`).click({ position: { x: 40, y: 6 } });
await page.getByTestId('ribbon-tab-Workspace').click();
check('the Workspace tab holds the population commands', (await page.getByTestId('ribbon-panel').getByTestId('gate-copy').count()) === 1);
await page.getByTestId('ribbon-tab-Edit').click();
await page.getByTestId('collapse-all').click();
await idle();
check('Edit > Collapse All collapses samples and populations', (await page.getByTestId(`row-${F1}/Rect 1`).count()) === 0);
await page.getByTestId('expand-all').click();
await idle();
check('Edit > Expand All shows them again', (await page.getByTestId(`row-${F1}/Rect 1`).count()) === 1);

// Close windows; close button removes one
const before = await page.getByTestId('graph-window').count();
await page.getByTestId('gw-close').first().click();
check('a window closes with its x', (await page.getByTestId('graph-window').count()) === before - 1);
await page.screenshot({ path: join(out, 'fj-layout.png') });

// Classic layout switch
await page.getByTestId('ribbon-tab-Configure').click();
await page.getByTestId('layout-classic').click();
await page.waitForTimeout(300);
check('Configure switches to the classic four-panel layout', (await page.getByTestId('pop-root').count()) === 1 && (await page.getByTestId('sample-table').count()) === 0);
await page.getByTestId('layout-flowjo').click();
await page.waitForTimeout(300);
check('and back to the FlowJo layout', (await page.getByTestId('sample-table').count()) === 1);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
