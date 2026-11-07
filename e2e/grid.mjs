// Layout grid figure editing (specs 25.2): insert / delete rows and columns,
// dimensions, padding, make even, clear, extract.
// Usage: node e2e/grid.mjs [baseUrl]
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
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const pick = async (loc, shift = false) => { await loc.dispatchEvent('mousedown', { bubbles: true, shiftKey: shift }); await loc.dispatchEvent('mouseup', { bubbles: true }); await page.waitForTimeout(150); };
const cards = page.getByTestId('layout-card');
const boxes = () => cards.evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, b: e.dataset.box.split(',').map(Number) })));
const clear = async () => { const pg = page.locator('[data-testid=layout-page]'); const b = await pg.boundingBox(); await pg.click({ position: { x: b.width - 4, y: b.height - 4 } }); };

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
for (const y of ['SSC-A', 'CD4 PE-Cy7 FLR-A', 'CD3 APC-H7 FLR-A']) { await page.getByTestId('y-channel').selectOption(y); await idle(); await page.getByTestId('add-to-layout').click(); }
await page.getByTestId('open-layout').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length === 3, null, { timeout: 60000 });
await page.getByTestId('layout-zoom').selectOption('0.5');
await pick(cards.nth(0)); await pick(cards.nth(1), true); await pick(cards.nth(2), true);
await page.getByTestId('layout-grid').click();
await page.waitForTimeout(500);
check('Grid layout makes a grid object with grid lines and a grid toolbar', (await page.getByTestId('layout-gridlines').count()) === 1 && (await page.getByTestId('layout-gridbar').count()) === 1);
const b0 = await boxes();
const byX = [...b0].sort((a, c) => a.b[0] - c.b[0]);

// Insert a row above the selected cell: every cell moves down one cell
await clear(); await pick(cards.nth(b0.indexOf(byX[0])));
await page.getByTestId('grid-insert-row').click();
await page.waitForTimeout(400);
const b1 = await boxes();
const dy = b1[0].b[1] - b0[0].b[1];
check('Insert row moves the cells of that row and below down one cell (281 + 2 x 4 pt)', b1.every((x, i) => x.b[1] - b0[i].b[1] === dy) && dy === 289, `dy ${dy}`);
check('the grid now has 4 rows', (await page.getByTestId('grid-rows').inputValue()) === '4');

// Delete the first column: its cell and contents go, the others move left
await clear(); await pick(cards.nth(b1.findIndex((x) => x.id === byX[0].id)));
await page.getByTestId('grid-delete-col').click();
await page.waitForTimeout(400);
const b2 = await boxes();
check('Delete column removes that column with its contents and closes the gap', b2.length === 2 && Math.min(...b2.map((x) => x.b[0])) === byX[0].b[0], b2.map((x) => x.b.join(',')).join(' | '));

// Padding: 4 -> 10 pt moves the second cell
await clear(); await pick(cards.nth(0));
const before = (await boxes()).map((x) => x.b[0]).sort((a, c) => a - c);
await page.getByTestId('grid-pad').fill('10');
await page.waitForTimeout(400);
const after = (await boxes()).map((x) => x.b[0]).sort((a, c) => a - c);
check('Cell padding 10 pt spaces the cells by cell width + 2 x padding', after[1] - after[0] === before[1] - before[0] + 12, `${before} -> ${after}`);

// Moving a grid: nudging a cell moves the whole grid, grid lines included
await clear(); await pick(cards.nth(0));
const gl0 = await page.getByTestId('layout-gridlines').evaluate((e) => e.style.left);
await page.getByTestId('layout-page').focus();
await page.keyboard.press('Control+Shift+ArrowRight');
await page.waitForTimeout(300);
const gl1 = await page.getByTestId('layout-gridlines').evaluate((e) => e.style.left);
await page.getByTestId('grid-even').click();
await page.waitForTimeout(300);
const gl2 = await page.getByTestId('layout-gridlines').evaluate((e) => e.style.left);
check('nudging a cell moves the grid with its cells; Make even keeps them in place', gl1 !== gl0 && gl2 === gl1, `${gl0} -> ${gl1} -> ${gl2}`);

// Set dimensions 1 x 1: one cell stays, the other is released as a free item
await page.getByTestId('grid-cols').fill('1');
await page.waitForTimeout(400);
check('Set dimensions keeps the cells inside and releases the rest', (await cards.count()) === 2 && (await page.getByTestId('grid-cols').inputValue()) === '1');

// Extract cells: the grid goes, the figures stay
const keep = (await boxes()).map((x) => x.b.join(','));
await page.getByTestId('grid-extract').click();
await page.waitForTimeout(300);
check('Extract cells removes the grid and leaves each figure where it is', (await page.getByTestId('layout-gridlines').count()) === 0 && (await boxes()).map((x) => x.b.join(',')).join() === keep.join());
await page.getByTestId('undo').count();

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
