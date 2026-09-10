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

## PlainTime conversions

Added toPlainTime and withPlainTime after seven of eight initial conversion tests
failed due to missing methods (86e36f). The receiver-error control already passed
because calling an absent method also throws TypeError; it was not evidence that
receiver branding was implemented. The successful result/prototype tests now
establish that the real conversion methods execute.

toPlainTime copies the private six-field time record and uses the captured
PlainTime intrinsic prototype. withPlainTime preserves private ISO date/calendar
fields, uses midnight for undefined, otherwise applies the maintained PlainTime
input conversion, and returns a fresh intrinsic PlainDateTime. The four-file
conversion/construction/formatting selection passed 39 tests (ab63eb). Lint and
the Node 18.18.2 conversion check are running as session 50010. These edits are
outside the previously qualified build. Factories and other methods remain open.

## From conversion requirements and backend mismatch

The conversion lint and all eight Node 18.18.2 tests passed (f90b5c).
Added from() regressions for strings, property bags, non-ISO calendars, overflow,
private-slot cloning and observable field/option order.

Backend/native diagnostic 86b524 confirmed a range-validation ordering mismatch:
for `+999999-01-01T00:00`, temporal-polyfill throws RangeError without reading
overflow, while native Node 26 reads overflow before RangeError. The specification
ToTemporalDateTime steps 4–13 likewise parses/canonicalizes first, reads options,
then applies representable-range validation in CreateTemporalDateTime. Invalid
syntax, February 30 and UTC designators must still reject before options.

Do not directly call backend PlainDateTime.from on a string before guest option
conversion and assume its ordering is equivalent. Separate grammar/calendar
validation from representable-range validation; do not classify parse errors by
unstable host error-message text. The from() implementation remains pending.

## Initial from() implementation

All 12 initial from() tests failed against the missing factory (025212). The
factory now uses an explicit guest input adapter: clones read private slots;
object inputs read calendar and ordered fields before overflow; normalized
primitive records alone reach the backend.

For expanded-year strings, ISO grammar/date/calendar validation uses an in-range
year congruent modulo 400. Gregorian leap-day validity is invariant under this
mapping. The original ISO year is restored before owned-value allocation after
guest overflow reads. Negative zero years are not mapped and remain syntax
errors. Calendar annotations do not reinterpret the ISO date portion. This
avoids relying on backend error text or moving syntax failures after options.
Offset components are also validated before guest options.

The initial 12 tests passed (5d121d). Added valid/invalid extreme leap years,
unknown-calendar ordering and exact nanosecond endpoints: all 46 tests in the
four PlainDateTime public files passed, and all 22 from() cases passed on Node
18.18.2 (193a4a). Scoped implementation lint passed before the last ten test-only
controls (8992ea). These changes still need fresh build/CLI and upstream checks.
Conversions from the still-missing PlainDate/ZonedDateTime brands, compare,
equals and other methods remain required. This is not complete type support.

## Comparison and equality

Eight comparison/equality cases failed against the missing methods (8c2b37).
Added static compare and prototype equals using the shared input adapter. Compare
fully converts the first operand before touching the second, then compares the
nine ISO numeric fields in chronological order. Equals checks the receiver brand,
converts the other operand, and requires both identical ISO fields and calendar.
Neither operation consults shadowing public getters on owned operands.

The comparison/from selection passed 30 tests (c2c9d5), including nanosecond-only
differences, calendar-independent ordering versus calendar-sensitive equality,
early failures, and captured-method metadata/replay. Scoped lint passed (4e4f24),
and all eight comparison tests passed on Node 18.18.2 (d04a70). These changes are still uncommitted
public integration and outside the last built qualification.

## Post-factory integration checks

The expanded Temporal/private-value/snapshot selection passed 1,013 tests with
four skipped across 56 files (6e77c8). The maintained build then failed with
TS2352 in the new from() adapter (743eaf): the normalized record was cast to the
entire PlainDateTimeLike union. Changed the cast to the backend DateTimeLikeObject
intersected with the normalized primitive record, preserving missing required
fields for runtime validation. The fresh build retry is session 71877; scoped
lint is session 33098. No successful build is claimed for the retry yet.

Updated the local README to list actual partial PlainDateTime methods and the
four still-missing Temporal classes, and replaced the stale full-suite counts
with the latest failing gate. This describes the working tree, not a release.

The build retry passed all 23 tasks and five fresh ESM checks (f3a4e5); scoped
lint passed (2178d6). The built from/compare/equals/range-order CLI probe passed
and its screenshot was inspected:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-time-from.ajs.png`.

An unmodified pinned Test262 PlainDateTime/from directory run is active as
session 2615 (70 fixtures, both script modes, declared helpers). Partial output
already exposed calendar-string property-bag failures. Inspected fixtures
(6210bd) require date, date-time, year-month, month-day and leap-second strings
as calendar identifiers. The guest adapter currently uses the backend constructor,
which accepts calendar identifiers but not that conversion grammar. A read-only
probe (0596cf) confirms Backend.PlainDate.withCalendar accepts these forms,
including out-of-range date strings without value-range checks. This is a
validated adapter gap; no calendar-string fix is claimed yet. Final upstream
counts and classification of the other failures remain pending.

## Upstream calendar-input correction

Session 2615 completed: 70 unmodified fixtures, 140 script-mode runs, 124 passed,
16 failed, no metadata exclusions (77efb7). The eight failing fixture names were
argument-plaindate, argument-propertybag-calendar-iso-string,
argument-propertybag-calendar-leap-second,
argument-zoneddatetime-balance-negative-time-units,
argument-zoneddatetime-negative-epochnanoseconds, calendar-temporal-object,
order-of-operations and overflow-invalid-string (all `.js`, both modes).
The overflow fixture constructs missing PlainDate/ZonedDateTime inputs before
its assertions; its TypeError is not proof of broken overflow validation.

Eleven calendar-input regressions failed before the adapter fix (22603d).
Further probing rejected direct backend withCalendar delegation: it accepts
February 30, month 13 and overflowing offset minutes (8fe578), while native
Node rejects them (cbf4e0), consistent with ParseTemporalCalendarString requiring
valid ISO grammar. The existing ISO scanner now has a shared parse result used
by both time-zone and calendar-string parsers. The guest calendar adapter reads
owned PlainDateTime calendar slots or parses strings before canonicalizing the
identifier. It never runs public coercion hooks on calendar-bearing values.

The calendar/from/time-zone regression selection passed 127 tests across four
files (0de9b9), including valid upstream forms and invalid-date/offset controls.
Lint and Node 18.18.2 checks are running as session 34044. Fresh build and reruns
of the upstream fixtures remain pending; the 124/140 result predates this fix.

### Calendar-input verification follow-up

Fresh scoped ESLint completed successfully (ea3f21). On Node 18.18.2, the
calendar/from/time-zone selection passed all 127 tests across four files
(dec67f). The maintained safe-js workspace build completed all 23 build tasks
and five fresh-process ESM import checks (a27596).

The two originally failing upstream calendar-input fixtures were fetched unchanged
from Test262 revision 419d3e0a2273ba01a3bfcbec423f2801425b8e93 and rerun against
the fresh build with sta.js, assert.js and their declared includes. Both
argument-propertybag-calendar-iso-string.js and
argument-propertybag-calendar-leap-second.js passed in normal and strict modes:
four of four runs passed (acac46). This verifies the concrete calendar-string
regression; it does not replace the full directory run or establish support for
the still-missing Temporal classes. The public integration remains uncommitted.
No push or release was performed.

## Calendar replacement

Validated the missing withCalendar method with five failing tests (c715b5).
Temporal section 5.3.27 requires receiver branding, calendar conversion, and a
fresh PlainDateTime retaining the original ISO date-time. The implementation
uses the existing calendar identifier adapter and private field storage, selects
the intrinsic prototype, retains allocation roots, and registers the method for
snapshot replay. Tests cover ISO-field preservation with Buddhist calendars,
calendar strings, private slots despite shadowed getters, subclass results,
non-coercion of unsupported objects, and captured-method/result replay.

The focused selection passed 28 tests (034c1b); the five new cases also passed
on Node 18.18.2 (0e93fd). Scoped lint passed (9d7e24). The maintained workspace
build passed all 23 tasks and five fresh ESM import checks (332692).
README now lists withCalendar as
part of the uncommitted public integration. No push or release.

The complete pinned Test262 withCalendar directory passed 32 of 34 runs across
17 fixtures, with no exclusions (db31c3). The two failing runs are
calendar-temporal-object.js in normal and strict modes. Inspection (62fc55)
confirms it first constructs the missing PlainDate class, followed by other
missing date-bearing classes, before any withCalendar assertions. This remains
an implementation gap, not evidence of a new withCalendar regression.

## Date-time rounding

Nineteen regressions failed against the missing round method (6a230c).
Following Temporal section 5.3.32, the new adapter brands first, reads and
converts increment/mode/unit in order, rounds the private ISO fields, and
retains the original calendar in a fresh intrinsic-prototype value. Backend
rounding sees only normalized primitive options and ISO fields, never guest
objects. Extracted the existing PlainTime option reader into a shared typed
helper; Instant's distinct increment rules are unchanged.

The initial PlainTime/PlainDateTime selection passed 52 tests (c2fd6d).
Additional day-tie controls cover all nine modes and receiver/early-increment
validation. Node 18.18.2 passed all 62 cases (00853c). Scoped lint passed
(210e1b); the maintained build passed all 23 tasks and five import checks
(1388c0). Lint started before the final ten test-only controls were added.
README lists round as part of the uncommitted public integration. No push or
release; this does not establish complete Temporal conformance.

### Upstream rounding and relativeTo integration

The complete pinned Test262 round directory finished with 86 passed and four
failed runs across 45 fixtures, with no exclusions (0348a6). Both modes fail
throws-argument-object-insufficient-data.js and throws-argument-object.js:
the fixtures require RangeError for a missing smallestUnit, whereas the shared
PlainTime-derived reader throws TypeError (554eda). The specification's required
option rule confirms RangeError. Existing local tests incorrectly expected
TypeError for an empty object; this is a validated remaining correction, not
an upstream test defect. Final test-only lint passed (964976).

Separately, four relativeTo regressions failed (3497a9): total/compare/round
read a shadowed calendar getter on owned PlainDateTime, and a Buddhist-calendar
month total produced 28 instead of 29 by interpreting calendar year as ISO.
GetTemporalRelativeToOption requires the private ISO date and calendar, with no
public reads. Added the owned PlainDateTime conversion path to the relativeTo
adapter. A fifth replay control already passed before the change.
All 93 focused Duration tests passed (c6aefd). The five new cases passed on
Node 18.18.2 (aec117), scoped lint passed (6b06d0), and the maintained build
passed 23 tasks plus five fresh ESM checks (bc339a). The earlier rounding
upstream run predates this relativeTo fix. README describes the private-field
conversion. Missing-unit rounding error correction remains pending.

### Required rounding unit correction

Corrected the empty-options expectations in both PlainTime and PlainDateTime;
the two tests failed against TypeError (6a191b). The shared reader now throws
RangeError when smallestUnit is missing, while undefined/non-object options
still throw TypeError. All 62 end-to-end rounding cases passed (0055f0), scoped
lint passed (8b6521), and the maintained build passed 23 tasks plus five fresh
ESM checks (e4c482). Both originally failing pinned upstream fixtures now pass
in normal and strict modes, four of four runs (154c86). The full 45-fixture
directory has not been rerun after this change; do not report a fresh 90/90.

### Calendar-bearing relativeTo property bags

Six regressions failed before the fix (4ba06e): relativeTo bags rejected ISO
calendar strings, owned PlainDateTime calendar values, and annotated calendar
strings beyond the representable date range. Two invalid-input controls passed
before the change. The adapter now reuses readTemporalCalendarIdentifier before
reading the remaining fields. All 101 Duration selection tests and scoped lint
passed in session 81627 (f533a1). This source change is not covered by the last
workspace build; a fresh full package gate is running as session 33443.

## Read-only preparation for field replacement

During the full-suite source freeze, a direct guest invocation confirmed that
PlainDateTime.with is still missing (423d6a). Native/backend probes agreed on
ISO month replacement, monthCode replacement, leap-day year constraint,
conflicting month/monthCode rejection, and empty partial-object rejection.
Both observed calendar, timeZone, then day/hour/microsecond/millisecond/minute/
month/monthCode/nanosecond/second/year, then overflow for an ISO input. These
probes are bounded implementation evidence, not comprehensive conformance.

One native/backend mismatch must not become a false SafeJS requirement:
Node 26.4.0 rejects changing Buddhist year 2543's February 29 to year 2544,
including explicit overflow: constrain (c9d721, 17ea8c). The backend returns
ISO 2001-02-28 with the Buddhist calendar. Temporal NonISOCalendarDateToISO
requires clamping to the closest valid day in the same month for constrain:
https://tc39.es/proposal-temporal/#sec-temporal-nonisocalendardatetoiso
Thus tests for this case should use the specified February 28 result, not the
native rejection. This is not a newly fixed SafeJS defect; with remains absent.

Implementation after the frozen gate should normalize guest fields once, reject
owned date/time partial inputs before reading their public properties, reject
calendar/timeZone changes, preserve calendar-specific month/year merging, and
read overflow after partial-field preparation. Existing PlainDateTime.from
normalization and PlainTime.with checks are relevant reuse points; plain object
spread is not sufficient for coupled month/monthCode and era/year fields.

## Field replacement implementation

Fourteen tests failed against missing with (259954). An empty-partial test
initially passed because calling the absent method also threw TypeError;
strengthened it with a method-presence guard and confirmed the failure (14c856).
The shared from/input adapter now accepts optional private base fields for
partial updates. It rejects owned date/time inputs before public reads, checks
calendar/timeZone, normalizes calendar-specific fields once, rejects an empty
partial before options, then reads overflow. Backend with performs coupled
calendar-field merging on normalized primitive data; the result is copied into
fresh private storage and uses the intrinsic prototype. Registered the method
for replay. Duration remains admissible when carrying a relevant partial field.

The with/from/calendar selection passed 52 tests (0637c6), including Buddhist
year clamping, month versus monthCode, conflict/overflow rejection, ordered
coercion, subclass behavior and replay. Node 18.18.2, lint and build checks are
running. README lists with as working-tree functionality; this change is outside
the last completed full-package fingerprint. No push or release.

All 15 with tests passed on Node 18.18.2 (a4884e). Scoped lint passed (f97fcc),
and the maintained workspace build passed 23 tasks and five fresh ESM checks
(ae6d83). The built CLI probe passed (30197c), and its screenshot was inspected:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-time-with.ajs.png`.
It shows month/monthCode replacement, Buddhist year constraint and explicit
overflow rejection. Upstream with fixtures have not yet been run.

The pinned Test262 with directory subsequently completed: 30 fixtures, 60 runs,
58 passed and two failed, no exclusions (e0967c). The sole failing fixture,
calendar-temporal-object-throws.js in both modes, constructs missing PlainDate,
PlainMonthDay, PlainYearMonth, ZonedDateTime and Now inputs before assertions
(069442). This does not establish a regression in with's owned-class rejection.

## Date-time addition and subtraction

Twelve arithmetic tests failed against missing add/subtract (7e1921). Added a
shared arithmetic adapter that reads duration first, retains normalized duration
fields across guest option reads, validates overflow, and delegates calendar
arithmetic on private ISO fields and primitive options. Results are copied into
owned storage, retain the calendar, and receive the intrinsic prototype. Methods
are registered for replay. Tests cover month constraint, signed subtraction,
nanosecond day transitions, combined month/time carry, Buddhist calendars,
ordered reads, invalid duration precedence, range rejection and replay.

Focused tests, minimum-Node checks, scoped lint and the maintained build are
running. README describes these uncommitted methods. No push or release; this
work is outside the completed 26,614-pass full-suite fingerprint.

The focused selection passed 39 tests (44375f); all twelve new arithmetic
cases passed on Node 18.18.2 (dfc53a). Scoped lint passed (a588e6), and the
maintained build passed all 23 tasks and five fresh ESM checks (b2da37).
The built CLI probe passed (8dbffa); its screenshot was inspected at
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-time-arithmetic.ajs.png`.
The pinned upstream add/subtract directories subsequently completed on the
arithmetic-qualified build: 42 fixtures and 84 runs per method, all 168 runs
passed, no exclusions (add a5aacd; subtract 745074). Revision:
419d3e0a2273ba01a3bfcbec423f2801425b8e93. This is bounded method coverage,
not complete Temporal conformance.

## Date-time differences

All eleven initial until/since tests failed against the missing methods
(c51ee5). Implemented other-operand conversion, calendar matching before
option reads, shared ordered difference-option normalization, private-field
backend arithmetic, and owned Duration results using the captured intrinsic
prototype. Registered both methods for replay. No guest objects enter backend
arithmetic.

Two initial expected results were incorrect: January 31 to February 29 with
largestUnit month is P29D, not P1M. Node 26.4 confirms the ISO result (16b1ac).
CalendarDateUntil uses ISODateSurpasses rather than constrained date addition:
https://tc39.es/proposal-temporal/#sec-temporal-calendardateuntil
Non-ISO date differences are implementation-defined; native Node 26.4 throws
Not yet implemented for the Buddhist month difference, so it is not an oracle
for that case. Kept the backend's Buddhist result and added January 28 to
February 29 controls expecting P1M1D to exercise actual month output. This
corrects tests, not a backend bug.

The thirteen difference tests cover default days, nanoseconds, calendar units,
since rounding direction, calendar mismatch precedence, ordered reads even
for equal operands, private operand fields and intrinsic Duration replay.
The focused difference/arithmetic/PlainTime-difference selection passed 47 tests
(640612). All thirteen difference tests passed on Node 18.18.2 (eea430).
Scoped lint passed (fad34f). The maintained workspace build passed all 23
tasks and five fresh native ESM import checks (321210). The built CLI probe
passed and its screenshot was inspected (a19f98):
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-time-difference.ajs.png`.
Upstream until/since fixtures remain unverified.
These uncommitted methods are outside the last full-package fingerprint.
No push or release.

## Locale formatting

Six tests failed against the missing own toLocaleString method (7c130f).
The inherited Object method silently returned ISO strings and ignored locale
options. Added a branded method with guest locale canonicalization and ordered
DateTimeFormat option normalization. Time zones are validated, then removed
before formatting the private wall-clock fields so older hosts need not
support ignored offset zones. Only normalized primitives cross into the
backend; output is budget-accounted and the captured method is replayable.

The ECMA-402 Temporal method uses CreateDateTimeFormat(any, all), rather than
the non-Intl ISO-string fallback:
https://tc39.es/proposal-temporal/#sup-temporal.plaindatetime.prototype.tolocalestring
The focused locale/difference selection passed 52 tests (f807aa), and all six
new locale cases passed on Node 18.18.2 (b68eb7). Tests cover named and offset
zone independence, early zone errors, style/component conflict, private fields,
calendar formatting and replay. Scoped lint passed (3f7ccd). Build and screenshot checks remain pending
while the upstream difference run uses the existing build.

The source CLI locale probe passed and its screenshot was inspected (f12103).
The pinned intl402 PlainDateTime/toLocaleString directory then ran all fifteen
fixtures in both modes: 22 passed, eight failed, no exclusions (1080bc).
All four failing fixtures call Intl.DateTimeFormat.format with PlainDateTime;
source inspection confirmed the admission predicate only accepted Instant and
PlainTime (a62f3f, 488e40). This was a concrete interoperability defect.

Four direct-Intl regression tests failed before the fix (2e82a5): private-field
formatting/parts, default-component replay, source-labelled ranges and
mixed-kind conversion order. Extended the private-brand admission predicate
and copied PlainDateTime ISO fields/calendar into backend-owned values; mixed
range types remain rejected. Nineteen focused tests passed (5f0184). The full
fifteen-fixture locale directory rerun passed all thirty runs with no exclusions
(0fe582), on the current source runtime. This is not a built-artifact or full
Intl conformance claim.

All ten locale/direct-Intl tests passed on Node 18.18.2 (e909a6). TypeScript
no-emit checking passed (a51ee7), without changing the build used by the running
difference corpus. The expanded source CLI screenshot was inspected (81d3fb):
it shows locale output, direct Intl formatting, and a date-time range.
Direct-Intl scoped lint passed (b8cba5), as did the earlier locale-method lint.
A maintained build is still pending.

That maintained build subsequently passed all 23 tasks and five fresh native
ESM import checks (3d8ddd), incorporating locale and direct-Intl integration.
The built CLI locale/direct-Intl/range probe also passed; its screenshot was
inspected (56ae00):
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-time-locale.ajs.png`.

The broader Intl formatting/private-Temporal/requested-options snapshot
selection passed all 73 tests in four files (e0d824). The completeness
inventory refresh is committed locally as 2df7a43a5; implementation changes
remain uncommitted. Unrelated staged safe-bash changes have the same patch hash
before/after that documentation-only commit (669234, f30899). No push or release.

The difference-qualified build's pinned until directory finished separately:
98 fixtures, 188 passed and eight failed, no exclusions (9f300a). Four fixtures
fail in both modes: argument-plaindate, both argument-zoneddatetime fixtures,
and calendar-temporal-object. Inspected sources (3c7a17, d291b2) require the
missing PlainDate/ZonedDateTime or other missing calendar-bearing types.
The since directory subsequently completed: 95 fixtures, 182 passed and eight
failed, no exclusions (ca4cc2). The same four fixture names fail in both modes.
Session 41224 is terminal; the maintained build can now incorporate locale and
direct-Intl changes without disturbing the difference corpus.

The complete pinned PlainDateTime round directory was rerun against current
source after the earlier missing-unit error-type fix: all 45 fixtures passed
in both script modes (90/90), with no exclusions (ffb0d5). This replaces the
old 86/90 directory result for current source; it is not full conformance.
