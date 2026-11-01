// REA proof producer for this repository.
//
// Runs the verifier tests named in tools/rea-obligations.json, computes each
// owner's implementation digest, and writes docs/validation/rea-proof.json:
// an authenticated REA Evidence record (predicate rea.reconstruction-proof,
// operation verify_reconstruction_obligations) plus REA manifest bindings
// that reference it. Contract: rea/docs/reconstruction-obligation-ledgers.md
// ("Proof applicability").
//
// Usage: node tools/reaProof.ts   (fixtures must be fetched first)
//
// owner_sha256 = SHA-256 of the canonical JSON of
//   [{ "path": <repo-relative path>, "sha256": <SHA-256 of the file bytes> }, ...]
// sorted by path, over the owner's "files". Canonical JSON: object keys
// sorted by UTF-16 code units, no whitespace, JSON.stringify for scalars
// (RFC 8785 as used by REA's Evidence identity).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

export type CaseKind = 'positive' | 'negative' | 'malformed' | 'boundary';
export interface ObligationSpec {
  obligation_id: string;
  obligation_version: number;
  owner: { module_path: string; symbol: string; files: string[] };
  fixtures: { fixture_id: string; case_kind: CaseKind; test_file: string; test_name: string }[];
  verifier: { verifier_id: string; claim_id: string; test_file: string; command: string };
}
// One test outcome: file (repo-relative), full test name, status.
export interface TestOutcome { file: string; name: string; status: string }

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('non-finite number');
    return JSON.stringify(v);
  }
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export function ownerDigest(files: string[], read: (path: string) => Buffer): string {
  const entries = [...files].sort().map((path) => ({ path, sha256: sha256(read(path)) }));
  return sha256(canonicalJson(entries));
}

// A fixture passes when at least one matching test ran and every match passed;
// a verifier passes when its test file ran tests and all of them passed.
export function fixturePassed(f: ObligationSpec['fixtures'][number], outcomes: TestOutcome[]): boolean {
  const m = outcomes.filter((t) => t.file === f.test_file && t.name.includes(f.test_name));
  return m.length > 0 && m.every((t) => t.status === 'passed');
}
export function verifierPassed(v: ObligationSpec['verifier'], outcomes: TestOutcome[]): boolean {
  const m = outcomes.filter((t) => t.file === v.test_file);
  return m.length > 0 && m.every((t) => t.status === 'passed');
}

// REA Evidence record (semantic fields) with its content-derived evidence_id.
export function proofEvidence<B>(bindings: B[], env: { platform: string; architecture: string; node: string }) {
  const record = {
    subject: null,
    provider: { id: 'flowjo-rea.proof', name: 'flowjo-rea proof producer', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.reconstruction-proof',
    operation: 'verify_reconstruction_obligations',
    parameters: { node: env.node },
    raw_result: null,
    normalized_result: { bindings },
    confidence: 'observed',
    authority: 'controlled-replay',
    environment: { id: `node-${env.node}`, platform: env.platform, architecture: env.architecture, isolation: 'process' },
    limitations: [
      'Verifiers are this repository’s vitest suites run in one local process; reference counts come from FlowJo-saved .wsp files (FlowJo 10.6.2 to 10.10.0), not a FlowJo runtime.',
      'Original-behavior cases (FlowJo observations) are not supplied as REA Evidence; manifest original_cases are empty.',
    ],
    relationship_coverage: null,
    locations: [],
    evidence_links: [],
  };
  return { evidence_id: `ev_${sha256(canonicalJson(record))}`, ...record };
}

export function buildProof(specs: ObligationSpec[], outcomes: TestOutcome[], read: (p: string) => Buffer, env: Parameters<typeof proofEvidence>[1]) {
  const bindings = specs.map((o) => ({
    obligation_id: o.obligation_id,
    obligation_version: o.obligation_version,
    owner_sha256: ownerDigest(o.owner.files, read),
    fixtures: o.fixtures.map((f) => ({ fixture_id: f.fixture_id, case_kind: f.case_kind, passed: fixturePassed(f, outcomes) })),
    verifiers: [{ verifier_id: o.verifier.verifier_id, claim_id: o.verifier.claim_id, passed: verifierPassed(o.verifier, outcomes) }],
  }));
  const evidence = proofEvidence(bindings, env);
  const manifest = {
    bindings: specs.map((o, i) => ({
      obligation_id: o.obligation_id,
      owner: { module_path: o.owner.module_path, symbol: o.owner.symbol, owner_sha256: bindings[i].owner_sha256 },
      original_cases: [],
      fixtures: o.fixtures.map((f) => ({ fixture_id: f.fixture_id, case_kind: f.case_kind, authority: 'integration', evidence_ids: [evidence.evidence_id] })),
      verifier: {
        verifier_id: o.verifier.verifier_id,
        claim_id: o.verifier.claim_id,
        command: o.verifier.command,
        authority: 'integration',
        status: bindings[i].verifiers[0].passed ? 'pass' : 'fail',
        result_evidence_id: evidence.evidence_id,
        enumerated_obligation_ids: [o.obligation_id],
      },
    })),
    contradictions: [],
  };
  return { evidence, manifest };
}

function main() {
  const specs = (JSON.parse(readFileSync('tools/rea-obligations.json', 'utf8')) as { obligations: ObligationSpec[] }).obligations;
  const files = [...new Set(specs.flatMap((o) => [o.verifier.test_file, ...o.fixtures.map((f) => f.test_file)]))];
  const out = 'node_modules/.cache/rea-proof-vitest.json';
  try {
    execFileSync('npx', ['vitest', 'run', ...files, '--reporter=json', `--outputFile=${out}`], { stdio: 'inherit' });
  } catch {
    // Failing tests still produce the report; failures are recorded as passed: false.
  }
  const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[] };
  const root = process.cwd() + '/';
  const outcomes: TestOutcome[] = report.testResults.flatMap((t) => t.assertionResults.map((a) => ({ file: t.name.replace(root, ''), name: a.fullName, status: a.status })));
  const { evidence, manifest } = buildProof(specs, outcomes, (p) => readFileSync(p), { platform: process.platform, architecture: process.arch, node: process.version });
  writeFileSync('docs/validation/rea-proof.json', JSON.stringify({ note: 'Generated by node tools/reaProof.ts. Do not edit by hand.', evidence_records: [evidence], manifest }, null, 2) + '\n');
  const failed = manifest.bindings.filter((b) => b.verifier.status !== 'pass').map((b) => b.obligation_id);
  console.log(`rea-proof: ${manifest.bindings.length} bindings, evidence ${evidence.evidence_id}${failed.length ? `, FAILED: ${failed.join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
