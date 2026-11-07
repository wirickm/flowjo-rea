// FlowJo 10 preferences, Don't Ask Again, edge warning, shortcuts, table editor through the real UI (Chromium via Playwright):
// docs/validation/flowjo-engine-specs.md sections 16 and 17.
// Usage: node e2e/prefs.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-prefs');
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
// FL2-A = 5000 > its range 1024: every event piles on the y axis upper edge.
const rows = [];
for (let i = 0; i < 2000; i++) rows.push([100 + (i % 50), 5000]);
writeFileSync(join(out, 'dp.fcs'), fcsBytes(['FL1-A', 'FL2-A'], [1024, 1024], rows, {}));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([join(out, 'dp.fcs')]);
await idle();
await page.getByTestId('sample-dp.fcs').click();
await idle();
await page.getByTestId('y-channel').selectOption('FL2-A');
await idle(); await page.waitForTimeout(400);
const ew = page.getByTestId('edge-warning');
check('16.3 edge warning: all events on an edge', (await ew.count()) === 1 && (await ew.innerText()) === 'Warning: Nearly all events are on the chart edges!', (await ew.count()) ? await ew.innerText() : 'none');

await page.keyboard.press(`${mod}+y`);
check('16.4 Ctrl/Cmd+Y opens Preferences', await page.getByTestId('prefs-dialog').isVisible());
await page.getByTestId('pref-edge').uncheck();
await page.getByTestId('pref-noundo').check();
await page.getByTestId('prefs-close').click();
check('16.3 edge warning off in preferences hides it', (await ew.count()) === 0);

await page.getByTestId('pop-root').click();
await page.getByTestId('stat-kind').selectOption('count');
await page.getByTestId('add-stat').click();
await idle(); await page.waitForTimeout(400); await idle();
check('16.1 / 19.3 Disable Undo applies to the next workspace: the open history is kept', !(await page.getByTestId('undo').isDisabled()));

await page.keyboard.press(`${mod}+t`);
check('16.4 Ctrl/Cmd+T opens the table editor', await page.getByTestId('tables-dialog').isVisible());
await page.getByTestId('table-new').click();
await page.getByTestId('table-add-stat').selectOption({ index: 1 });
await page.getByTestId('table-kw').fill('$FIL');
await page.getByTestId('table-add-kw').click();
await idle(); await page.waitForTimeout(400); await idle();
const prev = await page.getByTestId('table-preview').innerText();
check('17.1 statistic and keyword columns fill the preview', prev.includes('2000') && prev.includes('dp.fcs'), prev.replace(/\s+/g, ' '));
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('table-csv').click()]);
const { readFileSync } = await import('node:fs');
const csv = readFileSync(await dl.path(), 'utf8');
check('17.3 CSV output: empty corner cell, a row per sample', csv.startsWith(',') && csv.trim().split('\n').length === 2, JSON.stringify(csv));
await page.getByTestId('table-delete').click();
check('17.4 delete asks "Are you sure you want to delete this table? "', (await page.getByTestId('question').innerText()).includes('Are you sure you want to delete this table?'));
await page.getByTestId('dont-ask').check();
await page.getByTestId('answer-Delete').click();
await page.getByTestId('table-new').click();
await page.getByTestId('table-delete').click();
check('16.2 Don\'t ask again: the second delete does not ask', (await page.getByTestId('question').count()) === 0 && (await page.getByTestId('table-select').locator('option').count()) === 1);
await page.getByTestId('tables-close').click();
await page.getByTestId('open-prefs').click();
const rb = page.getByTestId('pref-reset-dontask');
check('16.2 Reset All Don\'t Show Memory lists one remembered answer', (await rb.innerText()).includes('(1)'));
await rb.click();
check('16.2 reset empties the memory', await rb.isDisabled());
await page.getByTestId('prefs-close').click();

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
