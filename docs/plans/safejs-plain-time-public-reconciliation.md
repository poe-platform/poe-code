# PlainTime public integration

## Scope and review

Commit the pending PlainTime constructor and method adapters, input-reader
extensions for owned ZonedDateTime/MonthDay/YearMonth values, shared string and
difference option readers, and focused public tests. Keep Temporal namespace,
ZonedDateTime-only locale-option changes and snapshot wiring separate.

Reviewed construction, from/compare/equals, with, add/subtract, until/since,
rounding, string/JSON formatting and locale handling. Results use private owned
fields, captured method-realm prototypes and data checkpoints. Locale processing
validates zones before discarding them for wall-clock formatting and retains
style/component validation. Shared options validate guest properties in order.

Added regressions for extracting a ZonedDateTime's private local time (including
nanoseconds at a DST transition), reading overflow afterward, and rejecting
owned MonthDay/YearMonth/ZonedDateTime partial inputs without public property
reads. Removed the stale comment asking for date/time brands already handled.
No speculative runtime algorithm change was introduced during this review.

## Evidence

The initial current-tree PlainTime plus shared formatting/difference cohort
passed 320 tests across 18 files (877f80), before the three final partial-input
guard cases were added. This cohort includes still-pending snapshot tests and
other public Temporal constructors; it is not standalone HEAD qualification.

A same-process Node 26.8.1 native/guest metadata comparison matched all five
own string properties of PlainTime and all eighteen of its prototype, including
descriptor flags and method/getter names and lengths (c80d2d). Property order
and symbol keys were not asserted. Metadata parity is not full conformance.

Node 18.20.8 passed 79 conversion/locale/difference tests across 3 files,
including the final private-brand cases and fixed-offset locale checks (301fb0).
Package type-checking passed (2da2c8). Focused ESLint on the seven implementation
files and ten PlainTime test files passed (dcfdeb).
The final Node 22 cohort passed 323 tests across 18 files (16c458).

## Remaining work

The public Temporal namespace and snapshot implementation remain partly
uncommitted. Intl portability and extreme-range gaps, skipped-day arithmetic,
and full-package test failures remain unresolved. Pushes and releases remain
paused. There is no visual CLI change in this reconciliation.
