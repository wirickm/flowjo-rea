// Colour axis, Event # parameter, layout adjunct histograms and ancestry (specs 24).
// Usage: node e2e/coloraxis.mjs [baseUrl]
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
const canvas = page.getByTestId('plot-canvas');
const at = async (fx, fy) => { const b = await canvas.boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };
// A pixel sample of the plot area, to see that colouring changed.
const pixels = () => canvas.evaluate((c) => { const d = c.getContext('2d').getImageData(64, 14, 382, 358).data; let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0; return h; });

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();

// Colour axis
const plain = await pixels();
await page.getByTestId('display-menu').locator('summary').click();
await page.getByTestId('display-color').selectOption('CD4 PE-Cy7 FLR-A');
await idle();
await page.waitForTimeout(300);
const coloured = await pixels();
check('a colour axis recolours the pseudocolor plot by the third parameter', coloured !== plain && (await page.getByTestId('color-legend').count()) === 1);
await canvas.focus();
await page.keyboard.press('Control+]');
await idle();
check('Ctrl+] steps to the next colour parameter', (await page.getByTestId('display-color').inputValue()) === 'Time', await page.getByTestId('display-color').inputValue());
await page.getByTestId('display-color').selectOption('');
await idle();

// Event # parameter
await page.getByTestId('display-event-number').check();
await idle();
const xs = await page.getByTestId('x-channel').locator('option').allTextContents();
check('Show Event # Parameter adds "Event #" at the end of the axis list', xs[xs.length - 1] === 'Event #', xs.slice(-2).join(', '));
await page.getByTestId('x-channel').selectOption('Event #');
await idle();
check('a plot against Event # draws without error', (await page.getByTestId('plot-caption').textContent()).includes('283,969'));
await page.getByTestId('x-channel').selectOption('FSC-A');
await idle();

// Two gate levels, then the child in the layout with ancestry and adjunct histograms
await page.getByTestId('tool-rect').click();
let [x0, y0] = await at(0.2, 0.05); let [x1, y1] = await at(0.75, 0.4);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
await page.getByTestId('pop-Rect 1').click(); await idle();
await page.getByTestId('x-channel').selectOption('CD3 APC-H7 FLR-A');
await page.getByTestId('y-channel').selectOption('CD4 PE-Cy7 FLR-A');
await idle();
await page.getByTestId('tool-rect').click();
[x0, y0] = await at(0.5, 0.5); [x1, y1] = await at(0.95, 0.95);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
const child = page.locator('[data-testid="pop-Rect 1"]').nth(1);
await child.click(); await idle();
await page.getByTestId('add-to-layout').click();
await page.getByTestId('open-layout').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length === 1, null, { timeout: 60000 });
const card = page.getByTestId('layout-card').first();
await card.click({ position: { x: 100, y: 100 } });
const b0 = (await card.getAttribute('data-box')).split(',').map(Number);
await page.getByTestId('layout-ancestry').check();
await page.waitForTimeout(800);
const b1 = (await card.getAttribute('data-box')).split(',').map(Number);
check('Show Ancestry widens the graph by one 140 pt chart per ancestor (2 here)', b1[2] > b0[2] + 2 * 140 && b1[3] === b0[3], `${b0.join(',')} -> ${b1.join(',')}`);
await page.getByTestId('layout-backgating').check();
await page.getByTestId('layout-adjunct').check();
await page.waitForTimeout(800);
const b2 = (await card.getAttribute('data-box')).split(',').map(Number);
check('Show Adjunct Histograms adds strips along the top and right edges', b2[3] > b1[3] && b2[2] > b1[2], `${b1.join(',')} -> ${b2.join(',')}`);
await page.waitForFunction(() => { const i = document.querySelector('[data-testid=layout-card] img'); return i && i.naturalWidth > 900; }, null, { timeout: 60000 });
const nat = await card.locator('img').evaluate((i) => [i.naturalWidth, i.naturalHeight]);
check('the rendered graph includes the ancestry charts and histograms', nat[0] > 900 && nat[1] > 420, nat.join('x'));
await page.getByTestId('layout-zoom').selectOption('0.75');
await page.waitForTimeout(500);
await page.getByTestId('layout-page').screenshot({ path: join(out, 'layout-ancestry.png') });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
