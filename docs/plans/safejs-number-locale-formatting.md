---
title: Numeric locale formatting
---

# Numeric locale formatting

## Validated gap

Two native-oracle tests fail because Number.prototype.toLocaleString and
BigInt.prototype.toLocaleString are absent. Cases include currency formatting
and a BigInt beyond the exact Number range. Keep the BigInt value exact; do not
convert it to Number before native formatting.

## Implementation requirements

Share a numeric locale formatter between the Number and BigInt entry points.
Check the receiver brand before reading locales/options. Reuse guest locale-list
canonicalization and property/string coercion, passing only canonical strings,
primitive options and the exact numeric value to native ICU. Expose proper
zero-length guest method metadata. Preserve boxed-receiver behavior and budgets.

Follow the published NumberFormat option order and conditional coercion, not a
blanket eager conversion of all option values. Read style/currency/unit options
with required-field and validity checks before later getters. Read notation,
then minimumIntegerDigits; capture the four raw fraction/significant digit
options before roundingIncrement/roundingMode/roundingPriority/trailingZeroDisplay.
Only then coerce digit values that the selected precision mode actually needs.
Ignored raw digit values must never be copied into the host. Validate digit
combinations before reading compactDisplay/useGrouping/signDisplay.

Check currency-dependent defaults, compact/scientific notation defaults,
rounding increments and priorities against the published algorithm. Native
runtime shortcuts or older defaults are not authoritative where they differ.
Preserve booleans versus strings for useGrouping and do not silently drop
supported formatting options to make basic tests pass.

Primary sources:

- https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/numberformat.html
- https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/locale-sensitive-functions.html
- https://raw.githubusercontent.com/tc39/ecma402/es2026/spec/negotiation.html

## Verification

Expand failing tests before implementation: exact large integers, NaN/infinities,
negative zero, currencies/units/percent, numbering systems, notation, rounding,
grouping/sign display, every getter/conversion phase, skipped digit coercion,
invalid receiver precedence, exception identity, pending/completed replay and
work/output/data limits. Run the maintained Number, BigInt, boxed and Intl
cohorts, lint/types, selected build and a screenshot-inspected real harness.
Commit and push this improvement independently while monitoring releases.

## Results

The original two missing-method probes failed before implementation. The
expanded numeric suite now has 63 passing cases; the maintained numeric,
boxed, Date-locale and guest-collation cohort has 332 passing cases across nine
files. A further red test exposed missing work accounting for long unit names;
the formatter now charges before native validation. Scoped ESLint and the
SafeJS TypeScript check pass.

The selected workspace build completed 23 declared dependency-closure builds
and four import smoke tests. The actual harness passed and its PNG was visually
inspected; its root build completed 70 tasks with zero cached results.

Node 22.23.2 uses currency-specific fraction defaults for scientific and
engineering notation. The published 2026 algorithm instead uses 0–3 fraction
digits outside standard currency notation; explicit defaults preserve that
behavior without losing native ICU localization. Native output oracles for
these two cases therefore specify those defaults explicitly.

The unrelated native-Promise import-policy probes remain unresolved and are
not included in this focused validation. Two newly validated Array locale
conversion failures are recorded separately for the next atomic improvement.
