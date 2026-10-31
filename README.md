# flowjo-rea

An independently implemented, local-only flow cytometry analysis app: FCS
import, compensation, scales, hierarchical gating, statistics, workspaces and
exports, with FlowJo workspace (.wsp) import. Built with React, TypeScript and
Vite; parsing and gating run in a Web Worker. Data never leaves your machine.

**Compatibility is partial and measured, not FlowJo parity.** See
[docs/compatibility-matrix.md](docs/compatibility-matrix.md) for what is
validated against FlowJo output and what still differs.

## Use without installing

```bash
npm run build
```

This writes one self-contained file, `dist/index.html` (about 330 KB: app,
styles and analysis worker inlined). Open it by double-clicking; it runs
offline from disk and FCS files never leave the browser. Verified in Chromium
from `file://` with the full E2E run; Firefox and Safari not yet verified.

## Run (development)

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173, then **Add FCS files**.

## Test

```bash
./scripts/fetch-fixtures.sh
```

```bash
npm test
```

End-to-end UI check (with `npm run dev` running):

```bash
npm run e2e
```

## Docs

- [docs/design.md](docs/design.md): requirements, constraints (including the
  architecture, validation strategy
- [docs/compatibility-matrix.md](docs/compatibility-matrix.md): feature status,
  evidence, validation, limitations
- [docs/validation/wsp-counts.md](docs/validation/wsp-counts.md): per-population
  comparison with FlowJo-saved counts
- [docs/progress.md](docs/progress.md): handoff log
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
