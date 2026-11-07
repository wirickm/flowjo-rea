// Event export options through the real UI (Chromium via Playwright):
// FlowJo 10 event cap and concatenation (docs/validation/flowjo-engine-specs.md 9).
// Usage: node e2e/export.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-export');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Minimal FCS 3.1 writer: float32 list mode, every $PnR = 1024.
const fcsBytes = (names, rows, extra = {}) => {
  const buf = Buffer.alloc(rows.length * names.length * 4);
  rows.forEach((row, e) => row.forEach((v, c) => buf.writeFloatLE(v, (e * names.length + c) * 4)));
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(rows.length), $NEXTDATA: '0', ...extra };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: '1024', [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  return Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]);
};
const col = (n, start) => Array.from({ length: n }, (_, i) => [start + i]);
writeFileSync(join(out, 'late.fcs'), fcsBytes(['A'], col(10, 0), { $FIL: 'late.fcs', $ETIM: '10:00:09' }));
writeFileSync(join(out, 'early.fcs'), fcsBytes(['A'], col(4, 100), { $FIL: 'early.fcs', $ETIM: '10:00:01' }));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const download = async (fn) => {
  const [d] = await Promise.all([page.waitForEvent('download'), fn()]);
  const p = join(out, d.suggestedFilename());
  await d.saveAs(p);
  return p;
};
const logText = async () => page.getByTestId('log').innerText();
const pops = async () => (await page.locator('.panel.tree .pname').allInnerTexts()).filter((t) => t !== 'All events');
const canvas = page.getByTestId('plot-canvas');
const drag = async (fx0, fy0, fx1, fy1) => {
  const box = await canvas.boundingBox();
  const at = (fx, fy) => [box.x + 64 + fx * (460 - 78), box.y + 14 + (1 - fy) * (420 - 62)];
  const [x0, y0] = at(fx0, fy0);
  const [x1, y1] = at(fx1, fy1);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
  await idle();
};

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([join(out, 'late.fcs'), join(out, 'early.fcs')]);
await idle();
await page.getByTestId('sample-late.fcs').click();
await idle();
await page.getByTestId('open-export').click();
// 9: no more than 3 of 10 events: positions 0, 3, 6 (step decimation, not random).
await page.getByTestId('exp-cap-on').check();
await page.getByTestId('exp-cap').fill('3');
const capped = readFileSync(await download(() => page.getByTestId('export-csv').click()), 'utf8').trim().split('\n');
check('9 no more than N takes every step-th event', capped.join('|') === 'A|0|3|6', capped.join('|'));
// 9: concatenate the group: $ETIM order, SampleID parameter.
await page.getByTestId('exp-cap-on').uncheck();
await page.getByTestId('exp-mode-concat').check();
const cat = readFileSync(await download(() => page.getByTestId('export-csv').click()), 'utf8').trim().split('\n');
check('9 concatenation is in $ETIM order with a SampleID column', cat[0] === 'A,SampleID' && cat[1] === '100,1' && cat[5] === '0,2' && cat.length === 15, `${cat[0]} | ${cat[1]} | ${cat[5]} | ${cat.length}`);

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
