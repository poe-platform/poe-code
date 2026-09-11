# Intl.DurationFormat

## Confirmed missing API and portability requirements

On September 8, the built runtime at 84d108bc1 rejects
`new Intl.DurationFormat('en',{style:'digital'}).format({hours:1,minutes:2,seconds:3})`
with `DurationFormat is not a constructor`. Native Node 24.14.0 returns
`1:02:03`; Node 18.18.0 has no native constructor. Node 18 support remains required.

The pinned candidate dependency @formatjs/intl-durationformat 0.10.18 is installed
locally but not delivered. Direct probes demonstrate that it is not sufficient
without further work:

- Node 18 rejects nonnumeric microsecond/nanosecond output because its native
  NumberFormat lacks those units. The existing portable NumberFormat also rejects
  those two units, so merely wiring that backend does not solve this gap.
- Node 18 formats 1 second + 999 milliseconds with two fractional digits as
  `0:00:02.00`, rather than the native Node 24 truncation result `0:00:01.99`.
- Both versions repeat negative signs: hours -1/minutes -2 produces
  `-1:-02:00.00`, while native Node 24 gives `-1:02:00.00`. Text styles repeat
  signs too. These are concrete failures, not assumptions from package claims.

The [ECMA-402 numeric duration algorithms](https://tc39.es/ecma402/#sec-formatnumerichours)
control sign display across fields, disable numeric grouping, and truncate
fractional seconds. The implementation must also retain negative-zero sign
placement when the first displayed field is zero. Validate additional cases
before changing the backend.

## Required work

- Failing tests for confirmed backend defects, then a private portable engine
  integration. Do not mutate host Intl or edit node_modules. Any generated
  dependency adaptations must parse and validate source structure and preserve
  license attribution, following existing NumberFormat generation practice.
- All ten duration fields, four styles, per-unit style/display, numbering system
  and fractionalDigits. Read guest options and duration fields in spec order;
  validate integer/sign/magnitude limits without exposing guest getters to native
  code or silently narrowing the supported API to digital positive durations.
- Constructor and method metadata, branding, subclassing, supported locales,
  resolved options, formatToParts and formatting results.
- Private-state accounting, bounded work, strict snapshots, replay, intrinsic
  mutation retention, and structuredClone rejection.
- Focused tests/lint, maintained build, supported Node 18/24 built probes,
  separate atomic commits and verified remote-main delivery. Keep releases
  monitored while continuing validated work.

This is not the last JavaScript gap: weak collections, Proxy, dynamic functions,
shared memory and the other documented limitations remain open.

## Additional validated backend gaps

After the portable-unit prerequisite and unit-case correction reached remote
main (1f3d5680e and 23e271256), the pinned DurationFormat dependency was
reinstalled for integration. Native Node 24 versus candidate probes establish:

- Digital hours 1 / seconds 3 with minutesDisplay auto must retain the middle
  minute: native 1:00:03, candidate 1, 03.
- Negative seconds must put the sign on the first displayed zero hour:
  native -0:00:03, candidate 0:00:-03.
- Truncated negative milliseconds must retain the first-field negative zero:
  native -0:00:00, candidate 0:00:-00.
- Digital hours 1234 must not group: native 1234:00:00, candidate 1,234:00:00.
- Long hoursDisplay always with minutes -2 must produce -0 hours, 2 minutes,
  not 0 hours, -2 minutes.
- The well-formed but unsupported numberingSystem foobar falls back natively;
  the candidate incorrectly throws RangeError.

These six cases are now explicit public-API regressions. The backend needs a
complete numeric-field partitioning correction, not just NumberFormat injection.

Further Node 24 comparisons validate input-conversion gaps: the candidate
accepts BigInt fields instead of throwing TypeError; throws generic Error for
fractional fields instead of RangeError; accepts years at 2^32 and normalized
seconds at 2^53; and rejects callable objects carrying duration properties.
These five cases also have explicit public-API regressions. The current spec's
IsValidDuration requires exact normalized-second bounds, so plain floating-point
weighted summation is insufficient near the boundary. Guest conversion must
read each property once in specification order before private formatting.

## Input conversion implementation in progress

The new private readDurationRecord converter reads fields once in alphabetical
spec order through the guest property/coercion helpers. It rejects BigInt and
nonintegral values, normalizes negative zero, validates common signs after all
reads, and checks calendar and normalized-second magnitude limits. Exact BigInt
nanosecond arithmetic preserves the valid neighbor immediately below 2^53
seconds, including its fractional subsecond remainder. Guest inputs and partial
state remain retained during coercion.

The initial 19 focused converter tests pass; added checks also cover abrupt
coercion order, delayed sign validation and the negative boundary neighbor.
This module is not yet wired to a public DurationFormat constructor and is not
delivered as standalone dead code. Formatting, options, private state, snapshots
and the public API remain implementation work.

The unit-options reader now applies per-unit allowed styles, numeric/fractional
inheritance, display defaults and incompatibility checks in guest getter order.
The combined record/options tests pass 33 cases. Locale-specific two-digit-hour
selection and top-level locale/numberingSystem/fractionalDigits handling still
need integration; these helpers are not a completed public implementation.

Publication monitoring confirms the subsecond prerequisite shipped as
@poe-platform/safe-js 0.1.467 (workflow 34238478572). The separate case-sensitivity
release remains monitored under workflow 34238514216.

## Formatting implementation in progress

The private formatter now composes portable NumberFormat parts and native
ListFormat parts under the duration partitioning rules. It keeps one leading
sign (including negative zero), preserves required middle minutes, disables
digital grouping, and combines fractional fields with exact decimal arithmetic
and truncation. It covers text and digital styles rather than delegating to the
candidate dependency's defective partitioner.

Three helper suites pass 42 tests, with lint and TypeScript checks passing.
A Node 24 source-level differential probe compares complete parts for six
locales, four styles and five positive/negative/subsecond records: all 120
comparisons match. The probe supplies the native digital separator and explicit
latn digits; it does not yet validate locale-pattern resolution or built Node 18
integration. Public branding, options, state, snapshots, budgets and delivery
remain outstanding.

Locale resolution now uses a private copy of the dependency's 766-locale digital
pattern data and native NumberFormat locale/numbering-system negotiation, without
calling its DurationFormat constructor or mutating host Intl. Top-level options
are connected to per-unit validation and fractionalDigits coercion. All four
helper suites pass 54 tests, including unsupported numbering-system fallback,
Unicode extension overrides, dot separators and fractional-digit bounds.

The guest constructor, supportedLocalesOf, resolvedOptions, format and
formatToParts are now wired. All 19 original public regressions pass. Two
additional failing tests established that structuredClone incorrectly read
custom getters and memory measurement omitted private settings; both are now
corrected through the standard value paths. The combined five-file suite passes
75 tests before adding the checkpoint test. A Finnish digital checkpoint with
a self-cycle and negative fractional seconds now exercises the remaining private
snapshot-state integration. No DurationFormat commit or publication is claimed.

The replay checkpoint passes independently, but a direct serialized closure
heap initially failed with an incompatible DurationFormat receiver. Dedicated
guest-durationformat heap nodes now preserve private settings, while ordinary
object state retains aliases, prototypes and custom properties. Validation checks
the exact settings shape, canonical locale/separator, all ten unit styles and
their sequencing/display constraints, and fractional-digit bounds. Nine forged
snapshot cases are rejected. The duration/plural/segmenter run passes 109 tests.

TypeScript exposed that required fractionalDigits: undefined was not valid dump
data. Snapshot capture now omits an absent fractionalDigits field rather than
weakening the dump-value type. Intrinsic-retention coverage now includes the new
constructor and methods. Broader tests, built Node 18/24 probes, budget checks
and release delivery are still required before declaring the feature complete.

Public constructor/method metadata, subclassing, receiver checks, fresh resolved
options and output string/parts budgets now have focused coverage. A native
Node 24 probe showed that constructor options must be an object or undefined,
while supportedLocalesOf still accepts primitive options. Four failing
constructor-option tests were corrected with a constructor-only guard. The six
focused files now pass 111 tests. The maintained build and final lint are running
before built cross-version probes and the full unexcluded SafeJS suite.

Final targeted lint and the maintained build passed (23-workspace closure and
four fresh-import checks). Built Node 24 matched all 120 duration part cases.
The Node 18 run exposed German narrow hours as 1Std. instead of the modern
portable 1h: numberformat-numbering.ts substitutes a native unit word into a
portable pattern. The full maintained suite is now running on unchanged source
while that older correction is investigated. Do not claim Node 18 parity or
DurationFormat delivery from the Node 24 result alone.

The unchanged-source full suite completed in 564.32 seconds: 21,125 passed,
eight failed, 37 skipped (712 files passed, four failed, one skipped). Six
failures remain in weak-collection and host-promise import work. Two were exact
legacy graph expectations lacking DurationFormat; adding that one explicit
intrinsic entry made both files pass (44 passes, one skip), without changing the
graph comparison or historical checkpoint fixtures.

The preceding CLI workflow 34238514729 failed on the Float32 inverse-coordinate
camera trace's 5000ms timeout. SafeJS 0.1.468 was published independently; CLI
publication is not successful. The camera performance issue remains open and
must be repaired without increasing its timeout.

The number word/pattern correction is now independently delivered as
a42853511351375ae1df3f0724254e8d13c382a8, verified on remote main. Built Node
18.18.0 and Node 24.14.0 now each pass all 120 full-part duration comparisons.

A further built Node 24 audit checks resolvedOptions and digital formatToParts
for every native-supported locale in the pinned dependency: 658 checked, 657
exact matches. The sole difference is ur-IN's arabext time separator: the pinned
data supplies U+066B while native Node 24 uses colon. The dependency explicitly
contains that numbering-system override; the Unicode CLDR 46 symbols chart also
lists U+066B as the arabext default, without an Urdu exception. This is not yet
evidence of an implementation defect, so do not replace locale data merely to
match the native oracle. Source:
https://www.unicode.org/cldr/charts/46/by_type/numbers.symbols.html
No DurationFormat publication is claimed yet.

## Delivery verification

The 240-case built option audit covers all four base styles, six clock/subsecond
units, five explicit unit styles and both displays. Resolved options and errors
match native Node 24 throughout. Twelve formatting differences all occur when
numeric seconds follow text minutes. ECMA-402 FormatNumericUnits starts at
seconds in these cases and leaves minutesFormatted false; the previous textual
minute remains a separate ListFormat element. Our list separator matches that
algorithm, whereas Node 24 inserts a clock colon after a text unit. Added three
specification conformance tests exercise all twelve combinations without changing
the implementation to copy the native discrepancy.
https://tc39.es/ecma402/#sec-formatnumericunits
https://tc39.es/ecma402/#sec-partitiondurationformatpattern

Final eight-file run: 158 passed, one existing skip. Lint passes all 19 changed
code/test files. Both Node 18 and Node 24 restore a serialized closure containing
a self-referential Finnish formatter and retain its negative fractional output.
The maintained build and 753-test broader Intl run passed before the final
test-only additions; runtime source is unchanged since those checks. The full
suite's six weak-collection/promise-import failures remain recorded work, not
suppressed or represented as a green full suite. No matching open GitHub issue
was found for DurationFormat. Commit and push the feature independently, then
continue the remaining JavaScript gaps while tracking publication.
