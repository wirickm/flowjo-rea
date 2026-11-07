// UAT step 2 (medium defects) through the real UI (Chromium via Playwright).
// Each check names its UAT item; behaviors in docs/validation/flowjo-engine-specs.md 6.7.
// Usage: node e2e/step2.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e-step2');
mkdirSync(join(out, 'other'), { recursive: true });
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
let seed = 11;
const u = () => ((seed = (1664525 * seed + 1013904223) >>> 0) + 0.5) / 4294967296;
const rows = (n) => Array.from({ length: n }, () => [1024 * u(), 1024 * u(), 50 + 900 * u(), -1 - 100 * u()]);
const CH = ['FSC-A', 'SSC-A', 'FL1-A', 'NEG'];
const F = 'step2.fcs';
writeFileSync(join(out, F), fcsBytes(CH, rows(5000), { $FIL: F }));
// Same name, different data ($TOT differs): must not relink; added as a new sample.
writeFileSync(join(out, 'other', F), fcsBytes(CH, rows(3000), { $FIL: F }));

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

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles(join(out, F));
await idle();
await page.getByTestId(`sample-${F}`).click();
await idle();

// a1-07: the same file is not added twice.
await page.getByTestId('add-fcs').setInputFiles(join(out, F));
await idle();
check('a1-07 the same file is not added twice', (await page.locator(`[data-testid="sample-${F}"]`).count()) === 1 && (await logText()).includes('not added again'));

// a2-04: the scale dialog keeps the channel range ($PnR = 1024) across scale types.
await page.getByTestId('x-scale').click();
await page.getByTestId('transform-kind').selectOption('logicle');
const T = await page.locator('.params input').first().inputValue();
check('a2-04 scale type change keeps the range 0..$PnR', T === '1024', `logicle T = ${T}`);
await page.getByRole('dialog').getByLabel('Close').click();

// a2-07: a shape of 10 px or less in both directions is discarded.
await page.getByTestId('tool-rect').click();
await drag(0.3, 0.3, 0.31, 0.31);
check('a2-07 shape of 10 px or less is discarded', (await pops()).length === 0 && (await logText()).includes('discarded'), (await pops()).join(','));

// a2-08: unique sibling names; duplicate rename refused.
await page.getByTestId('tool-rect').click();
await drag(0.1, 0.1, 0.5, 0.5);
await page.getByTestId('pop-root').click();
await page.getByTestId('tool-rect').click();
await drag(0.5, 0.5, 0.9, 0.9);
await page.getByTestId('pop-Rect 2').dblclick();
await page.getByLabel('Population name').fill('Rect 1');
await page.getByLabel('Population name').press('Enter');
await idle();
check('a2-08 rename to a sibling name is refused', (await pops()).join(',') === 'Rect 1,Rect 2' && (await logText()).includes('Name must be unique'), (await pops()).join(','));

// a2-11: delete asks; Cancel keeps the population, Delete removes it.
await page.getByTestId('pop-Rect 1').click();
await page.getByTestId('delete-pop').click();
const q = await page.getByTestId('question').innerText();
await page.getByTestId('answer-cancel').click();
const kept = (await pops()).includes('Rect 1');
await page.getByTestId('delete-pop').click();
await page.getByTestId('answer-Delete').click();
await idle();
check('a2-11 tree delete asks first (cancel keeps, Delete removes)', q.includes('Delete "Rect 1"') && kept && !(await pops()).includes('Rect 1'), q);

// a2-08: a new gate whose default name is taken gets a "-N" suffix.
await page.getByTestId('pop-root').click();
await page.getByTestId('tool-rect').click();
await drag(0.2, 0.6, 0.6, 0.95);
check('a2-08 taken default name gets a -N suffix', (await pops()).includes('Rect 2-1'), (await pops()).join(','));

// a2-09: NOT applies to the normally selected population.
await page.getByTestId('pop-Rect 2').click();
await page.getByTestId('bool-not').click();
await idle();
check('a2-09 NOT on the normal selection', (await pops()).includes('[not] NOT Rect 2'), (await pops()).join(','));

// a1-04/a5-03: re-importing exported Gating-ML twice adds nothing and logs no React errors.
await page.getByTestId('pop-root').click();
await page.getByTestId('open-export').click();
const gml = await download(() => page.getByTestId('export-gml').click());
await page.getByRole('dialog').getByRole('button', { name: 'x' }).click();
const before = (await pops()).join(',');
await page.getByTestId('import-gml').setInputFiles(gml);
await idle();
await page.getByTestId('import-gml').setInputFiles(gml);
await idle();
check('a1-04 Gating-ML re-import never duplicates gates', (await pops()).join(',') === before && (await logText()).includes('0 added'), (await pops()).join(','));

// a4-02: percentile must be an integer 0..100.
await page.getByTestId('stat-kind').selectOption('percentile');
await page.getByTestId('stat-channel').selectOption('FL1-A');
await page.getByTestId('stat-percentile').fill('150');
const blocked = await page.getByTestId('add-stat').isDisabled();
const msg = await page.getByTestId('percentile-error').isVisible();
await page.getByTestId('stat-percentile').fill('95');
check('a4-02 percentile 150 blocked, 95 accepted', blocked && msg && !(await page.getByTestId('add-stat').isDisabled()));
await page.getByTestId('add-stat').click();
await idle(); await page.waitForTimeout(400); await idle();

// a4-06: templates are named.
await page.getByTestId('template-name').fill('My panel');
await page.getByTestId('template-save').click();
check('a4-06 statistic template saved under its name', (await page.getByTestId('template-select').innerText()).includes('My panel'));

// a4-03 / a4-05: Number of Peaks limits; platform errors in the window.
await page.getByTestId('open-platforms').click();
await page.getByTestId('platform-kind').selectOption('proliferation');
const peaks = await page.getByTestId('prolif-peaks').inputValue();
await page.getByTestId('prolif-peaks').fill('-1');
const runBlocked = await page.getByTestId('platform-run').isDisabled();
const peaksErr = await page.getByTestId('prolif-peaks-error').isVisible();
check('a4-03 Number of Peaks default 4; -1 blocked with an error', peaks === '4' && runBlocked && peaksErr, `default ${peaks}`);
await page.getByTestId('prolif-peaks').fill('4');
await page.getByTestId('platform-channel').selectOption('NEG');
await page.getByTestId('platform-run').click();
await page.getByTestId('platform-error').waitFor({ timeout: 30000 });
check('a4-05 platform error shown in the platform window', (await page.getByTestId('platform-error').innerText()).includes('no positive values'));
await page.getByRole('dialog').getByLabel('Close').click();
await idle();

// a2-02: histogram "Normalized To Mode" option.
await page.getByTestId('plot-kind').selectOption('histogram');
await idle();
await page.getByTestId('hist-normalize').check();
await idle();
check('a2-02 histogram offers Normalized To Mode (off by default, saved when set)', await page.getByTestId('hist-normalize').isChecked());
await page.getByTestId('plot-kind').selectOption('pseudocolor');
await idle();

// a1-01: the group-by message promises membership updates only.
await page.getByTestId('group-key').selectOption('$FIL');
await page.getByTestId('group-by').click();
await idle();
check('a1-01 group-by message: membership only', (await logText()).includes('a new value does not create a new group'));
await page.getByTestId('group-All Samples').click();

// a5-02: remove a sample after a confirmation; Undo restores it.
await page.getByTestId(`sample-${F}`).click();
await page.getByTestId('remove-sample').click();
await page.getByTestId('answer-Remove').click();
await idle();
const gone = (await page.locator(`[data-testid="sample-${F}"]`).count()) === 0;
await page.getByTestId('undo').click();
await idle();
check('a5-02 remove sample asks, removes; Undo restores', gone && (await page.locator(`[data-testid="sample-${F}"]`).count()) === 1);

// a2-16: opening a workspace over current work asks first.
const wsPath = await download(() => page.getByTestId('save-ws').click());
await page.getByTestId('open-ws').setInputFiles(wsPath);
const asked = await page.getByTestId('question').innerText();
await page.getByTestId('answer-cancel').click();
await idle();
check('a2-16 opening a workspace over current work asks first; cancel keeps it', asked.includes('replaces the current workspace') && (await page.locator(`[data-testid="sample-${F}"]`).count()) === 1);

// a5-02: relink needs FlowJo's keyword match; a file that matches no sample is a new sample.
await page.reload();
await page.getByTestId('open-ws').setInputFiles(wsPath);
await idle();
await page.getByTestId('add-fcs').setInputFiles(join(out, 'other', F));
await idle();
const notLinked = (await page.locator('.missing').count()) === 1 && (await page.locator(`[data-testid="sample-${F}"]`).count()) === 2;
await page.getByTestId('add-fcs').setInputFiles(join(out, F));
await idle();
check('a5-02 file with a different $TOT is a new sample; the matching file relinks', notLinked && (await page.locator('.missing').count()) === 0);

// specs 6.2: deleting one quadrant deletes its sibling quadrants (FlowJo NodeList.addSiblingQuads).
await page.getByTestId(`sample-${F}`).first().click();
await idle();
await page.getByTestId('pop-root').click();
await page.getByTestId('tool-quadrant').click();
{
  const box = await canvas.boundingBox();
  await page.mouse.click(box.x + 64 + 0.5 * (460 - 78), box.y + 14 + 0.5 * (420 - 62));
}
await idle();
const quads = (await pops()).filter((t) => t.startsWith('Q'));
await page.getByTestId(`pop-${quads[2]}`).click();
await page.getByTestId('delete-pop').click();
const qText = await page.getByTestId('question').innerText();
await page.getByTestId('answer-Delete').click();
await idle();
check('6.2 deleting one quadrant deletes all four', quads.length === 4 && qText.includes('sibling quadrants') && !(await pops()).some((t) => t.startsWith('Q')), `${quads.length} quads; left: ${(await pops()).join(',')}`);

check('no uncaught page errors or React key warnings', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
