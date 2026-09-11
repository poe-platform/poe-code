# Proxy-aware isPrototypeOf

Six native comparisons failed with one passing control on 07d37b53b (55913).
Object.prototype.isPrototypeOf skipped Proxy getPrototypeOf traps, including
Proxy boundaries reached from ordinary children.

Walk with the shared prototype operation. Compare identity immediately after
each step, before querying a matched Proxy. Preserve primitive-argument early
return, error propagation and target invariants. Bound traversal and retain the
receiver/current chain node across guest traps, releasing on all exits.

Verification: 43 tests across three files, TypeScript and scoped lint passed
(70829). Expanded cyclic-budget and retention/cleanup tests plus primitive
regressions passed 37 tests across three files and final test lint (76787).
Other consumers, public construction, callable identity
and snapshots remain incomplete.
