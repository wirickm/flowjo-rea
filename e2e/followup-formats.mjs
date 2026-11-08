// Follow-up formats (docs/validation/ui-gaps/workspace.md section O,
// tables.md section 3): Export to / Import from FACSDiva, Import Parameters
// from CSV/CLR, Consensus Gate, Cluster Frequency, table output FlowJo XML
// and SQL.
// Usage: node e2e/followup-formats.mjs [baseUrl]
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(import.meta.url)('playwright');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] ?? 'http://localhost:5193';
const out = join(root, 'test-results', 'e2e');
mkdirSync(out, { recursive: true });
const dir = join(root, 'fixtures/flowkit/data/8_color_data_set');
const FILES = ['101_DEN084Y5_15_E01_008_clean.fcs', '101_DEN084Y5_15_E03_009_clean.fcs'];
const F1 = FILES[1];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};

// $TOT and parameter names of the FCS file (TEXT segment).
const fcs = readFileSync(join(dir, 'fcs_files', F1));
const ts = Number(fcs.subarray(10, 18).toString().trim()), te = Number(fcs.subarray(18, 26).toString().trim());
const txt = fcs.subarray(ts, te + 1).toString('latin1');
const d = txt[0];
const parts = txt.slice(1).split(d);
const kw = {};
for (let i = 0; i + 1 < parts.length; i += 2) kw[parts[i].toUpperCase()] = parts[i + 1];
const TOT = Number(kw.$TOT);
const names = Array.from({ length: Number(kw.$PAR) }, (_, i) => kw[`$P${i + 1}N`]);

// A FACSDiva experiment that includes F1 (element names as the FlowJo Diva classes read them).
const param = (n) => `<parameter name="${n}" type="30"><is_log>false</is_log><min>0.0</min><max>262143.0</max><biexp_scale>-1</biexp_scale><comp_biexp_scale>-1</comp_biexp_scale><manual_biexp_scale>-1</manual_biexp_scale></parameter>`;
const inst = `<instrument_settings name="Cytometer Settings"><use_auto_biexp_scale>true</use_auto_biexp_scale>${names.map(param).join('')}</instrument_settings>`;
const exp = `<?xml version="1.0" encoding="UTF-8"?><bdfacs version="Version 8.5"><experiment name="Base"><date>2019-01-01T00:00:00</date><export_time>2019-01-01T00:00:00</export_time><acquisition_worksheets name="Global Worksheets"><worksheet_template name="Global">${inst}<gates><gate fullname="All Events" type="EventSource_Classifier"><name>All Events</name></gate></gates></worksheet_template></acquisition_worksheets><specimen name="Specimen_001"><tube name="T"><data_filename>${F1}</data_filename>${inst}</tube></specimen></experiment></bdfacs>`;
const expPath = join(out, 'diva-base.xml');
writeFileSync(expPath, exp);
const csvPath = join(out, `${F1.replace(/\.fcs$/, '')}_Score.csv`);
writeFileSync(csvPath, 'Score\n' + Array.from({ length: TOT }, (_, i) => String(i % 7)).join('\n') + '\n');
const badPath = join(out, 'short.csv');
writeFileSync(badPath, '1\n2\n3\n');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
await context.addInitScript(() => localStorage.setItem('flowjo-rea.separateWindows', '0'));
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const idle = async () => {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.querySelector('[data-testid=busy]')?.textContent === 'Ready', null, { timeout: 120000 });
};
const T = (id) => page.getByTestId(id);
const tab = (t) => T(`ribbon-tab-${t}`).click();
const popRow = (sample, name) => page.locator(`[data-testid^="row-${sample}/"][data-testid$="/${name}"]`).first();
const log = async () => { if (!(await T('log').count())) await T('drawer-log').click(); return T('log').innerText(); };
const dl = async (fn) => { const [x] = await Promise.all([page.waitForEvent('download'), fn()]); return { name: x.suggestedFilename(), text: readFileSync(await x.path(), 'utf8') }; };
const derivedNames = async () => { await T('open-derived').first().click(); const t = await T('derived-list').innerText().catch(() => ''); await page.keyboard.press('Escape'); await page.locator('.modal-bg').first().click({ position: { x: 2, y: 2 } }).catch(() => {}); return t; };

await page.goto(base);
await tab('File');
await T('open-ws').setInputFiles(join(dir, '8_color_ICS_simple.wsp'));
await idle();
await T('add-fcs').setInputFiles(FILES.map((f) => join(dir, 'fcs_files', f)));
await idle();
await popRow(F1, 'Singlets').click();
await idle();

// --- Export to FACSDiva -------------------------------------------------------
await tab('File');
await T('export-diva').click();
check('Export to FACSDiva needs an existing experiment', await T('diva-export-ok').isDisabled());
await T('diva-export-input').setInputFiles(expPath);
await T('diva-export-name').fill('FJ Gates');
const ex = await dl(() => T('diva-export-ok').click());
check('Export writes <name>.xml', ex.name === 'FJ Gates.xml', ex.name);
check('the export adds the "FlowJo Exported Gates" template with the gates', ex.text.includes('worksheet_template name="FlowJo Exported Gates"') && ex.text.includes('fullname="All Events\\Time\\Singlets"') && ex.text.includes('experiment name="FJ Gates"'));
check('the tube settings are written with automatic biex off', /<tube name="T">[\s\S]*<use_auto_biexp_scale>false<\/use_auto_biexp_scale>/.test(ex.text));
writeFileSync(join(out, 'diva-exported.xml'), ex.text);

// --- Import from FACSDiva -----------------------------------------------------
const before = await page.locator(`[data-testid^="row-${F1}/"]`).count();
await T('import-diva').setInputFiles(join(out, 'diva-exported.xml'));
await T('diva-import-worksheet').selectOption('FlowJo Exported Gates');
check('Import picks the tube of the selected sample', (await T('diva-import-fcs').inputValue()) === F1);
await T('diva-import-ok').click();
await idle();
const after = await page.locator(`[data-testid^="row-${F1}/"]`).count();
check('Import from FACSDiva adds the gates to the sample', after > before, `${before} -> ${after}`);
check('Import reports what it imported', (await log()).includes('from FACSDiva'));

// --- Import Parameters from CSV/CLR ------------------------------------------
await T('import-csv-clr').setInputFiles(badPath);
await idle();
check('a file whose rows differ from the event count is refused', (await log()).includes(`3 data rows but the sample has ${TOT} events`));
await T('import-csv-clr').setInputFiles(csvPath);
await idle();
check('CSV import adds a parameter named from the header', (await log()).includes('Imported Score from'));
await tab('Tools');
await page.locator('[data-testid=open-derived]:visible').click();
check('the imported parameter is listed as a derived parameter from its file', (await T('derived-list').innerText()).includes('Imported from'), await T('derived-list').innerText());
await page.keyboard.press('Escape');
await page.locator('.modal-bg').evaluateAll((els) => els.forEach((e) => e.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))));

// --- Consensus Gate / Cluster Frequency --------------------------------------
await tab('Workspace');
await popRow(F1, 'Singlets').click();
await T('consensus-dp').click();
check('Consensus needs two populations', (await log()).includes('Select at least two populations'));
await popRow(F1, 'Singlets').click();
await popRow(F1, 'aAmine-').click({ modifiers: ['Control'] });
await T('consensus-dp').click();
await idle();
check('Consensus Gate creates "<pop>.<pop>.Consensus"', (await log()).includes('Created derived parameter Singlets.aAmine-.Consensus') || (await log()).includes('Created derived parameter aAmine-.Singlets.Consensus'), (await log()).split('\n')[0]);
await T('cluster-freq-dp').click();
await idle();
check('Cluster Frequency uses the focused population as primary', /Created derived parameter \S+\.\S+\.ClusterFreq/.test(await log()), (await log()).split('\n')[0]);
await tab('Tools');
check('three derived parameters exist (CSV, consensus, cluster frequency)', (await page.locator('[data-testid=open-derived]:visible').innerText()).includes('(3)'), await page.locator('[data-testid=open-derived]:visible').innerText());

// --- Table output: FlowJo XML and SQL ----------------------------------------
await page.locator('[data-testid=open-tables]').first().click();
await T('table-new').click();
await T('table-kw').fill('$TOT');
await T('table-add-kw').click();
await T('table-kw').fill('$DATE');
await T('table-add-kw').click();
await T('table-dest').selectOption('FILE');
await T('table-format').selectOption('XML_FLOWJO');
const x1 = await dl(() => T('table-create').click());
check('To File, FlowJo XML: <Table> with Columns and Rows', x1.name === 'Table.xml' && x1.text.startsWith('<Table name="Table">') && x1.text.includes('<Column id="0" keyword="$TOT"/>') && x1.text.includes(`<Row sample="${F1}"`), x1.text.slice(0, 120));
await T('table-format').selectOption('SQL');
const x2 = await dl(() => T('table-create').click());
check('To File, SQL: one INSERT per row in a .sql file', x2.name === 'Table.sql' && x2.text.split('\n').filter(Boolean).every((l) => l.startsWith("INSERT INTO 'Table' ('$TOT','$DATE') VALUES (")), x2.text.split('\n')[0]);

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
