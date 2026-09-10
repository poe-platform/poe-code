# Owned Temporal.PlainDateTime integration

## Validated missing behavior

Built reflection cd558e returns undefined for Temporal.PlainDateTime. The pinned
Test262 PlainTime.from directory has failures requiring its internal-slot
conversion, independently of the now-fixed template parser. This work implements
the missing type; it does not redefine the complete-JavaScript goal as a subset.

## Required implementation

Follow the [Temporal PlainDateTime specification](https://tc39.es/proposal-temporal/#sec-temporal-plaindatetime-objects).
Store ISO date/time fields and the canonical calendar identifier in owned private
storage. Public calendar-derived getters must not overwrite ISO storage. Guest
coercion, overflow, prototype selection and errors belong in guest adapters;
the backend must never receive unprocessed guest objects or become the guest
value itself. Brand checks must reject proxies and forged receivers.

Integrate data accounting, host copy/import/export, realm prototypes, intrinsic
registration, strict heap validation and public replay before claiming public
support. PlainTime.from must read owned time slots without invoking public
getters. Implement the complete static/prototype method surface, calendar
arithmetic, comparisons, rounding, locale formatting and date/time conversions;
dependent missing types remain required, not permanently excluded.

## TDD entry point

The initial public regression file covers constructor metadata and fields,
non-ISO calendar interpretation, internal-slot PlainTime conversion, coercion
before date rejection and subclass/nanosecond preservation through public
snapshot replay. Run it against the missing implementation first. Extend with
boundary, hostile input and method-specific tests as implementation proceeds.
Do not expose a constructor that loses private fields on copying or snapshots.

The initial run (02f06e) failed all five tests against the current implementation:
PlainDateTime is not a constructor, subclass creation fails, and the invalid-date
case throws TypeError before any numeric conversion instead of RangeError after
conversion. These are deliberately red, uncommitted tests; no implementation or
passing qualification is claimed yet.

## Private storage implementation

Added an owned WeakMap-backed ISO date/time record with a separate canonical
calendar identifier. Allocation accepts only own primitive data fields, rejects
accessors and proxy inputs, validates integer/range constraints before storage,
normalizes negative zero and freezes the copied record. No backend object is
stored in guest-visible data. Forged/proxied receivers cannot acquire the brand.

The private tests initially failed to import the missing module (8f6fd0; no test
cases executed). After implementation, all 15 private cases passed, together
with 11 existing PlainTime core cases (3e287d). All 15 also passed on the supported
Node 18.18.2 floor (f34f31). Scoped lint passed (c966f9).
The public construction regressions remain red: this private module is not yet
wired into constructors, host copying, accounting or heap/replay codecs.

## Copy and accounting integration

The five corrected copy/accounting regressions failed before integration
(4868d5): clone/export lost private slots, host import was unsupported, private
storage was not charged, and structured-clone mode silently accepted the value.
An initial test used the wrong measurement API; only the corrected iterable-based
measurement result is evidence of the accounting gap.

Local integration now preserves ISO fields and canonical calendars during copies,
including cycles, aliases, descriptors, frozen state and explicit null prototypes.
Host extraction uses captured intrinsic methods/getters, converts to ISO calendar
before reading date fields, and rejects proxies without traps. Private accounting
charges nine numeric fields and calendar text. Structured-clone mode rejects the
value instead of discarding its private slots.

The expanded core/copy selection passed 38 tests; all ten new copy tests also
passed on Node 18.18.2 (fb9ec8). Scoped lint passed before the last five test-only
controls were added (5ae93c). User-staged safe-bash patch remains unchanged
(7e6374). Constructor, host realm-bridge and heap/replay integration are still
pending, and the five public regressions remain red. No commit or delivery is
claimed for this incomplete integration.

## Snapshot codecs

Eleven new snapshot cases failed before codec integration (98c276): both codecs
lost the owned brand/private slots and the heap validator did not recognize the
new node kind. Added explicit heap and replay-data variants, canonical numeric
and calendar validation, and owned-value restoration. The slot record rejects
extra/missing fields, negative zero, invalid dates/times, fractional values and
noncanonical calendar identifiers.

The new cases and existing PlainTime heap/replay controls passed 59 tests across
three files (40f798). This includes aliases, frozen self-cycles, symbol cycles and
re-encoding. Scoped lint is running as session 99433. Public constructor and
realm-bridge integration remain pending; the original five public regressions
are not yet fixed. A maintained build is needed to qualify the expanded types.

## Initial public integration

The pre-constructor maintained build completed all 23 tasks and five fresh ESM
checks (284528); snapshot lint passed (da83e8). That build does not cover the
subsequent public constructor changes.

Added the guest constructor, all field/calendar getters and valueOf, realm
prototype identity, data-copy classification and private-slot PlainTime.from
conversion. The original five public regressions passed (7bf6ce). A new host
binding/replay test then reproduced unsupported host PlainDateTime admission
(8a5c40: one failed, five passed); extending the realm bridge resolved it.
The construction/copy/private-slot/snapshot/PlainTime control selection passed
73 tests in six files (6b3764), including replay without repeating host calls.
Scoped lint remains running as session 57950.

This is partial, uncommitted public support. Static from/compare and the remaining
prototype methods, full constructor coercion/boundary coverage, adversarial
snapshot checks, a fresh build and built CLI verification remain required before
qualifying this integration. Dependent PlainDate/ZonedDateTime types are still
missing. Do not label the type or JavaScript support complete.

## String and JSON formatting

Eight formatting regressions failed before implementation (aceac6). Added
toString/toJSON using private ISO slots, calendar annotations, precision and
rounding. The shared PlainTime precision-option reader now also supports the
calendarName prefix used by PlainDateTime, following the specification's
alphabetical read order. Existing PlainTime behavior remains covered; Instant's
distinct late validation order is not changed.

The constructor/formatting selection passed 42 tests (89a36d). After adding
upper-range rollover and captured-method replay checks, the two formatting files
passed 38 tests, and all ten PlainDateTime formatting cases passed on Node
18.18.2 (2f3127). Scoped lint passed before the final two test-only controls were
added (9124e0). The prior public-constructor lint also passed (33d309).
Formatting changes are outside the last build; fresh build/CLI qualification and
the remaining factories and methods are still required. No delivery is claimed.

## Accumulated integration qualification

The current Temporal/private-value/snapshot/lint selection passed 975 tests with
four skipped across 53 files (50f205). The following focused lint command exited
successfully (b10c8a). The fresh maintained workspace build passed 23 tasks and
all five fresh ESM checks (8fb7f8).

The built CLI probe succeeded and its screenshot was inspected:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-time.ajs.png`.
It verifies a Buddhist-calendar year, exact ISO JSON, rounding across leap-day
midnight, private-slot PlainTime conversion and the guest brand.

The owned private storage module and its core tests can be committed atomically;
public integration and further methods remain separate unfinished work. These
results cover the accumulated working tree, not only the standalone core commit.
They do not replace the last failing full-package gate. Releases remain held.
