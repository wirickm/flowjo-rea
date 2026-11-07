// Experiment platforms through the real UI (Chromium via Playwright): Plate
// Editor, Compare Populations, 3D Viewer, Create Calibration Parameter and
// FCS Scan (docs/validation/ui-gaps/platforms.md).
// Usage: node e2e/platforms-gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5186';
const out = join(root, 'test-results', 'e2e-platforms');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Minimal FCS 3.1 writer: float32 list mode.
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
// Two wells: FL1 uniform on 200 +- 300 (A1) and 600 +- 300 (B2); the other
// parameters are the same narrow spread in both (deterministic jitter).
const mk = (shift) => Array.from({ length: 4000 }, (_, i) => [400 + ((i * 37) % 100), 400 + ((i * 53) % 100), shift + ((i * 7919) % 600) - 300, (i * 13) % 1000]);
writeFileSync(join(out, 'a.fcs'), fcsBytes('a.fcs', ['FSC-A', 'SSC-A', 'FL1-A', 'FL2-A'], [1024, 1024, 1024, 1024], mk(200), { 'WELL ID': 'A01', 'PLATE ID': 'P1', Donor: 'D1' }));
writeFileSync(join(out, 'b.fcs'), fcsBytes('b.fcs', ['FSC-A', 'SSC-A', 'FL1-A', 'FL2-A'], [1024, 1024, 1024, 1024], mk(600), { 'WELL ID': 'B02', 'PLATE ID': 'P1', Donor: 'D2' }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept(d.defaultValue()));
const idle = async () => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const download = async (click) => { const [d] = await Promise.all([page.waitForEvent('download'), click()]); return readFileSync(await d.path(), 'utf8'); };

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([join(out, 'a.fcs'), join(out, 'b.fcs')]);
await idle();
await page.getByTestId('sample-a.fcs').click();
await idle();

// --- Plate Editor
await page.getByTestId('open-plate').click();
const plate = page.getByTestId('pe-plate');
check('PE default plate is 96 wells (8 x 12)', (await plate.getAttribute('data-rows')) === '8' && (await plate.getAttribute('data-cols')) === '12');
await page.getByTestId('pe-size-384').click();
check('PE 384 well plate is 16 x 24', (await plate.getAttribute('data-rows')) === '16' && (await plate.getAttribute('data-cols')) === '24');
await page.getByTestId('pe-size-1536').click();
check('PE 1536 well plate is 32 x 48 (rows to f)', (await plate.getAttribute('data-rows')) === '32' && (await page.getByTestId('well-f48').count()) === 1);
await page.getByTestId('pe-size-custom').click();
await page.getByTestId('pe-dims-cols').fill('6');
await page.getByTestId('pe-dims-rows').fill('4');
await page.getByTestId('pe-dims-ok').click();
check('PE custom 6 x 4', (await plate.getAttribute('data-cols')) === '6' && (await plate.getAttribute('data-rows')) === '4');
await page.getByTestId('pe-size-96').click();

await page.getByTestId('pe-kw-attr').fill('Stim');
await page.getByTestId('pe-kw-value').fill('PMA');
await page.getByTestId('pe-kw-add').click();
await page.getByTestId('well-A1').click();
await page.getByTestId('pe-kw-apply').click();
check('PE add keyword to selected well', (await page.getByTestId('pe-well-display').innerText()).includes('PMA'));
await page.getByTestId('well-C1').click({ modifiers: ['Shift'] });
await page.getByTestId('pe-fill-down').click();
await page.getByTestId('well-C1').click();
check('PE fill down copies A1 into B1..C1', (await page.getByTestId('pe-well-display').innerText()).includes('Stim'));
await page.getByTestId('pe-col-3').click();
await page.getByTestId('pe-titrate').click();
await page.getByTestId('pe-series-attr').fill('Conc');
await page.getByTestId('pe-series-start').fill('8');
await page.getByTestId('pe-series-mult').fill('0.5');
await page.getByTestId('pe-series-down').click();
await page.getByTestId('pe-filter').selectOption('Conc');
check('PE dilution series 8, 4, 2 ... down column 3', (await page.getByTestId('well-A3').innerText()).startsWith('8.0') && (await page.getByTestId('well-C3').innerText()).startsWith('2.0'));
await page.getByTestId('pe-heatmap').check();
const bgTop = await page.getByTestId('well-A3').evaluate((e) => getComputedStyle(e).backgroundColor);
check('PE heat map: maximum value is yellow', bgTop === 'rgb(255, 255, 0)', bgTop);
await page.getByTestId('pe-filter').selectOption('');
await page.getByTestId('pe-add-staging').click();
check('PE staging area has 5 wells after Add Staging Well', (await page.locator('[data-testid^=pe-staging-dup-]').count()) === 5);
await page.getByTestId('pe-read-samples').click();
check('PE Read Samples from Group matches wells by WELL ID keyword', (await page.getByTestId('well-sample-A1').count()) === 1 && (await page.getByTestId('well-sample-B2').count()) === 1);
await page.getByTestId('pe-read-attrs').click();
await page.getByTestId('well-B2').click();
check('PE Read Attributes from Group: non-common keyword Donor in B2', (await page.getByTestId('pe-well-display').innerText()).includes('D2'));
await page.getByTestId('pe-apply').click();
await idle();
check('PE Apply Plate Keywords to Group annotates samples', (await page.getByTestId('log').innerText()).includes('Plate keywords applied to 2 sample(s)'));
await page.getByTestId('pe-select-all').click();
await page.getByTestId('pe-make-group').click();
await idle();
check('PE Make Group from selected wells', (await page.getByTestId('log').innerText()).includes('created with 2 sample(s)'));
const csv = await download(() => page.getByTestId('pe-export').click());
check('PE Save As CSV Table: WELL ID column and 96 rows', csv.startsWith('WELL ID,') && csv.trim().split('\n').length === 97, csv.split('\n')[0]);
await page.getByTestId('pe-add-plate').click();
check('PE Add New Plate', (await page.getByTestId('pe-plate-select').locator('option').count()) === 2);
await page.getByTestId('pe-del-plate').click();
check('PE Delete Plate (confirmed)', (await page.getByTestId('pe-plate-select').locator('option').count()) === 1);
await page.getByTestId('pe-close').click();

// --- Compare Populations
await page.getByTestId('open-compare').click();
await page.getByTestId('compare-pick-sample').selectOption({ label: 'b.fcs' });
await page.getByTestId('compare-add-control').click();
await page.getByTestId('compare-row-FL1-A').waitFor({ timeout: 60000 });
await idle();
const ksd = Number(await page.getByTestId('compare-ksd-FL1-A').innerText());
const ksdFsc = Number(await page.getByTestId('compare-ksd-FSC-A').innerText());
check('CP K-S max difference ~2/3 on the shifted parameter, ~0 on an identical one', ksd > 0.6 && ksd < 0.75 && ksdFsc < 0.05, `${ksd} / ${ksdFsc}`);
check('CP K-S probability text', (await page.getByTestId('compare-ksp-FL1-A').innerText()) === 'greater than 99.9%');
await page.getByTestId('compare-mv').getByText(/T\(X\) =/).waitFor({ timeout: 60000 });
const mvText = await page.getByTestId('compare-mv').innerText();
check('CP multivariate chi-squared footer: T(X) > 0 with 300 bins', /#Bins = 300/.test(mvText) && Number(/T\(X\) = ([\d.]+)/.exec(mvText)?.[1]) > 1, mvText);
await page.getByTestId('compare-rm-scatter').click();
check('CP Remove Scatter drops FSC/SSC rows', (await page.getByTestId('compare-row-FSC-A').count()) === 0 && (await page.getByTestId('compare-row-FL1-A').count()) === 1);
await page.getByTestId('compare-opt-cdf').check();
check('CP graph shown per parameter', (await page.getByTestId('compare-graph-FL1-A').count()) === 1);
await page.getByTestId('compare-close').click();

// --- 3D Viewer
await page.getByTestId('open-threeD').click();
const cv = page.getByTestId('threed-canvas');
await page.waitForFunction(() => Number(document.querySelector('[data-testid=threed-canvas]')?.getAttribute('data-points')) > 0, null, { timeout: 60000 });
check('3D point cloud has events', Number(await cv.getAttribute('data-points')) > 1000, await cv.getAttribute('data-points'));
const yaw0 = await cv.getAttribute('data-yaw');
const box = await cv.boundingBox();
await page.mouse.move(box.x + 300, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 400, box.y + 220); await page.mouse.up();
check('3D drag rotates', (await cv.getAttribute('data-yaw')) !== yaw0);
await page.getByTestId('threed-reset').click();
check('3D Reset restores the default perspective', (await cv.getAttribute('data-yaw')) === yaw0);
await page.getByTestId('threed-close').click();

// --- Create Calibration Parameter (own rule)
await page.getByTestId('open-calibration').click();
await page.getByTestId('calib-channel').selectOption('FL1-A');
for (const [i, m] of [[0, 10], [1, 100], [2, 1000]]) { await page.getByTestId(`calib-mfi-${i}`).fill(String(m)); await page.getByTestId(`calib-mesf-${i}`).fill(String(m * 20)); }
check('CAL fit slope 1, r 1', (await page.getByTestId('calib-fit').innerText()).includes('Slope: 1.0000'));
await page.getByTestId('calib-define').click();
await idle();
check('CAL defines a derived parameter', (await page.getByTestId('open-derived').innerText()).includes('(1)'));

// --- FCS Scan
await page.getByTestId('open-fcsScan').click();
await page.getByTestId('fcsscan-files').setInputFiles([join(out, 'a.fcs'), join(out, 'b.fcs')]);
await page.getByTestId('fcsscan-row-1').waitFor();
check('SCAN lists both files with $TOT', (await page.getByTestId('fcsscan-table').innerText()).includes('4000'));
await page.getByTestId('fcsscan-find').fill('b.fcs');
check('SCAN find filters rows', (await page.locator('[data-testid^=fcsscan-row-]').count()) === 1);
const scsv = await download(() => page.getByTestId('fcsscan-to-csv').click());
check('SCAN save to spreadsheet', scsv.startsWith('Path,$FIL') && scsv.includes('b.fcs'), scsv.split('\n')[0]);

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
