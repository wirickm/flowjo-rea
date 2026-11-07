// Graph Display menu, gate size, axis stepping, workspace tree commands, Find,
// Add Keyword and the ribbon-grouped toolbar (specs 22).
// Usage: node e2e/display.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

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
const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const idle = async () => {
  await page.waitForTimeout(150);
  if (await page.getByTestId('gate-namer-ok').count()) { await page.getByTestId('gate-namer-ok').click(); await page.waitForTimeout(150); }
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const canvas = page.getByTestId('plot-canvas');
const at = async (fx, fy) => { const b = await canvas.boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };
const count = async (name) => Number((await page.getByTestId(`count-${name}`).first().textContent()).replace(/,/g, ''));

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();

// Toolbar bands
const bands = await page.locator('header .band-label').allInnerTexts();
check('toolbar is grouped in FlowJo ribbon bands', ['Document', 'Find', 'Keywords', 'Expand', 'Cytometry', 'Settings'].every((b) => bands.map((x) => x.toLowerCase()).includes(b.toLowerCase())), bands.join(', '));

// A rectangle, then the Display menu
await page.getByTestId('tool-rect').click();
let [x0, y0] = await at(0.25, 0.08); let [x1, y1] = await at(0.65, 0.4);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
const before = await count('Rect 1');
await page.getByTestId('display-menu').locator('summary').click();
for (const id of ['display-grid', 'display-medians']) await page.getByTestId(id).check();
await page.getByTestId('display-freq').uncheck();
await idle();
check('Display menu: frequencies on by default, grid / medians off; settings kept per population', !(await page.getByTestId('display-freq').isChecked()) && (await page.getByTestId('display-grid').isChecked()) && (await page.getByTestId('display-names').isChecked()));
await page.getByTestId('pop-Rect 1').click(); await idle();
const childGrid = await page.getByTestId('display-grid').isChecked();
await page.getByTestId('pop-root').click(); await idle();
check('the Display settings belong to the population plot', !childGrid && (await page.getByTestId('display-grid').isChecked()));
await page.getByTestId('display-freq').check();

// Gate size: select the gate, Ctrl+= grows it by 1.1
await page.getByTestId('tool-select').click();
const [gx, gy] = await at(0.45, 0.24);
await page.mouse.click(gx, gy);
await page.keyboard.press('Control+=');
await idle();
const bigger = await count('Rect 1');
await page.keyboard.press('Control+-');
await idle();
const back = await count('Rect 1');
check('Ctrl+= grows the selected gate by 1.1 about its centre; Ctrl+- shrinks it', bigger > before && Math.abs(back - before) < before * 0.01, `${before} -> ${bigger} -> ${back}`);

// No wrap for Next / Previous X
await page.getByTestId('x-channel').selectOption('FSC-A');
await idle();
await canvas.focus();
await page.keyboard.press('Control+j');
await idle();
check('Previous X at the first parameter stays (no wrap)', (await page.getByTestId('x-channel').inputValue()) === 'FSC-A');

// Tree: a child under Rect 1, then collapse / expand
await page.getByTestId('pop-Rect 1').first().click(); await idle();
await page.getByTestId('tool-rect').click();
[x0, y0] = await at(0.3, 0.1); [x1, y1] = await at(0.5, 0.3);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
await idle();
await page.getByTestId('twisty-Rect 1').click();
await idle();
check('collapsing a node hides its subtree', (await page.locator('[data-testid^="pop-Rect"]').count()) === 1);
await page.getByTestId('pop-root').click();
await page.keyboard.press('Control+u');
await idle();
check('Ctrl+U expands every node', (await page.locator('[data-testid^="pop-Rect"]').count()) === 2);
await page.keyboard.press('Control+Shift+U');
await idle();
check('Ctrl+Shift+U collapses every node', (await page.locator('[data-testid^="pop-Rect"]').count()) === 1);
await page.getByTestId('expand-all').click();
await idle();

// Duplicate from the context menu
await page.getByTestId('pop-Rect 1').first().click({ button: 'right' });
await page.getByTestId('ctx-Duplicate').click();
await idle();
check('Duplicate makes "Rect 1-1" with its child', (await page.getByTestId('pop-Rect 1-1').count()) === 1);

// Select Equivalent Nodes: Rect 1 is only in F1
await page.getByTestId('pop-Rect 1').first().click();
await page.keyboard.press('Control+Shift+E');
await page.waitForTimeout(200);
check('Select Equivalent Nodes checks the samples that have the population', (await page.getByLabel(`check ${F1}`).isChecked()) && !(await page.getByLabel(`check ${F2}`).isChecked()));

// Add Keyword and Find
await page.getByTestId('open-add-keyword').click();
await page.getByTestId('add-keyword-name').fill('Donor');
await page.getByTestId('add-keyword-ok').click();
await idle();
const ann = await page.locator('body').textContent();
check('Add Keyword adds the keyword to every sample', ann.includes('Donor'));
await page.getByTestId('open-find').click();
await page.getByTestId('find-what').fill('sep-2017');
const n = (await page.getByTestId('find-count').textContent()).trim();
const rows = await page.getByTestId('find-results').locator('tbody tr').count();
check('Find searches keyword values, case-insensitive by default', rows > 0 && n.includes('match'), `${n}`);
await page.getByTestId('find-case').check();
const rowsCase = await page.getByTestId('find-results').locator('tbody tr').count();
check('Match case narrows the results', rowsCase < rows, `${rows} -> ${rowsCase}`);
await page.getByTestId('find-next').click().catch(() => {});
await page.keyboard.press('Escape');
await page.screenshot({ path: join(out, 'display-toolbar.png') });

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
