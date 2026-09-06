---
title: Date structured cloning
---

## Validated scope

Four native-oracle failures show that structuredClone copies Date own properties,
rejects Date properties containing functions/accessors, and rejects Date subclasses.
Structured cloning of a genuine Date copies its time value, not its properties or
custom prototype. Restrict the managed-state exception to branded sandbox Dates
in structured-clone mode; return the new Date before traversing properties.
Keep identity registration so repeated Date references remain aliased.

## Verification and boundaries

Cover ignored data/symbol/accessor/function properties, invalid and frozen Dates,
null/custom prototypes, aliases shared with Maps and Sets, skipped conversion
hooks, and pending/completed replay. Ordinary Date copies still preserve data
descriptors and integrity and reject accessors/custom non-null prototypes.

An expanded oracle exposed a separate implementation error: Date.prototype is
currently branded as a Date, but native behavior and ECMAScript 2026 define it as
an ordinary object without a DateValue slot. Four corrected regressions are kept
separately for the next atomic fix; do not describe Date.prototype as a genuine
Date or count those failures as passing in this change.

All 135 focused Date/copy/snapshot tests across seven files passed. Run scoped
lint/types, selected workspace build, and this real CLI harness with screenshot
inspection. Commit and push independently, then continue the validated prototype
brand correction while monitoring publication. The native Promise import-policy
tests remain separate and unresolved.

Scoped lint/types passed. The selected build completed 23 dependency-closure
tasks and four native import smoke tests. The screenshot runner completed 70
uncached build tasks in 20.295 seconds; its actual harness passed and the PNG was
visually inspected. The four Date.prototype regressions are not part of the
passing count above.
