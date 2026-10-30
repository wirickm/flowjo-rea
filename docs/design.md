# flowjo-rea: requirements, constraints, design, validation

Replaces the incomplete draft `docs/superpowers/specs/2026-10-30-flowjo-parity-design.md`
(deleted on the remote; its stated objective and restriction analysis are
carried forward here).

## 1. Objective

An independently implemented flow-cytometry application that reproduces
FlowJo's core workflows and numeric behavior, with explicit evidence for each
compatibility claim. "Compatible" means reproducing FlowJo outputs on
FlowJo-written artifacts, not merely offering similar features. Feature status
and evidence live in `docs/compatibility-matrix.md`.

## 2. Constraints, by source

| Source | Applies to | Finding |
|---|---|---|
| REA `DISCLAIMER.md`, `AGENTS.md`, `CONTRIBUTING.md` | Repository guidance | Authored by the project owner; `AGENTS.md`/`CONTRIBUTING.md` govern changes to REA itself. Not treated as a bar on this project. |
| FlowJo license (BD) | Decompiling or disassembling FlowJo | The published FlowJo / BD Portal EULAs found on 2026-10-30 prohibit reverse engineering, decompiling and disassembly, one version "except to the extent permitted by applicable law" ([FlowJo EULA](https://www.flowjo.com/solutions/flowjo-envoy/eula), [Portal EULA PDF](https://flowjo.com/storage/app/media/Privacy%20Policies%20and%20EULAs/Final%20Informatics%20SW%20End%20User%20License%20Agreement%20FlowJo%20Portal%20V11%205.19.25.pdf)). Which version binds the owner's copy is unknown. |
| Copyright in FlowJo code, UI text, icons, docs | Reuse | Not copied. Only functional facts (file layout, numeric behavior) observed in FlowJo-written files are used. |
| Third-party open-source code and data | Fixtures, oracles | FlowKit (BSD-3), flowio (BSD-3), ISAC Gating-ML compliance data (read-only use permitted). Fetched at test time, not redistributed. See `THIRD_PARTY_NOTICES.md`. |
| Technical | Binary analysis | The FlowJo installer reported at `/tmp/claude-0/fj-dl/FlowJo-Win64-10.10.2.exe` does not exist in this session (`/tmp/claude-0/fj-dl/` absent, checked 2026-10-30). |

### Reverse-engineering decision

Binary inspection / decompilation of FlowJo was **not performed**. Reasons
actually established: (1) the artifact is absent; (2) the vendor EULA text
found prohibits it except where law permits, and the owner's license terms
and jurisdiction are not established; (3) interoperability exceptions (e.g.
EU Software Directive art. 6) are conditioned on the information not being
otherwise available, and the needed information was obtainable from
FlowJo-written files, published standards and open implementations. This is
not a blanket prohibition: if the owner establishes a license/jurisdiction
that permits it, targeted analysis of specific unresolved behaviors (polygon
and logicle-ellipse count gaps, statistic conventions) is the highest-value
use. Downloading the installer again was not attempted for the same reasons.

### What was and was not done with REA

Using REA's evidence labels in the matrix is not the same as running REA's
research workflow. Actual use, in this repository's session history:

| REA step | Done? | What it produced |
|---|---|---|
| Read REA docs (README, AGENTS.md, DISCLAIMER.md, reconstruction-readiness.md) | Yes | Understanding of the intended discover, analyze, compare, verify workflow |
| Run published CLI `npx rea-agents@latest` | **Blocked** | The session's tool-permission classifier denied it ("Code from External"). No output |
| Build REA from the local checkout (`npm ci --ignore-scripts`, `npm run build:cached`, REA commit a40ee74) | Yes | Working `node scripts/rea.mjs` CLI (rea 6.5.0). No REA files were modified |
| `rea doctor --json` | Yes | `docs/rea/doctor.json`: node/host healthy; Hopper, Ghidra, IDA, JADX, Kuna all `missing_analysis_engine` |
| `rea inspect-artifact` on a FlowJo-written .wsp and two FCS files | Yes | `docs/rea/inspect-*.json`: all rejected, `unsupported binary format`. REA targets executables, packages and apps, not data files |
| REA static or deep analysis of FlowJo (`inspect`, `inspect-binary-layout`, `inspect-managed-artifact`, `decompile`, `function`) | **Not performed** | See the two separate blockers below |
| REA runtime observation of FlowJo (`capture-process`, scenarios) | **Not performed** | Same blockers; also needs Windows/macOS and an activated FlowJo |
| REA compare / reconstruction-coverage / obligation ledger against FlowJo | **Not performed** | Depends on FlowJo Evidence that does not exist |

Separate blockers for FlowJo analysis:
1. **Artifact missing (technical).** `/tmp/claude-0/fj-dl/FlowJo-Win64-10.10.2.exe`
   was reported by a previous session but `/tmp/claude-0/fj-dl/` does not
   exist in this container. Re-downloading was not attempted.
2. **Permission unresolved (license).** The FlowJo EULA text found restricts
   reverse engineering "except to the extent permitted by applicable law"; the
   owner's license version, seat and jurisdiction have not been established.
   No permission is assumed. Even with the installer present, deep analysis
   would also need a supported engine (Ghidra/IDA/Hopper), which `rea doctor`
   reports as absent (a third, technical dependency).

Neither blocker prevents application development; work continues on
behavior defined by standards and FlowJo-written files.

The term "clean-room" is not used: no separation-of-teams process was set up.

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
- FlowJo-written artifacts: counts saved in .wsp files; FlowJo biex table.
- flowio as an independent FCS decoder.
- Hand-derived values for statistics and compensation.
- End-to-end UI run in Chromium (`npm run e2e`).

Tolerances: exact for ISAC and for FlowJo counts where matched; FlowJo LUT
1e-5 relative (table printed to 6 significant digits); known FlowJo count
gaps bounded at 1% + 10 events (4% for the logicle ellipse) as a regression
guard, with the full table in `docs/validation/wsp-counts.md`.
