# Proxy left-hand instanceof traversal

Seven native comparisons failed on ba24dfae4 (27466). Ordinary constructor
instanceof checks skipped Proxy prototype traps on the left-hand chain.

Use the shared prototype operation and compare identity before the next step.
Preserve bound-constructor forwarding, trap errors and target invariants. Bound
virtual cycles and retain the expected prototype/current node across traps.

Verification: 16 tests across two files, TypeScript and scoped lint passed
(33509). Existing hasInstance/function-prototype/prototype-operation suites passed
60 tests across three files (94094). Expanded cycle-budget and retention/failure
coverage passed all nine Proxy cases and final test lint (89117).
Callable Proxy constructors and existing special built-in
instanceof paths require separate integration; public construction and snapshots
remain incomplete.
