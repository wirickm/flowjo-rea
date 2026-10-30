# Third-party notices

## Runtime dependencies

- React, React DOM (MIT)
- @xmldom/xmldom 0.8.10 (MIT)

## Reference material used for validation (not redistributed)

`scripts/fetch-fixtures.sh` downloads these into `fixtures/` (gitignored):

- **FlowKit** by Scott White, BSD 3-Clause License, commit
  f2159043b6a56e527d4baacf97490caf8354618e, https://github.com/whitews/FlowKit.
  Used: FlowJo-saved .wsp files and FCS files under `data/`, the
  FlowJo-exported biex lookup table, noncompliant FCS examples.
- **ISAC Gating-ML 2.0 compliance tests** (`data/gate_ref` in FlowKit),
  Copyright (c) 2012 ISAC. "Free of charge distribution and read-only usage
  permitted. Modification and all other rights reserved."

## Derived work

- `flowjoBiexTable` in `src/core/transforms.ts`: the structure of FlowJo's
  biex table construction (integer zero-point snapping, `max * e^-b`
  scaling) was informed by FlowKit's `generate_biex_lut` (BSD-3-Clause,
  Copyright (c) 2018, Scott White). FlowKit's docstring states it was ported
  from the R library cytolib. The TypeScript implementation is new code
  expressed through this project's logicle solver and was validated against
  the FlowJo-exported table.

## Oracles

- `tests/oracles/fcs_flowio.json` was generated with flowio 1.4.0
  (BSD-3-Clause) by `scripts/oracles/fcs_flowio.py`; it contains derived
  checksums and a few event values of the fixture files.
