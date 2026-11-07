// Groups through the real UI (Chromium via Playwright): FlowJo 10 group
// criteria and group-owned analysis (docs/validation/flowjo-engine-specs.md 7).
// Usage: node e2e/groups.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-groups');
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
let seed = 7;
const u = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 0.5) / 4294967296;
const rows = (n) => Array.from({ length: n }, () => [1024 * u(), 1024 * u(), 50 + 900 * u()]);
const CH = ['FSC-A', 'SSC-A', 'FL1-A'];
writeFileSync(join(out, 'low.fcs'), fcsBytes(CH, rows(2000), { $FIL: 'low.fcs', DOSE: '5', $P3S: 'CD3' }));
writeFileSync(join(out, 'high.fcs'), fcsBytes(CH, rows(2500), { $FIL: 'high.fcs', DOSE: '20', $P3S: 'CD3' }));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(200);
  // A drawn gate opens Subpopulation Identification; keep its default name.
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
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

await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([join(out, 'low.fcs'), join(out, 'high.fcs')]);
await idle();
const groupCount = async (name) => Number(await page.getByTestId(`group-${name}`).locator('.pcount').innerText());

// 7.1: numeric comparison when the value is a number (as text "5" > "10").
await page.getByTestId('create-group').click();
await page.getByTestId('gd-name').fill('High dose');
await page.getByTestId('gd-key-0').fill('DOSE');
await page.getByTestId('gd-op-0').selectOption('gt');
await page.getByTestId('gd-val-0').fill('10');
await page.getByTestId('gd-save').click();
await idle();
check('7.1 live group "DOSE > 10" compares numerically', (await groupCount('High dose')) === 1);

// 7.1: remove from the current group only; deleting a group asks first.
await page.getByLabel('check low.fcs').check();
await page.getByLabel('check high.fcs').check();
await page.getByTestId('new-group').click();
await idle();
const manual = (await page.locator('.groups .pname').allInnerTexts()).find((t) => t.startsWith('Group'));
await page.getByTestId(`group-${manual}`).click();
await page.getByTestId('sample-low.fcs').click();
await page.getByTestId('remove-sample').click();
const rq = await page.getByTestId('question').innerText();
await page.getByTestId('answer-Remove from group').click();
await idle();
const left = await groupCount(manual);
await page.getByTestId('group-All Samples').click();
const total = await groupCount('All Samples');
check('7.1 remove sample asks workspace or group; "from group" keeps it in the workspace', rq.includes('only from group') && left === 1 && total === 2, `group ${left}, workspace ${total}`);
await page.getByTestId(`group-${manual}`).click();
await page.getByTestId('delete-group').click();
const dq = await page.getByTestId('question').innerText();
await page.getByTestId('answer-Delete').click();
await idle();
check('7.1 deleting a group asks first', dq.includes('Delete group') && (await page.locator(`[data-testid="group-${manual}"]`).count()) === 0);

// 7.2: copy analysis to group makes it group-owned; delete offers the FlowJo choices.
await page.getByTestId('group-All Samples').click();
await page.getByTestId('sample-low.fcs').click();
await idle();
await page.getByTestId('tool-rect').click();
await drag(0.1, 0.1, 0.6, 0.6);
await page.getByTestId('pop-Rect 1').click();
await page.getByTestId('apply-group').click();
await idle();
const owned = (await pops()).some((t) => t.includes('Rect 1') && t.includes('(G)'));
await page.getByTestId('sample-high.fcs').click();
await idle();
const copied = (await pops()).some((t) => t.includes('Rect 1'));
await page.getByTestId('pop-Rect 1').click();
await page.getByTestId('delete-pop').click();
const gq = await page.getByTestId('question').innerText();
await page.getByTestId('answer-Allocate To First Sample').click();
await idle();
const highLeft = (await pops()).some((t) => t.includes('Rect 1'));
await page.getByTestId('sample-low.fcs').click();
await idle();
const lowLeft = (await pops()).some((t) => t.includes('Rect 1') && !t.includes('(G)'));
check('7.2 group-owned analysis: Allocate To First Sample keeps it only in the first member, sample-owned', owned && copied && gq.includes('Delete Entirely') && !highLeft && lowLeft, `owned ${owned}, copied ${copied}, high ${highLeft}, low ${lowLeft}`);

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
