---
title: Symbol values in JSON replacers
---

Native comparisons reproduced rejection of Symbol values before the JSON
replacer callback could inspect them. Admit Symbol primitives into the existing
callback argument path without coercion or identity changes. Preserve the
standard omission of unconverted Symbol values, null array placeholders, and
exclusion of Symbol-keyed properties.

Cover root/object/array inputs, callback keys and holder identity, toJSON-produced
Symbols, replacer errors, and Symbol return values. Run package tests, lint,
types, selected build, and the skill-guided no-capability CLI harness with actual
screenshot inspection. Commit and push this improvement separately, then monitor
release publication without delaying the next validated gap.
