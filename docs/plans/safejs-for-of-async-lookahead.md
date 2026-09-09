# Bare async in for-of headers

Native comparisons validated accepted invalid ordinary for-of headers with
the bare async token immediately before of. Three whitespace/comment variants
failed regression tests before the repair; six valid-target controls passed.

The for-of branch now enforces this token lookahead only for ordinary loops.
Escaped async, parenthesized targets, member targets, var declarations, for-in
and for-await targets remain valid, with guest execution compared to native
results. Token type matters: an escaped async spelling is permitted by native
JavaScript and must not be rejected based only on its decoded name.

All nine focused tests and package TypeScript passed. The broader parser/runtime
suite passed 1,441 tests (one skipped); focused lint is running.
This followup is outside the frozen isolated
SafeJS suite. Releases and pushes remain paused.
