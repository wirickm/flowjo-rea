// FlowJo 10 gate tools through the real UI (Chromium via Playwright):
// docs/validation/flowjo-engine-specs.md section 10.
// Usage: node e2e/gatetools.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-gatetools');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Minimal FCS 3.1 writer: float32 list mode, every $PnR = 262144, stains in $PnS.
const fcsBytes = (names, stains, rows) => {
  const buf = Buffer.alloc(rows.length * names.length * 4);
  rows.forEach((row, e) => row.forEach((v, c) => buf.writeFloatLE(v, (e * names.length + c) * 4)));
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(rows.length), $NEXTDATA: '0', $FIL: 'gates.fcs' };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}S`]: stains[i], [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: '262144', [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  return Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]);
};
// Two dense blobs plus a uniform background (deterministic), on linear
// scatter axes so plot fractions are data fractions.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const rows = [];
const K = 262.144; // values in thousandths of the axis
// FL1-A (stain CD8): bimodal, about 100 and 20000, for BifurGate.
const fl = () => (rnd() < 0.5 ? 100 * Math.exp(0.2 * gauss()) : 20000 * Math.exp(0.2 * gauss()));
for (let i = 0; i < 3000; i++) rows.push([K * (300 + 30 * gauss()), K * (300 + 30 * gauss()), fl()]);
for (let i = 0; i < 3000; i++) rows.push([K * (700 + 30 * gauss()), K * (650 + 30 * gauss()), fl()]);
for (let i = 0; i < 1000; i++) rows.push([K * rnd() * 1000, K * rnd() * 1000, fl()]);
const N = rows.length;
writeFileSync(join(out, 'gates.fcs'), fcsBytes(['FSC-A', 'SSC-A', 'FL1-A'], ['CD3', 'CD4', 'CD8'], rows));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(200);
  // A drawn gate opens Subpopulation Identification; keep its default name.
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const canvas = page.getByTestId('plot-canvas');
// Plot fraction (0..1 of the axis range) to page coordinates.
const at = async (fx, fy) => {
  const box = await canvas.boundingBox();
  return [box.x + 64 + fx * (460 - 78), box.y + 14 + (1 - fy) * (420 - 62)];
};
const click = async (fx, fy, opts = {}) => { const [x, y] = await at(fx, fy); await page.mouse.click(x, y, opts); await idle(); };
const drag = async (fx0, fy0, fx1, fy1) => {
  const [x0, y0] = await at(fx0, fy0); const [x1, y1] = await at(fx1, fy1);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 6 }); await page.mouse.up();
  await idle();
};
const names = async () => (await page.locator('[data-testid^="pop-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').slice(4)))).filter((t) => t !== 'root');
const count = async (name) => Number((await page.getByTestId(`count-${name}`).first().textContent()).replace(/,/g, ''));
const sumOf = async (ns) => (await Promise.all(ns.map(count))).reduce((a, b) => a + b, 0);
const deleteAll = async (prefix) => {
  for (;;) {
    const n = (await names()).find((t) => t.startsWith(prefix));
    if (!n) return;
    await page.getByTestId(`pop-${n}`).click(); await idle();
    await page.getByTestId('delete-pop').click();
    const yes = page.locator('[data-testid^="answer-"]:not([data-testid="answer-cancel"])');
    await page.waitForTimeout(150);
    if (await yes.count()) await yes.first().click();
    await idle();
    await page.getByTestId('pop-root').click(); await idle();
  }
};

await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles([join(out, 'gates.fcs')]);
await idle();
await page.getByTestId('sample-gates.fcs').click();
await idle();
await page.getByTestId('x-channel').selectOption('FSC-A');
await page.getByTestId('y-channel').selectOption('SSC-A');
await idle();

// 10.1 toolbar order (GateWinToolBar full mode, then this app's spline quad).
const tools = await page.locator('.row.tools button[data-testid^="tool-"]').allInnerTexts();
check('10.1 2-D toolbar in FlowJo order', tools.join(',') === 'Arrow,Rectangle,Quad,Ellipse,Polygon,Pencil,Auto Gate,Curly Quad,Spider Quad,Spline quad', tools.join(','));

// 10.1 quad names use the stain: "Q1: CD3- , CD4+" is upper-left.
await page.getByTestId('tool-quadrant').click();
await click(0.5, 0.5);
let ns = await names();
check('10.1 quad names "Q<n>: <stain>+/- , <stain>+/-"', ['Q1: CD3- , CD4+', 'Q2: CD3+ , CD4+', 'Q3: CD3+ , CD4-', 'Q4: CD3- , CD4-'].every((n) => ns.includes(n)), ns.join(' | '));
check('10.1 quads partition the parent', (await sumOf(ns.filter((n) => n.startsWith('Q')))) === N);

// 10.3 spider via the X key; numbering continues at Q5.
await canvas.focus();
await page.keyboard.press('x');
check('10.1 key X selects the spider tool', (await page.getByTestId('tool-spider').getAttribute('class'))?.includes('active'));
await click(0.4, 0.6);
ns = await names();
const spider = ns.filter((n) => /^Q[5-8]:/.test(n));
check('10.3 spider quad: four populations Q5..Q8', spider.length === 4, spider.join(' | '));
check('10.3 spider quadrants partition the parent (lattice rule)', (await sumOf(spider)) === N, String(await sumOf(spider)));
await deleteAll('Q');

// 10.2 curly quad via the C key.
await canvas.focus();
await page.keyboard.press('c');
await click(0.5, 0.5);
ns = await names();
const curly = ns.filter((n) => n.startsWith('Q'));
check('10.2 curly quad: four quadrants that partition the parent', curly.length === 4 && (await sumOf(curly)) === N, `${curly.length} / ${await sumOf(curly)}`);
const curlyUR = await count(curly.find((n) => n.includes('CD3+ , CD4+')));
await deleteAll('Q');

// Plain quad at the same centre: the curly upper-right holds fewer events
// (its arms curve away from the centre).
await page.getByTestId('tool-quadrant').click();
await click(0.5, 0.5);
const quadUR = await count('Q2: CD3+ , CD4+');
check('10.2 curly upper-right is smaller than the straight one', curlyUR < quadUR, `${curlyUR} < ${quadUR}`);
await deleteAll('Q');

// 10.5 pencil: hold and draw around the lower blob.
await page.getByTestId('tool-pencil').click();
{
  const pts = Array.from({ length: 40 }, (_, i) => [0.3 + 0.12 * Math.cos((2 * Math.PI * i) / 40), 0.3 + 0.12 * Math.sin((2 * Math.PI * i) / 40)]);
  const [x0, y0] = await at(...pts[0]);
  await page.mouse.move(x0, y0); await page.mouse.down();
  for (const p of pts.slice(1)) { const [x, y] = await at(...p); await page.mouse.move(x, y); }
  await page.mouse.up(); await idle();
}
ns = await names();
const pencil = ns.find((n) => n.startsWith('Polygon'));
const pc = pencil ? await count(pencil) : 0;
check('10.5 pencil makes a polygon around the blob', !!pencil && pc > 2500 && pc < 3500, `${pencil} ${pc}`);

// 10.5 auto gate: contours appear; clicking on the upper blob gates it.
await page.getByTestId('tool-autogate').click();
await page.waitForFunction(() => Number(document.querySelector('[data-testid=plot-canvas]')?.dataset.autoContours) > 3, null, { timeout: 60000 });
// The contour with the vertex nearest the mouse is picked: hover on the
// blob's flank (the innermost contours at its centre are tiny).
{ const [x, y] = await at(0.77, 0.65); await page.mouse.move(x, y); }
await click(0.77, 0.65);
ns = await names();
const auto = ns.filter((n) => n.startsWith('Polygon') && n !== pencil);
const ac = auto.length ? await count(auto[0]) : 0;
check('10.5 auto gate makes a polygon on a contour of the upper blob', auto.length === 1 && ac > 500 && ac < 3600, `${auto.join(',')} ${ac}`);

// 10.7 convert: polygon to rectangle keeps the population.
await page.getByTestId(`pop-${pencil}`).click(); await idle();
await page.getByTestId('gate-convert').selectOption('rect'); await idle();
const after = await count(pencil);
check('10.7 convert polygon to rect keeps the population (bounding box holds more)', after >= pc, `${pc} -> ${after}`);

// 10.4 magnetic: a rectangle half off the blob moves onto it.
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('tool-rect').click();
await drag(0.2, 0.2, 0.32, 0.32);
ns = await names();
const rect = ns.find((n) => n.startsWith('Rect'));
const before = await count(rect);
await page.getByTestId(`pop-${rect}`).click(); await idle();
await page.getByTestId('gate-magnetic').check(); await idle();
const moved = await count(rect);
check('10.4 magnetic gate moves toward the densest events', moved > before, `${before} -> ${moved}`);

// 10.7 copy and paste under another population.
await page.getByTestId('gate-copy').click();
await page.getByTestId(`pop-${pencil}`).click(); await idle();
await page.getByTestId('gate-paste').click(); await idle();
check('10.7 paste adds the copied gate under the selected population', (await page.getByTestId(`pop-${rect}`).count()) === 2);

// 10.1 bisector on a histogram: "<stain>-" and "<stain>+".
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('plot-kind').selectOption('histogram'); await idle();
const tools1 = await page.locator('.row.tools button[data-testid^="tool-"]').allInnerTexts();
check('10.1 1-D toolbar: Arrow, Range, Bisector', tools1.join(',') === 'Arrow,Range,Bisector', tools1.join(','));
await page.getByTestId('tool-bisector').click();
await click(0.5, 0.5);
check('10.1 bisector halves "CD3-" / "CD3+" partition the parent', (await count('CD3-')) + (await count('CD3+')) === N, `${await count('CD3-')} + ${await count('CD3+')}`);

// 10.6 manual entry (Ctrl+G): a range from typed bounds.
await page.keyboard.press('Control+g');
await page.getByTestId('manual-x0').fill(String(200 * K));
await page.getByTestId('manual-x1').fill(String(400 * K));
await page.getByTestId('manual-ok').click(); await idle();
const manual = await count('FSC-A subset');
check('10.6 manual entry makes "FSC-A subset" from typed bounds', manual > 2500 && manual < 3600, String(manual));

// 10.6 manual entry in Percentile units: a percent gate (25 to 75).
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('manual-gate').click();
await page.getByTestId('manual-units-0').selectOption('percentile');
await page.getByTestId('manual-x0').fill('25');
await page.getByTestId('manual-x1').fill('75');
await page.getByTestId('manual-ok').click(); await idle();
const pctName = (await names()).filter((n) => n.startsWith('FSC-A subset')).pop();
const pctCount = await count(pctName);
check('10.6 percentile manual entry holds about half the parent', pctCount > 0.4 * N && pctCount < 0.6 * N, `${pctName} ${pctCount}`);

// 10.8 BifurGate on a bimodal fluorescent parameter.
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('bifurgate').click(); await idle();
const lo = await count('CD8-'), hi = await count('CD8+');
check('10.8 BifurGate splits the bimodal parameter at its valley', lo > 0.35 * N && hi > 0.35 * N && lo + hi === N, `${lo} + ${hi}`);

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
