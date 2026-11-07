// Graph-window parity through the real UI (specs 18): gate naming dialog,
// double-click to open a gate, child plots inherit the parent's axes, gating
// path, Next / Previous Sample keys, stain editing in axis titles.
// Usage: node e2e/uiparity.mjs [baseUrl]
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
const F2 = '101_DEN084Y5_15_E05_010_clean.fcs';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const canvas = page.getByTestId('plot-canvas');
const at = async (fx, fy) => { const b = await canvas.boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };
const caption = async () => (await page.getByTestId('plot-caption').textContent()).trim();
const POLY = [[0.28, 0.07], [0.72, 0.07], [0.78, 0.3], [0.3, 0.3]];
const drawPolygon = async () => {
  await page.getByTestId('tool-polygon').click();
  for (const [fx, fy] of POLY) { const [x, y] = await at(fx, fy); await page.mouse.click(x, y); }
  const [x, y] = await at(...POLY[0]);
  await page.mouse.click(x, y);
};

await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
// The root plot is set to FSC-A vs SSC-H so a child's inherited axes differ from the default.
await page.getByTestId('y-channel').selectOption('SSC-H');
await idle();

// 1. Subpopulation Identification after drawing
await drawPolygon();
const namer = page.getByRole('dialog', { name: 'Subpopulation Identification' });
check('drawing a gate opens Subpopulation Identification with the default name', (await namer.count()) === 1 && (await page.getByTestId('gate-namer-name').inputValue()) === 'Polygon 1');
await page.getByTestId('gate-namer-name').fill('Lymphocytes');
await page.getByTestId('gate-namer-memorize').click();
await page.getByTestId('gate-namer-ok').click();
await idle();
check('the typed name becomes the population name', (await page.getByTestId('pop-Lymphocytes').count()) === 1);

// 2. Unique-name check; Cancel discards the gate
await drawPolygon();
await page.getByTestId('gate-namer-name').fill('Lymphocytes');
await page.getByTestId('gate-namer-ok').click();
const err = (await page.getByTestId('gate-namer-error').count()) ? await page.getByTestId('gate-namer-error').textContent() : '';
const favs = await page.getByTestId('gate-namer-favorites').locator('option').allTextContents();
await page.getByTestId('gate-namer-cancel').click();
await idle();
check('a sibling name is refused with "Name must be unique."', err === 'Name must be unique.', err);
check('Favorites list keeps the memorized name', favs.includes('Lymphocytes'), favs.join(', '));
check('Cancel discards the drawn gate', (await page.locator('[data-testid^="pop-"]:not([data-testid="pop-root"])').count()) === 1);

// 3. Double-click inside the gate opens it, with the parent's axes
await page.getByTestId('tool-select').click();
const [cx, cy] = await at(0.5, 0.18);
await page.mouse.dblclick(cx, cy);
await idle();
check('double-click inside a gate opens its population', (await caption()).startsWith('Lymphocytes:'), await caption());
check('the child plot inherits the parent axes', (await page.getByTestId('x-channel').inputValue()) === 'FSC-A' && (await page.getByTestId('y-channel').inputValue()) === 'SSC-H', `${await page.getByTestId('x-channel').inputValue()} / ${await page.getByTestId('y-channel').inputValue()}`);

// 4. Gating path
const crumbs = (await page.getByTestId('gating-path').textContent()).replace(/\s+/g, ' ');
check('gating path shows sample > Lymphocytes', crumbs.includes(`${F1} > Lymphocytes`), crumbs);
await page.getByTestId('crumb-root').click();
await idle();
check('clicking the sample in the path goes up to all events', (await caption()).startsWith('All events:'), await caption());
await page.getByTestId('crumb-root').click();

// 5. Next / Previous Sample
await page.getByTestId('pop-Lymphocytes').click();
await idle();
await page.locator('body').focus();
await page.keyboard.press('PageDown');
await idle();
const stayed = await page.getByTestId(`sample-${F1}`).evaluate((n) => n.classList.contains('sel'));
check('Next Sample is disabled when no later sample has the population', stayed && (await page.getByTestId('next-sample').isDisabled()) && (await caption()).startsWith('Lymphocytes:'), await caption());
await page.getByTestId('pop-root').click();
await idle();
await page.locator('body').focus();
await page.keyboard.press('PageDown');
await idle();
const onF2 = await page.getByTestId(`sample-${F2}`).evaluate((n) => n.classList.contains('sel'));
check('PageDown shows the next sample', onF2 && (await caption()).startsWith('All events:'), await caption());
await page.keyboard.press('PageUp');
await idle();
const onF1 = await page.getByTestId(`sample-${F1}`).evaluate((n) => n.classList.contains('sel'));
check('PageUp returns to the previous sample', onF1 && (await caption()).startsWith('All events:'), await caption());
// The same population is kept when the next sample has it.
await page.getByTestId('pop-Lymphocytes').click();
await page.getByTestId('gate-copy').click();
await page.getByTestId(`sample-${F2}`).click();
await page.getByTestId('gate-paste').click();
await idle();
await page.getByTestId(`sample-${F1}`).click();
await page.getByTestId('pop-Lymphocytes').click();
await idle();
await page.locator('body').focus();
await page.keyboard.press('PageDown');
await idle();
check('PageDown keeps the population when the next sample has it', (await page.getByTestId(`sample-${F2}`).evaluate((n) => n.classList.contains('sel'))) && (await caption()).startsWith('Lymphocytes:'), await caption());
await page.keyboard.press('PageUp');
await idle();
await page.keyboard.press('Control+PageUp');
await idle();
check('Ctrl+PageUp is the Next Sample menu accelerator', await page.getByTestId(`sample-${F2}`).evaluate((n) => n.classList.contains('sel')));
await page.keyboard.press('Control+PageDown');
await idle();

// 6. Stain editing renames the axis ("name :: stain")
await page.getByTestId('open-keywords').click();
await page.getByTestId('stain-SSC-H').fill('Granularity');
await page.getByTestId('stain-SSC-H').press('Enter');
await idle();
await page.getByRole('dialog').getByLabel('Close').click();
await page.getByTestId('open-keywords').click();
const kept = await page.getByTestId('stain-SSC-H').inputValue();
await page.getByRole('dialog').getByLabel('Close').click();
check('an edited stain is kept as $PnS', kept === 'Granularity', kept);
await page.getByTestId('open-export').click();
const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-svg').click()]);
const svgPath = join(out, 'uiparity.svg');
await d.saveAs(svgPath);
const svg = readFileSync(svgPath, 'utf8');
check('the axis title shows "SSC-H :: Granularity"', svg.includes('SSC-H :: Granularity'));
await idle();
if (await page.getByRole('dialog').count()) await page.getByRole('dialog').getByRole('button', { name: /^(x|Close)$/ }).first().click();
await page.getByTestId(`sample-${F2}`).click();
await idle();
await page.getByTestId('open-keywords').click();
const f2 = await page.getByTestId('stain-SSC-H').inputValue();
await page.getByRole('dialog').getByLabel('Close').click();
check('"apply to all samples" sets the stain in the other sample', f2 === 'Granularity', f2);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
