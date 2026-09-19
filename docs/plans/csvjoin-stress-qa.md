# csvjoin independent stress QA

Use the registered literal executable through safe-bash with injected UTF-8,
C/UTC, clock, terminal and warning-suppression capabilities. Canonical tests
use MemoryFileSystem and in-memory streams only.

1. Run `node --import tsx --test packages/safe-bash/tests/commands/csvjoin-stress.test.ts`.
2. Compare exact stdout, stderr and status, and unchanged input-file bytes.
   Baseline duplicate/null cases come from the frozen join-operation reference.
3. Stress one-file typed serialization, different per-file selector indices,
   three-file right traversal, full-outer first-key null propagation and header
   deconfliction. Confirm left/right precedence over outer and sequential tails.
4. Check per-input type identity: text versus Decimal remains unequal, Boolean
   True equals Decimal one, and Decimal scale does not alter equality or lose
   precision beyond JavaScript's safe-integer boundary.
   Date/DateTime remain different types; aware datetimes compare instants and
   duration spellings compare their parsed microsecond values.
5. Confirm inherited `--zero` does not alter csvjoin's helper-default offset and
   reused producer byte views are copied before producer advancement/cleanup.
   Confirm duplicate expansion stops at the configured row bound without table
   output, and caller cancellation returns the pending cooperative named source.
6. Run root-selected maintained build/test/lint routes after integration. This
   scope does not qualify full csvkit parity, deployed filesystem adapters,
   cancellation of uncooperative host work or database/network functionality.

Expected multi-input ordering and name construction were audited against
released csvkit 2.2.0 `csvkit/utilities/csvjoin.py` and Agate 1.14.2
`agate/table/join.py`; canonical tests never execute those programs.

The original stress run reproduced six failures in twelve cases: inferred
tables and joined generated-name collisions returned explicit status 78.
After implementation, seventeen cases pass. Eleven novel table-semantic cases
also match the hash-locked CPython 3.14.2/csvkit 2.2.0/Agate 1.14.2 development
reference exactly; warning suppression is explicitly selected for the generated
header collision case. The development fixtures/evidence were temporary under
`out/csvjoin-stress-reference` and were purged after inspection.
