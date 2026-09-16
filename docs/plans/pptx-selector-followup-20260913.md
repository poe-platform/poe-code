# PPTX empty simple text selections

## Ownership and scope

Format-package change owned by the selector delegate: `text-replacement.ts`,
`text-replacement.test.ts`, and `command-text-replace.test.ts`, plus this plan
and `docs/pptx/selector-followup-evidence-20260913.md`. Preserve unrelated
changes. No README, runtime, dependency, native I/O, or network changes.

## Contract and implementation

Apply the root instructions, `docs/specs/pptx.md` section 6.2, and the shared
Office CLI/SDK contracts. Missing simple slide/shape selections in `text replace`
are empty mutations: fail by default and return unchanged bytes with zero effects
when `allowEmpty` is explicit. Preserve malformed, ambiguous, stale-token and
missing-token failures. Match cardinality remains exactly first/all/occurrence.

1. Read the public API and test audits and inventories under `docs/pptx`.
2. Reproduce missing slide and missing shape defects through exported SDK and
   command engine using original memfs fixtures before changing implementation.
3. Handle only `SelectionError` with code `missing-selection` from non-token
   replacement selection in the format package.
4. Verify malformed positions, ambiguous labels, token failures, all three match
   cardinalities, dry-run nonpublication and original-byte output publication.
5. Run focused tests and maintained package lint; root runs final package tests
   and commits explicitly owned files after maintained checks pass.

## Agent QA procedure

Use an original one-slide deck with a shape named Caption and text seed. Run the
actual command engine through explicit in-memory adapters. Inspect human output
for `text replace /deck.pptx --slide 1 --shape Absent --find seed --with sprout
--first --allow-empty --dry-run`, then repeat without `--allow-empty`. The first
must report zero validated matches and exit 0; the second must report
`missing-selection` and exit 1. Inspect the screenshot, then confirm adapters did
not publish either request. This procedure requires no downloaded deck or native
application.

Executed by root: screenshot `screenshots/pptx-selector-followup-20260913.png`
captured and visually inspected. The expected zero-match success and
missing-selection failure were observed. Screenshot remains disposable QA.
# Final integration receipt

Root verification: maintained PPTX build closure passed; package unit rerun
passed 6,821 tests in 260 files; package lint/type checks passed. The initial
package run overlapped the failing-first test additions and recorded two new
command failures; the settled rerun passed. Actual shell integration passed 49
tests plus manual empty-selection checks for all three cardinalities.
Local commit only; no push or release is authorized.
