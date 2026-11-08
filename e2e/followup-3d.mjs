// Follow-up round (docs/validation/ui-gaps/platforms.md sections 4-5,
// graph.md SHOWCUBE, tables.md PLOTPOINTCLOUD, workspace.md MIFlowCyt):
// 3D Viewer plot types, Show in 3D, table 3D Plot, Annotate Experiment and
// the Compare Populations measures, Add To Group and source group.
// Usage: node e2e/followup-3d.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5191';
mkdirSync(join(root, 'test-results', 'e2e-followup-3d'), { recursive: true });
const fcs = (n) => join(root, 'fixtures/flowkit/data/8_color_data_set/fcs_files', n);
const F1 = '101_DEN084Y5_15_E03_009_clean.fcs';
const F2 = '101_DEN084Y5_15_E05_010_clean.fcs';
const F3 = '101_DEN084Y5_15_E01_008_clean.fcs';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1700, height: 1200 }, acceptDownloads: true });
await context.addInitScript(() => { if (!sessionStorage.getItem('f3-init')) { localStorage.setItem('flowjo-rea.separateWindows', '0'); localStorage.removeItem('flowjo-rea.miflowcyt'); sessionStorage.setItem('f3-init', '1'); } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const T = (id) => page.getByTestId(id);
const download = async (click) => { const [d] = await Promise.all([page.waitForEvent('download'), click()]); return { name: d.suggestedFilename(), text: readFileSync(await d.path(), 'utf8') }; };
const points = () => page.waitForFunction(() => Number(document.querySelector('[data-testid=threed-canvas]')?.getAttribute('data-points')) > 0, null, { timeout: 60000 });

await page.goto(base + '?layout=classic');
await T('open-ws').setInputFiles(join(root, 'fixtures/flowkit/data/8_color_data_set/8_color_ICS_simple.wsp'));
await idle();
await T('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
await page.locator('[data-testid^="sample-"]').first().click();
await idle();
const popNode = page.locator('[data-testid^="pop-"]:not([data-testid="pop-root"])').first();
const popName = (await popNode.getAttribute('data-testid')).slice(4);
await popNode.click();
await idle();

// --- 3D Viewer from the Platforms band
await T('open-threeD').click();
await points();
const cv = T('threed-canvas');
check('3D opens in the default orientation (identity)', (await cv.getAttribute('data-view')) === '1.000,0.000,0.000,0.000,1.000,0.000,0.000,0.000,1.000');
check('3D colour axis defaults to the Spectrum gradient', (await T('threed-gradient').locator('option:checked').innerText()) === 'Spectrum');
check('3D graph types: Point Cloud, Bubble Plot, Terrain Plot (no Voxel in 10.6.2)', (await T('threed-type').locator('option').allInnerTexts()).join('|') === 'Point Cloud|Bubble Plot|Terrain Plot');
check('3D Size Parameter only for Bubble Plots', await T('threed-size').isDisabled());
await T('threed-type').selectOption('bubble');
check('3D Bubble Plot enables Size Parameter', (await cv.getAttribute('data-type')) === 'bubble' && !(await T('threed-size').isDisabled()));
await T('threed-type').selectOption('terrain');
check('3D Terrain Plot selected', (await cv.getAttribute('data-type')) === 'terrain');
const box = await cv.boundingBox();
await page.mouse.move(box.x + 300, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 330, box.y + 230, { steps: 3 }); await page.mouse.up();
const v1 = await cv.getAttribute('data-view');
await page.waitForTimeout(300);
const v2 = await cv.getAttribute('data-view');
check('3D drag rotates and a flick keeps it spinning', v1 !== '1.000,0.000,0.000,0.000,1.000,0.000,0.000,0.000,1.000' && v1 !== v2);
await T('threed-reset').click();
await page.waitForTimeout(150);
check('3D Reset stops the spin and restores the default perspective', (await cv.getAttribute('data-view')) === '1.000,0.000,0.000,0.000,1.000,0.000,0.000,0.000,1.000');
const png = await download(() => T('threed-export').click());
check('3D Export... writes a PNG', png.name.endsWith('.png'), png.name);
const wig = await download(() => T('threed-wiggle').click());
check('3D Wiggle... writes a two-frame movie', wig.name.endsWith('-wiggle.html') && (wig.text.match(/<img/g) ?? []).length === 2, wig.name);
await T('threed-type').selectOption('pointcloud');
const opts = await T('threed-add-pop-path').locator('option').allInnerTexts();
if (opts.length > 1) {
  await T('threed-add-pop-path').selectOption({ index: 1 });
  await T('threed-add-pop').click();
  await page.waitForFunction(() => document.querySelectorAll('[data-testid^=threed-pop-on-]').length === 2, null, { timeout: 60000 });
  check('3D Add population overlays a second population with the next quick colour', (await T('threed-pop-color-1').inputValue()) === '#ffc800');
} else check('3D Add population overlays a second population with the next quick colour', false, 'no child population');
await T('threed-close').click();

// --- Show in 3D from the graph window
const canvas = T('plot-canvas');
const xAxis = await T('x-channel').inputValue().catch(() => null);
const b = await canvas.boundingBox();
await canvas.click({ button: 'right', position: { x: b.width / 2, y: b.height / 2 } });
await T('ctx-Show-in-3D').click();
await points();
const x3 = await T('threed-axis-X').locator('option:checked').innerText();
check('Show in 3D opens the 3D Viewer of this population with the graph X axis', (await T('threed-dialog').innerText()).includes(popName) && (!xAxis || x3 === xAxis), `${x3} / ${xAxis}`);
await T('threed-close').click();

// --- Compare Populations: measures, Add To Group, source group
await T('open-compare').click();
await T('compare-pick-sample').selectOption({ index: 1 });
await T('compare-add-control').click();
await T('compare-measures').waitFor({ timeout: 120000 });
const mr = Number(await T('compare-mr-0').innerText());
const prec = Number(await T('compare-prec-0').innerText());
check('CP Match Ratio and F-measure per comparator', mr > 0 && mr <= 1 && prec >= 0, `${mr} ${prec}`);
await T('compare-mv').getByText(/T\(X\) =/).waitFor({ timeout: 120000 });
check('CP multivariate bins from the decoded tree', /#Bins = \d+/.test(await T('compare-mv').innerText()), await T('compare-mv').innerText());
await T('compare-add-to-group').click();
await T('compare-group-table').waitFor({ timeout: 180000 });
check('CP Add To Group lists the comparison for each group sample', (await T('compare-group-table').locator('tbody tr').count()) >= 2);
await T('compare-source-group').selectOption({ index: 1 });
await T('compare-source').waitFor({ timeout: 60000 });
check('CP Set source group takes the sample from the group', (await T('compare-source').innerText()).includes('source group'));
await T('compare-clear-source').click();
check('CP Clear source group reverts', (await T('compare-source').count()) === 0);
await T('compare-close').click();

// --- Annotate Experiment (MIFlowCyt)
await T('open-miflow').click();
check('MIFlowCyt dialog: created date defaults to today', /^\d\d-[A-Z]{3}-\d{4}$/.test(await T('miflow-created').inputValue()));
await T('miflow-name').fill('ICS experiment');
await T('miflow-tab-Specimen').click();
await T('miflow-organism').fill('Human');
await T('miflow-tab-Analysis').click();
await T('miflow-autofill-groups').click();
check('MIFlowCyt Auto-fill groups lists the workspace groups', (await T('miflow-groups').inputValue()).length > 0);
const xmlFile = await download(() => T('miflow-save-as').click());
check('MIFlowCyt Save As writes the <experiment> XML', xmlFile.name.endsWith('Summary.xml') && xmlFile.text.includes('<name>ICS experiment</name>') && xmlFile.text.includes('<organism>Human</organism>'), xmlFile.name);
await T('miflow-ok').click();
await T('open-miflow').click();
check('MIFlowCyt annotation is stored in the workspace', (await T('miflow-name').inputValue()) === 'ICS experiment');
await T('miflow-cancel').click();
await T('open-export').click();
const wsp = await download(() => T('export-wsp').click());
check('.wsp export carries the <experiment> element', wsp.text.includes('<experiment>') && wsp.text.includes('<name>ICS experiment</name>'));
await page.keyboard.press('Escape');

// --- Table editor 3D Plot
await T('open-tables').click();
await T('table-new').click();
for (const [stat, ch] of [['median', 1], ['cv', 1], ['count', null]]) {
  await T('table-add-column').click();
  await T('col-pop').selectOption({ index: 1 });
  await T('col-stat').selectOption(stat);
  if (ch !== null) await T('col-channel').selectOption({ index: ch });
  await T('col-ok').click();
}
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=table-preview] tbody tr')].length >= 2, null, { timeout: 120000 });
await T('table-col-0').click();
await T('table-col-1').click({ modifiers: ['Control'] });
await T('table-plot-3d').click();
check('Table 3D Plot needs three columns', (await T('threed-dialog').count()) === 0);
await T('table-col-2').click({ modifiers: ['Control'] });
await T('table-plot-3d').click();
await page.getByText("can not be plotted.").first().waitFor({ timeout: 30000 });
check('Table 3D Plot refuses a column with empty cells (BAD_TABLE_DATA)', (await T('threed-dialog').count()) === 0);
await page.getByRole('button', { name: 'OK' }).last().click();
await T('tables-close').click();
await T('add-fcs').setInputFiles([fcs(F3)]);
await idle();
await T('open-tables').click();
await page.waitForFunction(() => [...document.querySelectorAll('[data-testid=table-preview] tbody tr')].every((tr) => !tr.textContent.includes('NaN')), null, { timeout: 180000 });
await T('table-col-0').click();
await T('table-col-1').click({ modifiers: ['Control'] });
await T('table-col-2').click({ modifiers: ['Control'] });
await T('table-plot-3d').click();
await points();
check('Table 3D Plot opens the 3D viewer at point scale 0.8 coloured by the third column', (await T('threed-scale').inputValue()) === '80' && (await T('threed-color').locator('option:checked').innerText()) === (await T('threed-axis-Z').locator('option:checked').innerText()));
await T('threed-close').click();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
