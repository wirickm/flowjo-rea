# FlowJo parity via REA: scope, constraints, workflows, validation

Status: draft for owner review. No product code has been written. `package.json`
and `node_modules` from an early scaffold exist locally and are not committed.

## 1. Objective

Use REA to analyze FlowJo 10.10.2 and build a program that reproduces FlowJo's
functionality end to end: same inputs accepted, same analysis results, same
workspace interchange. "Parity" is measured against FlowJo outputs (section 6),
not against a generic notion of a cytometry tool.

## 2. Restrictions, by source

Each item names the source and why it does or does not bind a given step.
Nothing here is legal advice; items marked UNVERIFIED need a primary source.

### 2.1 Repository guidance

| Source | Applies? | Why |
| --- | --- | --- |
| REA `DISCLAIMER.md` | No | Project owner wrote it and has overridden it for this project. |
| REA `AGENTS.md` / `CONTRIBUTING.md` | No | Governs changes to the REA codebase, not use of REA on a target. |

### 2.2 Third-party license and law

| Source | Applies to | Status |
| --- | --- | --- |
| FlowJo EULA (BD) | Decompilation, running the app, use of results | UNVERIFIED. Not retrieved from flowjo.com. The installer likely carries the EULA text; reading it is step 1 of section 4. Typical commercial EULAs bar reverse engineering "except as permitted by law"; whether this one does is unknown. |
| Copyright in FlowJo code, UI text, icons, docs | Code reuse (copying expression) | Applies regardless of EULA. Functional facts (file formats, algorithms, numeric behavior) are generally not protected; the specific code and assets are. |
| US fair use case law (Sega v. Accolade, Sony v. Connectix) | Decompilation as intermediate copying | Supports decompiling to reach unprotected functional elements when that is the only way to get them. Fact-specific. |
| EU Software Directive art. 6 | Decompilation | Permits decompilation for interoperability by

---

> **DOCUMENT STOPS HERE (incomplete).** On 2026-10-30 the assistant's response
> that was writing this file was stopped by a safety classifier partway
> through section 2.2. No reason was supplied with the stop. The text above is
> preserved exactly as written at the point of the stop; sections 2.2 (rest),
> 3, 4, 5 and 6 of this draft were never written. Workflow inventory,
> compatibility requirements, architecture and validation are in
> `2026-10-30-flowjo-workflows-and-validation.md`.
