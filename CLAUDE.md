# flowjo-rea: notes for Claude sessions

- State and next steps: `docs/progress.md`. Feature status: `docs/compatibility-matrix.md`.
- Test fixtures: `./scripts/fetch-fixtures.sh`, then `npm test`, `npx tsc -p .`.
- Write findings as behavioral specs in `docs/validation/flowjo-engine-specs.md`
  and implement independently; never commit FlowJo binaries, disassembly or
  decompiled code.

## Target FlowJo version: 10, not 11

Every FlowJo reference count in the fixtures was written by FlowJo 10.6.2,
10.8.0, 10.8.1 or 10.10.0. Match FlowJo 10 behavior. FlowJo 11 uses a
different engine build and gives different counts (checked for polygons).

- FlowJo 10 installers (official, linked from flowjo.com/flowjo10/download):
  `https://fjinstallers.s3.amazonaws.com/FlowJo/FlowJo-OSX64-<version>.dmg`
  (10.6.2, 10.8.1, 10.10.0 and 10.10.2 exist). Unpack with
  `7z x <dmg> 'FlowJo/FlowJo.app/Contents/Resources/Java/*'`.
- Gating runs in the native engine
  `Contents/Resources/Java/libNativeEngine-<n>.jnilib` (x86_64 Mach-O,
  10.6.2 ships 3.6.2), not in the Java classes. Symbols demangle with
  `llvm-nm --demangle`; disassemble with `llvm-objdump`.
- FlowJo 11 tooling (`./scripts/fetch-flowjo.sh`, `./scripts/disasm.sh`,
  `docs/reverse-engineering.md`) is still useful for orientation, but its
  results are not the reference.

## Finding: FlowJo 10.6.2 polygon gating (2026-11-01)

Polygons are gated on a grid of `gateResolution` cells per axis (256 in
every fixture), not by an exact point-in-polygon test:

- Linear axes: event value cast to float32, `u = (v - min) * R / (max - min)`,
  cell = `floor(u + 0.5)` clamped to 0..R-1. Vertices use the same rounding.
- Transformed axes (logicle etc.): the transform lookup-table index scaled to
  R, truncated, for both events and vertices.
- The y axis is flipped (`R - u`) for both, consistently.
- An event is in the gate when its integer grid point is inside the rounded
  polygon or on its boundary (edges and vertices count as inside).

Scratch check on `8_color_ICS.wsp`: 35 of 42 populations exact (was 9);
total absolute difference 15 events (was 3,944). Not yet implemented in
`src/core`. FlowJo 11.2 differs (truncated vertices, cell-corner lattice);
see `docs/validation/flowjo-engine-specs.md`.

## Tools allowed in this repo

- Ghidra (headless, `analyzeHeadless`) is approved for decompiling the FlowJo
  engines. Install outside the repo (e.g. `/tmp/ghidra`, JDK 21 is present).
  Keep its output out of the repo, like disassembly.
