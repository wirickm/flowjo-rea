// FlowJo 10 interaction model through the real UI (specs 19): workspace and
// graph-window shortcuts, multi-target paste, Cut, gate keys, clipboard
// copies, enable rules. Usage: node e2e/interaction.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
mkdirSync(join(root, 'test-results', 'e2e'), { recursive: true });
const fcs = (n) => join(root, 'fixtures/flowkit/data/8_color_data_set/fcs_files', n);
const F1 = '101_DEN084Y5_15_E03_009_clean.fcs';
const F2 = '101_DEN084Y5_15_E05_010_clean.fcs';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

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
const canvas = page.getByTestId('plot-canvas');
const at = async (fx, fy) => { const b = await canvas.boundingBox(); return [b.x + 64 + fx * (460 - 78), b.y + 14 + (1 - fy) * (420 - 62)]; };
const count = async (name) => Number((await page.getByTestId(`count-${name}`).first().textContent()).replace(/,/g, ''));
const pops = () => page.locator('[data-testid^="pop-"]:not([data-testid="pop-root"])').count();
const caption = async () => (await page.getByTestId('plot-caption').textContent()).trim();
const rect = async (a, b) => {
  await page.getByTestId('tool-rect').click();
  const [x0, y0] = await at(...a); const [x1, y1] = await at(...b);
  await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 4 }); await page.mouse.up();
  await idle();
};
const sel = (f) => page.getByTestId(`sample-${f}`).evaluate((n) => n.classList.contains('sel'));

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1), fcs(F2)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();

// Gate keys on the plot
await rect([0.2, 0.05], [0.8, 0.35]);
const before = await count('Rect 1');
await page.getByTestId('tool-select').click();
const [cx, cy] = await at(0.5, 0.2);
await page.mouse.click(cx, cy); // selects the gate and focuses the plot
await page.keyboard.press('Shift+ArrowRight');
await idle();
const nudged = await count('Rect 1');
check('arrow keys nudge the selected gate (Shift x3)', nudged !== before, `${before} -> ${nudged}`);
await page.keyboard.press('Control+z');
await idle();
check('a nudge is one undo step', (await count('Rect 1')) === before, String(await count('Rect 1')));

await page.mouse.click(cx, cy);
await page.keyboard.press('Control+t');
await idle();
check('Ctrl+T in the plot transposes the axes', (await page.getByTestId('x-channel').inputValue()) === 'SSC-A' && (await page.getByTestId('y-channel').inputValue()) === 'FSC-A');
await canvas.focus();
await page.keyboard.press('Control+t');
await page.keyboard.press('Control+k');
await idle();
check('Ctrl+K in the plot shows the next X parameter', (await page.getByTestId('x-channel').inputValue()) === 'FSC-H', await page.getByTestId('x-channel').inputValue());
await canvas.focus();
await page.keyboard.press('Control+j');
await idle();
check('Ctrl+J in the plot shows the previous X parameter', (await page.getByTestId('x-channel').inputValue()) === 'FSC-A');

// Polygon keys: Backspace drops the last vertex, Space closes
await page.getByTestId('tool-polygon').click();
for (const [fx, fy] of [[0.3, 0.5], [0.6, 0.5], [0.6, 0.8], [0.95, 0.95]]) { const [x, y] = await at(fx, fy); await page.mouse.click(x, y); }
await page.keyboard.press('Backspace');
await page.keyboard.press(' ');
await idle();
check('Backspace removes the last polygon vertex and Space closes it', (await page.getByTestId('pop-Polygon 2').count()) === 1 && (await pops()) === 2);

// Delete in the plot deletes the selected gate
await page.getByTestId('tool-select').click();
const [px, py] = await at(0.5, 0.6);
await page.mouse.click(px, py);
await page.keyboard.press('Delete');
if (await page.getByTestId('answer-Delete').count()) await page.getByTestId('answer-Delete').click();
await idle();
check('Delete on the plot deletes the selected gate', (await pops()) === 1 && (await page.getByTestId('pop-Polygon 2').count()) === 0);

// Space: next sample (only samples that have the population; All events always)
await page.getByTestId('pop-root').click();
await idle();
await canvas.focus();
await page.keyboard.press(' ');
await idle();
check('Space in the plot shows the next sample', await sel(F2));
await canvas.focus();
await page.keyboard.press('Shift+ ');
await idle();
check('Shift+Space shows the previous sample', await sel(F1));

// Workspace shortcuts: Ctrl+C / Ctrl+V onto the checked samples
await page.getByTestId('pop-Rect 1').click();
await page.keyboard.press('Control+c');
await page.getByTestId('pop-root').click();
await page.getByLabel(`check ${F2}`).check();
await page.getByTestId('pop-root').click(); // keys typed in a checkbox stay there
await page.keyboard.press('Control+v');
await idle();
await page.getByTestId(`sample-${F2}`).click();
await idle();
check('Ctrl+V pastes under the same population in every checked sample', (await page.getByTestId('pop-Rect 1').count()) === 1);
await page.getByLabel(`check ${F2}`).uncheck();

// Delete key in the tree, then Cut and Paste to group
await page.getByTestId('pop-Rect 1').click();
await page.keyboard.press('Delete');
if (await page.getByTestId('answer-Delete').count()) await page.getByTestId('answer-Delete').click();
await idle();
check('Delete in the tree deletes the selected population', (await page.getByTestId('pop-Rect 1').count()) === 0);
await page.getByTestId(`sample-${F1}`).click();
await page.getByTestId('pop-Rect 1').click();
await page.keyboard.press('Control+x');
if (await page.getByTestId('answer-Delete').count()) await page.getByTestId('answer-Delete').click();
await idle();
check('Ctrl+X cuts: the population is removed', (await page.getByTestId('pop-Rect 1').count()) === 0);
await page.getByTestId('pop-root').click();
await page.getByTestId('gate-paste-group').click();
await idle();
const inF1 = await page.getByTestId('pop-Rect 1').count();
await page.getByTestId(`sample-${F2}`).click();
await idle();
check('Paste to group pastes the cut population into every sample of the group', inF1 === 1 && (await page.getByTestId('pop-Rect 1').count()) === 1);

// Ctrl+G in the workspace is Create Group; Ctrl+I opens Inspect (Keywords)
await page.getByTestId('pop-root').click();
await page.keyboard.press('Control+g');
check('Ctrl+G outside the plot opens Create Group', (await page.getByRole('dialog').count()) === 1 && !(await page.getByTestId('manual-x0').count()));
await page.getByRole('dialog').getByRole('button', { name: /^(x|Close|Cancel)$/ }).first().click();
await page.getByTestId('pop-root').click();
await page.keyboard.press('Control+i');
check('Ctrl+I opens Inspect (Keywords)', (await page.getByRole('dialog', { name: /Keywords/i }).count()) === 1 || (await page.getByTestId('stain-FSC-A').count()) === 1);
await page.getByRole('dialog').getByLabel('Close').click();

// Ctrl+B adds the chosen statistic; Copy table puts text on the clipboard
await page.getByTestId('pop-Rect 1').click();
await page.getByTestId('stat-kind').selectOption('count');
await page.getByTestId('pop-Rect 1').click();
await page.keyboard.press('Control+b');
await idle();
check('Ctrl+B adds a statistic column', (await page.getByTestId('stats-table').count()) === 1);
await page.getByTestId('copy-table').click();
await idle();
const clipText = await page.evaluate(() => navigator.clipboard.readText());
check('Copy table puts the table on the clipboard as text', clipText.startsWith('Sample\t') && clipText.includes(F1), clipText.split('\n')[0]);

// Copy Image from the plot
await canvas.focus();
await page.keyboard.press('Control+c');
await page.waitForTimeout(300);
const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
check('Ctrl+C in the plot copies the plot image', types.includes('image/png'), types.join(','));

// Up to parent / open child keys
await page.getByTestId('pop-Rect 1').click();
await idle();
await canvas.focus();
await page.keyboard.press('Control+u');
await idle();
check('Ctrl+U in the plot goes up to the parent', (await caption()).startsWith('All events:'), await caption());

// Copy analysis to group is disabled once the analysis belongs to the group
await page.getByTestId('pop-Rect 1').click();
await page.getByTestId('apply-group').click();
await idle();
check('Copy analysis to group is disabled when the analysis is already group-owned', await page.getByTestId('apply-group').isDisabled());

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
