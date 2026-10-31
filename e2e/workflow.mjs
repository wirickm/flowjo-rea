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
// Re-measured on every call so a layout change cannot offset clicks.
let box = await canvas.boundingBox();
const at = (fx, fy) => [box.x + 64 + fx * (460 - 78), box.y + 14 + (1 - fy) * (420 - 62)];
const remeasure = async () => { box = await canvas.boundingBox(); };
await page.getByTestId('tool-rect').click(); await remeasure();
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
await page.getByTestId('x-channel').selectOption('CD3 APC-H7 FLR-A'); await remeasure();
await page.getByTestId('y-channel').selectOption('CD4 PE-Cy7 FLR-A'); await remeasure();
await idle();
await page.screenshot({ path: join(out, '01-cd3-cd4.png') });
await page.getByTestId('tool-polygon').click(); await remeasure();
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
await page.getByTestId('tool-select').click(); await remeasure();
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
await page.getByTestId('tool-quadrant').click(); await remeasure();
const [qx, qy] = at(0.5, 0.5);
await page.mouse.click(qx, qy);
await idle();
const q = await Promise.all(['Q1', 'Q2', 'Q3', 'Q4'].map(async (k) => Number((await page.locator(`[data-testid^="count-${k}:"]`).first().textContent()).replace(/,/g, ''))));
check('quadrant gates partition the parent', q.reduce((a, b) => a + b, 0) === rectCount, `${q.join(' + ')} = ${q.reduce((a, b) => a + b, 0)} (parent ${rectCount})`);
await page.getByTestId('plot-kind').selectOption('histogram'); await remeasure();
await idle();
await page.getByTestId('tool-range').click(); await remeasure();
[x0, y0] = at(0.6, 0.5); [x1, y1] = at(0.9, 0.5);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
check('histogram range gate', Number(await count('Range 6')) > 0, `Range 6 = ${await count('Range 6')}`);
await page.screenshot({ path: join(out, '02-histogram.png') });
// ellipse: draw, then move, resize/rotate (major handle) and narrow (minor handle)
await page.getByTestId('plot-kind').selectOption('pseudocolor'); await remeasure();
await idle();
await page.getByTestId('tool-ellipse').click(); await remeasure();
[x0, y0] = at(0.3, 0.3); [x1, y1] = at(0.5, 0.45);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
const ellName = (await page.locator('[data-testid^="pop-Ellipse"]').first().getAttribute('data-testid')).slice(4);
const e0 = Number(await count(ellName));
await page.getByTestId('tool-select').click(); await remeasure();
const drag = async (a, b) => { await remeasure(); await page.mouse.move(...a); await page.mouse.down(); await page.mouse.move(...b, { steps: 5 }); await page.mouse.up(); await idle(); };
await drag(at(0.4, 0.375), at(0.45, 0.4));
const e1 = Number(await count(ellName));
await drag(at(0.55, 0.4), at(0.75, 0.6));
const e2 = Number(await count(ellName));
// minor handle: centre (0.45, 0.4) with b = 0.075 along the rotated minor axis;
// read the handle position from the saved gate rather than assuming it.
const wsNow = JSON.parse(readFileSync(await download(() => page.getByTestId('save-ws').click()), 'utf8'));
const eg = wsNow.samples.find((s) => s.fileName === F1).populations.find((p) => p.name === ellName).gate;
const [[sxx, sxy], [, syy]] = eg.cov;
const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
const l2 = (sxx + syy) / 2 - Math.sqrt(((sxx - syy) / 2) ** 2 + sxy * sxy);
const bMinor = Math.sqrt(l2 * eg.distanceSquare);
const hx = eg.mean[0] - bMinor * Math.sin(th), hy = eg.mean[1] + bMinor * Math.cos(th);
await drag(at(hx, hy), at(eg.mean[0] - 2 * bMinor * Math.sin(th), eg.mean[1] + 2 * bMinor * Math.cos(th)));
const e3 = Number(await count(ellName));
await page.screenshot({ path: join(out, '02b-ellipse.png') });
check('ellipse move, major-handle resize/rotate, minor-handle widen each re-gate', e0 > 0 && e1 !== e0 && e2 !== e1 && e3 > e2, `${e0} -> ${e1} -> ${e2} -> ${e3}`);
// contour plot renders equal-probability lines (pixels in the contour colour)
const contourPixels = async () => Number(await page.getByTestId('plot-canvas').getAttribute('data-contour-segments'));
const beforeContour = await contourPixels();
await page.getByTestId('plot-kind').selectOption('contour'); await remeasure();
await idle();
const c5 = await contourPixels();
await page.getByTestId('contour-level').selectOption('20');
await idle();
const c20 = await contourPixels();
await page.screenshot({ path: join(out, '02c-contour.png') });
check('contour plot draws lines; coarser level draws fewer', beforeContour === 0 && c20 > 0 && c20 < c5, `contour segments: pseudocolor ${beforeContour}, 5% ${c5}, 20% ${c20}`);
await page.getByTestId('plot-kind').selectOption('pseudocolor'); await remeasure();
await idle();
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
// annotations, group by annotation, rename group
for (const [f, v] of [[F1, 'stim'], [F2, 'ctrl']]) {
  await page.getByTestId(`sample-${f}`).click();
  await page.getByTestId('ann-key').fill('Condition');
  await page.getByTestId('ann-value').fill(v);
  await page.getByTestId('ann-add').click();
}
await page.getByTestId('group-key').selectOption('Condition');
await page.getByTestId('group-by').click();
await page.getByTestId('group-Condition = stim').dblclick();
await page.getByLabel('Group name').fill('Stimulated');
await page.getByLabel('Group name').press('Enter');
const groupsText = await page.locator('.groups').innerText();
await page.getByTestId('group-All Samples').click();
check('annotations -> group by annotation -> rename group', groupsText.includes('Stimulated') && groupsText.includes('Condition = ctrl'), groupsText.replace(/\n/g, ' | '));
await page.getByTestId(`sample-${F1}`).click();
await idle();
await page.waitForTimeout(500);
await idle();
const table1 = await page.getByTestId('stats-table').innerText();
check('stats table shows annotation column', table1.split('\n')[0].includes('Condition') && table1.includes('stim'));
check('stats table has both samples with values', table1.includes(F1) && table1.includes(F2) && !table1.includes('missing population'), table1.split('\n').slice(1).join(' | '));
const statsCsv = await download(() => page.getByTestId('export-stats').click());
check('stats CSV exported', readFileSync(statsCsv, 'utf8').split('\n').length >= 3);
// statistic templates and all-groups export
await page.getByTestId('template-save').click();
await page.getByTestId('stats-table').getByLabel('remove column').first().click();
const colsAfterRemove = await page.locator('[data-testid=stats-table] thead th').count();
await page.getByTestId('template-select').selectOption({ index: 1 });
await page.getByTestId('template-apply').click();
await idle(); await page.waitForTimeout(400); await idle();
const colsAfterApply = await page.locator('[data-testid=stats-table] thead th').count();
const tableAfterTemplate = await page.getByTestId('stats-table').innerText();
check('template restores the saved statistic columns and values', colsAfterApply === colsAfterRemove + 1 && tableAfterTemplate === table1, `${colsAfterRemove} -> ${colsAfterApply} columns`);
const allCsv = readFileSync(await download(() => page.getByTestId('export-stats-all').click()), 'utf8').trim().split('\n');
check('all-groups CSV has a Group column and one row per group membership', allCsv[0].startsWith('Group,Sample,Condition') && allCsv.length === 1 + 4, `${allCsv.length - 1} rows; header ${allCsv[0].slice(0, 60)}`);
// layout editor: two plots, rendered per sample, single and batch PNG export
let layoutSvg = '';
const pngSize = (p) => { const b = readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
await page.getByTestId('pop-Cells').click(); await idle();
await page.getByTestId('add-to-layout').click();
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('add-to-layout').click();
await page.getByTestId('open-layout').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length === 2, null, { timeout: 60000 });
const single = await download(() => page.getByTestId('layout-export').click());
layoutSvg = await download(() => page.getByTestId('layout-export-svg').click());
const batch = [];
page.on('download', async (d) => { const pth = join(out, `batch-${d.suggestedFilename()}`); await d.saveAs(pth); batch.push(pth); });
await page.getByTestId('layout-batch').click();
await page.waitForFunction(() => !document.body.innerText.includes('exporting...'), null, { timeout: 120000 });
await page.waitForTimeout(1000);
page.removeAllListeners('download');
const [lw, lh] = pngSize(single);
check('layout renders 2 plots and exports a 2-up PNG', lw === 920 && lh === 442, `${lw}x${lh}`);
check('batch export writes one PNG per sample in the group', batch.length === 2 && batch.every((b) => pngSize(b)[0] === 920), batch.map((b) => b.split('/').pop()).join(', '));
await page.getByRole('button', { name: 'move down' }).first().click();
await page.getByTestId('layout-remove').first().click();
await page.waitForTimeout(300);
const afterRemove = await page.getByTestId('layout-card').count();
await page.getByRole('dialog').getByLabel('Close').click();
await page.getByTestId('undo').click();
check('layout reorder/remove are undoable', afterRemove === 1 && (await page.getByTestId('open-layout').textContent()).includes('2'), `cards after remove ${afterRemove}; button "${await page.getByTestId('open-layout').textContent()}"`);
// overlays / backgating: Polygon 1 on the ungated FSC/SSC plot, then as a histogram
await page.getByTestId(`sample-${F1}`).click();
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('overlay-toggle').click();
await page.getByTestId('overlay-Cells/Polygon 1').check();
await idle(); await page.waitForTimeout(300);
const ov2d = Number(await canvas.getAttribute('data-overlay-points'));
await page.screenshot({ path: join(out, '02d-backgate.png') });
await page.getByTestId('plot-kind').selectOption('histogram'); await remeasure();
await idle(); await page.waitForTimeout(300);
const ovHist = Number(await canvas.getAttribute('data-overlay-points'));
const polyNow = Number(await count('Polygon 1'));
check('backgating overlay draws the population (2-D sampled, histogram full count)', ov2d > 0 && ov2d <= 5000 && ovHist === polyNow, `2-D points ${ov2d}, histogram events ${ovHist}, Polygon 1 ${polyNow}`);
await page.getByTestId('overlay-Cells/Polygon 1').uncheck();
await page.getByTestId('plot-kind').selectOption('pseudocolor'); await remeasure();
await idle();
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
const wspOut = await download(() => page.getByTestId('export-wsp').click());
const svgOut = await download(() => page.getByTestId('export-svg').click());
const svgText = readFileSync(svgOut, 'utf8');
check('plot SVG export is SVG with vector axis labels', svgText.includes('<svg') && svgText.includes('>Polygon 1') === false && /<text[^>]*>CD3 APC-H7 FLR-A<\/text>|<text[^>]*>FSC-A<\/text>/.test(svgText), `${svgText.length} bytes`);
await page.getByRole('dialog').getByRole('button', { name: 'x' }).click();
const csvRows = readFileSync(csvOut, 'utf8').trim().split('\n').length - 1;
check('events CSV row count equals population count', csvRows === polyFinal, `${csvRows} vs ${polyFinal}`);
writeFileSync(join(out, 'exports.json'), JSON.stringify({ fcsOut, csvOut, pngOut, gmlOut, wspOut, svgOut, layoutSvg, polyFinal, fcsDir: join(root, 'fixtures/flowkit/data/8_color_data_set/fcs_files') }));
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
check('layout persists in the saved workspace', (await page.getByTestId('open-layout').textContent()).includes('2'));
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
check('FlowJo plot settings imported (root: histogram of CD107a)', (await page.getByTestId('plot-kind').inputValue()) === 'histogram' && (await page.getByTestId('x-channel').inputValue()) === 'CD107a PE FLR-A', `${await page.getByTestId('plot-kind').inputValue()} / ${await page.getByTestId('x-channel').inputValue()}`);
check('FlowJo .wsp imported in UI; Time count equals FlowJo (283968)', timeCount === 283968, `Time = ${timeCount}`);
await page.getByTestId('pop-CD3+').click();
await idle();
await page.screenshot({ path: join(out, '04-flowjo-wsp.png') });
// spectral unmixing through the UI (UI path only: a synthetic 2-fluorochrome x
// 3-detector matrix on conventional data; numerics are covered by unit tests)
const specCsv = join(out, 'spectral.csv');
writeFileSync(specCsv, ',CD3 APC-H7 FLR-A,CD4 PE-Cy7 FLR-A,CD8 PerCP-Cy55 FLR-A\nUnmixA,1,0.3,0.1\nUnmixB,0.2,1,0.5\n');
await page.getByTestId('open-comp').click();
await page.getByRole('dialog').locator('input[type=file]').setInputFiles(specCsv);
await page.getByRole('button', { name: 'Save and apply to sample' }).click();
await page.getByRole('dialog').getByLabel('Close').click();
await idle();
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('plot-kind').selectOption('pseudocolor'); await remeasure();
const hasUnmixed = (await page.getByTestId('x-channel').locator('option', { hasText: 'UnmixA' }).count()) === 1;
await page.getByTestId('x-channel').selectOption('UnmixA'); await remeasure();
await page.getByTestId('y-channel').selectOption('UnmixB'); await remeasure();
await idle();
const cap = await page.getByTestId('plot-caption').textContent();
await page.screenshot({ path: join(out, '05-unmixed.png') });
check('spectral CSV import exposes unmixed channels that plot', hasUnmixed && cap.includes('283,969'), cap);
check('no uncaught page errors', errors.length === 0, errors.join('; '));
await browser.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
