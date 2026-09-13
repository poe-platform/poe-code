# Live collection position mapping

The shared SDK §4 requires ordinary numeric brackets to use nonnegative
positions. Live chart collections and gradient stops previously forwarded
negative brackets to their `.at` implementation, selecting the last member.
Both original public-export regressions failed before correction. Negative
brackets now raise `IndexError` with `index-out-of-range`; supported `.at(-1)`
lookup remains available. Chart points continue rejecting negative `.at` too.

The tests independently assert authored category labels, numeric values and
gradient positions. They cover plots, chart and plot series, categories, category
levels, points and gradient stops, including nonfinite/fractional/excessive
positions and live stop mutation. Models operate directly on original in-memory
XML; no filesystem operations exist in this unit boundary and no memfs or
downloaded fixture is needed. Existing CLI integration uses its memfs harness.

## Exact language and security boundary

[The member and source-case ledger](live-collection-indexing-map.json) retains
the relevant public collection identities, including inherited and underscore
types. This supplements J03/J08. The source language has no distinct JS
bracket/`.at` split; its negative access maps to `.at`, not negative brackets.
This does not remove public APIs or certify unrelated source parameter payloads.
Existing positional-family records explicitly retain exact-variant gaps. In
particular, sparse-cache reconstruction and series ordering require separate
evidence; the numeric-boundary correction does not resolve those obligations.

CLI ordinals remain one-based. `charts list/get` use inspection records, and
`--slide 0` is rejected. No arbitrary model evaluator is added to express JS
syntax. The direct CLI route and existing typed operations retain their shared
schemas and selection behavior. There is no new I/O, native or network authority.

The API/test audits and complete inventory structures were consulted. Historical
absence statements are superseded only for this tested mapping. Whole API,
parameter and BDD parity remains incomplete. No derived implementation or assets
were copied; existing standalone notices remain in place.

## Evidence

- Red: both new tests failed because negative bracket reads did not throw.
- Green: four focused files passed 38 tests, including existing collection and
  chart graph tests.
- Focused maintained package lint passed.
- Supplemental safe-bash CLI execution passed 9 tests across chart inventory
  and editing; the delegate cleared Git-local hook variables in the child.
  This direct node test execution is not a maintained workspace-route pass.
- Final maintained results are recorded in
  [the execution plan](../plans/pptx-live-collection-indexing.md).

Corpus/application evidence: none for this language-only correction. The corpus
manifest was reviewed; no QA binaries were acquired, shipped or deleted. No CLI
output or layout changed, so no new screenshot or renderer claim is made.
