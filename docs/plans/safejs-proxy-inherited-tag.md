# Inherited Proxy object tags

Eight native comparisons failed on ab5e31fcf (24601): ordinary objects, arrays,
dates and functions skipped Proxy get traps while looking up Symbol.toStringTag.

Stop the ordinary descriptor walk at a Proxy boundary, then use guest get with
the original object as receiver. Preserve built-in fallback tags for non-string
results and stop before a Proxy when an earlier own descriptor shadows it.

Verification: 36 tests across four files, TypeScript and scoped lint passed
(45545). Expanded collection/typed-array fallback, shadowing and trap-error tests
plus promise/async-function/deleted-tag snapshot regressions passed 35 tests across
four files and final test lint (51228). Callable Proxy identity, public construction, snapshots
and remaining consumers are incomplete.
