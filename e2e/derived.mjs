// FlowJo 10 Derive Parameters through the real UI (Chromium via Playwright):
// docs/validation/flowjo-engine-specs.md section 12.
// Usage: node e2e/derived.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-derived');
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
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(rows.length), $NEXTDATA: '0', $FIL: 'dp.fcs', ...extra };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: String(ranges[i]), [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  return Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]);
};
// FL1-A = 100 + i % 50, FL2-A = 50: FL1-A / FL2-A spans 2 to 2.98.
const rows = [];
for (let i = 0; i < 2000; i++) rows.push([100 + (i % 50), 50]);
writeFileSync(join(out, 'dp.fcs'), fcsBytes(['FL1-A', 'FL2-A'], [1024, 1024], rows, {}));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([join(out, 'dp.fcs')]);
await idle();
await page.getByTestId('sample-dp.fcs').click();
await idle();
await page.getByTestId('open-derived').click();
check('12.4 default name "Derived"', (await page.getByTestId('derived-name').inputValue()) === 'Derived');
await page.getByTestId('derived-name').fill('New Parameter');
check('12.4 a name with a space is refused', await page.getByTestId('derived-name-error').isVisible());
await page.getByTestId('derived-name').fill('Ratio');
await page.getByTestId('derived-formula').fill('FL1-A / (FL2-A');
const perr = await page.getByTestId('derived-error').innerText();
check('12.3 a parse error shows FlowJo\'s message', perr.includes('Unbalanced open and close parentheses.'), perr);
await page.getByTestId('derived-formula').fill('');
await page.getByTestId('derived-insert-ref').selectOption('FL1-A');
await page.getByTestId('derived-insert-op').selectOption(' / ');
await page.getByTestId('derived-insert-ref').selectOption('FL2-A');
check('12.4 references and operators are inserted as text', (await page.getByTestId('derived-formula').inputValue()) === 'FL1-A / FL2-A');
await page.getByTestId('derived-add').click();
await page.getByTestId('derived-formula').fill('Event #');
await page.getByTestId('derived-add').click();
const listed = await page.getByTestId('derived-list').innerText();
check('12.4 both parameters are listed (default name advances to Derived)', listed.includes('Ratio') && listed.includes('Derived'), listed.replace(/\s+/g, ' '));
await page.getByRole('dialog').getByLabel('Close').click();
await idle();
await page.getByTestId('pop-root').click();
await page.getByTestId('stat-kind').selectOption('max');
await page.getByTestId('stat-channel').selectOption('Ratio');
await page.getByTestId('add-stat').click();
await idle(); await page.waitForTimeout(400); await idle();
const v = Number(await page.locator('[data-testid=stats-table] tbody tr').first().locator('td').last().innerText());
check('12.2 the formula parameter is computed per event (max FL1-A / FL2-A = 2.98)', Math.abs(v - 2.98) < 1e-3, String(v));

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
