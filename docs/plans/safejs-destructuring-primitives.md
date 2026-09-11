---
title: Primitive object destructuring
---

# Accept primitive object-pattern sources

Eleven native-comparison tests failed under the previous object-only guard;
two nullish-error controls already passed. The current property readers and rest
copy helpers already implement primitive access and string key enumeration.
Reject only null and undefined at the pattern boundary, retaining primitive
receivers for inherited getters. Do not box the source once and accidentally
change getter receivers. Update the nullish diagnostic and matching assertions.

Controls cover string properties, rest exclusion, UTF-16 indexed keys, number
defaults, booleans, Symbols, primitive getter receivers, assignment, parameters,
nested patterns, and rejection before computed keys for nullish sources.

All 34 focused tests pass, including all thirteen new native comparisons.
Evidence: /tmp/poe-safejs-destructuring-primitives-red.log and
/tmp/poe-safejs-destructuring-primitives-focused.log. Run maintained package tests,
scoped lint/types, a workspace build, and the paired real harness screenshot
before committing and pushing this change independently to main.

The earlier iterator-destructuring delivery 14e485a2c is published as
@poe-platform/safe-js@0.1.163 by successful scoped run 34025283929.
Publication of subsequent syntax/reference-order commits remains monitored.

Next validated gap: a matcher object with `[Symbol.hasInstance](value)` returning
`value === 7` makes `7 instanceof matcher` true natively, but current SafeJS throws
TypeError: "Right-hand side of 'instanceof' is not a function." This is separate
from primitive object destructuring and needs its own failing tests and fix.

The maintained package suite passed 13,978 tests with 41 skips. TypeScript and
scoped ESLint exited zero. Evidence:
/tmp/poe-safejs-destructuring-primitives-package.log,
/tmp/poe-safejs-destructuring-primitives-types.log and
/tmp/poe-safejs-destructuring-primitives-eslint.log.

The selected workspace build passed (23 builds and four fresh-import checks).
The real harness screenshot was inspected: Harness passed, zero spawns, readable
results. Evidence: /tmp/poe-safejs-destructuring-primitives-build.log and
/tmp/poe-safejs-destructuring-primitives-screenshot.log.
