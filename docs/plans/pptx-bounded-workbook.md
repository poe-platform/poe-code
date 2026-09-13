# Bounded chart workbook capability

Scope: reuse `packages/pptx/src/chart-workbook.ts` and the verified shared
`office-package` archive primitives. No shared workbook implementation exists.
No new spreadsheet engine, native dependency, model alias layer, or README edit.
Root AGENTS.md applies; no scoped AGENTS.md exists in pptx, office-package or docs.
Own chart-workbook.ts, chart-editing.ts, new focused workbook tests and the
workbook-specific evidence files. Preserve all unrelated working changes.

1. Reproduce unsafe worksheet ownership and rejected simple imported ranges with
   original memfs tests; admit only bounded direct single-sheet references.
2. Keep replacement cells, formula ranges, caches, formats and epochs consistent;
   test category/XY/bubble growth/shrink and unusual series identities.
3. Reconcile every workbook writer/rewrite source variant against original tests
   or an explicit remaining gap. Retain public model obligations, including
   inherited and underscore-prefixed members, separately from operation support.
4. Run focused tests, maintained pptx test/lint and selected workspace build.
   Commit atomic verified improvements on main; do not push.

QA procedure: inspect generated chart/workbook XML through independent ZIP and
XML readers; execute SDK-backed `charts replace` with memfs publication, dry-run
and failure checks. Inspect help/error screenshots if output changes. No binary
corpus is required for these regressions; do not remove another campaign's inputs.

Research authority: ../pptx/upstream-test-audit.md,
../pptx/upstream-test-inventory.json, ../pptx/upstream-api-audit.md,
../pptx/upstream-api-inventory.json and counterpart ../docx audits.
Shared contracts: ../specs/pptx.md, ../specs/office-cli.md, ../specs/office-sdk.md.

Progress: implementation and checks pending.

First increment: seven range/ownership/identity regressions failed before the fix
and passed afterward (352 ms test execution). Maintained `npm run test
--workspace=pptx` passed 126 files / 3,561 tests; `npm run lint --workspace=pptx`
passed. Added support for quoted/relative direct ranges and stacked XY/bubble
sheets, reject unrelated cells/dependent chart formulas/epoch mismatches, and
allocate fresh series identities. No CLI grammar/help changes.
