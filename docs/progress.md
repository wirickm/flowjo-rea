# Progress and handoff

## State (2026-10-30)

Branch `main` on GitHub (wirickm/flowjo-rea). The earlier scaffold branch
`claude/friendly-newton-i046h7` was left untouched; `main` was created from
it (its last commit deleted the truncated design draft).

Working: FCS import, metadata inspection, groups, compensation, scales,
plots, gate creation and editing, hierarchical and boolean gating,
statistics across a group, native save/reload with relinking, exports,
Gating-ML import/export, FlowJo .wsp import. See
`docs/compatibility-matrix.md` for status and gaps.

## Commands and checks run

- `./scripts/fetch-fixtures.sh` (required for fixture-based tests)
- `npm test` : 101 passed, 1 skipped (report writer, runs with `WRITE_REPORT=1`)
- `npx tsc -p .` : clean
- `npm run dev` then `npm run e2e` : 17/17 checks passed in Chromium
- `WRITE_REPORT=1 npx vitest run tests/wsp.test.ts` regenerates
  `docs/validation/wsp-counts.md`

## Findings recorded on the way

- FlowJo .wsp rectangle/polygon coordinates are raw values; ellipse foci and
  edges are display-space at gate resolution; first two edge vertices are the
  major axis (gating:distance is not 2a).
- FlowJo Time gates use `$TIMESTEP` seconds times a per-sample gain stored on
  the Time linear transform.
- FlowJo biex uses a table with an integer-snapped zero channel.
- Exported FCS must not carry the source `$TIMESTEP` (values already in
  seconds); fixed and covered by `tests/e2e-exports.test.ts`.

## Unresolved

1. Polygon gates on the 8-colour set: about 0.25% fewer events than FlowJo.
   Rejected hypotheses are listed in the matrix. Next step: obtain FlowJo-side
   evidence (event-level export of a polygon population from FlowJo, or
   licensed analysis of FlowJo's polygon test).
2. Ellipse on logicle axes: 2-3% fewer events than FlowJo. Likely related to
   FlowJo's logicle display mapping; same evidence needed.
3. FlowJo statistic conventions (median, percentiles, robust CV) unverified.
4. FlowJo binary analysis not performed (artifact absent; EULA restriction;
   see `docs/design.md` section 2).

## Next implementation steps

1. Import FlowJo graph settings (axes per population) from .wsp.
2. Contour/density plots and overlays.
3. Ellipse resize/rotate editing; undo/redo.
4. Layout editor / batch report export (PNG/SVG per sample).
5. FlowJo .wsp export once a validation path exists.
