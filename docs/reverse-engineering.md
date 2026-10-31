# Reverse engineering FlowJo (interop analysis)

Purpose: resolve FlowJo numeric conventions that the open fixtures cannot
(polygon/ellipse membership, statistic definitions; see `docs/progress.md`
"Unresolved"). Findings are written up as behavioral specs and then
implemented independently in `src/core`. Do not copy decompiled code or
disassembly into the repo.

## Quick start (any fresh session)

```bash
./scripts/fetch-flowjo.sh
```

Downloads the public FlowJo 11.2.0 macOS x64 installer (about 420 MB) and
unpacks it to `/tmp/fjre` (override with `FLOWJO_RE_DIR`). Idempotent. Installs
`p7zip-full` and `llvm` via apt if missing. Nothing is committed.

Then disassemble any exported engine function by its demangled name:

```bash
./scripts/disasm.sh 'EllipseGate::ContainsPoint(double, double)'
```

Options: `FLOWJO_VERSION` (default `11.2.0`), `FLOWJO_ARCH` (`x64` default,
`arm64`). The Windows installer is Inno Setup 6.7, which innoextract 1.9
cannot unpack, so the DMG is used.

## What is inside

Output layout under `/tmp/fjre`:

| Path | Contents |
|---|---|
| `x/FlowJo 11.app/Contents/Resources/app.asar.unpacked/out/main/libNativeEngine.dylib` | C++ analysis engine (Mach-O x86_64, 48 MB). Exported C++ symbols are kept, so names demangle (gates, transforms, statistics) |
| `.../out/main/*-service.exe`, `proxy.exe` | Node.js single-executable apps (services around the engine) |
| `.../out/main/JSONSchemas/` | JSON schemas for engine specs (gate specs, etc.) |
| `asar/` | Unpacked Electron UI (JavaScript) |
| `engine-symbols.txt` | Exported symbols, demangled (`llvm-nm -gU`) |
| `engine-symbols-all.txt` | All defined symbols incl. local; used for function bounds |

Useful entry points found so far (engine):

| Area | Symbols |
|---|---|
| Polygon gates | `FGate::ComputeRegionGate`, `PolyGateHistogram2D::Build2DPolyGateHistogram`, `ScalePointSet::PointInPoly`, `FastTransform::fast_find_index`, `CompositeGateSpec::GetGateResolution` |
| Rectangle / range | `FGate::ComputeRectangularGate`, `FGate::ComputeHistogramGate`, `FGate::GetRectRangeInScale` |
| Ellipse | `EllipseGate::FromGateSpec`, `EllipseGate::ComputeEllipseGate`, `EllipseGate::ContainsPoint` |
| Boolean | `CompoundGate::ComputeAndGate/OrGate/NotGate` |
| Transforms | `Logicle::*`, `Biex::*`, `TransformSettings::CreateBiexTransformation` |
| Statistics | `GStatistics::Median`, `MedianExact`, `MedianNoHisto`, `Percentile*` |

Grep for more: `grep -i 'keyword' /tmp/fjre/engine-symbols.txt`.

## Tooling notes

- No decompiler is installed; `llvm-objdump` disassembly is enough for the
  small numeric functions. For larger functions, Ghidra can be used via the
  sibling `rea` repo (bring-your-own Ghidra; see `rea/docs/ghidra-provider.md`).
- Read rodata constants with
  `llvm-objdump -s --start-address=0x... --stop-address=0x... <dylib>`.
- Calls to `_writev+0x...` in the disassembly are unresolved stubs (libm
  functions such as `sincos`), not `writev`.

## Findings

Behavioral specs from this analysis live in `docs/validation/flowjo-engine-specs.md`.
