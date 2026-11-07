// FlowJo 10 Kinetics window through the real UI (Chromium via Playwright):
// docs/validation/flowjo-engine-specs.md section 11.
// Usage: node e2e/kinetics.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-kinetics');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Minimal FCS 3.1 writer: float32 list mode.
const fcsBytes = (names, ranges, rows, extra) => {
  const buf = Buffer.alloc(rows.length * names.length * 4);
  rows.forEach((row, e) => row.forEach((v, c) => buf.writeFloatLE(v, (e * names.length + c) * 4)));
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(rows.length), $NEXTDATA: '0', $FIL: 'kin.fcs', ...extra };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: String(ranges[i]), [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  return Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]);
};
// 400 s of events (Time 0..400 in steps of 0.05); FL1-A steps from 100 to
// 300 at t = 200 (a calcium-flux-like response).
const rows = [];
for (let i = 0; i < 8000; i++) { const t = i * 0.05; rows.push([t, (t < 200 ? 100 : 300) + ((i * 7919) % 13) - 6]); }
writeFileSync(join(out, 'kin.fcs'), fcsBytes(['Time', 'FL1-A'], [400, 1024], rows, { $BTIM: '10:00:00', $ETIM: '10:06:40' }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
const idle = async () => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const rowsOf = async () => page.locator('[data-testid=kin-table] tbody tr td:first-child').allInnerTexts();
const cell = async (name, col) => (await page.getByTestId(`kin-row-${name}`).locator('td').nth(col).innerText()).replace(/,/g, '');

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([join(out, 'kin.fcs')]);
await idle();
await page.getByTestId('sample-kin.fcs').click();
await idle();
await page.getByTestId('open-platforms').click();
await page.getByTestId('platform-kind').selectOption('kinetics');
await page.getByTestId('kin-row-All Events').waitFor({ timeout: 30000 });

// 11.1 defaults: Median, no smoothing; series length from the engine's binning.
check('11.1 defaults: statistic Median, smoothing None', (await page.getByTestId('kin-stat').inputValue()) === 'Median' && (await page.getByTestId('kin-smoothing').inputValue()) === 'None');
const pts = Number(await page.getByTestId('kin-chart').getAttribute('data-points'));
// Last event at 399.95: R = 399.95, width 1, trunc((R + 1) / 1) = 400 bins.
check('11.2 series length from the engine binning: 400 points', pts === 400, String(pts));

await page.getByTestId('kin-stat').selectOption('Mean');
await idle();
// 11.4 drag a timeslice over the second half: "Range #2".
{
  const box = await page.getByTestId('kin-chart').boundingBox();
  await page.mouse.move(box.x + box.width * 0.6, box.y + 60); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + 60, { steps: 5 }); await page.mouse.up();
}
await page.getByTestId('kin-name-form').waitFor();
check('11.4 a dragged timeslice is named "Range #2" by default', (await page.getByTestId('kin-name').inputValue()) === 'Range #2');
await page.getByTestId('kin-name-ok').click(); await idle();
await page.getByTestId('kin-row-Range #2').waitFor();
const peak = Number(await cell('Range #2', 4));
check('11.5 the late slice peaks near 300', peak > 290 && peak < 310, String(peak));

// 11.4 multiple ranges: prefix p, 4 slices back to back.
await page.getByTestId('kin-multi').click();
await page.getByTestId('kin-multi-prefix').fill('p');
await page.getByTestId('kin-multi-number').fill('4');
await page.getByTestId('kin-multi-ok').click(); await idle();
const names = await rowsOf();
check('11.4 multiple ranges p1..p4 after All Events, sorted by start', ['p1', 'p2', 'p3', 'p4'].every((n) => names.includes(n)) && names[0] === 'All Events', names.join(','));
check('11.4 p2 runs from 100 to 200', (await cell('p2', 1)) === '100' && (await cell('p2', 2)) === '200', `${await cell('p2', 1)}..${await cell('p2', 2)}`);

// 11.3 threshold statistic with an absolute threshold.
await page.getByTestId('kin-stat').selectOption('% of cells over Threshold T');
await page.getByTestId('kin-threshold').click();
await page.getByTestId('kin-th-value').fill('200');
await page.getByTestId('kin-th-define').click(); await idle();
await page.getByTestId('kin-row-p4').waitFor();
const late = Number(await cell('p4', 5)), early = await cell('p1', 5);
// Early points are all 0, and FlowJo skips runs of zeros as gaps: NaN.
check('11.3 % over T = 200: about 100 late; the all-zero early slice is NaN (zeros are gaps)', early === 'NaN' && late > 99, `${early} / ${late}`);

// 11.6 timeslice statistics as table columns.
await page.getByTestId('kin-add-table').click(); await idle();
await page.getByRole('dialog').getByLabel('Close').click();
await idle();
const heads = await page.locator('.panel.stats th').allInnerTexts();
check('11.6 Add to table makes Start t .. dt columns per slice', heads.some((h) => h.includes('Peak (p4)')) && heads.some((h) => h.includes('AUC (Range #2)')), `${heads.length} headers`);

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
