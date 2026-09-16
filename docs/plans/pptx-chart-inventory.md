# Chart inventory implementation and verification

Scope: F36 read-only chart enumeration through the `pptx` package and plural
`charts list/get` commands. No whole pipeline execution, README changes, push or
release. Root wires exports; safe-bash command adapters belong in
`packages/safe-bash/src/commands/pptx`. Original fast tests use authored XML and
memfs, never downloaded documents or runtime/network dependencies.

Ownership: chart SDK worker owns chart domain files; adapter worker owns its
scoped command files and public export wiring; accounting worker owns the five
new chart inventory research/usage/plan files and characterization test. Root
owns the preservation test, final evidence, validation and commits of
explicit named files after relevant maintained checks. Preserve unrelated work.

Research: pinned source `278b47b1dedd5b46ee84c286e77cdfb0bf4594be` in
`/tmp/pptx-upstream-review`; provenance and identities remain only in research.
Read both shared Office contracts, chart subsection and F36 in the PPTX spec,
upstream test/API audits and inventories, and the corpus manifest. Retain existing
standalone legal notices; no copied original project fixtures or source names in
product code, comments, test names or branding.

## Implementation and TDD

1. Establish absence of chart inspection and add failing original tests.
2. Enumerate classical plot families and combinations; record raw series/category,
   axis, label, point, marker, legend and style structures and formula/cache data.
3. Resolve chart relationships through admitted package parts. Distinguish literal
   authority from references/caches and authoritative workbook relationship
   metadata. Never fetch, calculate or activate a workbook or external link.
4. Retain unknown chart XML and report unsupported extensions. Inspection must
   not run creating getters or materialize default structures.
5. Expose identical SDK and CLI selection, JSON, schema/capability and error rules.
   Run focused failing/passing tests, then maintained scope lint/test checks.
6. Record every relevant source parameter and BDD example separately. Partial
   inspection assertions cannot discharge a live model/property obligation.

## Manual QA procedure

1. Use only already acquired documents listed in `docs/pptx/corpus-manifest.json`.
   Verify admitted bytes against the listed SHA-256 before use. Missing fixtures
   are an unavailable QA case, never a unit-test failure or a reported pass.
2. Read the ZIP and chart relationships independently through an explicit QA
   capability. Count classic/modern chart parts, plot families, series, axes,
   indexed points, formulas and embedded/external workbook links. Record exact
   XML examples separately from SDK output so assertions are independent.
3. Run SDK chart inspection and `pptx charts list/get --json` against the same
   selected chart-bearing slides. Compare independent counts, literal/reference
   classifications, formula text and sparse point indices; modern/unknown
   substructures must remain visible and unsupported, not silently disappear.
4. Hash chart parts and whole input bytes before/after reads. Confirm inspection
   creates no title/font/label/default/workbook structure, writes no file and
   performs no external refresh. Inspect command help/list screenshots using the
   maintained screenshot command for any visible CLI change.
5. Reduce a meaningful discrepancy to a tiny original memfs/XML regression,
   observe failure, fix, and rerun relevant maintained checks. Never copy publisher
   fixtures into unit tests or commit ignored binaries/screenshots.
6. Record QA receipts in the research evidence with counts and limitations.
   Commit each atomic validated improvement on main, stage explicit owned paths,
   and report local hashes separately. Do not push or release.

## Execution receipt

Initial parser tests failed because the chart module was absent; ten command
tests failed on missing routes/schema/capabilities. Original regressions then
demonstrated missing MCE fallback styles, absent ambiguity candidate locations
and oversized human output before their corrections. The preservation fixture
was corrected to use namespace-complete XML fragments and the maintained archive
writer before its independent byte assertions passed; those fixture errors were
not product defects.

The maintained package suite passed 3,337 tests in 118 files. Package lint,
selected workspace build, five actual safe-bash chart tests and the exact
integration discovery registration check passed. QA used the existing manifest
fixture with independent counts and SHA-256 checks; see the research evidence.
Help, selected chart report and usage-error screenshots are disposable outputs
under `.cache/pptx-corpus`. The maintained generic screenshot route captures this
package command engine directly without the unrelated root predev build path.
No downloaded bytes, screenshots or ad hoc QA executable are committed.

The 1,407-row research ledger and 784-record API ledger retain outstanding model
defaults, setters, builders, collection and enum obligations. This is an F36
inspection improvement, not completion of the full proposed PPTX pipeline.
