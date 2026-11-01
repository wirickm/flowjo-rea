import { describe, expect, it } from 'vitest';
import { buildProof, canonicalJson, fixturePassed, ownerDigest, verifierPassed, type ObligationSpec } from '../tools/reaProof';
import { createHash } from 'node:crypto';

const spec: ObligationSpec = {
  obligation_id: 'demo.claim',
  obligation_version: 1,
  owner: { module_path: 'a.ts', symbol: 'f', files: ['b.ts', 'a.ts'] },
  fixtures: [{ fixture_id: 'demo.pos', case_kind: 'positive', test_file: 't.test.ts', test_name: 'works' }],
  verifier: { verifier_id: 'demo.v', claim_id: 'demo.claim.v1', test_file: 't.test.ts', command: 'npx vitest run t.test.ts' },
};
const files: Record<string, string> = { 'a.ts': 'export const f = 1;\n', 'b.ts': 'export const g = 2;\n' };
const read = (p: string) => Buffer.from(files[p]);
const env = { platform: 'linux', architecture: 'x64', node: 'v22' };

describe('REA proof producer', () => {
  it('canonical JSON sorts keys and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'], c: { z: 0, y: 1 } })).toBe('{"a":[true,null,"x"],"b":1,"c":{"y":1,"z":0}}');
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });

  it('owner digest covers the sorted file list and every byte', () => {
    const d = ownerDigest(['b.ts', 'a.ts'], read);
    expect(d).toBe(ownerDigest(['a.ts', 'b.ts'], read));
    const expected = createHash('sha256').update(canonicalJson([
      { path: 'a.ts', sha256: createHash('sha256').update(files['a.ts']).digest('hex') },
      { path: 'b.ts', sha256: createHash('sha256').update(files['b.ts']).digest('hex') },
    ])).digest('hex');
    expect(d).toBe(expected);
    expect(ownerDigest(['a.ts', 'b.ts'], (p) => Buffer.from(files[p] + (p === 'b.ts' ? ' ' : '')))).not.toBe(d);
  });

  it('fixtures need a matching passing test; verifiers need all their file’s tests to pass', () => {
    const ok = [{ file: 't.test.ts', name: 'suite works', status: 'passed' }];
    expect(fixturePassed(spec.fixtures[0], ok)).toBe(true);
    expect(fixturePassed(spec.fixtures[0], [])).toBe(false);
    expect(verifierPassed(spec.verifier, [...ok, { file: 't.test.ts', name: 'other', status: 'failed' }])).toBe(false);
  });

  it('emits a content-addressed REA proof record and manifest bound to it', () => {
    const outcomes = [{ file: 't.test.ts', name: 'suite works', status: 'passed' }];
    const { evidence, manifest } = buildProof([spec], outcomes, read, env);
    const { evidence_id, ...rest } = evidence;
    expect(evidence_id).toBe(`ev_${createHash('sha256').update(canonicalJson(rest)).digest('hex')}`);
    expect(evidence.predicate_type).toBe('rea.reconstruction-proof');
    expect(evidence.operation).toBe('verify_reconstruction_obligations');
    expect(evidence.normalized_result.bindings[0]).toEqual({
      obligation_id: 'demo.claim', obligation_version: 1, owner_sha256: ownerDigest(spec.owner.files, read),
      fixtures: [{ fixture_id: 'demo.pos', case_kind: 'positive', passed: true }],
      verifiers: [{ verifier_id: 'demo.v', claim_id: 'demo.claim.v1', passed: true }],
    });
    expect(manifest.bindings[0].verifier.result_evidence_id).toBe(evidence_id);
    expect(manifest.bindings[0].owner.owner_sha256).toBe(evidence.normalized_result.bindings[0].owner_sha256);
    // A failing verifier is recorded, never hidden.
    const failed = buildProof([spec], [{ file: 't.test.ts', name: 'suite works', status: 'failed' }], read, env);
    expect(failed.manifest.bindings[0].verifier.status).toBe('fail');
    expect(failed.evidence.evidence_id).not.toBe(evidence_id);
  });
});
