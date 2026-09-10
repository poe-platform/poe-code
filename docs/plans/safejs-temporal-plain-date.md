# Temporal PlainDate implementation

## Validated gap

Current source-runtime reflection (f0a87e) finds no Temporal.PlainDate binding.
The pinned Test262 PlainDateTime until/since argument-plaindate fixtures fail
because their helper constructs PlainDate before exercising midnight conversion.
This is not resolved by the private storage module alone.

## Private value storage

The initial test-first suite failed on the missing module (0da592). Added owned
ISO year/month/day and canonical calendar storage in a WeakMap. Public values
start extensible with a null prototype and no own properties; frozen private
records remain independent of caller mutation and public getter shadowing.
Allocation requires own numeric data fields, rejects non-integer or invalid
dates without truncating or constraining, and normalizes negative zero.

PlainDate accepts -271821-04-19 through +275760-09-13. Backend boundary probes
confirmed these endpoints and rejected adjacent dates (56f51f); unlike
PlainDateTime, the lower date is not rejected for having no time component.
The normative range operation is
[ISODateWithinLimits](https://tc39.es/proposal-temporal/#sec-temporal-isodatewithinlimits).

Captured native/backend accessors read host private slots without consulting
shadowed getters. Exported host values are tracked for later copying with a
removed prototype; custom prototypes and untracked null-prototype objects are
not silently admitted. Proxy inputs are rejected without invoking traps.
Host export uses native PlainDate when captured, otherwise the maintained backend.

Fourteen new core tests plus fifteen existing PlainDateTime core tests passed
(3359de). All fourteen new tests passed on Node 18.18.2 (707295) and native-
Temporal Node 26.4.0 (aa4efa). Scoped lint passed (14abc8). The maintained
workspace build passed all 23 tasks and five fresh native ESM import checks
(0f6d13). This core has no public CLI visual effect and no public constructor
binding yet; no screenshot or upstream PlainDate conformance pass is claimed.

## Remaining integration

- Add public constructor coercion, newTarget/realm behavior, calendar getters,
  valueOf and formatting with owned result prototypes and resource accounting.
- Wire private brands into object-model copying, host import/export, immutable
  input handling, data-size measurement and structuredClone rejection.
- Add validated heap/replay codecs, preserving aliases, cycles, extensibility,
  own descriptors and symbols without exposing internal slots.
- Implement PlainDateTime.toPlainDate and PlainDate-to-date-time midnight fast
  paths; make calendar conversion and Duration relativeTo use private date slots.
- Implement from/compare/equals, field/calendar replacement, arithmetic,
  differences and conversions, including ordered guest reads and calendar rules.
- Extend Intl formatting/parts/ranges using the private brand, not public
  coercion or a fake timestamp that changes wall-clock fields.
- Run focused regressions, built CLI screenshots for exposed behavior, relevant
  upstream fixture directories and a later full package gate. Missing related
  classes remain explicit gaps rather than skipped passing cases.

No push or release. The release hold remains in effect.

## Data-copy integration

Seven of eight new copy tests failed before integration (041e6a): internal
copies lost private branding, host imports were unsupported, private slot
memory was not counted, structuredClone silently lost data, and clone/export
dropped accessor descriptors without rejecting them. The import-accessor test
was already a passing rejection control; it does not count as a reproduced fix.

Extended the existing date-time data-copy path to cover private PlainDate
slots, preserving own string/symbol descriptors, aliases, frozen cycles and
explicit null prototypes. Host export creates tracked host dates. Added
private-slot memory accounting and structuredClone rejection, and made the
object-state classification treat owned dates consistently with other Temporal
data. Guest host-binding admission and snapshot/replay codecs are not wired yet.

The core/date/date-time selection passed 32 tests (78ddee), and all eighteen
date/date-time copy cases passed on Node 18.18.2 (639ef6). Broader copy checks,
scoped lint and the maintained workspace build are running. The broader nine-file
copy selection subsequently passed all 131 tests (2afd2f). The changes do not
add a public PlainDate binding or a new CLI visual surface.

Scoped lint passed (9e01e8), and the maintained workspace build passed all 23
tasks plus five fresh native ESM import checks (f71b3f). These copy-integration
changes remain uncommitted within the broader Temporal integration; only the
private core is committed as e7a984670. No push or release.

## Snapshot and replay codecs

All thirteen initial codec tests failed (861896): heap and replay round-trips
lost the private brand, and the heap validator did not recognize a date node.
Added explicit guest-temporal-plain-date and temporal-plain-date records with
ISO/calendar slots. Heap restoration and replay decoding preserve frozen
cycles, aliases and own descriptors; replay tests also cover symbol cycles and
explicit null prototypes. Both validators require exact canonical fields and
reject invalid ranges, fractions, wrong types, negative zero, extra slots and
noncanonical calendars.

The first candidate missed validator and restoration dispatch registration.
Focused tests exposed those omissions (a70b1a, a78133); the first build also
failed TypeScript's discriminated-union checks (ca7211). Fixed the registrations
rather than weakening validation or casting away the errors.

The corrected five-file Temporal codec selection passed 84 tests (8f727e).
All 24 date/date-time codec tests passed on Node 18.18.2 (fb112d), and TypeScript
no-emit checking passed (2a0111). Fresh lint and maintained build checks are
running. Public constructor/realm registration and host-binding admission are
still missing, so this does not claim complete PlainDate support. No CLI visual
surface was added, and no new screenshot is required for these internal codecs.

The broader replay-data/heap-validation/data-descriptor selection passed all
54 tests (524d97), and fresh scoped lint passed (95aca2). The earlier failing
candidate was superseded; these results describe the corrected registrations.
The fresh maintained build passed all 23 tasks and five native ESM import checks
(02b76a). Snapshot integration remains uncommitted with the broader Temporal
work. Public constructor and host-binding tests are the next integration step;
no upstream PlainDate fixture failures are claimed fixed yet. No push or release.

## Public constructor and host bindings

All seven new public tests failed before implementation (707ae6): construction
and subclassing were missing, and initial host date bindings were rejected.
Added constructor field coercion/truncation in year/month/day order, strict
calendar arguments, private range validation before newTarget.prototype lookup,
realm fallback, calendar-derived getters and always-throwing valueOf. toString
reads only calendarName; toJSON ignores arguments. Intrinsic methods and the
prototype are registered for replay and realm lookup. Host-binding admission
uses private slots and existing Temporal descriptor/budget rules.

All seven construction/host-result replay tests passed (ac537d). The 28-test
construction/copy/codec selection passed on Node 18.18.2 (8ebc9f), and TypeScript
no-emit checking passed (9dc2ed). Broader Temporal tests, lint and maintained build
are running. README explicitly lists remaining factories, methods, conversions
and private-date fast paths; exposing the constructor does not establish that
its interactions with every other Temporal type are complete.

The broader Temporal selection completed: 1,190 passed, four skipped across
70 files (1d2a87). Scoped lint passed (3276c6); the maintained build passed all
23 tasks and five native ESM import checks (ec9a3a). These selections overlap
earlier tests and are not a full-package gate or upstream conformance pass.
The built CLI probe passed and its screenshot was inspected (66d539), showing
ISO/Buddhist output, the Buddhist year, leap-month length and both date limits:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date.ajs.png`.
Public integration remains uncommitted; no push or release.

## PlainDateTime input integration

Three regressions failed (f0a11f): PlainDateTime.from and differences read
shadowed public date/calendar fields, and PlainDateTime.with accepted an owned
PlainDate as a partial update. Added an owned-date fast path that copies private
ISO/calendar slots and supplies midnight, preserving the existing overflow
option/range-validation sequence. Partial replacement rejects dates before any
public property reads. The 31-test input/difference/with selection passed
(dfe076), and all three new cases passed on Node 18.18.2 (69724c).
Upstream date-argument fixtures, lint, maintained build and CLI checks are pending.

Both pinned upstream until/since argument-plaindate fixtures now pass in both
script modes (4/4, bdb994), on source runtime. Scoped lint passed (d64ed2) and
the maintained build passed all 23 tasks and five native ESM import checks
(077e2d). No complete until/since directory rerun is claimed by these four cases.
Built CLI output was inspected in the screenshot (a9110c): private Buddhist
date conversion produces midnight and a twelve-hour difference without reading
the shadowed year getter. Artifact:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-input.ajs.png`.
Changes remain uncommitted; no push or release.

## Calendar identifier and relativeTo integration

Three new regressions failed (e5684a): calendar conversion rejected owned
PlainDate values, and Duration total/compare/round read public date fields.
The shared calendar identifier adapter now accepts private date calendars.
The relativeTo adapter constructs a backend date from private ISO/calendar
slots, sharing the existing private PlainDateTime path. No public fields or
coercion hooks are consulted for an owned date.

All sixteen focused date/date-time/calendar-relative tests passed (0ef4a7).
Minimum-Node, lint, maintained build and built CLI checks are still running.

The three new regressions passed on Node 18.18.2 (f88e08). The broader
Duration total/compare/round selection passed 91 tests (83e8b3). Scoped lint
passed (ac8f69). These overlapping selections do not establish complete calendar
conformance or a full-package pass.
The maintained build passed all 23 tasks and five native ESM import checks
(0dde86). The built CLI probe passed and its screenshot was inspected
(ba943f), showing private Buddhist calendar extraction, a 29-day month total
and equal month/day comparison despite a throwing public year getter:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-relative.ajs.png`.
Integration remains uncommitted. No push or release.

## PlainDateTime.toPlainDate

Three regressions failed against the absent conversion (70bd78). The method
now allocates a fresh owned date from private date-time slots, discards the time,
preserves the ISO date/calendar and sets the captured intrinsic PlainDate
prototype. Namespace initialization captures that prototype before constructing
PlainDateTime. The method is registered for replay and checkpoints its output.

The conversion/construction/date-input selection passed thirteen tests (0b8a00),
including endpoint dates, shadowed getters, subclasses and replay after public
namespace replacement. All three conversion cases passed on Node 18.18.2
(ba9267). The complete pinned Test262 toPlainDate directory passed eight fixtures
in both modes: 16/16, no exclusions (bc79c9), using the source runtime.
Lint, maintained build and built CLI screenshot verification are pending.

Scoped lint passed (a9be49), and the maintained build passed all 23 tasks and
five native ESM import checks (d0489e). The built CLI probe passed and its
screenshot was inspected (14a190):
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-conversion.ajs.png`.
It shows preserved Buddhist date/year and intrinsic prototype identity despite
a throwing public year getter. Changes remain uncommitted; no push or release.

## PlainDate.withCalendar

The specification requires a fresh date with the same private ISO date and the
converted calendar identifier:
https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.withcalendar

Five new tests failed against the absent method (796957). The implementation
uses the shared calendar identifier adapter, retains its private inputs and
result, assigns the captured intrinsic prototype and checkpoints the new date.
Tests cover strings, calendar annotations, private date/date-time calendar
inputs, throwing public getters, subclasses, invalid receiver/object input,
fresh identity, captured methods and replay after namespace replacement.

Twenty tests passed across the date construction, date/date-time calendar
replacement and relative-date selections (601551). Minimum-Node, lint and build
checks are pending; no full-package or complete conformance claim is made.

The unchanged upstream withCalendar directory at Test262 revision
419d3e0a2273ba01a3bfcbec423f2801425b8e93 ran with sta.js, assert.js and each
declared helper, with YAML frontmatter respected and normal/strict modes.
Result: 26 passed, eight failed, zero exclusions (c33c24). Source inspection
(6c47ba) shows basic.js, calendar-time-string.js and missing-argument.js call
the absent PlainDate.from before reaching withCalendar; calendar-temporal-object.js
constructs the absent PlainMonthDay/PlainYearMonth/ZonedDateTime types first.
Both modes fail for each fixture. These remain failures, not skipped passes;
the full directory must be rerun once the missing APIs exist.
All five focused cases passed on Node 18.18.2 (60de2f).

Scoped lint passed (510e3e); the maintained build passed 23 tasks and five fresh
ESM import checks (6fb5a0). The built CLI screenshot (faaf10) was inspected and
shows 2000-02-29[u-ca=buddhist], year 2543, fresh identity and intrinsic prototype
despite a throwing public year getter:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-calendar.ajs.png`.
The public constructor module and construction tests were previously untracked;
the local public-date commit captures that existing work with calendar replacement.
Namespace, copying and snapshot wiring still include uncommitted integration.
No push or release; the broader objective remains incomplete.

## PlainDate.from

Seven regressions failed against the missing factory (008571). A dedicated
date input reader now handles private PlainDate/PlainDateTime slots, ISO strings
and ordered calendar/date property bags. It never reads time fields from bags.
Calendar bag years are interpreted by the backend; ISO strings retain their ISO
year even with a non-ISO annotation. Expanded years use an equivalent ISO
400-year cycle for grammar checking before options, followed by actual range
validation after options. The factory captures its intrinsic prototype and is
registered for replay.

Nineteen factory/construction/calendar tests passed (ff6e51), including date
endpoints, immediate field coercion, private-slot conversion, option ordering,
fresh intrinsic results and replay. Upstream from/withCalendar fixtures,
minimum-Node tests and typechecking are in progress. Other factories, arithmetic,
replacement, locale integration and date conversions remain incomplete.

All seven new cases passed on Node 18.18.2 (790277); TypeScript checking passed
(73ecce), as did scoped lint (79752b) and the maintained build's 23 tasks and
five fresh ESM import checks (06740a).

The entire pinned Test262 PlainDate/from directory ran unchanged with parsed
YAML frontmatter, sta/assert and declared helpers, in normal/strict modes:
132 passed, ten failed, zero exclusions (3607f6). The five failing fixtures are
argument-zoneddatetime-slots.js, argument-zoneddatetime.js,
calendar-temporal-object.js, order-of-operations.js and overflow-invalid-string.js.
Inspection (76d6fa, aa6abb) shows all require missing ZonedDateTime or the other
missing calendar-bearing classes. In order-of-operations.js, preceding bag and
owned-date/date-time assertions run before the missing ZonedDateTime constructor.
These failures remain part of the total; this is not complete conformance.

The complete withCalendar rerun improved from 26/34 to 32/34 (37e7e6), with
only calendar-temporal-object.js failing in both modes due to absent classes.
The built CLI screenshot (9568a6) was inspected: a calendar-based Buddhist bag
and private copy preserve 2000-02-29/year 2543, and both date endpoints convert:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-from.ajs.png`.
No push or release; other public integration remains uncommitted.

## PlainDate comparisons

Five regressions failed against the absent compare and equals methods (73f632).
Compare converts left then right through the date reader and compares private
ISO year/month/day; equals brands its receiver first, converts the other value,
and requires both ISO date and calendar equality. Neither consults shadowed
public fields of owned values. Both are registered for captured-method replay.
The behavior follows Temporal's compare and equals algorithms:
https://tc39.es/proposal-temporal/#sec-temporal.plaindate.compare
https://tc39.es/proposal-temporal/#sec-temporal.plaindate.prototype.equals

Nineteen focused comparison/from/construction tests passed (29f489), covering
calendar differences, endpoints, argument conversion order, private date-time
conversion, invalid receiver/input and replay. Upstream fixtures, minimum-Node,
lint and maintained build checks are pending. This is not full conformance.

All five comparison cases passed on Node 18.18.2 (2116c5). The unchanged pinned
Test262 directories ran with parsed YAML frontmatter, declared helpers and
normal/strict modes at revision 419d3e0a2273ba01a3bfcbec423f2801425b8e93:
compare 78 passed/six failed; equals 76 passed/four failed; zero exclusions
(fb7e59). Source inspection (6c8972) shows the zoned argument fixtures require
absent ZonedDateTime; the calendar fixtures use checkToTemporalCalendarFastPath,
whose missing-class construction was inspected in aa6abb. These are genuine
remaining interoperability gaps, not passing or excluded cases.

Scoped lint passed (96ccfb); the maintained build passed all 23 tasks and five
fresh ESM import checks (0d8f39). The built CLI screenshot (24895c) was inspected:
same ISO date compares as zero across calendars, equals returns false for the
different calendar, ISO string equality returns true and chronological order is
negative, despite a throwing public year getter:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-comparison.ajs.png`.
No push or release, and no full-package conformance claim.

## PlainDate add/subtract

Seven regressions failed against missing arithmetic methods (a66a52). The
implementation brands the receiver, converts the duration to primitive fields,
reads and validates overflow, then performs backend calendar arithmetic from
private ISO/calendar fields and returns a fresh owned intrinsic date. The
result is checkpointed and methods registered for replay.
Specification: https://tc39.es/proposal-temporal/#sec-temporal-adddurationtodate

Nineteen focused arithmetic/comparison/from tests passed (159b59), covering
month-end constrain/reject, truncation of sub-day time remainders, negative
durations, input-before-options order, private duration/date slots, non-ISO
calendar preservation, range errors, intrinsic identity and replay.
Minimum-Node, lint, maintained build and upstream fixtures are running.

All seven arithmetic tests passed on Node 18.18.2 (71db31). Scoped lint passed
(e8326a), and the maintained build passed 23 tasks and five fresh ESM import
checks (f63e67). The built CLI screenshot (17c247) was inspected and confirms
month clamping, subtraction and whole-day time-duration behavior:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-template-qa.wECZDk-plain-date-arithmetic.ajs.png`.
Upstream add/subtract fixture execution is still active; no result claimed yet.
