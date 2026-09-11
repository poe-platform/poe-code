---
title: Date copy integrity
---

## Validated failure

Six regression cases demonstrate that Date import and export lose
non-extensibility, including sealed and frozen Dates. Own descriptors already
survive, but allowing new properties means the copied object is no longer sealed
or frozen. This is independent of the separately reproduced Date subclass gap.

## Change and checks

Apply non-extensibility after copying all Date data descriptors on ordinary
import, internal clone, and export. Preserve cycle registration before copying
properties. Do not make structured cloning inherit source non-extensibility;
that API intentionally creates an extensible value. Frozen Date time slots
remain mutable, as in native JavaScript.

Cover all three integrity operations, symbol self-cycles, descriptors, internal
cloning, rejection of added properties, and native time mutation. Run focused
Date, copy, and snapshot regressions, lint and types, the selected workspace
build, and the real harness below with screenshot inspection. The harness is
a guest integrity smoke check; direct boundary tests prove the actual copy fix.
Commit and push this improvement separately and monitor publication while
continuing Date prototype work.

Validation: all 110 focused tests across six Date/copy/snapshot files passed,
as did scoped ESLint and package type checking. The maintained selected build
completed 23 dependency-closure build tasks and four native import smoke tests.
The screenshot runner completed 70 uncached build tasks; its actual harness
passed, and the resulting PNG was visually inspected. The separate Date
subclass regression and native Promise import-policy tests remain unresolved
and are not included in this focused green test count.
