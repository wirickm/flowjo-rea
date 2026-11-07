// Desktop shell smoke test: launches the Electron app on the built page,
// loads an FCS file, checks a shortcut reaches the page and that a network
// request is blocked. Usage: npm run build && node e2e/electron.mjs
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { _electron } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test-results', 'e2e-electron');
mkdirSync(out, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`); };

// Minimal FCS 3.1 file: two float32 channels.
const names = ['FL1-A', 'FL2-A'];
const buf = Buffer.alloc(1000 * 8);
for (let e = 0; e < 1000; e++) { buf.writeFloatLE(100 + (e % 50), e * 8); buf.writeFloatLE(50, e * 8 + 4); }
const kw = { $BYTEORD: '1,2,3,4', $DATATYPE: 'F', $MODE: 'L', $PAR: '2', $TOT: '1000', $NEXTDATA: '0', $FIL: 'el.fcs' };
names.forEach((n, i) => Object.assign(kw, { [`$P${i + 1}N`]: n, [`$P${i + 1}B`]: '32', [`$P${i + 1}R`]: '1024', [`$P${i + 1}E`]: '0,0' }));
const textFor = (b, e2) => '/' + Object.entries({ ...kw, $BEGINDATA: String(b), $ENDDATA: String(e2) }).map(([k, v]) => `${k}/${v}`).join('/') + '/';
let text = textFor(0, 0);
for (let i = 0; i < 3; i++) { const b = 58 + Buffer.byteLength(text); text = textFor(b, b + buf.length - 1); }
const b = 58 + Buffer.byteLength(text);
const pad = (v) => String(v).padStart(8, ' ');
writeFileSync(join(out, 'el.fcs'), Buffer.concat([Buffer.from(`FCS3.1    ${pad(58)}${pad(b - 1)}${pad(b)}${pad(b + buf.length - 1)}${pad(0)}${pad(0)}`), Buffer.from(text), buf]));

const executablePath = createRequire(join(root, 'package.json'))('electron');
const app = await _electron.launch({ executablePath, args: ['--no-sandbox', root] });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.waitForSelector('[data-testid=add-fcs]');
check('window opens the built page from disk', page.url().startsWith('file:'), page.url());
await page.getByTestId('add-fcs').setInputFiles([join(out, 'el.fcs')]);
await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
check('an FCS file loads (analysis worker runs)', (await page.getByTestId('sample-el.fcs').count()) === 1);
await page.keyboard.press(process.platform === 'darwin' ? 'Meta+y' : 'Control+y');
check('Ctrl/Cmd+Y reaches the page (Preferences)', await page.getByTestId('prefs-dialog').isVisible());
const net = await page.evaluate(() => fetch('https://example.com/').then(() => 'loaded', () => 'blocked'));
check('network requests are blocked', net === 'blocked', net);
const iso = await page.evaluate(() => typeof window.require === 'undefined' && typeof window.process === 'undefined');
check('no Node access in the page', iso);
check('no uncaught page errors', errors.length === 0, errors.join('; '));
await app.close();
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 1));
process.exit(results.every((r) => r.ok) ? 0 : 1);
