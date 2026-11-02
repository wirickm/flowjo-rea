# Obligation ledger

This ledger follows the REA reconstruction obligation model
(`docs/reconstruction-obligation-ledgers.md` in wirickm/rea): every
compatibility claim is an obligation with an owner, required case kinds, a
verifier, the authority of its evidence, and an explicit status. Absence of
evidence never closes an obligation.

Two parts:

1. **Reviewed obligations** (below): the behaviors this app claims, written
   by hand in the REA field vocabulary.
2. **REA-generated ledger** (end of file): REA's own
   `build-reconstruction-obligation-ledger` run over REA's static analysis of
   this app's code. Summary: `docs/validation/rea-ledger-summary.json`.

## Vocabulary

- **Status**: `verified` (owner + all required cases + passing verifier at
  the required authority), `implemented` (owner and passing tests, but the
  verifier's authority is weaker than required), `blocked` (needs evidence
  this environment cannot produce), `unknown`.
- **Authority**, weakest to strongest: `synthetic` (generated data with a
  known truth), `cross-implementation` (agrees with another open
  implementation), `standard` (ISAC truth data), `flowjo-file` (counts or
  tables FlowJo wrote), `flowjo-runtime` (FlowJo opened and compared).
- **Case kinds**: `positive`, `negative`, `malformed`, `boundary`.

## Reviewed obligations: milestone 6

| ID | Claim | Owner | Cases covered | Verifier | Evidence authority | Required authority | Status | Next evidence |
|---|---|---|---|---|---|---|---|---|
| fcs.datasets.select | Enumerate `$NEXTDATA` data sets and switch a sample between them | `src/core/service.ts` `selectDataset`; `src/core/fcs.ts` `parseFcs` | positive, negative (out of range), malformed (unloaded) | `tests/datasets.test.ts`; E2E "multiple data sets" | synthetic | standard | implemented | A real multi-data-set FCS file |
| gate.exclusion | Population = parent events outside its gate (FlowJo `eventsInside="0"`) | `src/core/analysis.ts` `run`; `src/core/wsp.ts` | positive, boundary (complement within parent) | `tests/import-gaps.test.ts`; E2E "exclusion toggle" | flowjo-file (inclusive count) + derived | flowjo-file | implemented | A FlowJo-saved workspace with an exclusion gate and its count |
| gate.exclusion.export | Exclusion survives Gating-ML (gate + NOT) and .wsp (`eventsInside="0"`) | `src/core/gatingml.ts` `exportGatingMl`; `src/core/wspWriter.ts` | positive | `tests/import-gaps.test.ts` | round trip (own reader) | flowjo-runtime | blocked | Open the exported .wsp in FlowJo |
| gate.spline-quadrant | Curved quadrant: monotone cubic dividers, four populations partition the parent | `src/core/spline.ts`; `src/core/analysis.ts` | positive, boundary (straight = ordinary quadrant, exact), negative (curved classification) | `tests/import-gaps.test.ts`; E2E "spline quadrant" | synthetic | flowjo-file | implemented | A FlowJo-saved curved quadrant with counts (FlowJo's spline definition is unknown) |
| wsp.statistic-nodes | `<Statistic>` nodes become statistics columns | `src/core/wsp.ts` `statNode` | positive (Count) | `tests/import-gaps.test.ts` | flowjo-file (Count only) | flowjo-file | implemented | FlowJo workspaces with Median/Mean/Percentile statistic nodes (name and parameter attribute unobserved) |
| wsp.keyword-groups | FlowJo keyword-criteria groups import as live groups | `src/core/wsp.ts`; `src/core/project.ts` `matchRules` | positive (14 fixtures), negative (no match) | `tests/import-gaps.test.ts` | flowjo-file (membership empty in every fixture) | flowjo-file | implemented | A FlowJo workspace whose criteria select samples; case-sensitivity check |
| platform.cell-cycle | Dean-Jett-Fox and Watson G1/S/G2 fractions | `src/core/cellcycle.ts` `fitCellCycle` | positive, negative (G1-only), malformed (empty) | `tests/cellcycle.test.ts`; E2E "cell cycle" | synthetic | flowjo-file | implemented | FlowJo or ModFit fit of the same histogram |
| platform.proliferation | Generation fit and division/proliferation/expansion indices | `src/core/proliferation.ts` `fitProliferation` | positive, negative (undivided), malformed (nonpositive) | `tests/proliferation.test.ts`; E2E "proliferation" | synthetic | flowjo-file | implemented | FlowJo proliferation platform output on the same data |
| gate.rect-open-bounds | Rectangle bounds on or beyond a linear axis edge (4096 channels) are open, as in FlowJo 10 | `src/core/wsp.ts` `parseWsp` | positive (E01 Time), negative (quad-gate bounds stay closed) | `tests/wsp.test.ts` | flowjo-file | flowjo-file | REA verified; verified on fixtures | A fixture with an open upper bound |
| platform.kinetics | Statistic per time bin | `src/core/kinetics.ts` `kinetics` | positive, boundary (empty bin), malformed (bad options) | `tests/kinetics.test.ts`; E2E "kinetics" | hand | hand | verified | - |
| app.local-only | No network transmission of event data | whole app | negative (no request construction) | REA `analyze-javascript-application` request family; source grep | static analysis (partial coverage) | runtime capture | implemented | Browser capture of a full session with no outbound requests (see residual below) |
| app.offline-build | Single-file build runs from `file://` | `vite.config.ts`; `src/ui/workerClient.ts` | positive | E2E on `dist/index.html` from `file://` (46/46, Chromium) | runtime (Chromium) | runtime (Chromium, Firefox, Safari) | blocked | Run in Firefox and Safari (not installable here) |

## Carried obligations (earlier milestones, still open)

| ID | Claim | Status | Blocking evidence |
|---|---|---|---|
| wsp.polygon-counts | Polygon counts equal FlowJo's | REA verified (see REA closure); verified on fixtures: FlowJo 10 gate grid (`src/core/gateGrid.ts`); every fixture polygon exact except pinned FlowJo version differences (`tests/wsp.test.ts`), flowjo-file authority | A FlowJo-saved polygon on non-logicle transformed axes (biex, arcsinh) |
| wsp.logicle-ellipse | Logicle ellipse counts equal FlowJo's | REA verified; verified on fixtures: FlowJo 10 outline polygon; all 4 fixture ellipses exact (`tests/wsp.test.ts`), flowjo-file authority | - |
| stats.flowjo-conventions | Median/percentile/robust CV match FlowJo | REA verified against static FlowJo 10.6.2 observations; implemented from the FlowJo 10.6.2 engine (`src/core/flowjoStats.ts`, specs section 4); verifier `tests/flowjo-stats.test.ts` (hand authority) | FlowJo statistic output on a known population (flowjo-file authority) |
| wsp.export | Exported .wsp opens in FlowJo with equal counts | blocked | Open in FlowJo |
| unmix.vendor | OLS unmixing matches vendor output | blocked | Vendor-unmixed reference data |

## Residuals found while building this ledger

- Resolved: the single-file bundle used to contain one `fetch(` call (Vite's
  module-preload polyfill, never run); `build.modulePreload.polyfill: false`
  removes it, and `dist/index.html` now contains no `fetch(`.
- Resolved: .wsp export writes keyword-rule groups (and "group by" keyword
  groups) as FlowJo `<Criteria>` plus their current members; "group by"
  annotation groups are written as members only (no FlowJo keyword).
- REA could not analyze the minified single-file bundle within its default
  limits (1 GiB heap exhausted; 5-minute per-source deadline with 4 GiB), so
  the REA run uses the tsc-compiled, unbundled modules. That covers this
  app's code, not bundled React.

## REA-generated ledger

Commands (REA built from wirickm/rea; paths are local):

```bash
npx tsc -p . --noEmit false --outDir <dir>/out   # then remove out/tests
rea analyze-javascript-application <dir> --max-heap-mb 4096 \
  --analysis-timeout-ms 900000 --detail summary --evidence_output ev.json
rea build-reconstruction-obligation-ledger ledger-in.json --format json
# ledger-in.json = {"evidence_bundle": <ev.json>, "reviewed_obligations": [],
#                   "manifest": {"bindings": [], "contradictions": []}}
```

Result (`docs/validation/rea-ledger-summary.json`):

- Static analysis: 37 of 37 modules parsed completely, 56,651 AST nodes,
  631 findings; semantic unknowns in 14 sources.
- Request family: 0 relations retained (no `fetch`, WebSocket or HTTP
  construction recovered). Coverage is partial, so this supports but does
  not prove `app.local-only`.
- Ledger: status `unknown`, 109 candidate obligations, 0 verified:
  65 parser boundaries (`Number`, `String`, `parseInt`, `parseFloat`,
  `JSON.parse`), 36 awaited-expression task lifecycles, 5 promise ownership,
  2 timers, 1 package lifecycle. All are `unowned` or `unknown` because no
  manifest bindings or authenticated review records were supplied.
- REA classified `out/src/main.js` as an Electron main entrypoint from the
  package `main` field; this is a static inference and wrong for this
  browser app.

## REA closure (reconstruction obligation ledger)

`npm run rea-proof` (`tools/reaProof.ts`) writes
`docs/validation/rea-ledger-request.json`, a complete input for
`rea build-reconstruction-obligation-ledger`. With
`REA_CLI=<rea>/scripts/rea.mjs REA_NODE=<node 24>` it also runs REA and writes
`docs/validation/rea-ledger-result.json`.

Result (REA built from wirickm/rea, ledger status `ready`): all four
reviewed obligations **verified** with no diagnostics:
`wsp.polygon-counts`, `wsp.logicle-ellipse`, `gate.rect-open-bounds`,
`stats.flowjo-conventions` (obligation version 2).

What the request contains:

- **Original cases** (`tools/rea-originals.json`): seven static observations
  of FlowJo 10.6.2, each an Evidence record with `confidence: observed`,
  `authority: shipped-artifact`, the digest of the observed file
  (`libNativeEngine-3.6.2.jnilib` or `FlowJo-10.6.2.jar` from the official
  installer), the function or class locations, and the behavior in words.
  This meets REA's `static` original authority.
- **Reviews**: one record per obligation (`analyst-inference`), linking the
  observations; marked as AI-assisted, with no human review attested.
- **Proof**: one `rea.reconstruction-proof` record (`controlled-replay`)
  from running the verifier tests, bound to each obligation's version and
  `owner_sha256`; fixture and verifier authority `integration`.
- **Manifest** bindings: owner, original cases per required case kind,
  fixtures, verifier.

`owner_sha256` = SHA-256 of the canonical JSON of
`[{path, sha256(file bytes)}]` over the owner's files (listed in
`tools/rea-obligations.json`), sorted by path. Changing an owner file makes
the retained proof inapplicable; regenerate after code changes.

Negative controls run against REA: changing one owner digest gives
`inapplicable-fixture-proof`/`inapplicable-verifier-proof` (status
`implemented`); removing an original case gives `missing-original-case`;
editing a record without re-hashing is rejected (`evidence_integrity_mismatch`).

Limits of this closure:

- REA checks integrity, authority and applicability, not truth. The
  original-case records are this project's own statements of what the
  FlowJo binary does (read from disassembly and bytecode); REA cannot
  re-derive them.
- The verifiers compare against FlowJo-saved counts (FlowJo 10.6.2 to
  10.10.0); statistics have no FlowJo-computed reference values.
- `platform.kinetics` is this app's own definition (no FlowJo original), so it
  is not in the REA request.
