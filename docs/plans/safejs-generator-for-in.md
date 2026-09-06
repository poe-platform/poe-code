---
title: Generator for-in restoration
---

# Generator for-in restoration

## Evidence and implementation

Repeated restoration repeated enumeration entries and right-hand effects,
rebound modified loop variables and could skip the suspended body after its
current property was deleted. Sixteen sync/async restoration regressions
initially failed; all now pass. Two additional cases exposed the separate
parser gap recorded in safejs-for-in-target-gap.md, not a restoration defect.

Preserve the original enumeration object, key list, current index and iteration
scope. Resume the current body without repeating membership checks or binding;
continue normal property checks for later keys. Snapshot validation restricts
scope references to internal fields and checks key/index structure and source
ancestry.

## Verification

Twenty sync/async restoration cases and five public snapshot validation cases
pass. The maintained package test route passed 15,493 tests (41 skipped), with
only `**/guest-generator-iteration-continuations.test.ts` excluded: that
uncommitted file contains the next for-of fix's regression. Changed-file lint,
package types and the selected workspace build passed. The skill-guided CLI
harness passed with zero spawns; its screenshot was inspected with no warnings.
Release publication is tracked independently from local checks and delivery.

## Visual QA

Run `npm run screenshot-poe-code -- harness run docs/plans/safejs-generator-for-in.md`.
Inspect a passed harness with zero spawns and no warnings. The skill-guided
pair grants no capabilities and checks enumeration after deletion. Repeated
low-level restoration is verified by unit tests, not inferred from this smoke.
