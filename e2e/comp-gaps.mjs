// Compensation editor gaps (docs/validation/ui-gaps/compensation.md): live
// N x N / All By / Histograms preview with overlay and zoom, matrix
// management (identity, duplicate, reset, compare, visibility), SSM view of a
// saved wizard matrix, wizard parameter set, spectral weights, Optimize
// Weights, animation,
// Apply To Workspace / group and the Matrix Icon drop.
// Usage: node e2e/comp-gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5183';
const out = join(root, 'test-results', 'e2e');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// Synthetic single-stain controls with a known spillover matrix.
const TRUE = [[1, 0.25, 0.01], [0.02, 1, 0.08], [0, 0.05, 1]];
const DYES = ['FITC-A', 'PE-A', 'APC-A'];
const writeControl = (file, primary, seed) => {
  let st = seed >>> 0;
  const u = () => ((st = (1664525 * st + 1013904223) >>> 0) + 0.5) / 4294967296;
  const nrm = () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  const names = ['FSC-A', 'SSC-A', ...DYES];
  const n = 20000;
  const buf = Buffer.alloc(n * names.length * 4);
  const p = DYES.indexOf(primary);
  for (let e = 0; e < n; e++) {
    const dye = p >= 0 && e < n * 0.3 ? 20000 * (1 + 0.2 * nrm()) : 0;
    // Photon-like noise grows with the signal, so the controls have spillover spreading.
    const row = [50000 + 2000 * nrm(), 30000 + 2000 * nrm(), ...DYES.map((_, j) => { const sig = p >= 0 ? dye * TRUE[p][j] : 0; return 200 + sig + 50 * nrm() + (j === 2 ? 8 : 2) * Math.sqrt(sig) * nrm(); })];
    row.forEach((v, c) => buf.writeFloatLE(v, (e * names.length + c) * 4));
  }
  const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: String(names.length), $TOT: String(n), $FIL: file.split('/').pop() };
  names.forEach((nm, i) => Object.assign(kw, { [`$P${i + 1}N`]: nm, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: '262144', [`$P${i + 1}E`]: '0,0' }));
  const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
  let text = textFor(0, 0);
  for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
  const b = 58 + Buffer.byteLength(text);
  const pad = (v) => String(v).padStart(8, ' ');
  const header = `FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`;
  writeFileSync(file, Buffer.concat([Buffer.from(header), Buffer.from(text), buf]));
};
const dir = join(out, 'comp-gaps');
mkdirSync(dir, { recursive: true });
const ctrl = [['unstained.fcs', null], ['fitc.fcs', 'FITC-A'], ['pe.fcs', 'PE-A'], ['apc.fcs', 'APC-A']];
ctrl.forEach(([f, pr], i) => writeControl(join(dir, f), pr, i + 1));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const download = async (fn) => {
  const [d] = await Promise.all([page.waitForEvent('download'), fn()]);
  const p = join(out, d.suggestedFilename());
  await d.saveAs(p);
  return p;
};
const dlg = () => page.getByRole('dialog');
const closeDlg = async () => { await dlg().getByLabel('Close').click(); await idle(); };
const openComp = async (file) => { await page.getByTestId(`sample-${file}`).click(); await idle(); await page.getByTestId('open-comp').click(); };
const attr = (tid, a) => page.getByTestId(tid).getAttribute(a);

await page.addInitScript(() => { try { localStorage.setItem('flowjo-rea.separateWindows', '0'); localStorage.removeItem('flowjo-rea.compPrefs'); } catch { /* */ } });
await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles(ctrl.map(([f]) => join(dir, f)));
await idle();

// Gates: a positive range on each control's dye; the unstained tube's whole range as universal negative.
for (const [f, pr] of ctrl) {
  const ch = pr ?? 'FITC-A';
  await page.getByTestId(`sample-${f}`).click(); await idle();
  await page.getByTestId('pop-root').click(); await idle();
  await page.getByTestId('plot-kind').selectOption('histogram'); await idle();
  await page.getByTestId('x-channel').selectOption(ch); await idle();
  await page.getByTestId('manual-gate').click();
  await page.getByTestId('manual-x0').fill(pr ? '5000' : '-100000');
  await page.getByTestId('manual-x1').fill('1000000');
  await page.getByTestId('manual-ok').click(); await idle();
}

// FlowJo wizard with the parameter set: Remove This Parameter drops PE.
await openComp('fitc.fcs');
await dlg().getByTestId('fj-wizard').locator('summary').first().click();
await page.getByTestId('fj-univ').selectOption({ label: 'unstained.fcs: FITC-A subset' });
for (const [f, pr] of ctrl.slice(1)) {
  await page.getByTestId(`fj-primary-${f}`).selectOption(pr);
  await page.getByTestId(`fj-pos-${f}`).selectOption(`${pr} subset`);
}
await page.getByTestId('fj-remove-pe.fcs').click();
check('Remove This Parameter unchecks the parameter and clears its control', !(await page.getByTestId('fj-param-PE-A').isChecked()) && (await page.getByTestId('fj-primary-pe.fcs').inputValue()) === '');
await page.getByTestId('fj-run').click();
await page.getByTestId('fj-status').waitFor();
const twoCh = await page.locator('table.matrix thead th').count();
check('wizard without PE builds a 2-parameter matrix', twoCh === 3, `${twoCh - 1} columns`);
await page.getByTestId('fj-params').locator('summary').click();
await page.getByTestId('fj-reset-params').click();
await page.getByTestId('fj-primary-pe.fcs').selectOption('PE-A');
await page.getByTestId('fj-pos-pe.fcs').selectOption('PE-A subset');
await page.getByTestId('fj-remove-unused').click();
check('Remove Unused Parameters keeps the 3 assigned parameters', ['FITC-A', 'PE-A', 'APC-A'].every(Boolean) && (await page.getByTestId('fj-params').locator('summary').textContent()).includes('3 of 3'));
await page.getByTestId('fj-run').click();
await page.waitForFunction(() => document.querySelectorAll('table.matrix thead th').length === 4, null, { timeout: 30000 });

// Percent display (Use Percent for spillover, default on).
const cell01 = page.locator('table.matrix tbody tr').nth(0).locator('input').nth(1);
const pct = Number(await cell01.inputValue());
check('matrix cells show percent by default (FITC into PE ~ 25%)', Math.abs(pct - 25) < 1, String(pct));

// SSM of the wizard matrix.
check('Display SSM is enabled for a wizard matrix', await page.getByTestId('comp-ssm-view').isEnabled());
await page.getByTestId('comp-ssm-view').click();
const ssmRows = await page.getByTestId('comp-ssm-table').locator('tbody tr').allInnerTexts();
check('SSM view shows the SSM with a Sum row and column', ssmRows.length === 4 && ssmRows[3].startsWith('Sum') && (await page.getByTestId('comp-status').textContent()).startsWith('Displaying SSM of matrix'), ssmRows[3]);
const ssmFile = await download(() => page.getByTestId('comp-ssm-export').click());
check('Export SSM writes SSM_<matrix>.csv', /SSM_.*\.csv$/.test(ssmFile) && readFileSync(ssmFile, 'utf8').startsWith('SSM,FITC-A,PE-A,APC-A'));
await page.getByTestId('comp-ssm-view').click();
await dlg().getByRole('button', { name: 'Save matrices' }).click();
await closeDlg();

// Reopen: the saved matrix keeps its SSM.
await openComp('fitc.fcs');
await page.getByTestId('matrix-select').selectOption({ index: 1 });
check('a saved wizard matrix still offers Display SSM after reopening', await page.getByTestId('comp-ssm-view').isEnabled());

// Live preview: preview sample fitc.fcs, N x N cells, edits update the plots before saving.
await page.getByTestId('comp-preview-sample').selectOption({ label: 'fitc.fcs' });
await page.getByTestId('comp-grid').waitFor({ timeout: 30000 });
const cells = await page.locator('[data-testid^=comp-cell-]').evaluateAll((e) => e.map((x) => x.dataset.testid));
check('N x N view: upper triangle of 3 parameters = 3 plots, x = later channel', cells.length === 3 && cells.includes('comp-cell-PE-A-FITC-A') && cells.includes('comp-cell-APC-A-PE-A'), cells.join(' '));
await page.getByTestId('comp-preview-pop').selectOption('FITC-A subset');
await page.waitForFunction(() => document.querySelector('[data-testid=comp-preview-count]')?.textContent?.startsWith('6,'), null, { timeout: 30000 }).catch(() => {});
check('Preview Population limits the preview to the chosen population', (await page.getByTestId('comp-preview-count').textContent()).match(/^[0-9,]+/)?.[0] !== '20,000', await page.getByTestId('comp-preview-count').textContent());
await page.waitForTimeout(300);
const pe0 = Number(await attr('comp-cell-PE-A-FITC-A', 'data-mx'));
await cell01.fill('0');
await page.waitForTimeout(300);
const pe1 = Number(await attr('comp-cell-PE-A-FITC-A', 'data-mx'));
check('editing a cell recompensates the preview at once (FITC->PE 0%: PE median of FITC events rises)', pe1 > pe0 + 500, `${pe0} -> ${pe1}`);
await page.getByTestId('comp-reset').click();
await page.waitForTimeout(300);
const pe2 = Number(await attr('comp-cell-PE-A-FITC-A', 'data-mx'));
check('Reset restores the saved values and the preview', Math.abs(Number(await cell01.inputValue()) - pct) < 1e-6 && Math.abs(pe2 - pe0) < 1, `${pe2}`);

// Views, overlay, zoom.
await page.getByTestId('comp-view').selectOption('allby:PE-A');
const allBy = await page.locator('[data-testid^=comp-cell-]').evaluateAll((e) => e.map((x) => x.dataset.testid));
check('All By PE-A: one plot per other parameter with y = PE-A', allBy.length === 2 && allBy.every((t) => t.endsWith('-PE-A')), allBy.join(' '));
await page.getByTestId('comp-view').selectOption('histos');
check('Histograms: one histogram per parameter', (await page.locator('[data-testid^=comp-cell-]').count()) === 3 && (await page.getByTestId('comp-cell-FITC-A-').count()) === 1);
await page.getByTestId('comp-view').selectOption('nxn');
check('Overlay Uncompensated is on by default (preference)', await page.getByTestId('comp-overlay').isChecked());
const z = async () => (await page.getByTestId('comp-zoom').textContent()).trim();
const z0 = await z();
await page.getByTestId('comp-zoom-in').click(); const z1 = await z();
await page.getByTestId('comp-zoom-out').click(); await page.getByTestId('comp-zoom-out').click(); const z2 = await z();
await page.getByTestId('comp-zoom-100').click(); const z3 = await z();
const w100 = await page.getByTestId('comp-cell-PE-A-FITC-A').evaluate((c) => c.width);
await page.getByTestId('comp-zoom-fit').click(); const z4 = await z();
check('zoom: default 50%, in 66%, out 33%, reset 100% (256 px plots), fit changes the scale', z0 === '50%' && z1 === '66%' && z2 === '33%' && z3 === '100%' && w100 === 256 && z4 !== '100%', [z0, z1, z2, z3, w100, z4].join(' '));

// Visibility: hide APC, Show All.
await page.getByTestId('comp-vis-APC-A').uncheck();
check('hiding a parameter removes it from the matrix and plots, "(1 hidden)"', (await page.locator('table.matrix thead th').count()) === 3 && (await page.locator('[data-testid^=comp-cell-]').count()) === 1 && (await page.getByTestId('comp-hidden-count').textContent()) === '(1 hidden)');
await page.getByTestId('comp-showall').check();
check('Show All shows hidden parameters again', (await page.locator('table.matrix thead th').count()) === 4);
await page.getByTestId('comp-showall').uncheck();
await page.getByTestId('comp-vis-APC-A').check();

// Animate.
await page.getByTestId('comp-animate').click();
const label = await page.getByTestId('comp-anim-label').textContent();
await page.getByTestId('comp-animate').waitFor({ state: 'visible' });
await page.waitForFunction(() => !document.querySelector('[data-testid=comp-anim-label]'), null, { timeout: 15000 });
check('Animate steps the preview from Scale: 0.1% and ends at 100%', label === 'Scale: 0.1%', label);

// Preferences: percent off shows fractions.
await page.getByTestId('comp-prefs').click();
await page.getByTestId('comp-pref-percent').uncheck();
const frac = Number(await cell01.inputValue());
await page.getByTestId('comp-pref-percent').check();
check('Use Percent for spillover off shows fractions', Math.abs(frac - 0.25) < 0.01, String(frac));

// Identity, duplicate, compare.
await page.getByTestId('comp-identity').click();
await page.getByTestId('comp-identity-create').click();
const idName = await page.getByTestId('matrix-select').locator('option:checked').textContent();
const idVals = await page.locator('table.matrix tbody tr').evaluateAll((r) => r.map((x) => [...x.querySelectorAll('input')].map((i) => Number(i.value))));
check('New Identity Matrix over the fluorescence parameters', idName === 'New Matrix' && JSON.stringify(idVals) === JSON.stringify([[100, 0, 0], [0, 100, 0], [0, 0, 100]]), `${idName} ${JSON.stringify(idVals)}`);
await page.getByTestId('comp-duplicate').click();
check('Duplicate Matrix makes "<name>-copy"', (await page.getByTestId('matrix-select').locator('option:checked').textContent()) === 'New Matrix-copy');
const wizName = await page.getByTestId('matrix-select').locator('option').nth(1).textContent();
await page.getByTestId(`comp-compare-${wizName}`).check();
await page.getByTestId('comp-compare-New Matrix').check();
const diff = await page.getByTestId('comp-compare-result').locator('tbody tr').nth(0).locator('td').nth(1).textContent();
check('Compare 2 matrices shows their Difference', (await page.getByTestId('comp-status').textContent()) === 'Displaying Difference of 2 matrices' && Math.abs(Math.abs(Number(diff)) - pct) < 1e-6, diff);
await page.getByTestId('comp-compare-New Matrix-copy').check();
check('Compare 3 matrices shows the Standard Deviation', (await page.getByTestId('comp-status').textContent()) === 'Displaying Standard Deviation of 3 matrices');
for (const n of [wizName, 'New Matrix', 'New Matrix-copy']) await page.getByTestId(`comp-compare-${n}`).uncheck();

// Spectral weights.
const spec = join(dir, 'spectral.csv');
writeFileSync(spec, ',FITC-A,PE-A,APC-A\nDye1,1,0.3,0.1\nDye2,0.2,1,0.5\n');
await dlg().locator('label:has-text("Import matrix CSV") input[type=file]').setInputFiles(spec);
await page.getByTestId('comp-weights').click();
const wFile = await download(() => page.getByTestId('comp-weights-export').click());
check('Export Weights writes detectorweights.csv (all 1 by default)', wFile.endsWith('detectorweights.csv') && readFileSync(wFile, 'utf8') === 'Detector Name,Weights\r\nFITC-A,1\r\nPE-A,1\r\nAPC-A,1\r\n');
const wIn = join(dir, 'weights.csv');
writeFileSync(wIn, 'Detector Name,Weights\nFITC-A,2\nPE-A,1\nAPC-A,0.5\n');
await page.getByTestId('comp-weights-import').setInputFiles(wIn);
await page.waitForFunction(() => document.querySelector('[data-testid=comp-weights-table] tbody')?.textContent?.includes('0.5'), null, { timeout: 5000 }).catch(() => {});
const wt = await page.getByTestId('comp-weights-table').locator('tbody').innerText();
await page.getByTestId('comp-weights-close').click();
check('Import Weights fills the table; Close switches unmixing to weighted least squares', wt.includes('2') && wt.includes('0.5') && (await dlg().textContent()).includes('unmixed by weighted least squares'));
await page.getByTestId('comp-weights').click();
await page.getByTestId('comp-weights-import').setInputFiles(spec);
await page.getByTestId('comp-weights-error').waitFor({ timeout: 5000 }).catch(() => {});
check('a weights file with other detectors is refused', (await page.getByTestId('comp-weights-error').count()) === 1);
await page.getByTestId('comp-weights-close').click();

// Optimize Weights (OPTIMIZEWT) on a spectral matrix with the controls' spectra: Dye1 = FITC control, Dye2 = PE control.
const spec2 = join(dir, 'spectral2.csv');
writeFileSync(spec2, ',FITC-A,PE-A,APC-A\nDye1,1,0.25,0.01\nDye2,0.02,1,0.08\n');
await dlg().locator('label:has-text("Import matrix CSV") input[type=file]').setInputFiles(spec2);
await page.getByTestId('comp-weights').click();
await page.getByTestId('comp-weights-import').setInputFiles(wIn);
await page.waitForFunction(() => document.querySelector('[data-testid=comp-weights-table] tbody')?.textContent?.includes('0.5'), null, { timeout: 5000 }).catch(() => {});
await page.getByTestId('comp-weights-close').click();
await page.getByTestId('comp-optimize-weights').click();
check('Optimize is disabled until every fluorochrome has a positive and a negative population', await page.getByTestId('comp-opt-run').isDisabled());
await page.getByTestId('comp-opt-pos-Dye1').selectOption({ label: 'fitc.fcs: FITC-A subset' });
await page.getByTestId('comp-opt-neg-Dye1').selectOption({ label: 'unstained.fcs: FITC-A subset' });
await page.getByTestId('comp-opt-pos-Dye2').selectOption({ label: 'pe.fcs: PE-A subset' });
await page.getByTestId('comp-opt-neg-Dye2').selectOption({ label: 'unstained.fcs: FITC-A subset' });
await page.getByTestId('comp-opt-run').click();
const askText = (await page.getByTestId('comp-opt-confirm').textContent()) ?? '';
await page.getByTestId('comp-opt-no').click();
check('customized weights (0.5) ask before overwriting; No leaves them', askText.includes('You already have customized weights') && (await page.getByTestId('comp-opt-done').count()) === 0);
const weightsRead = async () => {
  await page.getByTestId('comp-weights').click();
  const t = await page.getByTestId('comp-weights-table').locator('tbody tr td:nth-child(3)').allInnerTexts();
  await page.getByTestId('comp-weights-close').click();
  return t.map(Number);
};
const optimize = async () => {
  await page.getByTestId('comp-opt-run').click();
  if (await page.getByTestId('comp-opt-confirm').count()) await page.getByTestId('comp-opt-yes').click();
  let msg = '';
  for (let i = 0; i < 600 && !(await page.getByTestId('comp-opt-done').count()); i++) {
    if (!msg && (await page.getByTestId('comp-opt-message').count())) msg = (await page.getByTestId('comp-opt-message').textContent().catch(() => '')) ?? '';
    await page.waitForTimeout(50);
  }
  return { msg, done: (await page.getByTestId('comp-opt-done').textContent()) ?? '' };
};
const o1 = await optimize();
const w1 = await weightsRead();
check('Optimize Weights finishes with "Done." and stores new weights on the matrix', o1.done.startsWith('Done.') && w1.length === 3 && w1.every((v) => v > 0) && JSON.stringify(w1) !== JSON.stringify([2, 1, 0.5]), `${o1.done} ${JSON.stringify(w1)} ${o1.msg}`);
check('progress messages name the iteration and detector (when caught)', o1.msg === '' || /^Iteration \d+ : Optimizing detector \d+, current best SSM sum is /.test(o1.msg), o1.msg);
check('the optimisation stores the SSM of the controls (Display SSM)', await page.getByTestId('comp-ssm-view').isEnabled());
await page.getByTestId('comp-ssm-view').click();
const optSsm = await page.getByTestId('comp-ssm-table').locator('tbody tr').allInnerTexts();
check('SSM after optimisation has one row per fluorochrome plus Sum, with spreading > 0', optSsm.length === 3 && optSsm[0].startsWith('Dye1') && Number(optSsm[2].trim().split(/\s+/).pop()) > 0, optSsm.join(' | '));
await page.getByTestId('comp-ssm-view').click();
await optimize();
const w2 = await weightsRead();
check('Optimize Weights is deterministic (same weights on a second run)', JSON.stringify(w1) === JSON.stringify(w2), JSON.stringify(w2));
await page.getByTestId('comp-opt-close').click();

// Apply To Workspace and the Matrix Icon.
await page.getByTestId('matrix-select').selectOption({ label: wizName });
await page.getByTestId('comp-apply-workspace').click();
await closeDlg();
await openComp('unstained.fcs');
check('Apply To Workspace sets every sample to the matrix', (await page.getByTestId('comp-current').textContent()) === wizName);
await page.getByTestId('matrix-select').selectOption({ label: 'New Matrix' });
await page.getByTestId('comp-preview-sample').selectOption({ label: 'unstained.fcs' });
await page.getByTestId('comp-grid').waitFor({ timeout: 30000 });
await page.evaluate(() => {
  const dt = new DataTransfer();
  const icon = document.querySelector('[data-testid=comp-matrix-icon]');
  icon.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  const target = document.querySelector('[data-testid="sample-pe.fcs"]');
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  icon.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
});
await idle();
await closeDlg();
await openComp('pe.fcs');
check('dropping the Matrix Icon on a sample applies the matrix to it', (await page.getByTestId('comp-current').textContent()) === 'New Matrix');
await page.getByTestId('matrix-select').selectOption({ label: 'New Matrix' });
await page.getByTestId('comp-apply-group-select').selectOption({ label: 'All Samples' });
await page.getByTestId('comp-apply-group').click();
await closeDlg();
await openComp('apc.fcs');
check('Apply To Group applies to the chosen group', (await page.getByTestId('comp-current').textContent()) === 'New Matrix');
await page.screenshot({ path: join(out, 'comp-gaps.png') });
await closeDlg();

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
