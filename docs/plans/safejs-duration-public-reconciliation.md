# Duration constructor and public-method reconciliation

## Scope

Commit the reviewed, previously pending Duration constructor, duration/partial
input reader, string formatter and seven existing public-method test files.
The private Duration representation, total/round adapters, relative-date reader
and supporting Intl implementation are already committed dependencies.

The constructor defines all ten fields, sign/blank getters, from/compare,
with/add/subtract, negated/abs, round/total, toString/toJSON/toLocaleString and
valueOf. Guest coercion and property access remain inside interpreter adapters;
normalized primitive records cross into backend arithmetic. Owned return values
use the original method realm's prototype and data checkpoints.

No new runtime defect was demonstrated during this reconciliation, so no
speculative algorithm change was made. Existing formatting includes the
previously implemented correction for negative durations rounded to zero.

## Evidence

Reviewed construction, input reading, copying, sign changes, arithmetic,
comparison, formatting, locale handling, rounding and total wiring. The test
files cover numeric and mixed-sign validation order, subclasses, private brands,
shadowed fields, nonconstructible methods, exact field bounds, fractional
precision, negative rounded zero, DST/calendar behavior, and replay.

`npx vitest run temporal-duration` passed 295 tests across 16 files (2d827f).
This includes existing private-state, transport and snapshot integration tests
in the working tree; it is not a standalone committed-tree qualification.

A same-process Node 26.8.1 native/guest probe compared all own string property
names on Duration and its prototype, sorted to avoid asserting initialization
order, together with enumerable/configurable/writable flags and method/getter
names and lengths. All records matched (aa055c). This metadata check is not
proof of arithmetic or full Temporal conformance, and does not cover symbols.

Node 18.20.8 passed all 101 construction/method/with/arithmetic/format/compare
tests across 6 files (b2d100). Package type-checking passed (67bfb9); focused
ESLint on all three implementation files and seven public test files passed
(4eeb7b). Locale tests were included in the Node 22 cohort, not the Node 18 one.

## Remaining integration

The public Temporal namespace wiring and snapshot implementation remain partly
uncommitted. The full-package gate is not green. Skipped-day calendar arithmetic,
Intl extreme ranges/locale portability and other recorded JavaScript gaps are
still unresolved. Pushes and releases remain paused. No visual CLI changes.
