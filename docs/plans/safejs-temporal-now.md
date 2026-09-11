# Temporal.Now: validated gap and replay requirements

## Evidence

A fresh source-runtime probe returned undefined for Temporal.Now while returning
function for Temporal.PlainYearMonth, Proxy and WeakRef and object for Atomics
(5a3ae5). Namespace inspection confirms no Now property. This is a validated
missing capability, not inferred from an old absence inventory.

Source inspection (9cf42f, 8b9f91) identifies the existing Date clock boundary:
declareHostOperation plus wrapCallerInjectedBindings under module <Date>, with
recorded outcomes and onReplay restoration of injected clock state. RunClock
currently exposes millisecond now(), snapshot() and optional restore().
Date tests already prove completed replay does not reread the clock and public
Date.now replacement does not change Date construction's private clock.

## Required implementation behavior

Expose an ordinary, non-callable Now namespace with timeZoneId, instant,
plainDateTimeISO, zonedDateTimeISO, plainDateISO and plainTimeISO. Preserve normal
metadata and intrinsic identity through snapshot/replay.

Reuse the existing recorded clock boundary where possible; never call backend
Temporal.Now directly from guest methods without journaling nondeterminism.
Capture private clock functions during binding creation so guest replacement of
Date.now or Temporal namespace properties cannot redirect internal reads.

Default time-zone selection is also nondeterministic. Record it through an
explicit host-operation boundary so replay cannot silently substitute a new
host default. Explicit zones must be validated before the clock is sampled;
invalid zones must not consume an injected clock tick. Use the maintained zone
parser and owned ZonedDateTime private-zone admission, not general object string
coercion. Construct owned result types with existing realm prototypes and budget
accounting rather than exposing backend objects.

Clock precision and range semantics need explicit qualification: RunClock's
existing milliseconds are not evidence of nanosecond precision. Conversion to
nanosecond units must not invent sub-millisecond measurements. Preserve injected
clock validation, and independently check default host clamping against the
Temporal requirement before making a conformance claim.

Primary source: https://tc39.es/proposal-temporal/#sec-temporal-now.
SystemDateTime and zonedDateTimeISO resolve/validate the zone before reading time;
HostSystemUTCEpochNanoseconds specifies range and host precision behavior.

## Test-first qualification

Reproduce missing methods; cover namespace metadata, all result brands, controlled
clock values, explicit UTC/fixed/named zones, private zone inputs, invalid-input
observation order, ignored extra arguments, and independence from public shadows.
Verify completed and pending dump/replay, captured methods and injected clock
restoration; replay must not reread completed host outcomes. Verify default-zone
recording with controlled host behavior, without changing global process TZ in
parallel tests. Use pinned upstream fixtures and screenshot the public CLI path.

## Local implementation and initial verification

The full pre-Now package gate is terminal (fc98aa): 27,188 passed, nine failed,
41 skipped. Its source fingerprint matched. Now work began only afterward;
those results do not qualify the new implementation.

Six initial regression tests failed against the missing API (247254). The new
namespace factory constructs owned result types using the existing intrinsic
prototypes. It captures Date's recorded clock closure; default-zone reads use a
separate recorded host operation under module <Temporal.Now>. Explicit zones
are resolved before the clock is called. Private zoned values and ignored extra
arguments do not trigger public coercion. Methods retain their private clock
closures and are registered for intrinsic snapshot identity.

The focused Now/Date selection passes all 22 tests on Node 22.23.2 (035877).
The eight Now tests pass on Node 18.18.2 (aaf5c9). Completed replay preserves
recorded clock/default-zone outcomes, even after the mocked host zone changes;
a pending checkpoint allows both continuations to consume their own clock read.
The first default-zone mock used a non-constructible arrow; that test setup
error was corrected with a normal function before the passing runs. TypeScript
passes (ada65f).

At pinned Test262 revision 419d3e0a2273ba01a3bfcbec423f2801425b8e93 on Node
26.8.1, the two top-level Now fixtures pass both modes (four passes, d8db1d),
and all nine Now/instant fixtures pass both modes (18 passes, 991104). Original
sources/harnesses and completion sentinels were used, with zero exclusions.
The subsequent method-directory results are recorded below. This is not full conformance.

An adhoc CLI screenshot (64e351) exercises all six methods, including a fixed
offset; the rendered output was inspected. Fresh scoped lint passed (c5e28e).
Maintained build session 46633 passed (c5acae): 23 workspace builds and all five
fresh native ESM import checks. The earlier Intl formatToParts session
87723 still runs the pre-Now process candidate; do not attribute it to this tree.

The factory/tests are an atomic local addition, but public wiring depends on
the broader uncommitted Temporal integration in globals.ts and temporal.ts.
Do not claim a standalone delivered feature or a clean full gate. Default-host
precision/range qualification, further budgeting/recovery checks and integration
delivery remain open. No push or
release is authorized by this plan.

## Complete pinned Now fixture-tree qualification

The directory listing was audited after the six method runs: it also contains
toStringTag, which was then tested. The method directories have no nested
directories (c5ba4c, d49bf8). All runs use the same pinned revision and Node
26.8.1 process runtime, original fixture/harness sources, both script modes and
completion sentinels. There are no excluded or unsupported fixtures.

| Directory under test/built-ins/Temporal/Now | Fixtures | Passed executions | Evidence |
| --- | ---: | ---: | --- |
| top-level | 2 | 4 | d8db1d |
| instant | 9 | 18 | 991104 |
| plainDateISO | 9 | 18 | b9eea1 |
| zonedDateTimeISO | 15 | 30 | 053134 |
| plainDateTimeISO | 13 | 26 | ab70b8 |
| plainTimeISO | 10 | 20 | cc582c |
| timeZoneId | 6 | 12 | 2ac98b |
| toStringTag | 2 | 4 | 510cd1 |

Total: 66 fixtures, 132 passing executions, zero failures. This qualifies the
pinned Now fixture tree, not the entire Temporal implementation, every runtime,
or all host precision/range and sandbox-budget interactions.

Six additional focused tests cover exact negative/positive millisecond clock
endpoints and rejection of NaN, Infinity, fractional and out-of-range injected
clock values. All 14 Now tests pass on Node 22.23.2 (1a1436); TypeScript passes
(8db51e), and scoped test lint passes (e3e217). These tests preserve the existing Date clock validation and convert
to BigInt before scaling, without inventing sub-millisecond precision. Runtime
implementation sources did not change during this qualification.
