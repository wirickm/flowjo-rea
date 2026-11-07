// Graph window and axis transform gaps (docs/validation/ui-gaps/graph.md):
// smoothing, outliers, resolution, dots, Y range, colours, scientific notation,
// gate tint / colour, gates on peaks, transform menu, first / last sample,
// copy image, colour table, close all, print / movie menu items.
// Usage: node e2e/graph-gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5184';
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
const context = await browser.newContext({ viewport: { width: 1700, height: 1800 }, acceptDownloads: true });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
await context.addInitScript(() => { if (!sessionStorage.getItem('gg-init')) { localStorage.setItem('flowjo-rea.separateWindows', '0'); localStorage.removeItem('flowjo-rea.prefs'); sessionStorage.setItem('gg-init', '1'); } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(200);
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
  await page.waitForTimeout(100);
};
const canvas = page.getByTestId('plot-canvas');
const img = () => page.evaluate(() => document.querySelector('[data-testid=plot-canvas]').toDataURL());
const pixel = (x, y) => page.evaluate(([x, y]) => { const c = document.querySelector('[data-testid=plot-canvas]'); const k = c.width / 460; return Array.from(c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data); }, [x, y]);
const at = async (fx, fy) => { const b = await canvas.boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };
const ctxMenu = async () => { const b = await canvas.boundingBox(); await canvas.click({ button: 'right', position: { x: b.width - 30, y: b.height - 70 } }); };
const caption = () => page.getByTestId('plot-caption').innerText();

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
await page.getByTestId('display-menu').locator('summary').click();

// --- Gate colour and Tint ---
await page.getByTestId('tool-rect').click(); await page.waitForTimeout(300);
let [x0, y0] = await at(0.25, 0.08); let [x1, y1] = await at(0.65, 0.4);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
await page.getByTestId('tool-select').click();
const [gx, gy] = await at(0.45, 0.24);
const [ex, ey] = await at(0.92, 0.92);
const deselect = async () => { await page.mouse.click(ex, ey); await idle(); };
await deselect();
const g0 = await img();
await page.mouse.click(gx, gy); await idle();
await page.getByTestId('gate-color').fill('#00aa00'); await idle();
await deselect();
const g1 = await img();
await page.mouse.click(gx, gy); await idle();
await page.getByTestId('gate-tint').check(); await idle();
await deselect();
const g2 = await img();
check('gate colour and Tint redraw the gate', g1 !== g0 && g2 !== g1, `${g1 !== g0} ${g2 !== g1}`);
await page.mouse.click(gx, gy, { button: 'right' });
check('the gate menu shows Tint as on', (await page.getByTestId('ctx-Tint').count()) === 1 && (await page.getByTestId('ctx-Tint').innerText()).startsWith('*'));
await page.keyboard.press('Escape');
await page.mouse.click(5, 5);

await page.keyboard.press('Escape');
await deselect();
// --- Smoothing (pseudocolor is unsmoothed by default) ---
check('pseudocolor opens unsmoothed; Show Outliers needs smoothing', !(await page.getByTestId('display-smooth').isChecked()) && (await page.getByTestId('display-outliers').isDisabled()));
const raw = await img();
await page.getByTestId('display-smooth').check(); await idle();
const sm13 = await img();
check('Smooth draws a different (smoothed) image and stores 13', sm13 !== raw && (await page.getByTestId('display-smoothing').inputValue()) === '13');
await page.getByTestId('display-smoothing').selectOption('104'); await idle();
check('every smoothing amount above 0 draws the same picture (engine reads a boolean)', (await img()) === sm13);
await page.getByTestId('display-outliers').check(); await idle();
check('Show Outliers on a smoothed pseudocolor draws outlier dots', (await img()) !== sm13);
await page.getByTestId('display-outliers').uncheck();
await ctxMenu();
await page.getByTestId('ctx-Smooth').click(); await idle();
check('the plot menu Smooth item toggles smoothing off', !(await page.getByTestId('display-smooth').isChecked()) && (await img()) === raw);

// --- Resolution ---
await page.getByTestId('display-resolution').selectOption('512'); await idle();
const r512 = await img();
check('Set Graph Resolution 512 redraws the plot on a finer grid', r512 !== raw);
await page.getByTestId('display-resolution').selectOption('256'); await idle();
check('resolution back to 256 gives the original picture', (await img()) === raw);

// --- Background colour ---
await page.getByTestId('display-backcolor').fill('#ffff00'); await idle();
const px = await pixel(64 + 3, 14 + 3);
check('background colour fills the plot area', px[0] > 240 && px[1] > 240 && px[2] < 20, px.join(','));
await page.getByTestId('display-backcolor').fill('#ffffff'); await idle();

// --- Dot plot: # Dots and foreground ---
await page.getByTestId('plot-kind').selectOption('dot'); await idle();
check('dot plots draw 8,000 events by default (preference dotsToDraw)', (await caption()).includes('8,000'), await caption());
await page.getByTestId('display-ndots').fill('1000'); await idle();
check('# Dots sets the events drawn', (await caption()).includes('1,000'), await caption());
await page.getByTestId('display-ndots').fill('0'); await idle();
check('# Dots 0 becomes 100', (await page.getByTestId('display-ndots').inputValue()) === '100');
const dots = await img();
await page.getByTestId('display-forecolor').fill('#ff0000'); await idle();
check('foreground colour recolours the dots', (await img()) !== dots);

// --- Histogram: smoothing default, Y range, peaks ---
await page.getByTestId('plot-kind').selectOption('histogram'); await idle();
const names = await page.getByTestId('x-channel').locator('option').evaluateAll((o) => o.map((x) => x.value));
const fl = names.find((n) => !/^(FSC|SSC|Time)/i.test(n));
await page.getByTestId('x-channel').selectOption(fl); await idle();
check('histograms open smoothed (preference smoothing1D)', await page.getByTestId('display-smooth').isChecked());
const hs = await img();
await page.getByTestId('display-smooth').uncheck(); await idle();
check('histogram smoothing off draws the raw counts', (await img()) !== hs);
await page.getByTestId('display-yaxis').selectOption('manual'); await idle();
check('Set Y Axis Range: Manual offers a top value (default 1000)', (await page.getByTestId('display-ymax').inputValue()) === '1000');
const y1000 = await img();
await page.getByTestId('display-ymax').fill('100'); await idle();
check('a manual Y top redraws the count axis', (await img()) !== y1000);
await page.getByTestId('display-yaxis').selectOption('auto'); await idle();
// scientific notation (preference)
const sci = await img();
await page.getByTestId('display-scinot').uncheck(); await idle();
check('Use Scientific Notation off relabels the log axis', (await img()) !== sci);
await page.getByTestId('display-scinot').check(); await idle();
// gates on peaks
const before = await page.locator('[data-testid^="pop-"]').count();
await ctxMenu();
await page.getByTestId('ctx-Create Gates On Peaks').click(); await idle();
const pops = await page.locator('[data-testid^="pop-"]').evaluateAll((e) => e.map((x) => x.getAttribute('data-testid')));
check('Create Gates On Peaks adds range gates named after the parameter', pops.length > before && pops.some((p) => p === `pop-${fl}` || p.startsWith(`pop-${fl}.Pop`)), pops.join(', '));
await ctxMenu();
await page.getByTestId('ctx-Create Gates On Peaks').click(); await idle();
check('running it again replaces the same ranges (no duplicates)', (await page.locator('[data-testid^="pop-"]').count()) === pops.length);

// --- Copy Image without transparency ---
await ctxMenu();
await page.getByTestId('ctx-Copy Image Without Transparency').click(); await idle();
await page.waitForTimeout(300);
check('Copy Image Without Transparency copies the plot image', (await page.getByTestId('log').innerText()).includes('Plot image copied'));

// --- Transform menu ---
await page.getByTestId('x-channel').selectOption(fl); await idle();
const t0 = await img();
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-linear').click(); await idle();
check('Linear Axis switches the X scale', (await img()) !== t0);
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-reset').click(); await idle();
check('Reset restores the data-set scale', (await img()) === t0);
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-range').click();
await page.getByTestId('range-min').fill('-1000');
await page.getByTestId('range-max').fill('100000');
await page.getByTestId('range-ok').click(); await idle();
check('Change Displayed Parameter Range sets min and max', (await page.getByTestId('range-dialog').count()) === 0 && (await img()) !== t0);
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-autowidth').click(); await idle();
check('Calculate Width Basis reports the width basis from the data', /width basis -/.test(await page.getByTestId('log').innerText()));
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-applycomp').click(); await idle();
check('Apply To All Compensated Parameters copies the scale', /applied to \d+ parameter/.test(await page.getByTestId('log').innerText()));
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-remove').click(); await idle();
check('Remove Transforms resets the like parameters', (await img()) === t0);
await page.getByTestId('x-transform').click();
await page.getByTestId('tm-derive-log').click(); await idle();
const opts = await page.getByTestId('x-channel').locator('option').evaluateAll((o) => o.map((x) => x.value));
check('Derive Log Parameter adds a formula parameter', opts.includes(`${fl.replace(/[^A-Za-z0-9_]/g, '_')}_log`), opts.slice(-2).join(', '));

// --- First / Last sample ---
await page.getByTestId('last-sample').click(); await idle();
const crumb = await page.getByTestId('crumb-root').innerText();
await page.getByTestId('first-sample').click(); await idle();
check('Last / First Sample jump to the ends of the group', crumb === F2 && (await page.getByTestId('crumb-root').innerText()) === F1);

// --- Preferences: adjust colour table ---
await page.getByTestId('open-prefs').first().click();
await page.getByTestId('pref-adjustcolor').check();
await page.getByTestId('prefs-close').click();
await page.getByTestId('x-channel').selectOption('FSC-A'); await idle();
await page.getByTestId('plot-kind').selectOption('pseudocolor'); await idle();
await page.getByTestId('display-smooth').check(); await idle();
const c0 = await img();
await page.getByTestId('display-adjust-color').click();
await page.getByTestId('ct-start-0').fill('#ff00ff');
await page.getByTestId('ct-end-3').fill('#000000');
await page.getByTestId('ct-ok').click(); await idle();
check('Adjust color table recolours the pseudocolor plot', (await img()) !== c0);

// --- Print / Make Movie menu ---
await ctxMenu();
check('the plot menu offers Print and Make Movie', (await page.getByTestId('ctx-Print...').count()) === 1 && (await page.getByTestId('ctx-Make Movie...').isEnabled()));
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }).catch(() => null), page.getByTestId('ctx-Make Movie...').click()]);
check('Make Movie records the group as a WebM video', !!dl && dl.suggestedFilename().endsWith('.webm'), dl ? dl.suggestedFilename() : 'no download');

// --- Close All Graph Windows (FlowJo layout) ---
await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`row-${F1}`).dblclick({ position: { x: 40, y: 6 } });
await idle();
await page.getByTestId('gw-duplicate').first().click(); await idle();
const nw = await page.getByTestId('graph-window').count();
await page.getByTestId('gw-close-all').first().click();
check('Close All Graph Windows closes every graph window', nw === 2 && (await page.getByTestId('graph-window').count()) === 0, `${nw} windows`);

await page.screenshot({ path: join(out, 'graph-gaps.png') });
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
