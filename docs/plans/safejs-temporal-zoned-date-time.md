# Owned Temporal.ZonedDateTime implementation

## Reading this record

The entries below preserve implementation-stage observations, including runs
that were live at the time of an entry. They are not all current status claims.
For the latest full-package process, fingerprint and upstream locale result,
see [the current integration gate](safejs-post-zoned-integration-gate.md).
The public integration remains uncommitted. The private core is committed as
5191b81af; documentation commits do not deliver the implementation. Fixed-offset
locale formatting still fails on Node 18; see
[the verified portability gap](safejs-intl-offset-zone-portability.md).

## Owned Duration relativeTo integration

Five new tests failed before repair (d86e3e): public calendar getters were read,
the spring-transition day totaled 24 instead of 23 hours, and distinct overlap
occurrences both totaled 24 hours instead of 25 and 24. The shared relativeTo
reader now recognizes owned ZonedDateTime values before property-bag conversion
and constructs the private backend value from exact epoch, zone and calendar.
This follows GetTemporalRelativeToOption's internal-slot path:
https://tc39.es/proposal-temporal/#sec-temporal-gettemporalrelativetooption

The Duration compare/round/total and relativeTo selection passed 98 tests
(c1a8e9). All five new tests passed on Node 18.18.2 (926ad3). TypeScript passed
(79e383); scoped ESLint passed (0f00bf); whitespace checks passed (133e77).
The source CLI screenshot (07fc2a)
was visually inspected and showed dayInHours: 23 across New York's spring DST
transition. Tests include poisoned public getters and completed replay.
These changes remain local and uncommitted with the public Temporal integration.

Upstream baseline 63958 completed until with 196 passes and two failures across
99 fixtures, both modes, no exclusions (37f386), pinned to test262 revision
419d3e0a2273ba01a3bfcbec423f2801425b8e93. Both failures construct the absent
PlainMonthDay in calendar-temporal-object.js. The run has started since (101
fixtures) and remains live; its code predates the equal-epoch zone correction.

## Locale formatting: latest local verification

Four regression tests first failed against the current implementation (35ffc7):
the inherited Object method returned ISO text, did not brand the receiver, and
ignored locale options. The public ZonedDateTime locale method now canonicalizes
guest locales, reads options through guest operations, and formats private slots
through the backend with only normalized primitive options.

The normative algorithm in
https://github.com/tc39/proposal-temporal/blob/main/spec/intl.html rejects every
defined timeZone option with TypeError before coercion and later option reads.
The shared option reader has an opt-in rejection flag for this method; other
callers keep their existing behavior. Non-ISO calendar compatibility is checked
by the backend after option normalization.

Verification: all four tests failed before implementation; the combined locale
selection passed 37 tests (b04b9f), including existing PlainTime coverage. The
four new tests passed on Node 18.18.2 (b7cfd4). TypeScript (dbc01b), scoped ESLint
(b904d3), and whitespace checks (60a20c) passed. The source CLI screenshot
(0c8902) was visually inspected and displayed December 31, 1969 at 7:00 PM EST
for epoch zero in America/New_York. Tests cover receiver branding, option
ordering, calendar mismatch, private field shadows, and completed replay.

This remains uncommitted with the public Temporal integration. There is no
fresh full-package gate or upstream locale conformance result for this change.
Difference baseline session 63958 remains live (93aa73); it loaded code before
the equal-epoch zone compatibility correction. No push or release was made.

## Validated gap

Source-runtime probe b4a90a returned `ok: true` and `returnValue: "undefined"`
for `return typeof Temporal.ZonedDateTime;`. No public constructor exists in
the current Temporal namespace. The preceding reflection and upstream fixture
audits recorded the dependent date/time conversion failures. This is a real
missing feature, not an inferred bug from a failing test name.

## Constructor and private storage constraints

The [Temporal constructor specification](https://tc39.es/proposal-temporal/#sec-temporal.zoneddatetime)
was inspected on 2026-09-09. Constructor validation must process newTarget,
BigInt conversion, epoch range, time-zone identifier and calendar in order,
before allocating the instance with its requested prototype. Store an owned
brand plus epochNanoseconds, timeZone and calendar privately; do not use public
guest properties as backing storage.

The constructor parses a time-zone identifier, not the broader Temporal
time-zone-like string accepted by conversion methods. Consequently it must not
blindly reuse `parseTemporalTimeZoneString`, which also accepts full date/time
strings. Backend probes b4a90a confirmed these cases:

- `america/new_york` becomes `America/New_York`.
- `+0530` becomes `+05:30`; `-00:00` becomes `+00:00`.
- `+01:00:30` and `2000-01-01T00:00[UTC]` throw RangeError.
- The calendar identifier `ISO8601` becomes `iso8601`.

Backend behavior is supporting evidence only; it does not replace the
specification or upstream conformance tests.

Probe 00d547 additionally verified that both epoch endpoints
`-8640000000000000000000n` and `8640000000000000000000n` are accepted with
`+23:59` and the Buddhist calendar; the adjacent out-of-range values throw.
Do not constrain the instant range by applying PlainDateTime's local date
range checks to this storage constructor.

## Integration inspection

Current source inspection (fa9097, ccb9c3) identifies these required consumers:

- `values.ts`: structured-clone rejection, private-slot resource measurement,
  own-property-aware sandbox copying and host export. Charge the BigInt using
  the existing Instant measurement route, plus zone/calendar string storage.
- `host-bridge.ts` and `object-model.ts`: host admission, default realm
  prototype and distinguishing owned values from ordinary guest state.
- Heap capture/validation/restore and replay-data codecs: encode the epoch as
  a canonical decimal string, following Instant, rather than putting a raw
  BigInt in JSON. Validate the exact record shape, epoch length/range and
  canonical zone/calendar identifiers before allocation.
- Calendar, relativeTo, PlainDate, PlainTime and PlainDateTime input readers:
  consume owned slots without calling overridden guest getters. Their partial
  update guards must reject ZonedDateTime before reading calendar/timeZone.

A supplemental source/native reflection probe (36c529) covered symbol-keyed
constructor and prototype properties of the five existing Temporal types.
The own symbol descriptors matched Node 26.4.0: constructors had none and each
prototype had its non-writable, non-enumerable, configurable toStringTag.
This closes the earlier audit's symbol-key omission for these five types only;
it does not establish algorithmic conformance or cover the missing types.

## Upstream constructor baseline

At pinned Test262 revision `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, the
ZonedDateTime directory contains 20 direct constructor fixtures, excluding its
method subdirectories. Diagnostic d01d83 executed their unchanged sources with
sta.js, assert.js and declared includes in both ordinary and strict script
modes: 6 executions passed, 34 failed, none were excluded. The preceding runner
b54c92 terminated on its first unhandled runtime rejection and supplied no
usable totals; it was corrected to capture each fixture's thrown result.

Crucially, the six passes are vacuous compatibility evidence. Inspection
e60f8e found that calendar-wrong-type.js, constructor.js and missing-arguments.js
only assert TypeError. Calling the absent constructor also throws TypeError,
so their two script modes pass without implementing ZonedDateTime. Retain the
upstream assertions unchanged, but require positive construction and correct
observable evaluation order before counting these as implementation evidence.
The independently validated missing binding explains why this baseline cannot
be presented as partial constructor conformance.

## Implementation and verification sequence

1. After session 29473 finishes, preserve its terminal result and repeat its
   source fingerprint before editing source or tests. Do not restart it simply
   because it is quiet. The previous goal turn verified the same live handle.
2. Write failing private-storage tests: immutable copied slots, exact epoch
   endpoints, invalid primitive types, accessor/proxy rejection without traps,
   canonical identifiers, forged receiver rejection and captured host getters.
3. Implement private storage and narrowly admitted native/backend host objects.
   Follow the existing owned Temporal representation; never expose a backend
   object directly to the guest. Track exported null-prototype host instances
   and reject altered custom prototypes consistently with existing types.
4. Integrate copy/import/export, resource accounting, heap/replay codecs and
   restoration before claiming the public type is usable. Verify own property
   descriptors, symbols, cycles, aliases, prototype and extensibility handling.
5. Add constructor/getters and ordered input conversion with TDD. Add static
   methods, every standard prototype method, and existing Temporal consumers'
   private-slot fast paths, including calendar and relativeTo conversions.
6. Run pinned upstream Test262 fixtures without rewriting their expectations;
   classify failures against their actual execution, not fixture names alone.
   Check Node 18.18.2 and the current native Temporal oracle separately.
7. Run maintained scoped lint/build/tests, CLI screenshot checks for exposed
   behavior, then a fresh full package gate after shared integration changes.

## Private storage implementation

The full package gate finished before this code was added; its evidence is in
safejs-post-plain-date-full-gate.md. Its source fingerprint does not include
this implementation.

The new temporal-zoned-date-time module owns an immutable null-prototype slot
record behind a WeakMap brand. It validates internal data descriptors without
guest coercion, canonicalizes identifiers through the backend constructor and
keeps the full instant endpoint range. Captured native/backend getters admit
host slots without invoking overridden own getters; proxies are excluded and
tracked host exports retain their slots after prototype removal.

TDD evidence: f0d3a6 failed to resolve the absent module before implementation.
The completed private-core selection passed 19 tests on Node 22.23.2 (1dd1fb),
19 on minimum Node 18.18.2 (df5d0d) and 19 on native-Temporal Node 26.4.0
(2a0994). These cover private immutable fields, exact range endpoints,
canonical/invalid zones, accessor/proxy rejection, forged brands and host
prototype handling. TypeScript passed (794870).
Scoped ESLint passed (0167fd). The maintained selected-workspace build passed
all 23 build tasks and five fresh native ESM import checks (1ca37e).

This is private storage only, not public ZonedDateTime support. Copy/budget,
snapshot and public constructor/method integration are still required. There
is no CLI-visible behavior change to screenshot in this increment. Releases
and pushes remain paused; local implementation commits and remote delivery
must be reported separately.

## Copy and resource-accounting integration

New copy tests reproduced seven failures and one pass before integration
(9b6fe8): erased clone/round-trip brands, rejected host input, zero private-slot
cost, missing structured-clone rejection, and skipped own-accessor rejection.
The working changes in values.ts now copy the owned fields alongside ordinary
descriptors, cycles, aliases, symbols and extensibility, export through captured
host constructors, reject structured cloning, and charge the private BigInt
plus zone/calendar strings. Object-state classification recognizes the owned
brand without dropping custom prototype protection.

The private-core/new-copy/PlainDate-copy selection passed 35 tests (79101e);
TypeScript passed (75c465). This integration is not yet committed: the shared
files contain the preceding still-uncommitted Temporal integration and must be
qualified coherently, not silently included as unrelated changes in a narrow
commit. Host binding admission, default public prototype and snapshot codecs
remain next. The public ZonedDateTime constructor is still absent.
All eight copy tests also passed on Node 18.18.2 and 26.4.0 (94a954), and scoped
ESLint passed (d01fa2). No full-package or fresh-build claim is made for these
later shared-file changes.

## Replay-data codec integration

The new replay tests failed 13/13 before the change (397b7a): ordinary replay
encoding erased the private brand, and decoding the new kind was unsupported.
The replay-data codec now preserves canonical decimal epoch strings, zone and
calendar identifiers, aliases, symbol properties, cycles, explicit null
prototypes and frozen state. Decoding validates exact slot membership, types,
epoch spelling/range and canonical identifiers before graph initialization.

The new replay/PlainDate codec/Instant replay selection passed 52 tests
(d0f33d). These are replay-data graphs, not proof of low-level guest-heap
restoration: guest-heap capture, kind validation and allocation remain next.
This shared codec integration remains uncommitted with the preceding Temporal
work; public ZonedDateTime construction and host binding admission remain absent.
The 13 new replay tests also passed on Node 18.18.2 and 26.4.0 (c7e088).
TypeScript (bab682), scoped ESLint (22906b) and diff whitespace checks passed.

## Guest-heap integration

Low-level heap tests independently reproduced 11 failures (482397): capture
lost the private brand and the kind validator rejected the proposed node.
Heap capture now writes the canonical decimal epoch and zone/calendar slots;
both kind registries recognize the node. Validation checks exact fields,
primitive types, epoch spelling/range and canonical identifiers. Restoration
allocates an owned value before restoring ordinary graph state, preserving
aliases, frozen self-cycles and property descriptors.

The heap/replay/PlainDate selection passed 37 tests (8a0772), and TypeScript
passed (bde817). This low-level restoration path and replay-data path are now
both covered, but the public constructor and host binding adapter remain
unfinished. Shared integration changes remain uncommitted, outside the last
full-package fingerprint, and have not been pushed or released.
All 11 new heap tests also passed on Node 18.18.2 and 26.4.0 (2577de).
Scoped ESLint passed (35f029); diff whitespace checks passed (44a723).

## Host-binding admission

Two positive host-binding tests failed with unsupported ZonedDateTime before
the adapter changed (2b7969); two negative admission controls passed. The host
bridge now copies captured private slots into an owned value, charges its
storage, and preserves ordinary string-keyed descriptors, cycles and frozen
state. Own accessors and arbitrary host symbols retain the existing rejection
policy rather than admitting host-private metadata.

The first post-change test used the wrong reader for run() results (c1c2f1).
A direct probe (3cc572) and existing Instant tests confirmed that run returns
sandbox values, not native exports. Correcting the test to inspect owned slots
produced 36 passing host/copy/heap/replay tests (e8af43). The host-result replay
asserts identical slots and aliases while calling the host function only once.
No runtime change was made to accommodate that incorrect test assumption.
TypeScript (01a652) and scoped ESLint (e2b2e7) passed; the public constructor
and default realm prototype still remain to be integrated.
The four host-binding tests passed on Node 18.18.2 and 26.4.0 (8f927c).
The maintained build was started in session 25590 (ac14d5) for the combined
copy/heap/replay/host integration. Poll that handle to completion before
claiming the combined build passed; do not restart a live build.

Session 25590 completed successfully (2dc181): 23 maintained build tasks and
five fresh native ESM import checks passed for the pre-constructor integration.

## Public constructor and getters

Five new public construction tests failed before implementation (6f2e1c).
The working public adapter now provides new-only construction, ordered epoch
coercion/range validation then zone/calendar validation, subclass/newTarget
prototype selection, 28 private-slot-backed getters and rejecting valueOf.
The namespace and default realm prototype route now recognize ZonedDateTime.
The constructor/host selection passed nine tests (4874ed), and the five
constructor tests passed on minimum Node 18.18.2 (4b7677).

The attempted pinned upstream constructor rerun (session 22121, c7ca43)
terminated on a network EPIPE before totals. It is not a completed run.
construction-and-properties failed in both script modes before interruption;
inspection a0d404 shows it invokes the still-missing toInstant method before
most field assertions, and later requires string conversion. Implement those
methods and rerun unchanged fixtures; do not weaken the fixture to claim green.

Current verification handles: constructor-era maintained build session 61790;
TypeScript/scoped ESLint session 80682; source-CLI screenshot session 8819 for
/tmp/safejs-template-qa.wECZDk/zoned-construction.ajs. Poll these exact handles
to completion before claiming success. The README and current inventory now
describe construction/getters as partial working-tree support. Static factories
and remaining prototype methods are still absent; shared integration is not
committed, remotely delivered or released.

Screenshot session 8819 exited 1 (b89457). Visual inspection found a missing
tiny-mcp-client/dist/index.js import while the concurrent maintained build was
recreating dependency output. This did not execute the ZonedDateTime probe.
Rerun the built CLI screenshot after session 61790 finishes; do not change
runtime code in response to this build/diagnostic overlap.

Constructor-era build session 61790 passed all 23 tasks and five import checks
(63bb20). TypeScript/scoped lint session 80682 passed (7f2966). The built CLI
screenshot rerun completed (dcaaad); its image displays Buddhist year 2513,
the +05:30 offset, nanosecond 789 and a 24-hour day. This verifies the visible
constructor/getter probe, not the missing methods or full conformance.

## Conversions to owned Temporal values

Five conversion tests failed before implementation (9f5817). The public
adapter now implements toInstant, toPlainDate, toPlainTime and toPlainDateTime.
Each brands its receiver, reads private slots, creates a fresh owned result,
assigns the captured target intrinsic prototype and checkpoints resource use.
The namespace passes those prototypes directly; replaced public constructor
bindings and ZonedDateTime subclasses do not select result prototypes.

The conversion/construction/host selection passed 14 tests (eba6a3); the five
conversion tests passed on Node 18.18.2 (a38e90). TypeScript/scoped ESLint passed
(51d264). A source-CLI screenshot (9dde92), visually inspected, showed the exact
UTC instant, previous-day Buddhist date, local time and local date-time.
The previous maintained build predates these conversion changes.

Pinned upstream Test262 conversion directories completed (8f7eae, 8e2ad9):
toInstant 12 passed/8 failed; toPlainDate 12/2; toPlainTime 16/2;
toPlainDateTime 18/2. Total 58 passed and 14 failed over 36 original fixtures
in both script modes, with no exclusions. All seven failing fixture sources
were inspected (1eda62, 0f9fa1); each invokes the absent ZonedDateTime.from.
The toPlainDateTime basic fixture first passes its direct-constructor case,
then fails at the factory. Implement from and rerun unchanged fixtures rather
than removing the dependency or calling the conversion suites conformant.

## ZonedDateTime.from

Five focused tests failed before the factory existed (4506d3). The new input
adapter accepts owned slots, strings and property bags; reads/coerces bag fields
through guest operations; and validates disambiguation, offset and overflow in
order. String grammar/identifier checks use an equivalent in-range ISO year
before guest options, while actual epoch interpretation occurs afterward.
The adapter handles required timeZone, optional era fields, strict month codes
and offsets, and retains intermediate values during guest coercion.

The factory/conversion selection passed ten tests (aaf2bd), and the five
factory tests passed on Node 18.18.2 (962458). TypeScript initially rejected the
normalized-bag assertion (c69fc9); the corrected intersection preserves missing
fields for post-option backend validation and passed TypeScript (635ec2).
Scoped ESLint passed (cf73ed). A source-CLI screenshot (fd5f50), visually
inspected, shows the New York overlap resolving to 05:30Z and 06:30Z.

Pinned upstream run 51786 completed (9dfd67, 4b1e26): from has 160 passed and
22 failed over 91 fixtures in both script modes. All four conversion suites
now pass: toInstant 20/20, toPlainDate 14/14, toPlainTime 18/18 and
toPlainDateTime 20/20, with no exclusions. These replace the earlier 14 missing-
factory conversion failures, but do not establish complete Temporal conformance.

Factory failures are in argument-propertybag-function-object,
argument-propertybag-ignores-incorrect-properties, argument-propertybag-monthcode-month,
argument-propertybag-optional-properties, argument-string-basic-and-extended-format,
argument-string-decimal-places, argument-string-negative-extended-year,
argument-string-optional-parts, argument-string-variant-decimal-separator,
calendar-temporal-object and overflow-options, in both modes. Three sources
were inspected (2a75c1): two use assertZonedDateTimesEqual and one calls equals
directly. The helper source (f6f0f1) requires the absent equals method. The other
fixture failures still require source-level diagnosis; do not assume their
cause merely from names or TypeError. All changes remain local and uncommitted.

## Equality and ordering

Four new tests failed before compare/equals existed (1b2923). The adapter now
implements compare by fully converting its first operand, then its second,
and comparing private epochs. Equals brands its receiver before converting
the argument, then compares private epochs, time-zone identity and calendar
through backend values created solely from owned fields.

The comparison/factory/conversion selection passed 14 tests (fdc595), and four
comparison tests passed on Node 18.18.2 (4bfc6d). TypeScript/scoped ESLint passed
(ed1edf). Source-CLI screenshot e6328e, visually inspected, distinguishes UTC
from the fixed +00:00 zone while showing equal epochs and clone equality.

Pinned upstream from/compare/equals rerun session 6380 is terminal. Observed
final totals are from 180 passed/2 failed and equals 104 passed/6 failed.
The compare final output was lost during context truncation; do not infer its
totals. Fixture b529c2 and helper 593a7c
show construction of the missing PlainMonthDay and PlainYearMonth types before
calendar callbacks are executed. This dependency is validated, not a reason
to weaken the factory or helper. Record the completed run before qualifying
these methods; other prototype methods and broad integration remain unfinished.

## withTimeZone

The original pinned compare/disregard-time-zone-ids-if-exact-times-are-equal.js
fixture calls the absent withTimeZone method. This validates a missing dependency,
not incorrect comparison semantics. Four new focused tests failed (4bcf29).
The implementation brands the receiver first, accepts zone strings and owned
ZonedDateTime private zone slots, preserves epoch/calendar, and returns a fresh
intrinsic object with retained-value accounting and checkpointing.

Eight focused zone-change/comparison tests pass (b892ee). The unchanged upstream
comparison fixture now passes in both script modes (5961b4). This does not
qualify the entire comparison suite or the remaining equals failures. Public
integration and README changes are still uncommitted; no push or release.

The four new tests also pass on Node 18.18.2 (bfa1bd); TypeScript and scoped
ESLint finished successfully (faad76). Source CLI screenshot 90a067 was
visually inspected: unchanged instant, +05:30 zone, Buddhist calendar, 05:30
local time. git diff --check passed (49cb4c). These focused checks do not
replace the outstanding broad integration gate.

## withCalendar and shared calendar admission

Six new tests failed on the current implementation (029562): the ZonedDateTime
method was absent, and PlainDate/PlainDateTime rejected owned ZonedDateTime
calendar inputs. The shared calendar reader now accepts private ZonedDateTime
calendar slots. The new method brands first, preserves epoch and zone, and
creates a fresh intrinsic result. The factory uses the shared reader instead
of duplicating its ZonedDateTime calendar branch.

Sixteen focused tests covering this method, the factory and PlainDateTime
calendar changes pass (779e0e). The six new tests pass on Node 18.18.2 (741425).
TypeScript and scoped ESLint passed (e7596e); diff whitespace checks passed
(5fa532), with the unrelated safe-bash staged files unchanged. CLI screenshot
9094e3 was visually inspected: epoch preserved, +05:30 zone, Buddhist year 2513.

Original Test262 withCalendar fixtures at revision
419d3e0a2273ba01a3bfcbec423f2801425b8e93 completed: 16 fixtures, 30 passed,
two failed, no exclusions, both script modes (151493). The failing source
calendar-temporal-object.js was inspected (93773f): it constructs absent
PlainMonthDay and PlainYearMonth objects before invoking withCalendar. This
is a remaining implementation dependency, not a passing conformance result.
Integration and README remain local/uncommitted; releases remain paused.

## ISO and JSON formatting

After withTimeZone/withCalendar, the original equals directory rerun completed
with 108 passed and two failed over 55 fixtures, both script modes, no
exclusions (c052bd). Only calendar-temporal-object still fails while constructing
the absent PlainMonthDay; the previous four other failures no longer occur.

Five new formatting tests failed (c95203), demonstrating inherited generic
Object.toString output and absent toJSON. Formatting now reads owned slots and
normalizes guest options through the shared formatting reader. Zoned mode reads
offset between fractionalSecondDigits and roundingMode, then timeZoneName after
smallestUnit. Recognized disallowed units are rejected after that final read;
invalid unit strings fail immediately. JSON ignores arguments and formats the
default exact representation. Methods are intrinsic-registered for replay.

The formatting selection passed 43 tests (a142ea), including existing PlainTime
and PlainDateTime formatting. Five new tests passed on Node 18.18.2 (e3ca70).
Original Test262 formatting suites at revision
419d3e0a2273ba01a3bfcbec423f2801425b8e93 completed (e8ca91): toString 124/124,
toJSON 22/22, 73 fixtures in both script modes, no exclusions. CLI screenshot
14e052 was visually inspected for exact/JSON/rounded representations; whitespace
checks passed (845bbe). TypeScript/scoped ESLint session 39169 finished
successfully (c06cca). Maintained build session 64054 finished successfully
(f6c5a4): 23 declared build tasks and five fresh-process native ESM import
checks passed. This qualifies the current working tree, not a clean committed
checkout or the complete unit/conformance suites. Changes remain uncommitted.

## startOfDay

Four new tests reproduced the missing method (53a044). The adapter brands
the receiver, computes the local date's first valid instant through backend
values made only from private slots, and returns a fresh intrinsic owned
ZonedDateTime retaining the calendar and zone. Tests cover fixed offsets,
the skipped Sao Paulo midnight of 2015-10-18, private field shadows, ignored
arguments, invalid receivers, subclasses and completed replay.

Nine focused start-of-day/formatting tests passed (435ec7; terminal 2b8efe).
The four new tests passed on Node 18.18.2 (2e3a0c). The pinned original Test262
startOfDay directory completed with all 18 executions passing over nine
fixtures in both modes, no exclusions (31590f). CLI screenshot 82110b was
visually inspected: local 01:00 start, 03:00Z instant and a 23-hour day.
TypeScript/scoped ESLint passed (1ba201), as did whitespace checks (482bbc).
The previous maintained build predates this method. No push or release;
public integration is uncommitted.

## withPlainTime and shared time admission

Five initial tests failed (a70ceb): withPlainTime was absent, and PlainTime.with
consulted public calendar properties of an owned ZonedDateTime instead of
rejecting the Temporal brand. The shared time reader now converts owned zoned
slots to local time, and rejects ZonedDateTime in partial-update mode.

The initial backend withPlainTime delegation failed the added overlap regression
(34c6cf). A direct probe (69d923) confirmed that the backend retained the later
-05:00 offset for New York 2021-11-07 01:30. Current specification withPlainTime
requires compatible disambiguation, choosing -04:00. The adapter now derives
local date-time before guest input conversion and explicitly resolves the changed
local date-time with compatible disambiguation; omitted time uses startOfDay.
It preserves private zone/calendar, validates receiver before guest coercion,
and returns a fresh intrinsic object.

The original pinned Test262 directory passed all 72 executions over 36 fixtures
before the overlap correction (864200). This is evidence of a coverage gap,
not proof of the corrected source: keep the independent overlap regression.
After correction, 16 focused tests passed (7256a2), including PlainTime coercion
and PlainDateTime conversions. A subsequently added completed-replay test and
the other five new tests passed on Node 18.18.2 (c7981d). CLI screenshot 8154ed
was visually inspected and shows the earlier -04:00 overlap result. The first
TypeScript/lint run completed (eb77b2), but source changed while it ran; fresh
session 4753 subsequently passed (a7b43f). All six new tests also passed on
Node 22 (3a5080); whitespace checks passed (74bc98).
No push or release; these changes remain in the uncommitted public integration.

## Zoned rounding

Five tests reproduced missing round (0d6543). The method now brands before
option reads, normalizes day/time units and rounding settings through the
existing guest option reader, rounds private zoned fields, and creates a fresh
owned intrinsic result with checkpoint accounting.

The focused zoned/plain-date-time rounding selection passed 34 tests (63d8e6).
Five new tests passed on Node 18.18.2 (722a06), covering actual 23/25-hour day
progress, gaps/overlaps, increment validation, read order, private fields and
completed replay. The original pinned Test262 round directory passed all 92
executions over 46 fixtures in both modes, no exclusions (3afa61). CLI screenshot
22de06 was visually inspected for short/long day rounding. TypeScript/scoped
ESLint passed (cfbaff), as did whitespace checks (cc6e9a). No push or release.
Public integration remains uncommitted, and complete conformance is unproven.

## Zoned differences

Five new tests reproduced absent until/since (3ab1c7). The adapter brands first,
converts the other input through private zoned storage, checks calendars before
options, normalizes difference settings, and returns an owned Duration with a
captured intrinsic prototype and checkpoint accounting.

Initial implementation failed the equal-instant/different-zone calendar-unit
regression (88dc2d): the backend's zero-difference shortcut skips zone validation.
The adapter now checks time-zone identity for effective calendar-unit differences
after backend option validation and before returning. Directed rounding, elapsed
23-hour versus one-calendar-day behavior, calendar/zone validation order, private
fields and completed replay are covered. After correction 18 focused tests pass
(d43945) and all five new tests pass on Node 18.18.2 (48c7c1).

Source CLI screenshot 662a55 was visually inspected for PT23H/P1D/-P1D. The
first static check finished (ffc24b); the fresh post-correction static check
also passed (2618c2). Original pinned Test262 until/since session 63958 is still
live and loaded the pre-zone-correction source. It has reported two
calendar-temporal-object failures during missing PlainMonthDay construction;
do not infer totals or attribute unseen failures. Record its terminal outcome
as baseline evidence, not post-correction qualification. No push or release;
public integration remains uncommitted.

## Partial zoned updates

Five new tests reproduced missing with (fa9cc7). The shared zoned input reader
now has a partial mode retaining private base fields, rejecting owned Temporal
brands and forbidden calendar/timeZone properties before reading fields,
requiring at least one partial field before options, and using prefer instead
of the factory's reject offset default. Backend calendar-aware merging receives
only normalized primitive fields; guest option reads retain their order.

Ten partial/factory tests pass (e85ad9); five new tests pass on Node 18.18.2
(e0380b). Coverage includes month-code merging and overflow, overlap offset
preference versus ignore, field/options ordering, private receiver slots and
completed replay. CLI screenshot 5765ab was visually inspected for preserved
-05:00 versus compatible -04:00 overlap results. TypeScript/scoped ESLint passed
(00147f), as did whitespace checks (b04d2c). Original Test262 with session 32676
finished: all 82 executions pass over 41 fixtures in both modes, no exclusions
(9bf366). Difference baseline session
63958 also remains live and predates the equal-epoch zone correction. Do not
restart these processes or infer their final totals. No push or release;
public integration remains uncommitted.

## Transition lookup

Four tests failed before getTimeZoneTransition existed (8619ea). The method now
brands the receiver before accessing direction, accepts a direction string or
options object, reads/coerces direction once, validates even fixed-offset inputs,
and searches using backend values constructed only from private slots. Null
results remain null; transitions become fresh owned intrinsic values with the
same calendar/zone and checkpoint accounting.

Four focused tests passed on Node 22 (af69d5) and Node 18.18.2 (128302), including
strict before/after transition boundaries, invalid directions, fixed offsets,
private shadows, subclass results and completed replay. Original Test262 at
419d3e0a2273ba01a3bfcbec423f2801425b8e93 passed all 28 transition executions
(f8b7e4), 14 fixtures in both modes, no exclusions. The corrected withPlainTime
implementation was also rerun: all 72 executions passed (1907ce), no exclusions.
This supersedes the pre-overlap-correction upstream qualification.

Source CLI screenshot ed6228 was visually inspected for previous/next New York
transitions and null fixed-offset results. TypeScript/scoped ESLint passed
(1af9c2), as did whitespace checks (41094a). Changes remain local/uncommitted;
no push or release.

## PlainDate zoned conversion

Arithmetic run 67113 finished (20777d): subtract 82 passed/two failed, 42
fixtures in both modes, no exclusions. Source inspection during focused rerun
9c6c13 distinguishes the dependencies: add needs PlainDate.toZonedDateTime;
subtract first passes its minimum-bound arithmetic assertion, then requires
the still-absent PlainDateTime.toZonedDateTime. Do not conflate these failures.

Four tests reproduced missing PlainDate.toZonedDateTime (1c9dc8). The method
now brands first, reads and validates zone before plainTime, admits owned zoned
zone slots, resolves omitted time to start-of-day and explicit time compatibly,
and returns an owned zoned result. Namespace construction preallocates the zoned
prototype so result identity is captured independently of the mutable constructor.

Nine focused date-conversion/arithmetic tests pass (05e6c8); the four new tests
pass on Node 18.18.2 (eb9594). The original addition overflow fixture now passes
in both modes (9c6c13); subtraction remains blocked by its distinct missing
PlainDateTime conversion, not a proven arithmetic failure. CLI screenshot
fb2418 was visually inspected for skipped midnight and overlap behavior.
Whitespace checks pass (126343). Upstream PlainDate.toZonedDateTime run 6056
finished: all 92 executions pass over 46 fixtures in both modes, no exclusions
(7c5555). TypeScript/scoped ESLint run 16845 remains live; record its outcome.
All changes remain local and uncommitted; no push or release.

## PlainDateTime zoned conversion

The prior PlainDate static checks completed successfully (a717af). Three new
PlainDateTime conversion tests initially failed (bc004c); one contained a missing
brace in its guest test source, which was corrected before the valid red rerun
(e59204). No parser change was made for that test typo.

PlainDateTime.toZonedDateTime now validates the receiver, normalizes and validates
the zone before reading options, reads/coerces disambiguation, and resolves its
private ISO time with compatible/earlier/later/reject behavior. The owned result
preserves calendar and uses the captured zoned prototype, including after public
constructor replacement and completed replay.

Seven focused PlainDate/PlainDateTime conversion tests pass (cb311a), and three
new tests pass on Node 18.18.2 (1e37b9). The pinned original PlainDateTime
toZonedDateTime suite passed all 58 executions over 29 fixtures in both modes,
no exclusions (ea38f0). The previously blocked subtraction overflow fixture now
passes in both modes in the same run. This fixes its conversion dependency;
the full arithmetic suites have not been rerun since the conversion additions.

CLI screenshot 915186 was visually inspected for the two overlap offsets;
whitespace checks passed (f06d9b). Static checks session 38210 and maintained
workspace build session 33210 subsequently passed: static checks d8c3bb,
23 maintained builds and five fresh-process import checks 3dad24. No push
or release; public integration and documentation changes remain uncommitted.

## Zoned input in date factories and partial updates

Six new tests established four failures and two passing controls (1ae344).
PlainDate.from/PlainDateTime.from consulted public zoned calendar/date fields;
both with methods also read properties before rejecting zoned partial inputs.
The readers now convert zoned private epoch/zone/calendar to owned local fields
before option validation and reject the zoned brand in partial mode before
public reads. Overflow controls remain validated and results remain intrinsic.

The five-file factory/update selection passed 65 tests (123cf4), all six new
tests passed on Node 18.18.2 (a78dd8), and TypeScript/scoped ESLint passed
(81e4ac). CLI screenshot 9adf96 was visually inspected for negative-offset
local date/time and preserved Buddhist calendar despite an overridden year
getter. Whitespace checks passed (62cae5). The just-completed maintained build
predates these reader edits. Upstream selected zoned-input run 72971 passed
all eight executions over four original fixtures in both modes (8ce679):
PlainDate argument-zoneddatetime and argument-zoneddatetime-slots, and
PlainDateTime argument-zoneddatetime-balance-negative-time-units and
argument-zoneddatetime-negative-epochnanoseconds. This is selected coverage,
not the complete factory suites.
No push or release; changes remain uncommitted.

## Instant zoned conversion and input slots

Four tests failed before implementation (111e34): missing toZonedDateTimeISO
and public coercion reads for zoned Instant input. The new method preserves
the private epoch, reads a string or owned private zone, uses ISO calendar,
and allocates an intrinsic owned result with checkpoint accounting. The shared
Instant input conversion now admits private zoned epochs for from, compare,
equals and differences without touching coercion hooks.

Nine conversion tests pass (4d0712); all four new tests pass on Node 18.18.2
(ab2f71). The original pinned Test262 toZonedDateTimeISO directory passes all
38 executions, 19 fixtures in both modes, no exclusions (c593c7). CLI screenshot
77de2f was visually inspected: +05:30 local time, exact UTC nanosecond roundtrip,
ISO calendar. TypeScript/scoped ESLint passed (be0ee5), as did whitespace
checks (4c82c4).
No push or release; these changes remain in the uncommitted public integration.

## Zoned arithmetic

Five tests failed before add/subtract existed (b2bb38). The methods now brand
the receiver first, convert duration before observing options, retain primitive
duration fields during overflow coercion, then apply calendar-aware arithmetic
to private backend values. Results preserve zone/calendar and use the intrinsic
prototype, owned storage and checkpoint accounting.

The arithmetic/withPlainTime selection passed 11 tests (133db7); all five new
arithmetic tests passed on Node 18.18.2 (aa24a3). Tests include calendar day
versus 24-hour DST behavior, inverse subtraction, Buddhist month-end constrain
and reject behavior, observable duration-before-options ordering, private field
shadows, subclass results and completed replay. CLI screenshot b7013b was
visually inspected: one day retains noon, while 24 hours reaches 13:00 across
the spring transition. Whitespace checks passed (40b55e).

TypeScript/scoped ESLint run 40259 passed (7843cb). Pinned upstream add/subtract
run 67113 is still live. Its add directory completed: 84 passed, two failed,
43 fixtures in both modes, no exclusions (cd626c). Failing fixture
overflow-adding-months-to-max-year.js was inspected (da54a0); it calls the
absent PlainDate.toZonedDateTime before either arithmetic assertion. This is
a validated missing conversion dependency, not an arithmetic repair target.
Subtract totals are still pending; continue polling the same handle.
These additions remain uncommitted with the public Temporal integration.
