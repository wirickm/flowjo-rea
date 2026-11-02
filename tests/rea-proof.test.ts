import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildRequest, bundle, canonicalJson, evidence, fixturePassed, ownerDigest, verifierPassed, type ObligationSpec, type Originals } from '../tools/reaProof';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const spec: ObligationSpec = {
  obligation_id: 'demo.claim',
  obligation_version: 1,
  title: 'Demo claim',
  family: 'demo',
  target_location: 'demo()',
  required_case_kinds: ['positive', 'negative'],
  original_cases: [
    { kind: 'positive', observation: 'obs', location: 'inside is in' },
    { kind: 'negative', observation: 'obs', location: 'outside is out' },
  ],
  supporting_observations: [],
  owner: { module_path: 'a.ts', symbol: 'f', files: ['b.ts', 'a.ts'] },
  fixtures: [
    { fixture_id: 'demo.pos', case_kind: 'positive', test_file: 't.test.ts', test_name: 'works' },
    { fixture_id: 'demo.neg', case_kind: 'negative', test_file: 't.test.ts', test_name: 'rejects' },
  ],
  verifier: { verifier_id: 'demo.v', claim_id: 'demo.claim.v1', test_file: 't.test.ts', command: 'npx vitest run t.test.ts' },
};
const originals: Originals = {
  subjects: { engine: { name: 'lib.dylib', sha256: 'a'.repeat(64), format: 'mach-o', architecture: 'x86_64', local_path: 'x/lib.dylib' } },
  providers: { engine: { id: 'llvm-objdump', name: 'LLVM objdump', version: '18' } },
  observations: [{ key: 'obs', subject: 'engine', symbols: ['demo()'], locations: [{ kind: 'address-range', start: '0x10', end: '0x20' }], behavior: 'inside is in, outside is out', spec_section: '1' }],
};
const files: Record<string, string> = { 'a.ts': 'export const f = 1;\n', 'b.ts': 'export const g = 2;\n' };
const read = (p: string) => Buffer.from(files[p]);
const env = { platform: 'linux', architecture: 'x64', node: 'v22' };
const passing = [
  { file: 't.test.ts', name: 'suite works', status: 'passed' },
  { file: 't.test.ts', name: 'suite rejects', status: 'passed' },
];

describe('REA ledger request producer', () => {
  it('canonical JSON sorts keys and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 0, y: 1 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":1,"z":0}}');
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });

  it('owner digest covers the sorted file list and every byte', () => {
    const d = ownerDigest(['b.ts', 'a.ts'], read);
    expect(d).toBe(ownerDigest(['a.ts', 'b.ts'], read));
    expect(d).toBe(sha(canonicalJson([{ path: 'a.ts', sha256: sha(files['a.ts']) }, { path: 'b.ts', sha256: sha(files['b.ts']) }])));
    expect(ownerDigest(['a.ts', 'b.ts'], (p) => Buffer.from(files[p] + ' '))).not.toBe(d);
  });

  it('fixtures need a matching passing test; verifiers need all their file’s tests to pass', () => {
    expect(fixturePassed(spec.fixtures[0], passing)).toBe(true);
    expect(fixturePassed(spec.fixtures[0], [])).toBe(false);
    expect(verifierPassed(spec.verifier, [...passing, { file: 't.test.ts', name: 'other', status: 'failed' }])).toBe(false);
  });

  it('evidence IDs hash the semantic content; subject name and local path are not part of it', () => {
    const fields = { subject: originals.subjects.engine, provider: { id: 'p', name: 'p', version: '1' }, analysis_profile: null, predicate_type: 't', operation: 'o', parameters: {}, raw_result: null, normalized_result: { x: 1 }, confidence: 'observed', authority: 'shipped-artifact', environment: null, limitations: [], relationship_coverage: null, locations: [], evidence_links: [] };
    const a = evidence(fields);
    const b = evidence({ ...fields, subject: { ...fields.subject, name: 'renamed', local_path: 'elsewhere' } });
    expect(a.evidence_id).toBe(b.evidence_id);
    expect(evidence({ ...fields, normalized_result: { x: 2 } }).evidence_id).not.toBe(a.evidence_id);
    const { evidence_id, ...rest } = a;
    const semantic = { ...rest, subject: { digest: { sha256: 'a'.repeat(64) }, format: 'mach-o', architecture: 'x86_64' } };
    expect(evidence_id).toBe(`ev_${sha(canonicalJson(semantic))}`);
  });

  it('builds a request whose original cases, fixtures and verifier bind to bundled Evidence', () => {
    const req = buildRequest([spec], originals, passing, read, env);
    const ids = new Set(req.evidence_bundle.records.map((r) => r.evidence_id));
    const b = req.manifest.bindings[0];
    expect(b.original_cases.map((c) => c.kind)).toEqual(['positive', 'negative']);
    for (const c of b.original_cases) expect(ids.has(c.evidence_id)).toBe(true);
    expect(ids.has(b.verifier.result_evidence_id)).toBe(true);
    expect(b.verifier.status).toBe('pass');
    expect(b.verifier.nondeterminism.mode).toBe('total-order');
    expect(b.parser_type).toBeNull();
    for (const id of req.reviewed_obligations[0].review_evidence_ids) expect(ids.has(id)).toBe(true);
    const orig = req.evidence_bundle.records.find((r) => r.predicate_type === 'flowjo-rea.static-behavior')!;
    expect([orig.authority, orig.confidence]).toEqual(['shipped-artifact', 'observed']);
    const review = req.evidence_bundle.records.find((r) => r.predicate_type === 'flowjo-rea.obligation-review')!;
    expect(review.limitations).toContain('AI-assisted review (Claude Code session); no human review is attested.');
  });

  it('records a failing verifier instead of hiding it', () => {
    const req = buildRequest([spec], originals, [{ file: 't.test.ts', name: 'suite works', status: 'failed' }], read, env);
    expect(req.manifest.bindings[0].verifier.status).toBe('fail');
  });

  it('bundles records in canonical order with derived manifests', () => {
    const req = buildRequest([spec], originals, passing, read, env);
    const again = bundle([...req.evidence_bundle.records].reverse());
    expect(JSON.stringify(again)).toBe(JSON.stringify(req.evidence_bundle));
    expect(req.evidence_bundle.artifacts).toEqual([{ digest: { sha256: 'a'.repeat(64) }, format: 'mach-o', architecture: 'x86_64' }]);
    expect(req.evidence_bundle.scenarios.map((s) => s.authority)).toEqual(['controlled-replay']);
  });
});
