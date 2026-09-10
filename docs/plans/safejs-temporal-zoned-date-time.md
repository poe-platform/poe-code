# Owned Temporal.ZonedDateTime implementation

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
