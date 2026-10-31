# flowjo-rea: requirements, design, validation

## 1. Objective

An independently implemented flow-cytometry application that reproduces
FlowJo's workflows and numeric behavior, with explicit evidence for each
compatibility claim. "Compatible" means reproducing FlowJo outputs on
FlowJo-written files, not merely offering similar features. Feature status and
evidence live in `docs/compatibility-matrix.md`.

## 2. Sources

The implementation is built from published standards, open file formats, and
FlowJo-written data files:

- **Standards:** FCS 3.1 (data files), ISAC Gating-ML 2.0 (gates and transforms).
- **FlowJo-written files:** `.wsp` workspaces and the counts, transforms and
  plot settings they contain; a FlowJo-exported biex lookup table.
- **Open-source references (test fixtures and oracles only):** FlowKit (BSD-3),
  flowio (BSD-3), ISAC Gating-ML compliance data. Fetched at test time, not
  redistributed. See `THIRD_PARTY_NOTICES.md`.

Behavior that could not be derived from these sources is listed as unresolved
in `docs/progress.md` and bounded in the validation strategy below.

## 3. Design

Stack kept from the scaffold (React 18, TypeScript, Vite, Vitest): it suits a
local, offline, browser-based tool. Added: `@xmldom/xmldom` (XML in workers).

Layers, each testable alone:

| Layer | Files | Responsibility |
|---|---|---|
| File handling | `src/core/fcs.ts`, `fcsWriter.ts` | FCS read/write, explicit `AppError` codes |
| Numerics | `compensation.ts`, `transforms.ts`, `analysis.ts`, `stats.ts` | Spillover inversion, scales, gate evaluation over the hierarchy, statistics |
| Workspace state | `model.ts`, `project.ts` | JSON-serialisable workspace; save/load validation; copy gate trees |
| Interchange | `gatingml.ts`, `wsp.ts`, `xml.ts` | Gating-ML 2.0 import/export; FlowJo .wsp import |
| Service | `service.ts`, `src/worker/analysis.worker.ts` | Owns event data and cached engines; runs in a Web Worker |
| UI | `src/ui/*` | Panels, plot canvas, dialogs; never holds event arrays |

Key decisions:
- Gates carry their own dimension transforms and compensation reference
  (Gating-ML semantics). Plots map gates into axis space for display; edits
  rewrite the gate in the plot's scale.
- Event data never leaves the machine; workspaces store file name + SHA-256
  and relink on reopen.
- Errors are per population: a bad gate marks that population (and its
  descendants empty) without aborting the sample.

## 4. Validation strategy

Independent expectations only:
- ISAC Gating-ML 2.0 compliance truth: exact per-event membership.
- FlowJo-written files: counts saved in .wsp files; FlowJo biex table.
- flowio as an independent FCS decoder.
- Hand-derived values for statistics and compensation.
- End-to-end UI run in Chromium (`npm run e2e`).

Tolerances: exact for ISAC and for FlowJo counts where matched; FlowJo LUT
1e-5 relative (table printed to 6 significant digits); known FlowJo count
gaps bounded at 1% + 10 events (4% for the logicle ellipse) as a regression
guard, with the full table in `docs/validation/wsp-counts.md`.
