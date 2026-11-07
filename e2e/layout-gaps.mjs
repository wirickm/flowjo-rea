// Layout editor gaps (docs/validation/ui-gaps/layout.md): resize handles and
// Lock Size, Select All / Invert, Copy / Cut / Paste, figure properties,
// shapes and arrowheads, chart axis / population change, Open Original Graph,
// the layout list, text styling and live fields, Insert Graphic, zoom, page
// scaling, rulers, page breaks, header / footer, multigraph variants, batch name.
// Usage: node e2e/layout-gaps.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5173';
const out = join(root, 'test-results', 'e2e');
mkdirSync(out, { recursive: true });
const fcs = (n) => join(root, 'fixtures/flowkit/data/8_color_data_set/fcs_files', n);
const F1 = '101_DEN084Y5_15_E03_009_clean.fcs';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
// A 20 x 10 red PNG for Insert Graphic.
const png = (() => {
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(20, 0); ihdr.writeUInt32BE(10, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 10 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: 20 }, () => [255, 0, 0]).flat())])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
const pngPath = join(out, 'layout-gaps-graphic.png');
writeFileSync(pngPath, png);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1700, height: 1200 }, acceptDownloads: true });
await context.addInitScript(() => { localStorage.setItem('flowjo-rea.separateWindows', '0'); });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/clipboard/i.test(m.text()) && errors.push(m.text()));
page.on('dialog', (d) => d.accept());
const idle = async () => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const cards = page.getByTestId('layout-card');
const boxes = () => cards.evaluateAll((els) => els.map((e) => ({ id: e.dataset.id, kind: e.dataset.kind, style: e.dataset.style, b: e.dataset.box.split(',').map(Number) })));
const pick = async (loc, shift = false) => { await loc.dispatchEvent('mousedown', { bubbles: true, shiftKey: shift }); await loc.dispatchEvent('mouseup', { bubbles: true }); await page.waitForTimeout(150); };
const clear = async () => { const pg = page.locator('[data-testid=layout-page]'); const b = await pg.boundingBox(); await pg.click({ position: { x: b.width - 4, y: b.height - 4 } }); await page.waitForTimeout(100); };
const download = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); return d; };

await page.goto(base + (base.includes('?') ? '&' : '?') + 'layout=classic');
await page.getByTestId('add-fcs').setInputFiles([fcs(F1)]);
await idle();
await page.getByTestId(`sample-${F1}`).click();
await idle();
// A rectangle gate so a chart can switch population.
const canvas = page.getByTestId('plot-canvas');
const cb = await canvas.boundingBox();
const at = (fx, fy) => [cb.x + 64 + fx * (460 - 78), cb.y + 14 + (1 - fy) * (420 - 62)];
await page.getByTestId('tool-rect').click();
let [x0, y0] = at(0.15, 0.04); let [x1, y1] = at(0.85, 0.6);
await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(300);
if (await page.locator('.modal-bg').count()) await page.keyboard.press('Enter');
await idle();
await page.getByTestId('pop-root').click(); await idle();
await page.getByTestId('add-to-layout').click();
await page.getByTestId('open-layout').click();
await page.waitForFunction(() => document.querySelectorAll('[data-testid=layout-card] img').length === 1, null, { timeout: 60000 });

// 1. Resize from a corner handle; Shift keeps the aspect ratio; Lock Size
let bx = await boxes();
const chart = bx[0];
await pick(cards.nth(0));
check('a selected figure shows four corner handles', (await page.locator('[data-testid^=layout-handle-]').count()) === 4);
let pageBox = await page.getByTestId('layout-page').boundingBox();
const ptPx = (x, y) => [pageBox.x + x, pageBox.y + y];
let [hx, hy] = ptPx(chart.b[0] + chart.b[2], chart.b[1] + chart.b[3]);
await page.mouse.move(hx - 1, hy - 1); await page.mouse.down(); await page.mouse.move(hx - 60, hy - 40, { steps: 5 }); await page.mouse.up();
await page.waitForTimeout(300);
bx = await boxes();
check('dragging the bottom-right handle resizes; the top-left corner stays', bx[0].b[0] === chart.b[0] && bx[0].b[1] === chart.b[1] && Math.abs(bx[0].b[2] - (chart.b[2] - 59)) <= 1 && Math.abs(bx[0].b[3] - (chart.b[3] - 39)) <= 1, bx[0].b.join(','));
const r0 = bx[0].b[2] / bx[0].b[3];
pageBox = await page.getByTestId('layout-page').boundingBox();
[hx, hy] = ptPx(bx[0].b[0] + bx[0].b[2], bx[0].b[1] + bx[0].b[3]);
await page.mouse.move(hx - 1, hy - 1); await page.keyboard.down('Shift'); await page.mouse.down(); await page.mouse.move(hx + 80, hy + 5, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
await page.waitForTimeout(300);
bx = await boxes();
check('Shift-drag keeps the aspect ratio', Math.abs(bx[0].b[2] / bx[0].b[3] - r0) < 0.02 && bx[0].b[2] > chart.b[2] - 59, `${bx[0].b.join(',')} ratio ${r0.toFixed(3)}`);
await page.getByTestId('layout-lock-size').click();
await page.waitForTimeout(200);
check('Lock Size hides the handles', (await page.locator('[data-testid^=layout-handle-]').count()) === 0);
await page.getByTestId('layout-lock-size').click();

// 2. Chart X / Y axis and population after placement; Remove Data
const imgBefore = await cards.nth(0).locator('img').getAttribute('src');
await page.getByTestId('layout-chart-y').selectOption('CD4 PE-Cy7 FLR-A');
await page.waitForFunction((s) => document.querySelector('[data-testid=layout-card] img')?.getAttribute('src') !== s, imgBefore, { timeout: 60000 });
check('Chart Y Axis changes the placed chart', (await page.getByTestId('layout-chart-y').inputValue()) === 'CD4 PE-Cy7 FLR-A');
await page.getByTestId('layout-chart-pop').selectOption('Rect 1');
await page.waitForFunction(() => /Rect 1/.test(document.querySelector('[data-testid=layout-card]')?.getAttribute('title') ?? ''), null, { timeout: 60000 });
check('the chart can switch population', /Rect 1/.test(await cards.nth(0).getAttribute('title')));
await page.getByTestId('layout-ancestry').check();
await page.waitForTimeout(400);
const hAnc = (await boxes())[0].b;
await page.getByTestId('layout-ancestry-dir').selectOption('v');
await page.waitForTimeout(400);
const vAnc = (await boxes())[0].b;
check('Vertical ancestry puts the ancestry charts below: taller, narrower', vAnc[3] > hAnc[3] && vAnc[2] < hAnc[2], `${hAnc.join(',')} -> ${vAnc.join(',')}`);
await page.getByTestId('layout-ancestry').uncheck();
await page.getByTestId('layout-multigraph').selectOption('allby');
await page.waitForTimeout(400);
const allby = (await boxes())[0].b;
await page.getByTestId('layout-multigraph').selectOption('halfnxn');
await page.waitForTimeout(400);
const half = (await boxes())[0].b;
check('All by Y is one row of charts; half N x N is N rows', half[3] > allby[3], `${allby.join(',')} / ${half.join(',')}`);
check('multigraph 2-D cells can be dot or contour plots', (await page.getByTestId('layout-multigraph-kind').count()) === 1);
await page.getByTestId('layout-multigraph').selectOption('');
await page.waitForTimeout(300);

// 3. Select All, Invert, Copy / Paste (+4), Cut
await page.getByTestId('layout-add-text').click();
await page.getByTestId('layout-page').focus();
await page.keyboard.press('Control+a');
await page.waitForTimeout(150);
check('Ctrl+A selects every figure', (await page.locator('[data-testid=layout-card].sel').count()) === 2);
await clear(); await pick(cards.nth(1));
await page.getByTestId('layout-select-invert').click();
await page.waitForTimeout(150);
check('Invert Selection selects the others', (await page.locator('[data-testid=layout-card].sel').count()) === 1 && (await page.locator('[data-testid=layout-card].sel').getAttribute('data-kind')) === 'chart');
await clear(); await pick(cards.nth(1));
const tb0 = (await boxes())[1].b;
await page.getByTestId('layout-page').focus();
await page.keyboard.press('Control+c');
await page.keyboard.press('Control+v');
await page.waitForTimeout(300);
bx = await boxes();
check('Copy + Paste adds a copy 4 pt right and down, selected', bx.length === 3 && bx[2].b[0] === tb0[0] + 4 && bx[2].b[1] === tb0[1] + 4 && (await cards.nth(2).getAttribute('class')).includes('sel'), bx[2]?.b.join(','));
await page.keyboard.press('Control+x');
await page.waitForTimeout(200);
check('Cut removes the selection', (await cards.count()) === 2);
await page.getByTestId('layout-paste').click();
await page.waitForTimeout(200);
check('Paste after Cut puts it back', (await cards.count()) === 3);
await page.keyboard.press('Delete');
await page.waitForTimeout(150);

// 4. Shapes, figure properties, arrowheads
await page.getByTestId('layout-add-rect').click();
await page.getByTestId('layout-fill-on').check();
await page.getByTestId('layout-fill').fill('#ff0000');
await page.getByTestId('layout-line-weight').selectOption('heavy');
await page.getByTestId('layout-line-style').selectOption('dashed');
await page.getByTestId('layout-gradient-type').selectOption('vertical');
await page.waitForTimeout(200);
bx = await boxes();
const rect = bx.find((x) => x.kind === 'rect');
const st = JSON.parse(rect?.style ?? '{}');
check('Figure Properties set fill, line weight, line style and gradient', st.fill === '#ff0000' && st.weight === 'heavy' && st.lineStyle === 'dashed' && st.gradientType === 'vertical', rect?.style);
await page.getByTestId('layout-add-arrow').click();
await page.waitForTimeout(150);
check('an arrow is a line with a forward arrowhead', (await page.getByTestId('layout-arrowhead').inputValue()) === 'forward');
await page.getByTestId('layout-arrowhead').selectOption('double');
check('arrowheads: None, Forward, Backward, Double-headed', (await page.getByTestId('layout-arrowhead').inputValue()) === 'double');
await page.getByTestId('layout-add-ellipse').click();
await page.waitForTimeout(150);
check('rectangles, ellipses and lines are figures', ['rect', 'line', 'ellipse'].every((k) => true) && (await boxes()).filter((x) => ['rect', 'line', 'ellipse'].includes(x.kind)).length === 3);

// 5. Text styling, live keyword, special characters
await clear(); await pick(cards.nth(1));
await page.getByTestId('layout-text').fill('Events: ');
await page.getByTestId('layout-text').evaluate((t) => t.setSelectionRange(8, 8));
await page.getByTestId('layout-insert-keyword').selectOption('$TOT');
await page.waitForTimeout(500);
check('Insert Keyword shows the live keyword value', /^Events: \d{4,}/.test(await cards.nth(1).innerText()) && (await page.getByTestId('layout-text').inputValue()) === 'Events: {{keyword:$TOT}}', await cards.nth(1).innerText());
await page.getByTestId('layout-text-bold').check();
await page.getByTestId('layout-text-size').fill('16');
await page.waitForTimeout(150);
const font = await cards.nth(1).locator('.layout-textbox').evaluate((e) => e.style.font);
check('text font size and bold apply to the text figure', /bold/.test(font) && /16px/.test(font), font);
await page.getByTestId('layout-special-chars').click();
await page.getByTestId('layout-char').first().click();
await page.waitForTimeout(150);
check('Special Characters inserts the character', (await page.getByTestId('layout-text').inputValue()).includes(String.fromCharCode(945)));

// 6. Insert Graphic
await page.getByTestId('layout-insert-graphic').setInputFiles(pngPath);
await page.waitForTimeout(800);
bx = await boxes();
const img = bx.find((x) => x.kind === 'image');
check('Insert Graphic adds an image figure at (30, 50) at its own size', !!img && img.b.join() === '30,50,20,10', img?.b.join(','));

// 7. Zoom in / out / fit; scale to page; rulers; page breaks
await page.getByTestId('layout-zoom-in').click();
check('Zoom In takes the next step (100 -> 150 %)', (await page.getByTestId('layout-page').getAttribute('data-zoom')) === '1.5');
await page.getByTestId('layout-zoom-out').click(); await page.getByTestId('layout-zoom-out').click();
check('Zoom Out takes the previous step (150 -> 100 -> 75 %)', (await page.getByTestId('layout-page').getAttribute('data-zoom')) === '0.75');
await page.getByTestId('layout-zoom-fit').click();
check('Fit to Window picks a listed step', [0.12, 0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5, 2, 4].includes(Number(await page.getByTestId('layout-page').getAttribute('data-zoom'))));
await page.getByTestId('layout-zoom-100').click();
// a figure beyond the first page, then Scale To Page
await clear(); await pick(cards.nth(0));
await page.getByTestId('layout-page').focus();
for (let i = 0; i < 40; i++) await page.keyboard.press('Shift+ArrowRight');
await page.waitForTimeout(300);
const pagesBefore = await page.getByTestId('layout-export-pdf').innerText();
await page.getByTestId('layout-scale-page').click();
await page.waitForTimeout(300);
check('Scale To Page fits every figure on one page', /\(1 page\)/.test(await page.getByTestId('layout-export-pdf').innerText()) && !/\(1 page\)/.test(pagesBefore), `${pagesBefore} -> ${await page.getByTestId('layout-scale').innerText()}`);
await page.getByTestId('layout-show-rulers').check();
check('Show Rulers shows a ruler', (await page.getByTestId('layout-ruler').count()) === 1);
await page.getByTestId('layout-scale-reset').click();
await page.waitForTimeout(200);
const breaks0 = await page.locator('.page-break').count();
await page.getByTestId('layout-show-breaks').uncheck();
check('Show Pagebreaks off hides the page breaks', breaks0 > 0 && (await page.locator('.page-break').count()) === 0, `${breaks0}`);

// 8. Header / footer in the PDF; batch file name
await page.getByTestId('layout-header-footer').click();
await page.getByTestId('layout-hf-header').check();
check('header preview fills in the page number', (await page.getByTestId('layout-hf-preview').innerText()).startsWith('Page 1'));
const pdf = await download(() => page.getByTestId('layout-export-pdf').click());
check('PDF with header exports', /\.pdf$/.test(pdf.suggestedFilename()));
await page.getByTestId('layout-file-name').fill('report');
const pngD = await download(() => page.getByTestId('layout-export').click());
check('File Name sets the output name', pngD.suggestedFilename().startsWith('report_'), pngD.suggestedFilename());

// 9. Several layouts: Add, Duplicate, Rename, Delete
const n0 = await cards.count();
await page.getByTestId('layout-list-add').click();
await page.waitForTimeout(200);
check('Add makes an empty layout "Layout-1" current', (await page.getByTestId('layout-list').inputValue()) === 'Layout-1' && (await cards.count()) === 0);
await page.getByTestId('layout-list').selectOption('Layout');
await page.waitForTimeout(300);
check('switching back shows the first layout\'s figures', (await cards.count()) === n0);
await page.getByTestId('layout-list-duplicate').click();
await page.waitForTimeout(300);
check('Duplicate copies the layout as "Layout-2"', (await page.getByTestId('layout-list').inputValue()) === 'Layout-2' && (await cards.count()) === n0);
await page.getByTestId('layout-list-rename').click();
await page.getByTestId('layout-rename-input').fill('Figures');
await page.getByTestId('layout-rename-input').press('Enter');
await page.waitForTimeout(200);
check('Rename renames the current layout', (await page.getByTestId('layout-list').inputValue()) === 'Figures' && (await page.getByTestId('layout-list').locator('option').allInnerTexts()).join() === 'Figures,Layout,Layout-1');
await page.getByTestId('layout-list-delete').click();
await page.waitForTimeout(300);
check('Delete removes it; the layout now at its place becomes current', (await page.getByTestId('layout-list').locator('option').count()) === 2 && (await page.getByTestId('layout-list').inputValue()) === 'Layout');

// 10. Open Original Graph
await clear();
const chartCard = page.locator('[data-testid=layout-card][data-kind=chart]').first();
await pick(chartCard);
await page.getByTestId('layout-open-graph').click();
await page.waitForTimeout(500);
check('Open Original Graph closes the layout and selects the chart\'s population', (await page.getByTestId('layout-page').count()) === 0 && ((await page.getByTestId('pop-Rect 1').getAttribute('class')) ?? '').includes('sel'));

check('no page errors', errors.length === 0, errors.join(' | '));
await page.screenshot({ path: join(out, 'layout-gaps.png') });
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
