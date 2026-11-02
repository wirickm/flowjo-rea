// REA reconstruction-ledger request producer for this repository.
//
// Writes docs/validation/rea-ledger-request.json, a complete input for
// `rea build-reconstruction-obligation-ledger`:
// - original-case Evidence: static observations of FlowJo 10.6.2
//   (tools/rea-originals.json; shipped-artifact authority);
// - one review Evidence record per reviewed obligation;
// - proof Evidence (predicate rea.reconstruction-proof) from running the
//   verifier tests named in tools/rea-obligations.json;
// - the canonical Evidence bundle, reviewed obligations and manifest.
// With REA_CLI=<path to rea's scripts/rea.mjs> (and REA_NODE=<node for REA>
// when REA needs another Node version), it also runs REA's ledger and writes
// docs/validation/rea-ledger-result.json.
// Contract: rea/docs/reconstruction-obligation-ledgers.md.
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

export type CaseKind = 'positive' | 'negative' | 'malformed' | 'cancellation' | 'teardown';
export interface ObligationSpec {
  obligation_id: string;
  obligation_version: number;
  title: string;
  family: string;
  target_location: string;
  required_case_kinds: CaseKind[];
  original_cases: { kind: CaseKind; observation: string; location: string }[];
  supporting_observations: string[];
  owner: { module_path: string; symbol: string; files: string[] };
  fixtures: { fixture_id: string; case_kind: CaseKind; test_file: string; test_name: string }[];
  verifier: { verifier_id: string; claim_id: string; test_file: string; command: string };
}
interface Subject { name: string; sha256: string; format: string; architecture: string | null; local_path: string }
export interface Originals {
  subjects: Record<string, Subject>;
  providers: Record<string, { id: string; name: string; version: string }>;
  observations: { key: string; subject: string; symbols: string[]; locations: Record<string, string>[]; behavior: string; spec_section: string }[];
}
// One test outcome: file (repo-relative), full test name, status.
export interface TestOutcome { file: string; name: string; status: string }
type Env = { platform: string; architecture: string; node: string };
type EvidenceRecord = Record<string, unknown> & {
  evidence_id: string;
  authority: string;
  operation: string;
  predicate_type: string;
  provider: unknown;
  environment: unknown;
  subject: { digest: { sha256: string }; format: string; architecture: string | null } | null;
};

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

// REA Evidence identity: ev_ + SHA-256 of the canonical semantic content; the
// subject contributes only digest, format and architecture.
export function evidence(fields: Record<string, unknown> & { subject: Subject | null }): EvidenceRecord {
  const s = fields.subject;
  const subject = s === null ? null : { name: s.name, digest: { sha256: s.sha256 }, local_path: s.local_path, format: s.format, architecture: s.architecture };
  const semantic = { ...fields, subject: subject === null ? null : { digest: subject.digest, format: subject.format, architecture: subject.architecture } };
  const keys = ['subject', 'provider', 'analysis_profile', 'predicate_type', 'operation', 'parameters', 'raw_result', 'normalized_result', 'confidence', 'authority', 'environment', 'limitations', 'relationship_coverage', 'locations', 'evidence_links'];
  const content = Object.fromEntries(keys.map((k) => [k, (semantic as Record<string, unknown>)[k]]));
  return { evidence_id: `ev_${sha256(canonicalJson(content))}`, ...fields, subject } as EvidenceRecord;
}

const base = { analysis_profile: null, raw_result: null, relationship_coverage: null, evidence_links: [] as string[] };

export function originalRecords(o: Originals): Map<string, EvidenceRecord> {
  const out = new Map<string, EvidenceRecord>();
  for (const ob of o.observations) {
    out.set(ob.key, evidence({
      ...base,
      subject: o.subjects[ob.subject],
      provider: o.providers[ob.subject],
      predicate_type: 'flowjo-rea.static-behavior',
      operation: ob.subject === 'jar' ? 'inspect_java_classes' : 'inspect_native_functions',
      parameters: { symbols: ob.symbols },
      normalized_result: { behavior: ob.behavior, spec: `docs/validation/flowjo-engine-specs.md section ${ob.spec_section}` },
      confidence: 'observed',
      authority: 'shipped-artifact',
      environment: null,
      limitations: ['Read by an analyst from disassembly or bytecode of the shipped FlowJo 10.6.2 build; behavior is stated in words and no FlowJo code is retained.'],
      locations: ob.locations,
    }));
  }
  return out;
}

export function reviewRecord(o: ObligationSpec, links: string[]): EvidenceRecord {
  return evidence({
    ...base,
    subject: null,
    provider: { id: 'flowjo-rea.review', name: 'flowjo-rea obligation review', version: '1' },
    predicate_type: 'flowjo-rea.obligation-review',
    operation: 'review_reconstruction_obligation',
    parameters: { obligation_id: o.obligation_id, obligation_version: o.obligation_version },
    normalized_result: { title: o.title, required_case_kinds: o.required_case_kinds, owner: o.owner.module_path },
    confidence: 'derived',
    authority: 'analyst-inference',
    environment: null,
    limitations: ['AI-assisted review (Claude Code session); no human review is attested.'],
    locations: [],
    evidence_links: [...links].sort(),
  });
}

export function proofRecord<B>(bindings: B[], env: Env): EvidenceRecord {
  return evidence({
    ...base,
    subject: null,
    provider: { id: 'flowjo-rea.proof', name: 'flowjo-rea proof producer', version: '2' },
    predicate_type: 'rea.reconstruction-proof',
    operation: 'verify_reconstruction_obligations',
    parameters: { node: env.node },
    normalized_result: { bindings },
    confidence: 'observed',
    authority: 'controlled-replay',
    environment: { id: `node-${env.node}`, platform: env.platform, architecture: env.architecture, isolation: 'process' },
    limitations: ['Verifiers are this repository’s vitest suites run in one local process; FlowJo reference counts come from FlowJo-saved .wsp files (FlowJo 10.6.2 to 10.10.0).'],
    locations: [],
  });
}

// Canonical REA Evidence bundle: records sorted by ID; manifests derived from
// the records, de-duplicated and sorted by their JSON text.
const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
function uniqueSorted<T>(values: T[]): T[] {
  const m = new Map<string, T>();
  for (const v of values) m.set(JSON.stringify(v), v);
  return [...m.entries()].sort(([a], [b]) => byCodePoint(a, b)).map(([, v]) => v);
}
export function bundle(records: EvidenceRecord[]) {
  const sorted = [...records].sort((a, b) => byCodePoint(a.evidence_id, b.evidence_id));
  return {
    artifacts: uniqueSorted(sorted.flatMap((r) => (r.subject ? [{ digest: r.subject.digest, format: r.subject.format, architecture: r.subject.architecture }] : []))),
    providers: uniqueSorted(sorted.map((r) => r.provider)),
    environments: uniqueSorted(sorted.flatMap((r) => (r.environment ? [r.environment] : []))),
    scenarios: sorted.filter((r) => r.authority === 'controlled-replay').map((r) => ({ evidence_id: r.evidence_id, operation: r.operation, authority: r.authority })),
    captures: sorted.filter((r) => r.predicate_type === 'rea.process-capture').map((r) => ({ evidence_id: r.evidence_id, predicate_type: r.predicate_type })),
    unknowns: [],
    records: sorted,
  };
}

export function buildRequest(specs: ObligationSpec[], originals: Originals, outcomes: TestOutcome[], read: (p: string) => Buffer, env: Env) {
  const orig = originalRecords(originals);
  const id = (key: string) => {
    const r = orig.get(key);
    if (!r) throw new Error(`unknown observation ${key}`);
    return r.evidence_id;
  };
  const bindings = specs.map((o) => ({
    obligation_id: o.obligation_id,
    obligation_version: o.obligation_version,
    owner_sha256: ownerDigest(o.owner.files, read),
    fixtures: o.fixtures.map((f) => ({ fixture_id: f.fixture_id, case_kind: f.case_kind, passed: fixturePassed(f, outcomes) })),
    verifiers: [{ verifier_id: o.verifier.verifier_id, claim_id: o.verifier.claim_id, passed: verifierPassed(o.verifier, outcomes) }],
  }));
  const proof = proofRecord(bindings, env);
  const reviews = specs.map((o) => reviewRecord(o, [...new Set([...o.original_cases.map((c) => id(c.observation)), ...o.supporting_observations.map(id)])]));
  const reviewed_obligations = specs.map((o, i) => ({
    obligation_id: o.obligation_id,
    obligation_version: o.obligation_version,
    title: o.title,
    application_layer: 'application',
    family: o.family,
    target: { artifact_sha256: null, application_node_id: null, semantic_node_id: null, location: o.target_location },
    required: true,
    required_case_kinds: o.required_case_kinds,
    required_original_authority: 'static',
    required_fixture_authority: 'integration',
    required_verifier_authority: 'integration',
    requires_parser_type: false,
    dependency_obligation_ids: [],
    residual_unknown_ids: [],
    unavailable_authority: [],
    required_next_evidence: [],
    disposition: 'active',
    review_evidence_ids: [reviews[i].evidence_id],
  }));
  const manifest = {
    bindings: specs.map((o, i) => ({
      obligation_id: o.obligation_id,
      owner: { module_path: o.owner.module_path, symbol: o.owner.symbol, owner_sha256: bindings[i].owner_sha256 },
      parser_type: null,
      original_cases: o.original_cases.map((c) => ({ kind: c.kind, evidence_id: id(c.observation), location: c.location })),
      fixtures: o.fixtures.map((f) => ({ fixture_id: f.fixture_id, case_kind: f.case_kind, authority: 'integration', evidence_ids: [proof.evidence_id] })),
      verifier: {
        verifier_id: o.verifier.verifier_id,
        claim_id: o.verifier.claim_id,
        command: o.verifier.command,
        authority: 'integration',
        status: bindings[i].verifiers[0].passed ? 'pass' : 'fail',
        result_evidence_id: proof.evidence_id,
        enumerated_obligation_ids: [o.obligation_id],
        nondeterminism: { mode: 'total-order', specification: 'Deterministic: fixed fixture files and a fixed algorithm give one result.' },
      },
    })),
    contradictions: [],
  };
  return { evidence_bundle: bundle([...orig.values(), ...reviews, proof]), reviewed_obligations, manifest };
}

function main() {
  const specs = (JSON.parse(readFileSync('tools/rea-obligations.json', 'utf8')) as { obligations: ObligationSpec[] }).obligations;
  const originals = JSON.parse(readFileSync('tools/rea-originals.json', 'utf8')) as Originals;
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
  const request = buildRequest(specs, originals, outcomes, (p) => readFileSync(p), { platform: process.platform, architecture: process.arch, node: process.version });
  const requestPath = 'docs/validation/rea-ledger-request.json';
  writeFileSync(requestPath, JSON.stringify(request, null, 2) + '\n');
  const failed = request.manifest.bindings.filter((b) => b.verifier.status !== 'pass').map((b) => b.obligation_id);
  console.log(`rea-ledger-request: ${request.manifest.bindings.length} obligations, ${request.evidence_bundle.records.length} Evidence records${failed.length ? `, FAILED: ${failed.join(', ')}` : ''}`);
  if (failed.length) process.exitCode = 1;
  const cli = process.env.REA_CLI;
  if (cli) {
    const ledger = JSON.parse(execFileSync(process.env.REA_NODE ?? process.execPath, [cli, 'build-reconstruction-obligation-ledger', requestPath, '--json'], { maxBuffer: 1 << 28 }).toString());
    const r = ledger.normalized_result;
    const summary = {
      note: 'Generated by REA_CLI=<rea/scripts/rea.mjs> node tools/reaProof.ts. Do not edit by hand.',
      ledger_evidence_id: ledger.evidence_id,
      ledger_id: r.ledger_id,
      closure_digest: r.closure_digest,
      ledger_status: r.summary?.status ?? r.status,
      obligations: r.obligations.map((o: { obligation_id: string; status: string; diagnostics: { code: string; detail: string }[] }) => ({ obligation_id: o.obligation_id, status: o.status, diagnostics: o.diagnostics })),
    };
    writeFileSync('docs/validation/rea-ledger-result.json', JSON.stringify(summary, null, 2) + '\n');
    console.log(`REA ledger: ${summary.obligations.map((o: { obligation_id: string; status: string }) => `${o.obligation_id}=${o.status}`).join(', ')}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
