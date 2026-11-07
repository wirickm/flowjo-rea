// Uncompensated parameters, layout grid figure with border axes, multigraph (specs 25).
// Usage: node e2e/remaining.mjs [baseUrl]
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
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const pick = async (loc, shift = false) => { await loc.dispatchEvent('mousedown', { bubbles: true, shiftKey: shift }); await loc.dispatchEvent('mouseup', { bubbles: true }); await page.waitForTimeout(100); };

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();

// Uncompensated parameters
await page.getByTestId('display-menu').locator('summary').click();
await page.getByTestId('display-uncomp').check();
await idle();
const opts = await page.getByTestId('x-channel').locator('option').allTextContents();
const twin = opts.find((o) => o.endsWith(' (uncompensated)'));
check('Show Uncompensated Parameters adds raw twins of the compensated parameters', !!twin && !opts.some((o) => /^(FSC|SSC)-.* \(uncompensated\)$/.test(o)), twin ?? opts.slice(-3).join(', '));
await page.getByTestId('x-channel').selectOption('CD4 PE-Cy7 FLR-A (uncompensated)');
await idle();
check('a plot on an uncompensated twin draws', (await page.getByTestId('plot-caption').textContent()).includes('283,969'));
await page.getByTestId('x-channel').selectOption('FSC-A');
await idle();

// Three graphs into the layout
for (const y of ['SSC-A', 'CD4 PE-Cy7 FLR-A', 'CD3 APC-H7 FLR-A']) {
  await page.getByTestId('y-channel').selectOption(y);
  await idle();
  await page.getByTestId('add-to-layout').click();
}
await page.getByTestId('open-layout').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length === 3, null, { timeout: 60000 });
const cards = page.getByTestId('layout-card');
await pick(cards.nth(0)); await pick(cards.nth(1), true); await pick(cards.nth(2), true);
await page.getByTestId('layout-grid').click();
await page.waitForTimeout(800);
const info = await cards.evaluateAll((els) => els.map((e) => ({ g: e.dataset.group, b: e.dataset.box })));
const grouped = info.every((x) => x.g && x.g === info[0].g);
const ys = new Set(info.map((x) => x.b.split(',')[1]));
check('Grid layout puts the graphs in one row of cells and groups them', grouped && ys.size === 1, info.map((x) => x.b).join(' | '));
const byX = info.map((x, i) => [Number(x.b.split(',')[0]), i]).sort((a, c) => a[0] - c[0]).map((x) => x[1]);
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(cards.nth(byX[0]));
const axesChecks = await Promise.all(['x-label', 'y-label'].map((k) => page.getByTestId(`layout-hide-${k}`).isChecked()));
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(cards.nth(byX[1]));
const axes2 = await Promise.all(['x-label', 'y-label'].map((k) => page.getByTestId(`layout-hide-${k}`).isChecked()));
check('cells are bare except the border: the left cell keeps its Y axis, inner cells only X (bottom row)', !axesChecks[0] && !axesChecks[1] && !axes2[0] && axes2[1], `left hide x/y ${axesChecks}, inner ${axes2}`);
await page.getByTestId('layout-ungroup').click();

// Multigraph on one graph
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(cards.nth(0));
const b0 = (await cards.nth(0).getAttribute('data-box')).split(',').map(Number);
await page.getByTestId('layout-multigraph').selectOption('histograms');
await page.waitForTimeout(1500);
const b1 = (await cards.nth(0).getAttribute('data-box')).split(',').map(Number);
check('Show Multigraph (histograms) adds a grid of charts beside the graph', b1[2] > b0[2], `${b0.join(',')} -> ${b1.join(',')}`);
await page.getByTestId('layout-multigraph').selectOption('nxn');
await page.waitForTimeout(2500);
const b2 = (await cards.nth(0).getAttribute('data-box')).split(',').map(Number);
check('N x N makes the block wider and taller (4 x 4 for 4 parameters)', b2[2] > b1[2] && b2[3] > b1[3], `${b1.join(',')} -> ${b2.join(',')}`);
await page.waitForFunction(() => { const i = document.querySelector('[data-testid=layout-card] img'); return i && i.naturalWidth > 1000; }, null, { timeout: 60000 });
await page.getByTestId('layout-zoom').selectOption('0.5');
await page.waitForTimeout(500);
await page.getByTestId('layout-page').screenshot({ path: join(out, 'layout-multigraph.png') });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
