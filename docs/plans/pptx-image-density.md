# Image density rounding correction

Scope: correct the existing bounded image metadata operation to the ties-to-even
rule in `docs/specs/pptx.md` section 6.5. Root owns metadata, SDK regressions and
research corrections. The delegated CLI worker owns its new safe-bash regression
and companion plan. Preserve all preexisting replacement work and other changes.

## Procedure

1. Read root and applicable scoped instructions, shared Office contracts, image
   test/API audits and inventories, and the disposable corpus manifest.
2. Reproduce incorrect density ties in original numeric and TIFF cases, then
   expose incorrect picture geometry through the exported SDK and safe-bash CLI.
3. Correct only numeric rounding; keep per-axis fallback and no-coercion policy.
4. Independently parse output ZIP/XML and hash media bytes. Do not decode images,
   download fixtures, execute a native image runtime or mutate READMEs.
5. Reconcile all five density parameter variants and the documented density API.
   Keep whole-model gaps and all unrelated test/API inventory entries visible.
6. Run maintained package tests/lint and selected build closure plus the focused
   safe-bash regression. Inspect any CLI screenshot evidence in the companion
   plan. Stage only named owned files and commit on main without push/release.

## QA boundary

The manifest's publisher decks are disposable QA inputs, not unit fixtures.
This deterministic rounding defect is reproduced entirely with original in-memory
headers and does not need corpus acquisition or native rendering. Tests establish
dimensions and byte preservation, not JPEG decodability or rendering fidelity.
SVG/MCE admission, remaining image formats and the live Image/Picture model remain
separate obligations; this correction does not upgrade their capabilities.

## Evidence

Before implementation, metadata tests failed six cases: even-half rounding,
range-boundary fallback and both TIFF byte orders. The SDK regression failed
with width 909613 instead of independently specified 914400 EMUs.

Final maintained checks passed:

- `npm run test --workspace=pptx`: 3202 tests in 112 files.
- `npm run lint --workspace=pptx`: ESLint and both TypeScript projects.
- `npm run build:workspaces -- --workspace=pptx`: all three declared build tasks.
- Focused safe-bash CLI regression: 1/1; runner-registration check: 107/107,
  as recorded in [the CLI plan](pptx-image-density-cli.md).
- Both image case ledgers retain all 121 rows; all five exact density identities
  match their source inventory pointers, with whole-row parity still false.
- `git diff --check`: passed. Existing help/error screenshots were inspected by
  the CLI worker; no visual grammar changed and no new capture was made.

The product change stays in `packages/pptx/src/image-metadata.ts`. Owned tests
are its test file, `image-insertion.test.ts`, the new safe-bash density test, and
only the density registration line in `integration-inputs.test.mjs`. The existing
replacement registration remains unstaged. Research changes are the density
receipt and four existing image accounting/API receipts. Include this plan and
the CLI plan in the local commit; report its hash separately. No push/release.
