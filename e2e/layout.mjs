// FlowJo 10 layout logic through the real UI (specs 21): placement, drag,
// arrange commands, z-order, groups, locks, nudge, page breaks, paper, export.
// Usage: node e2e/layout.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
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
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const boxes = () => page.getByTestId('layout-card').evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, b: e.dataset.box.split(',').map(Number) })));
const card = (i) => page.getByTestId('layout-card').nth(i);
// Selects a card even when another overlaps it (mousedown straight on the card).
const pick = async (loc, shift = false) => { await loc.dispatchEvent('mousedown', { bubbles: true, shiftKey: shift }); await loc.dispatchEvent('mouseup', { bubbles: true }); await page.waitForTimeout(100); };

await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
for (let i = 0; i < 2; i++) await page.getByTestId('add-to-layout').click();
await page.getByTestId('open-layout').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length === 2, null, { timeout: 60000 });
await page.getByTestId('layout-add-text').click();
let bx = await boxes();
check('graphs stack at (200, 200) centred; text goes to (30, 50)', bx[0].b.join() === bx[1].b.join() && bx[2].b[0] === 30 && bx[2].b[1] === 50, bx.map((x) => x.b.join(',')).join(' | '));

// Drag the top graph 150 pt right and 120 pt down (zoom 100%: 1 pt = 1 px)
const top = card(1);
const tb = await top.boundingBox();
await page.mouse.move(tb.x + 200, tb.y + 200); await page.mouse.down(); await page.mouse.move(tb.x + 350, tb.y + 320, { steps: 6 }); await page.mouse.up();
await page.waitForTimeout(200);
bx = await boxes();
check('dragging moves the graph by the pointer distance in points', bx[1].b[0] === bx[0].b[0] + 150 && bx[1].b[1] === bx[0].b[1] + 120, bx[1].b.join(','));

// Select all three (Shift-click) and Align Left / Top
await card(0).click({ position: { x: 100, y: 100 } });
await card(1).click({ position: { x: 200, y: 200 }, modifiers: ['Shift'] });
await card(2).click({ position: { x: 5, y: 5 }, modifiers: ['Shift'] });
await page.getByTestId('layout-align-left').click();
await page.waitForTimeout(200);
bx = await boxes();
check('Align Left puts every item at the smallest x of the selection', new Set(bx.map((x) => x.b[0])).size === 1 && bx[0].b[0] === 30, bx.map((x) => x.b[0]).join(','));
await page.getByTestId('layout-align-top').click();
await page.waitForTimeout(200);
bx = await boxes();
check('Align Top puts every item at the smallest y', new Set(bx.map((x) => x.b[1])).size === 1, bx.map((x) => x.b[1]).join(','));
await page.getByTestId('layout-align-hcenter').click();
await page.waitForTimeout(200);
bx = await boxes();
const centres = bx.map((x) => x.b[0] + Math.floor(x.b[2] / 2));
check('Center aligns the centres', new Set(centres).size === 1, centres.join(','));

// Nudge: Shift+Arrow moves 3 pt; a locked item stays
await page.getByTestId('layout-page').focus();
const before = (await boxes()).map((x) => x.b[0]);
await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(200);
check('Shift+Arrow nudges the selection by 3 pt', (await boxes()).every((x, i) => x.b[0] === before[i] + 3));
const textC = page.locator('[data-testid=layout-card]').filter({ has: page.locator('.layout-textbox') });
const graphC = page.locator('[data-testid=layout-card]').filter({ has: page.locator('img') });
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(textC);
await page.getByTestId('layout-lock').click();
await pick(graphC.first(), true);
const tx0 = Number((await textC.getAttribute('data-box')).split(',')[0]), gx0 = Number((await graphC.first().getAttribute('data-box')).split(',')[0]);
await page.getByTestId('layout-page').focus();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(200);
const tx1 = Number((await textC.getAttribute('data-box')).split(',')[0]), gx1 = Number((await graphC.first().getAttribute('data-box')).split(',')[0]);
check('a position-locked item is skipped by nudge; the others move', tx1 === tx0 && gx1 === gx0 + 1, `text ${tx0}->${tx1}, graph ${gx0}->${gx1}`);
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(textC);
await page.getByTestId('layout-lock').click();

// Group: clicking one member selects both; they move together
const textCard = page.locator('[data-testid=layout-card]').filter({ has: page.locator('.layout-textbox') });
const graphCard = page.locator('[data-testid=layout-card]').filter({ has: page.locator('img') });
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(graphCard.first());
await pick(textCard, true);
await page.getByTestId('layout-group').click();
await page.waitForTimeout(200);
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
const gTarget = textCard;
await pick(gTarget);
const selCount = await page.locator('[data-testid=layout-card].sel').count();
check('clicking a group member selects the whole group', selCount === 2, String(selCount));
await page.getByTestId('layout-ungroup').click();

// Duplicate at +8 pt; Delete removes it
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(gTarget.first());
const src = (await page.locator('[data-testid=layout-card].sel').first().getAttribute('data-box')).split(',').map(Number);
await page.getByTestId('layout-duplicate').click();
await page.waitForTimeout(200);
const dup = (await page.locator('[data-testid=layout-card].sel').first().getAttribute('data-box')).split(',').map(Number);
check('Duplicate copies the selection at (+8, +8)', dup[0] === src[0] + 8 && dup[1] === src[1] + 8, `${src.join(',')} -> ${dup.join(',')}`);
await page.getByTestId('layout-remove').click();

// Page breaks: move a graph across the right page edge, then Avoid page breaks
const gIdx = (await boxes()).findIndex((x) => x.b[2] > 250);
await pick(card(gIdx));
await page.getByTestId('layout-page').focus();
for (let i = 0; i < 25; i++) await page.keyboard.press('Control+Alt+Shift+ArrowRight'); // 12 pt each
await page.waitForTimeout(300);
const crossing = (await page.locator('[data-testid=layout-card].sel').first().getAttribute('data-box')).split(',').map(Number);
const pdfBefore = readFileSync(await (async () => { const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('layout-export-pdf').click()]); const p = join(out, 'layout-2pages.pdf'); await d.saveAs(p); return p; })(), 'latin1');
check('a layout wider than the page exports one PDF page per page', (pdfBefore.match(/\/Type \/Page /g) ?? []).length === 2 && pdfBefore.includes('/MediaBox [0 0 612.00 792.00]'), `${(pdfBefore.match(/\/Type \/Page /g) ?? []).length} pages; item ${crossing.join(',')}`);
await page.getByTestId('layout-avoid-breaks').click();
await page.waitForTimeout(200);
const moved = (await page.locator('[data-testid=layout-card].sel').first().getAttribute('data-box')).split(',').map(Number);
check('Avoid page breaks moves the crossing graph to the next page start (468 pt)', moved[0] === 468, moved.join(','));

// Landscape paper widens the page
await page.getByTestId('layout-orientation').selectOption('landscape');
await page.waitForTimeout(300);
const pw = await page.getByTestId('layout-page').evaluate((e) => e.getBoundingClientRect().width);
check('landscape Letter page is 648 pt wide inside the margins', Math.round(pw) % 648 === 0, String(pw));
await page.screenshot({ path: join(out, 'layout-editor.png') });

await page.getByTestId('layout-orientation').selectOption('portrait');
await page.waitForTimeout(300);

// Guides: shown on request; a dragged graph snaps to the 250 pt guide within 30 pt
await page.getByTestId('layout-show-guides').check();
check('a new layout has one vertical and one horizontal guide at 250 pt', (await page.getByTestId('layout-guide-v').getAttribute('data-at')) === '250' && (await page.getByTestId('layout-guide-h').getAttribute('data-at')) === '250');
const gcard = page.locator('[data-testid=layout-card]').filter({ has: page.locator('img') }).first();
await page.locator('[data-testid=layout-page]').click({ position: { x: 440, y: 620 } });
await pick(gcard);
const gb0 = (await gcard.getAttribute('data-box')).split(',').map(Number);
const cb = await gcard.boundingBox();
// Move so the left edge lands 20 pt short of the guide (x = 230) and the top 300 pt down
await page.mouse.move(cb.x + 150, cb.y + 150); await page.mouse.down();
await page.mouse.move(cb.x + 150 + (230 - gb0[0]), cb.y + 150 + (400 - gb0[1]), { steps: 8 }); await page.mouse.up();
await page.waitForTimeout(200);
const gb1 = (await gcard.getAttribute('data-box')).split(',').map(Number);
check('a dragged graph snaps its left edge to the guide', gb1[0] === 250, `${gb0.join(',')} -> ${gb1.join(',')}`);

// Gate annotations: frequencies / names need Show Gates; axes string toggles
await page.getByTestId('layout-show-gates').uncheck();
check('with Frequencies / with Names are disabled while Show Gates is off', (await page.getByTestId('layout-gate-freq').isDisabled()) && (await page.getByTestId('layout-gate-names').isDisabled()));
await page.getByTestId('layout-show-gates').check();
await page.getByTestId('layout-hide-x-label').check();
check('hide X label is kept for the graph', await page.getByTestId('layout-hide-x-label').isChecked());

// Escape closes the layout editor (own rule)
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('Escape closes the dialog', (await page.getByRole('dialog', { name: 'Layout editor' }).count()) === 0);
check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
