# PlainDate conversion reconciliation

## Scope

Commit the pending PlainDate conversions to MonthDay, YearMonth and ZonedDateTime,
the owned ZonedDateTime input path, and partial-date brand exclusions. Retain
the existing constructor and methods. Keep destination-type public constructors,
Temporal namespace wiring and snapshot implementation separate.

Conversion results preserve private calendar fields, use supplied destination
realm prototypes and pass data checkpoints. Zoned conversion handles a bare
zone-like argument or a bag with timeZone/plainTime, validates the zone before
reading plainTime, and delegates start-of-day and compatible gap/overlap handling
to the maintained backend.

## Review and validation

Added five focused regression cases: private local-date/calendar extraction
from a ZonedDateTime before overflow access; three partial-date brand rejection
cases before public accessors; and the required timeZone property read, with
plainTime ignored, on a bare ZonedDateTime argument. The current implementation
passed these cases; no speculative runtime repair was introduced. Removed a
stale comment asking for calendar-bearing brands that are already present.

Node 26.8.1 native probes independently confirmed the Buddhist local date at
epoch zero in -01:00, and the bare-zone property access behavior (718ba7).
A native/guest metadata comparison matched five constructor and thirty-two
prototype own string properties, their descriptor flags, and method/getter
names and lengths (7999ec). This does not cover symbols or full conformance.

The current-tree conversion/from/with cohort passed 58 tests in 7 files
(11eef8), including destination conversions and replay. The destination public
constructors and snapshot implementations are still partly uncommitted; this
is not a standalone committed-tree test result.

Node 18.20.8 passed all 31 focused conversion tests across 4 files (cb9cbd).
Package type-checking passed (3ccdc9).
Focused ESLint on both implementation files and the four conversion test files
passed (bc170c).

## Remaining work

Full-package test failures, Intl portability/extreme-range gaps and the other
recorded conformance issues remain open. This commit does not deliver the whole
Temporal namespace. No push or release is authorized during the release hold;
these changes have no visual CLI impact.
