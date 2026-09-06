---
title: Generator object continuations
---

## Validated gap

Restoration repeated completed object property values and computed keys. Native
comparison of `{a:count++,b:yield 1}` returned count=1, a=0, b=4; the restored
generator instead returned count=2, a=1, b=4. Fourteen sync/async cases failed
before the fix, covering spreads, computed keys, accessors and prototypes.

## Change

Retain the partial object's identity, current property index, and the property
key only after that key has been evaluated. Resume from that property without
rebuilding the earlier properties. Snapshot validation checks both the exact
property index and whether suspension occurred before or after key evaluation.
Forged key phases are rejected.

## QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-generator-object-continuations.md` and inspect the screenshot.
The harness must pass with count=2, property a=0 and property 1=4, no warnings,
and zero spawns. It grants no external capabilities. Independent repeated
low-level restoration is covered by native-comparison unit tests, not inferred
from this CLI smoke check.

## Verification

The full maintained SafeJS package suite passed 15,294 tests with 41 existing
skips (425 passing files and one skipped file). The new file includes 14
sync/async native-comparison cases and two forged key-phase rejection cases.
Focused ESLint and package types pass. The maintained selected-workspace build
passed, including four native built-import checks. The CLI harness passed with
zero spawns; its screenshot was inspected and showed no warnings or errors.
