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
