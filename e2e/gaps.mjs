// Remaining interaction gaps through the real UI (specs 20): text paste into
// the sample table, drag and drop (files, populations, matrices), right-click
// menus, Copy Histogram Function / Copy Statistics.
// Usage: node e2e/gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
mkdirSync(join(root, 'test-results', 'e2e'), { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Minimal FCS 3.1 (float32) as in e2e/gatetools.mjs.
const fcsBytes = (file, names, rows) => {
  const buf = Buffer.alloc(rows.length * names.length * 4);
  rows.forEach((row, e) => row.forEach((v, c) => buf.writeFloatLE(v, (e * names.length + c) * 4)));
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(rows.length), $NEXTDATA: '0', $FIL: file };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: '262144', [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  return Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]);
};
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rows = Array.from({ length: 4000 }, () => [rnd() * 262144, rnd() * 262144, rnd() * 262144, rnd() * 262144]);
const NAMES = ['FSC-A', 'SSC-A', 'FL1-A', 'FL2-A'];
const fileA = fcsBytes('a.fcs', NAMES, rows).toString('base64');
const fileB = fcsBytes('b.fcs', NAMES, rows.slice(0, 3000)).toString('base64');
const mtx = `<?xml version="1.0"?><gating:gatingML xmlns:gating="http://www.isac-net.org/std/Gating-ML/v2.0/gating" xmlns:transforms="http://www.isac-net.org/std/Gating-ML/v2.0/transformations" xmlns:data-type="http://www.isac-net.org/std/Gating-ML/v2.0/datatypes"><transforms:spilloverMatrix name="Dropped" transforms:id="d1"><data-type:parameters><data-type:parameter data-type:name="FL1-A"/><data-type:parameter data-type:name="FL2-A"/></data-type:parameters><transforms:spillover data-type:parameter="FL1-A"><transforms:coefficient transforms:value="1"/><transforms:coefficient transforms:value="0.1"/></transforms:spillover><transforms:spillover data-type:parameter="FL2-A"><transforms:coefficient transforms:value="0.05"/><transforms:coefficient transforms:value="1"/></transforms:spillover></transforms:spilloverMatrix></gating:gatingML>`;

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1700, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
// Drops files (name, base64 or text, type) on the element matching selector.
const dropFiles = async (selector, files) => {
  await page.evaluate(({ selector, files }) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const data = f.b64 ? Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0)) : f.text;
      dt.items.add(new File([data], f.name, { type: f.type ?? '' }));
    }
    const el = document.querySelector(selector);
    el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, { selector, files });
};
const canvas = page.getByTestId('plot-canvas');
const at = async (fx, fy) => { const b = await canvas.boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };

await page.goto(base);

// 1. File drop on the window opens FCS files
await dropFiles('.app', [{ name: 'a.fcs', b64: fileA }, { name: 'b.fcs', b64: fileB }]);
await idle();
check('FCS files dropped on the window are added', (await page.getByTestId('sample-a.fcs').count()) === 1 && (await page.getByTestId('sample-b.fcs').count()) === 1);
await page.getByTestId('sample-a.fcs').click();
await idle();

// 1b. Text paste (before any population copy: nodes paste first) into the sample table
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData('text/plain', 'Donor\tDay\nD1\t0\nD2\t7\n');
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
});
await idle();
const annA = await page.locator('body').textContent();
await page.getByTestId('sample-b.fcs').click();
await idle();
const annB = await page.locator('body').textContent();
check('pasted tab text fills keyword columns from the selected sample down', annA.includes('Donor') && annA.includes('D1') && annB.includes('D2'));
await page.getByTestId('undo').click();
await idle();
check('the text paste is one undo step', !(await page.locator('body').textContent()).includes('D2'));
await page.getByTestId('sample-a.fcs').click();
await idle();

// 2. Matrix dropped on a sample is applied to it
await dropFiles('[data-testid="sample-b.fcs"]', [{ name: 'dropped.mtx', text: mtx }]);
await idle();
const log = (await page.locator('.log, [data-testid=log]').first().textContent().catch(() => '')) || (await page.locator('body').textContent());
check('a matrix dropped on a sample is added and applied there', log.includes('Matrix "Dropped" added and applied to 1 sample(s)'));

// 3. Population dragged onto another sample and onto a group
await page.getByTestId('tool-rect').click();
const [x0, y0] = await at(0.1, 0.1); const [x1, y1] = await at(0.5, 0.5);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
await page.getByTestId('pop-Rect 1').dragTo(page.getByTestId('sample-b.fcs'));
await idle();
await page.getByTestId('sample-b.fcs').click();
await idle();
check('a population dragged onto a sample is copied there', (await page.getByTestId('pop-Rect 1').count()) === 1);
await page.getByTestId('sample-a.fcs').click();
await idle();
await page.getByTestId('pop-Rect 1').dragTo(page.getByTestId('pop-Rect 1'));
await idle();
check('dropping a population onto itself is refused', (await page.locator('[data-testid^="pop-"]:not([data-testid="pop-root"])').count()) === 1);

// 4. Right-click menu on a population
await page.getByTestId('pop-Rect 1').click({ button: 'right' });
const items = await page.getByTestId('context-menu').locator('button').allInnerTexts();
check('population right-click menu follows FlowJo order', items.slice(0, 4).join(',') === 'Copy,Paste,Rename,Delete' && items.includes('Copy analysis to group'), items.join(','));
await page.getByTestId('ctx-Copy').click();
await page.getByTestId('sample-b.fcs').click({ button: 'right' });
await page.getByTestId('ctx-Paste').click();
await idle();
const dupNote = (await page.locator('body').textContent()).includes('already exists there');
check('sample right-click Paste pastes (name clash reported)', dupNote);

// 5. Right-click on a gate in the plot
await page.getByTestId('sample-a.fcs').click();
await page.getByTestId('pop-root').click();
await idle();
await page.getByTestId('tool-select').click();
const [gx, gy] = await at(0.3, 0.3);
await page.mouse.click(gx, gy, { button: 'right' });
const gitems = await page.getByTestId('context-menu').locator('button').allInnerTexts();
check('gate right-click menu: Rename, Clear, conversions, copies', gitems[0] === 'Rename...' && gitems[1] === 'Clear' && gitems.includes('Convert to Polygon') && gitems.includes('Copy Image'), gitems.join(','));
await page.getByTestId('ctx-Convert to Polygon').click();
await idle();
await page.mouse.click(gx, gy, { button: 'right' });
check('Convert to Polygon is applied (now disabled)', await page.getByTestId('ctx-Convert to Polygon').isDisabled());
await page.keyboard.press('Escape');
await page.mouse.click(5, 5);

// 6. Copy Statistics and Copy Histogram Function
await page.getByTestId('pop-Rect 1').click();
await page.getByTestId('stat-kind').selectOption('count');
await page.getByTestId('add-stat').click();
await idle();
await page.mouse.click(gx, gy, { button: 'right' });
await page.getByTestId('ctx-Copy Statistics').click();
await page.waitForTimeout(200);
const st = await page.evaluate(() => navigator.clipboard.readText());
check('Copy Statistics puts "<statistic>\\t<value>" lines on the clipboard', /Count\t\d/.test(st), st);
await page.getByTestId('plot-kind').selectOption('histogram');
await idle();
await canvas.focus();
await page.keyboard.press('Control+f');
await page.waitForTimeout(200);
const hist = (await page.evaluate(() => navigator.clipboard.readText())).split('\n');
check('Ctrl+F copies the histogram: header then one row per bin', hist[0].endsWith('\tCount') && hist.length > 50 && /^[-\d.e+]+\t\d+$/.test(hist[1]), `${hist[0]} / ${hist[1]} (${hist.length} rows)`);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
