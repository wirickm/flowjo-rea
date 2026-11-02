// Produce REA original-case Evidence for the FlowJo 10.6.2 obligations with
// REA's own tools, over one REA MCP session (stdio JSON-RPC):
//   engine: open_binary (Ghidra provider) -> inspect_artifact ->
//           analyze_function for each function in tools/rea-native-observations.json
//   jar:    open_binary -> inspect_artifact (member inventory with digests)
// and export each session as an REA Evidence bundle.
//
// The bundles contain Ghidra's decompilation of FlowJo code: keep them outside
// the repository (CLAUDE.md). Commit only ledger results.
//
// Usage:
//   REA_CLI=../rea/scripts/rea.mjs REA_NODE=/opt/node24/bin/node \
//   GHIDRA_INSTALL_DIR=/path/to/ghidra_12.1.4_PUBLIC \
//   FLOWJO_JAVA_DIR=<unpacked FlowJo-OSX64-10.6.2.dmg>/FlowJo/FlowJo.app/Contents/Resources/Java \
//   node tools/reaObserveFlowjo.mjs <output directory outside the repo>
// A fresh Ghidra import and auto-analysis of the engine takes about 10 minutes
// on 4 cores.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

function connect(env) {
  const p = spawn(process.env.REA_NODE ?? process.execPath, [process.env.REA_CLI, '--mcp'], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let id = 0;
  createInterface({ input: p.stdout }).on('line', (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const req = (method, params) => new Promise((res) => { const i = ++id; pending.set(i, res); p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: i, method, params }) + '\n'); });
  return {
    async init() {
      await req('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'flowjo-rea', version: '1' } });
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) + '\n');
    },
    async call(name, args) {
      const r = await req('tools/call', { name, arguments: args });
      const text = r.result?.content?.[0]?.text ?? '';
      if (r.error || r.result?.isError) throw new Error(`${name} failed: ${JSON.stringify(r.error) ?? text.slice(0, 500)}`);
      return text ? JSON.parse(text) : null;
    },
    close: () => p.kill(),
  };
}

const out = process.argv[2];
const dir = process.env.FLOWJO_JAVA_DIR;
if (!out || !dir || !process.env.REA_CLI || !process.env.GHIDRA_INSTALL_DIR) {
  console.error('usage: REA_CLI=... GHIDRA_INSTALL_DIR=... FLOWJO_JAVA_DIR=... node tools/reaObserveFlowjo.mjs <outdir>');
  process.exit(2);
}
const spec = JSON.parse(readFileSync('tools/rea-native-observations.json', 'utf8'));
const t0 = Date.now();
const log = (...a) => console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, ...a);

const engine = connect({ REA_ANALYSIS_PROVIDER: 'ghidra', REA_GHIDRA_STARTUP_TIMEOUT_MS: process.env.REA_GHIDRA_STARTUP_TIMEOUT_MS ?? '3600000' });
await engine.init();
const opened = await engine.call('open_binary', { path: join(dir, spec.engine.file), provider_id: 'ghidra' });
if (opened.result.sha256 !== spec.engine.sha256) throw new Error(`engine digest ${opened.result.sha256} != ${spec.engine.sha256}`);
await engine.call('inspect_artifact', { detail: 'summary' });
for (const f of spec.engine.functions) {
  await engine.call('analyze_function', { procedure: f.address });
  log('analyze_function', f.address, f.symbol);
}
log('export', JSON.stringify(await engine.call('export_evidence_bundle', { path: join(out, 'flowjo-engine.bundle.json') })));
await engine.call('close_binary', {});
engine.close();

const jar = connect({});
await jar.init();
const jo = await jar.call('open_binary', { path: join(dir, spec.jar.file) });
if (jo.result.sha256 !== spec.jar.sha256) throw new Error(`jar digest ${jo.result.sha256} != ${spec.jar.sha256}`);
await jar.call('inspect_artifact', { detail: 'complete' });
log('export', JSON.stringify(await jar.call('export_evidence_bundle', { path: join(out, 'flowjo-jar.bundle.json') })));
jar.close();
