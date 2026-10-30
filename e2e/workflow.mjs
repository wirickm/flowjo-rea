// End-to-end workflow through the real UI (Chromium via Playwright):
// import -> inspect -> compensate/transform -> gate -> stats -> save ->
// reload -> export. Usage: node e2e/workflow.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// Uses the preinstalled Playwright when not installed locally.
const { chromium } = createRequire(import.meta.url)('playwright');
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
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
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const download = async (fn) => {
  const [d] = await Promise.all([page.waitForEvent('download'), fn()]);
  const p = join(out, d.suggestedFilename());
  await d.saveAs(p);
  return p;
};
const count = async (name) => (await page.getByTestId(`count-${name}`).first().textContent()).replace(/,/g, '');

await page.goto(base);
// 1. import
const t0 = Date.now();
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
check('import two real FCS files', (await page.getByTestId(`sample-${F1}`).textContent()).includes('283,969'), `${Date.now() - t0} ms`);
// 2. inspect metadata
await page.getByTestId(`sample-${F1}`).click();
await page.getByTestId('open-keywords').click();
const kwText = await page.getByRole('dialog').textContent();
check('keywords dialog shows parameters and $TOT', kwText.includes('FSC-A') && kwText.includes('$TOT') && kwText.includes('283969'));
await page.getByRole('dialog').getByLabel('Close').click();
// 3. compensation: file keyword assigned by default
await page.getByTestId('open-comp').click();
check('compensation defaults to file spillover', (await page.getByTestId('comp-current').textContent()).includes('File spillover'));
await page.getByRole('dialog').getByLabel('Close').click();
await idle();
// 4. gate: rectangle on FSC-A / SSC-A (default axes)
const canvas = page.getByTestId('plot-canvas');
const box = await canvas.boundingBox();
const at = (fx, fy) => [box.x + 64 + fx * (460 - 78), box.y + 14 + (1 - fy) * (420 - 62)];
await page.getByTestId('tool-rect').click();
let [x0, y0] = at(0.15, 0.04);
let [x1, y1] = at(0.85, 0.6);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 5 }); await page.mouse.up();
await idle();
const rectCount = Number(await count('Rect 1'));
check('rectangle gate created with a count', rectCount > 1000 && rectCount < 283969, `Rect 1 = ${rectCount}`);
// rename it
await page.getByTestId('pop-Rect 1').dblclick();
await page.getByLabel('Population name').fill('Cells');
await page.getByLabel('Population name').press('Enter');
await idle();
check('rename population', (await page.getByTestId('pop-Cells').count()) === 1);
// 5. drill into Cells and gate CD3 vs CD4 (logicle) with a polygon
await page.getByTestId('pop-Cells').click();
await page.getByTestId('x-channel').selectOption('CD3 APC-H7 FLR-A');
await page.getByTestId('y-channel').selectOption('CD4 PE-Cy7 FLR-A');
await idle();
await page.screenshot({ path: join(out, '01-cd3-cd4.png') });
await page.getByTestId('tool-polygon').click();
for (const [fx, fy] of [[0.55, 0.45], [0.95, 0.45], [0.95, 0.95], [0.55, 0.95]]) {
  const [px, py] = at(fx, fy);
  await page.mouse.click(px, py);
}
const [cx, cy] = at(0.55, 0.45);
await page.mouse.click(cx, cy);
await idle();
const polyCount = Number(await count('Polygon 1'));
check('polygon gate on compensated logicle axes', polyCount > 0 && polyCount < rectCount, `Polygon 1 = ${polyCount}`);
// undo/redo the polygon creation
await page.getByTestId('undo').click();
await idle();
const goneAfterUndo = (await page.getByTestId('pop-Polygon 1').count()) === 0;
await page.keyboard.press('Control+Shift+Z');
await idle();
const backCount = Number(await count('Polygon 1'));
check('undo removes the gate; redo (keyboard) restores the identical count', goneAfterUndo && backCount === polyCount, `undo removed: ${goneAfterUndo}, redo count ${backCount}`);
// edit: drag a vertex outward and confirm the count changes
await page.getByTestId('tool-select').click();
const [vx, vy] = at(0.55, 0.45);
const [vx2, vy2] = at(0.4, 0.3);
await page.mouse.move(vx, vy); await page.mouse.down(); await page.mouse.move(vx2, vy2, { steps: 5 }); await page.mouse.up();
await idle();
const polyEdited = Number(await count('Polygon 1'));
check('dragging a polygon vertex re-gates', polyEdited !== polyCount, `${polyCount} -> ${polyEdited}`);
await page.keyboard.press('Control+Z');
await idle();
const undoneEdit = Number(await count('Polygon 1'));
await page.keyboard.press('Control+Y');
await idle();
check('undo/redo a vertex edit', undoneEdit === polyCount && Number(await count('Polygon 1')) === polyEdited, `${undoneEdit} / ${await count('Polygon 1')}`);
// quadrant + histogram range on Cells
await page.getByTestId('tool-quadrant').click();
const [qx, qy] = at(0.5, 0.5);
await page.mouse.click(qx, qy);
await idle();
const q = await Promise.all(['Q1', 'Q2', 'Q3', 'Q4'].map(async (k) => Number((await page.locator(`[data-testid^="count-${k}:"]`).first().textContent()).replace(/,/g, ''))));
check('quadrant gates partition the parent', q.reduce((a, b) => a + b, 0) === rectCount, `${q.join(' + ')} = ${q.reduce((a, b) => a + b, 0)} (parent ${rectCount})`);
await page.getByTestId('plot-kind').selectOption('histogram');
await idle();
await page.getByTestId('tool-range').click();
[x0, y0] = at(0.6, 0.5); [x1, y1] = at(0.9, 0.5);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
check('histogram range gate', Number(await count('Range 6')) > 0, `Range 6 = ${await count('Range 6')}`);
await page.screenshot({ path: join(out, '02-histogram.png') });
// 6. statistics: count + median CD3 for Polygon 1, across the group
await page.getByTestId('pop-Polygon 1').click();
await page.getByTestId('stat-kind').selectOption('count');
await page.getByTestId('add-stat').click();
await page.getByTestId('stat-kind').selectOption('median');
await page.getByTestId('stat-channel').selectOption('CD3 APC-H7 FLR-A');
await page.getByTestId('add-stat').click();
await page.getByTestId('stat-kind').selectOption('freqParent');
await page.getByTestId('add-stat').click();
// copy gates to the group so the second sample gets them
await page.getByTestId('pop-Cells').click();
await page.getByTestId('apply-group').click();
await idle();
await page.waitForTimeout(800);
await idle();
const table1 = await page.getByTestId('stats-table').innerText();
check('stats table has both samples with values', table1.includes(F1) && table1.includes(F2) && !table1.includes('missing population'), table1.split('\n').slice(1).join(' | '));
const statsCsv = await download(() => page.getByTestId('export-stats').click());
check('stats CSV exported', readFileSync(statsCsv, 'utf8').split('\n').length >= 3);
// 7. exports: gated events FCS + CSV, PNG, Gating-ML
await page.getByTestId(`sample-${F1}`).click();
await page.getByTestId('pop-Polygon 1').click();
await idle();
const polyFinal = Number(await count('Polygon 1'));
await page.getByTestId('open-export').click();
const fcsOut = await download(() => page.getByTestId('export-fcs').click());
const csvOut = await download(() => page.getByTestId('export-csv').click());
const pngOut = await download(() => page.getByTestId('export-png').click());
const gmlOut = await download(() => page.getByTestId('export-gml').click());
await page.getByRole('dialog').getByRole('button', { name: 'x' }).click();
const csvRows = readFileSync(csvOut, 'utf8').trim().split('\n').length - 1;
check('events CSV row count equals population count', csvRows === polyFinal, `${csvRows} vs ${polyFinal}`);
writeFileSync(join(out, 'exports.json'), JSON.stringify({ fcsOut, csvOut, pngOut, gmlOut, polyFinal }));
// 8. save, reload, reopen, relink
const wsPath = await download(() => page.getByTestId('save-ws').click());
const before = await page.locator('.panel.tree').innerText();
await page.reload();
await page.getByTestId('open-ws').setInputFiles(wsPath);
await idle();
check('reopened workspace lists samples as data missing', (await page.locator('.missing').count()) === 2);
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
await page.waitForTimeout(500);
const after = await page.locator('.panel.tree').innerText();
check('population tree and counts identical after save/reload', before === after, before === after ? '' : `before:\n${before}\nafter:\n${after}`);
const table2 = await page.getByTestId('stats-table').innerText();
check('stats identical after reload', table2 === table1);
await page.screenshot({ path: join(out, '03-reloaded.png') });
// 9. FlowJo workspace import through the UI: counts vs FlowJo's saved counts
await page.reload();
await page.getByTestId('open-ws').setInputFiles(join(root, 'fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp'));
await idle();
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
await page.waitForTimeout(500);
const timeCount = Number(await count('Time'));
check('FlowJo .wsp imported in UI; Time count equals FlowJo (283968)', timeCount === 283968, `Time = ${timeCount}`);
await page.getByTestId('pop-CD3+').click();
await idle();
await page.screenshot({ path: join(out, '04-flowjo-wsp.png') });
check('no uncaught page errors', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
