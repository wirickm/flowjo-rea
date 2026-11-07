// Follow-up round f2 (docs/validation/ui-gaps/workspace.md, platforms.md,
// tables.md, graph.md): Check Sample Quality badges and report, ribbon
// customisation of the workspace / table editor / plate editor ribbons,
// CC Gates in Workspace.
// Usage: node e2e/followup-f2.mjs [baseUrl]
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5192';
const dir = join(root, 'fixtures/flowkit/data/8_color_data_set');
const FILES = ['101_DEN084Y5_15_E01_008_clean.fcs', '101_DEN084Y5_15_E03_009_clean.fcs'];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
await context.addInitScript(() => localStorage.setItem('flowjo-rea.separateWindows', '0'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
const idle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const tab = (t) => page.getByTestId(`ribbon-tab-${t}`).click();
const has = async (id) => (await page.getByTestId(id).count()) > 0;
const x = async (id) => (await page.getByTestId(id).boundingBox()).x;

await page.goto(base);
await page.getByTestId('add-fcs').setInputFiles(FILES.map((f) => join(dir, 'fcs_files', f)));
await idle();

// --- Check Sample Quality ---------------------------------------------------
await tab('Tools');
await page.getByTestId('check-quality').click();
await idle();
const st = await Promise.all(FILES.map((f) => page.getByTestId(`quality-${f}`).getAttribute('data-status')));
check('Check Sample Quality marks every sample of the group with a badge', st.every((s) => ['valid', 'ok', 'irregular', 'flawed', 'malformed'].includes(s)), st.join(', '));
check('the badge tooltip names the status', /^Sample quality: /.test(await page.getByTestId(`quality-${FILES[0]}`).getAttribute('title')));
await page.getByTestId(`quality-${FILES[0]}`).click();
const rows = await page.locator('[data-testid^=quality-row-]').count();
check('the report lists the trend of every non-time parameter', rows > 5 && !(await has('quality-row-Time')), `${rows} rows`);
check('the report shows the status and drifting parameters', (await page.getByTestId('quality-status').innerText()).length > 0 && (await page.getByTestId('quality-drifting').innerText()).length > 0);
await page.getByTestId('quality-close').click();

// --- Workspace ribbon customisation -----------------------------------------
await tab('File');
await page.getByTestId('ribbon-config').click();
check('Customize Ribbon opens on the current task', (await page.getByTestId('rib-task').inputValue()) === 'File');
await page.getByTestId('rib-remove-find').click();
check('Remove takes the band off the task', !(await has('open-find')) && !(await has('rib-band-find')));
await page.getByTestId('rib-remove-document').click();
check('the last band of a task cannot be removed', (await page.getByTestId('rib-error').innerText()) === 'Unable to remove the last band from a task.' && (await has('save-ws')));
await page.getByTestId('rib-add-find').click();
await page.getByTestId('rib-left-find').click();
check('Add puts the band back; moving reorders it', (await has('open-find')) && (await x('open-find')) < (await x('save-ws')));
await page.getByTestId('rib-add-find').click();
check('a band already on the task is refused', (await page.getByTestId('rib-error').innerText()).startsWith('No band was added'));
await page.getByTestId('rib-palette-expand').dragTo(page.getByTestId('rib-band-document'), { targetPosition: { x: 4, y: 4 } });
check('dragging a band from the list onto a band adds it before (left half)', (await has('expand-all')) && (await x('expand-all')) < (await x('save-ws')));
await page.getByTestId('rib-band-expand').dragTo(page.getByTestId('rib-palette'));
check('dragging a band off the ribbon removes it', !(await has('expand-all')));
await page.getByTestId('rib-task').selectOption('Tools');
await page.getByTestId('rib-add-settings').click();
await page.getByTestId('rib-close').click();
await tab('Tools');
check('a band can be added to another task', await has('separate-windows'));
await page.reload();
await idle();
await tab('File');
check('customisations last for the session', (await x('open-find')) < (await x('save-ws')));
await page.getByTestId('ribbon-config').click();
await page.getByTestId('rib-commit').click();
const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('flowjo-rea.ribbon.ws') ?? 'null'));
check('Commit to Preferences saves the structure', prefs?.File?.[0] === 'find', JSON.stringify(prefs?.File));
await page.getByTestId('rib-defaults').click();
const cleared = await page.evaluate(() => localStorage.getItem('flowjo-rea.ribbon.ws'));
check('Apply defaults restores the default ribbon and clears the preferences', cleared === null && (await x('save-ws')) < (await x('open-find')));
await page.getByTestId('rib-close').click();

// --- Table editor ribbon ------------------------------------------------------
await page.getByTestId('open-tables').click();
await page.getByTestId('table-new').click();
await page.getByTestId('te-ribbon-config').click();
await page.getByTestId('rib-remove-plots').click();
check('table editor: removing the Plots band hides it', !(await has('table-plot-box')) && (await has('table-create')));
await page.getByTestId('rib-right-formatting').click();
check('table editor: bands reorder', (await page.getByTestId('table-iter').boundingBox()).y < (await page.getByTestId('table-format-none').boundingBox()).y);
check('table editor has no Commit to Preferences (no TECommand)', !(await has('rib-commit')));
await page.getByTestId('rib-defaults').click();
check('table editor: Apply defaults restores the bands', await has('table-plot-box'));
await page.getByTestId('rib-close').click();
await page.getByTestId('tables-close').click();

// --- Plate editor ribbon ------------------------------------------------------
await tab('Tools');
await page.getByTestId('open-plate').click();
await page.getByTestId('pe-ribbon-config').click();
await page.getByTestId('rib-remove-size').click();
check('plate editor: removing a band hides it', !(await has('pe-size-96')));
await page.getByTestId('rib-band-settings').dragTo(page.getByTestId('rib-band-plates'), { targetPosition: { x: 4, y: 4 } });
check('plate editor: drag moves a band', (await x('pe-show-n')) < (await x('pe-add-plate')));
await page.getByTestId('rib-defaults').click();
check('plate editor: Apply defaults', (await has('pe-size-96')) && (await x('pe-add-plate')) < (await x('pe-show-n')));
await page.getByTestId('rib-close').click();
await page.getByTestId('pe-close').click();

// --- CC Gates in Workspace -----------------------------------------------------
if (!(await has(`row-${FILES[0]}`))) { await page.getByTestId('add-fcs').setInputFiles(FILES.map((f) => join(dir, 'fcs_files', f))); await idle(); }
await page.getByTestId(`row-${FILES[0]}`).click();
await tab('FlowJo');
await page.getByTestId('open-platforms').click();
const ch = 'FSC-A';
await page.getByTestId('platform-channel').selectOption(ch);
await page.getByTestId('platform-run').click();
await page.getByTestId('cc-result').waitFor({ timeout: 60000 }).catch(() => {});
if (await has('cc-result')) {
  await page.getByTestId('cc-gates').check();
  await idle();
  const names = ['G1', 'G2', 'S'].map((p) => `row-${FILES[0]}/DeanJettFox-${ch}-${p}`);
  const made = await Promise.all(names.map(has));
  check('CC Gates in Workspace adds the G1, G2 and S range gates', made.every(Boolean), made.join(','));
  await page.getByTestId('cc-gates').uncheck();
  await idle();
  check('unchecking removes them', !(await Promise.all(names.map(has))).some(Boolean));
} else check('cell cycle fit ran for CC Gates', false, await page.getByTestId('platform-error').innerText().catch(() => ''));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
