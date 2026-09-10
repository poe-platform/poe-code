# Legacy substr argument conversion

## Validation

The unchanged runtime failed 15 of 17 regressions (17f5f2), including native
comparisons, direct calls without interpreter context and checkpoint replay.
Guest start/length conversion hooks were bypassed and callable extra arguments
were rejected. Native probes confirm length conversion still occurs for empty
receivers and infinite/out-of-range starts (5618ed).

## Repair

Substr now shares the ordered two-argument numeric conversion implementation
with slice and substring. The second converted argument is still passed to
native substr as a length, never translated into an end index. Undefined length
remains distinct from NaN or zero, and negative start/length behavior remains
native. Primitive-only direct calls stay synchronous. Removed the now-unused
native optional-number helper after its final caller was migrated.

## Verification

The substr/range regressions and existing string/coercion/retention selection
passed 84 tests in five files (8ced70), including all 17 substr regressions.
Targeted ESLint and package TypeScript checks passed after removal of the unused
helper (041e19). The first lint run had correctly reported that helper as unused.
No CLI visual behavior changes. No push or release. The preceding full-package
result does not cover this repair and its 14 remaining failures are unresolved.
