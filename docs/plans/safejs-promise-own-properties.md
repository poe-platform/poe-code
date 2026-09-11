---
title: Promise own properties
---

## Validated failures

Promise own-property assignment and descriptor lookup initially rejected. Eight
expanded runtime/checkpoint tests failed before implementation. Subsequent
tests reproduced missing deletion support, freezing the internal wrapper rather
than guest properties, omitted JSON properties, rejected object spread, ignored
own string-coercion hooks, and lost properties and aliases on native export.

## Implementation

Keep promise execution wrappers frozen. Store JavaScript-visible properties in
a weakly keyed guest property table. Route descriptor lookup, member calls,
assignment, deletion, own-property checks, enumeration, integrity operations,
JSON, object spread and coercion through that table. Count retained property
graphs and accessor closures against the data budget.

Native export copies own data descriptors and extensibility, preserves aliases
and self-cycles, and retains normal settlement behavior. Accessors still cannot
be copied through this data-only boundary.

## Validation

Thirteen new tests pass. The existing promise compatibility/generic/runtime
cohort passed 139 tests; JSON and spread checks passed 35 tests before later
export/coercion additions. Run the full SafeJS workspace suite, scoped lint and
types, selected workspace build, and this real CLI harness. Visually inspect
the screenshot. No agents or external capabilities are required.

The full workspace suite passed 16,638 tests with 41 skipped. Scoped lint and
TypeScript passed. The next Object.assign regression tests were added after
this run and remain outside this commit and its green count.
The selected build passed all four built-import checks. The real CLI harness
passed and its screenshot was visually inspected; its root build completed
all 70 tasks uncached.

## Remaining boundaries

The checkpoint tests cover public pending/completed replay. They do not prove
direct low-level promise graph serialization or imported host promise own
properties. Those need separate validation and implementation. Promise
prototype inheritance and constructor/species behavior also remain distinct
from supporting own properties.

Read-only probes confirmed two follow-ups: importing a native promise with a
label property drops the label, and Object.assign rejects Promise, Map and Set
targets before reaching their supported property setters. The latter is a
shared target-validation issue and should have its own atomic fix.
