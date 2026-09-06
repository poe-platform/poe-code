---
title: Ordinary Date prototype
---

## Validated correction

Four native-oracle failures show that Date.prototype wrongly carries an internal
Date time value. The published ECMAScript 2026 specification defines it as an
ordinary object with no DateValue slot. Native Date.prototype.getTime(), Date
construction from Date.prototype, and its default toJSON call therefore throw;
structuredClone(Date.prototype) produces an ordinary object, not an invalid Date.

Replace the branded prototype allocation with an ordinary sandbox object. Store
it in the normal intrinsic prototype map, removing the special Date self-prototype
case and unnecessary Date unions in intrinsic-registration types. Genuine Dates
retain their brand, shared prototype graph and subclass behavior.

Correct the earlier date-prototype-graphs plan, which repeated the mistaken
assumption. Update the persistent-realm isolation test to mutate an ordinary
prototype property instead of calling setTime on a non-Date. Preserve its checks
for separate instance values and separate prototype state; add explicit method
brand failures rather than perpetuating the invalid expectation.

## Verification and delivery

The 223 focused Date tests across eight files pass, including all maintained
non-generic Date methods, ordinary object tagging, constructor conversion,
structured cloning, ignored coercion on invalid receivers, subclass behavior,
and pending/completed replay. Run the full maintained SafeJS suite with the
unresolved native Promise import-policy file explicitly excluded, lint/types,
selected workspace build, and the actual harness below with screenshot inspection.
Commit and push this correction independently, monitoring release publication
while investigating further validated gaps.

The maintained suite passed 16,994 tests with 41 skips across 494 passing files
and one skipped file in 111.49 seconds. Only the native Promise import-policy
file was explicitly excluded. Scoped lint and package types passed. Six Date
static-function property failures were created and reproduced after broad suite
collection; they are the next separate issue and are not counted as passing.
The selected build passed 23 dependency-closure tasks and four native import
smoke tests. The screenshot runner completed 70 uncached build tasks in 22.863
seconds; the actual harness passed and its PNG was visually inspected.
