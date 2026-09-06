---
title: Date argument coercion
---

## Validated scope

Four native-oracle cases fail because Date construction, Date.UTC, and Date.parse
reject object arguments without performing JavaScript coercion. Use the existing
sandbox primitive, number, and string conversion machinery. A single Date
constructor argument uses the default primitive hint; an existing branded Date
copies its time without calling hooks. Component arguments use numeric hints,
in order, for only the first seven arguments. Date.parse uses a string hint.

## Verification

Cover accessor lookup and receiver identity, hints, conversion order, abrupt
completion, ignored arguments, fallback conversion, invalid conversions,
BigInt/Symbol rejection, argument defaults, subclasses, parsing limits, fatal
budgets, and pending/completed replay. Date setter coercion is a separate path
and is not claimed by this change.

All 115 focused tests across five Date/runtime/snapshot files passed, along with
scoped ESLint and package type checking. Keep the unrelated native Promise import
policy tests out of this count. Run the maintained selected workspace build and
the real harness below, inspect its screenshot, then commit and push this atomic
fix to main. Continue validating other gaps while monitoring releases.

The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The screenshot runner completed 70 uncached build tasks in 20.097
seconds. Its real harness passed, and the resulting PNG was visually inspected.
