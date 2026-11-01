# flowjo-rea: notes for Claude sessions

- State and next steps: `docs/progress.md`. Feature status: `docs/compatibility-matrix.md`.
- Test fixtures: `./scripts/fetch-fixtures.sh`, then `npm test`, `npx tsc -p .`.
- FlowJo binary for interop analysis: `./scripts/fetch-flowjo.sh` (downloads and
  unpacks the public macOS installer to `/tmp/fjre`), then
  `./scripts/disasm.sh '<demangled C++ name>'`. Details: `docs/reverse-engineering.md`.
- Write findings as behavioral specs in `docs/validation/flowjo-engine-specs.md`
  and implement independently; never commit FlowJo binaries, disassembly or
  decompiled code.
