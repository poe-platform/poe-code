---
title: Object.assign built-in targets
---

Sixteen target-validation regressions initially failed across Promise, Map,
Set and RegExp instances. Object.assign now uses the existing mutable-property
validation rather than a narrower target predicate. Keep live host objects on
their existing bridge path; descriptor access is not the host mutation API.

Tests cover identity, setters and their receiver, no-op assignments on
non-extensible targets, rejection of new properties, and preservation of
earlier writes when a later property is read-only. The focused Object,
accessor, extensibility, promise and host-bridge cohort passed 175 tests across
six files. Scoped lint and TypeScript passed. Run the selected workspace build,
then this real CLI harness and visually inspect its screenshot.

The selected build passed all four built-import checks. The real CLI harness
passed and its screenshot was visually inspected; its root build completed
all 70 tasks uncached.

The symbol part of four expanded cases exposed a distinct Object.assign bug.
Those assertions are preserved in a separate regression file, including an
ordinary-object case: five tests fail because symbol keys are omitted. Keep
that fix in the next atomic commit, not in this target-validation change.
