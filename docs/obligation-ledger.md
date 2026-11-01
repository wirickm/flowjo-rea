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
| platform.kinetics | Statistic per time bin | `src/core/kinetics.ts` `kinetics` | positive, boundary (empty bin), malformed (bad options) | `tests/kinetics.test.ts`; E2E "kinetics" | hand | hand | verified | - |
| app.local-only | No network transmission of event data | whole app | negative (no request construction) | REA `analyze-javascript-application` request family; source grep | static analysis (partial coverage) | runtime capture | implemented | Browser capture of a full session with no outbound requests (see residual below) |
| app.offline-build | Single-file build runs from `file://` | `vite.config.ts`; `src/ui/workerClient.ts` | positive | E2E on `dist/index.html` from `file://` (46/46, Chromium) | runtime (Chromium) | runtime (Chromium, Firefox, Safari) | blocked | Run in Firefox and Safari (not installable here) |

## Carried obligations (earlier milestones, still open)

| ID | Claim | Status | Blocking evidence |
|---|---|---|---|
| wsp.polygon-counts | Polygon counts equal FlowJo's | verified on fixtures: FlowJo 10 gate grid (`src/core/gateGrid.ts`); every fixture polygon exact except pinned FlowJo version differences (`tests/wsp.test.ts`), flowjo-file authority | A FlowJo-saved polygon on non-logicle transformed axes (biex, arcsinh) |
| wsp.logicle-ellipse | Logicle ellipse counts equal FlowJo's | verified on fixtures: FlowJo 10 outline polygon; all 4 fixture ellipses exact (`tests/wsp.test.ts`), flowjo-file authority | - |
| stats.flowjo-conventions | Median/percentile/robust CV match FlowJo | implemented from the FlowJo 10.6.2 engine (`src/core/flowjoStats.ts`, specs section 4); verifier `tests/flowjo-stats.test.ts` (hand authority) | FlowJo statistic output on a known population (flowjo-file authority) |
| wsp.export | Exported .wsp opens in FlowJo with equal counts | blocked | Open in FlowJo |
| unmix.vendor | OLS unmixing matches vendor output | blocked | Vendor-unmixed reference data |

## Residuals found while building this ledger

- The single-file bundle contains one `fetch(` call: Vite's module-preload
  polyfill, which fetches `<link rel="modulepreload">` targets. The
  single-file build has no such links, so it never runs a request, but it is
  dead code that weakens a static local-only claim. Removable with
  `build.modulePreload.polyfill: false` (not changed in this milestone).
- .wsp export writes keyword groups as their current members (SampleRefs),
  not as criteria.
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

Closing REA obligations needs manifest bindings with owner digests and
verifier proofs bound to them (REA "proof applicability"). That proof
producer does not exist yet for this repository; building it is the next
step if REA-verified closure is wanted.
