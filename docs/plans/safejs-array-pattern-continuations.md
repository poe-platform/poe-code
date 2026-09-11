---
title: Partial array-pattern continuations
---

# Partial array-pattern continuations

## Confirmed defect

Five direct regressions fail across declaration, assignment and for-of
destructuring. After a later default yields, restoration repeats earlier
bindings or reference effects. This causes redeclaration errors and duplicate
key/default side effects. Two new for-in target cases encounter the same
underlying defect; merely expanding the parser is not complete delivery.

## Required state

Preserve the acquired destructuring iterator, current element index, iterator
done status, and whether suspension occurred while preparing the assignment
reference or after reading the current element. After the read, preserve the
current value and any prepared member reference so a default expression can
resume without preparing the reference or reading the element again.

Reuse the portable iterator records introduced for for-of. Do not restore by
replaying previous next calls or by suppressing initialized-binding errors:
both repeat observable effects. Wire this through PatternContext so nested
patterns retain outer continuation state. Validate source ancestry and element
position in snapshots, and keep internal scopes out of guest data.

## Verification

The implementation passes 53 focused cases covering sync/async generators,
nested patterns, holes, rest targets, prepared member references, cached iterator
methods and closing. Seven additional public snapshot validation cases pass,
including malformed positions, phases, done flags, references and protocols.
The custom iterator fixture explicitly provides sandbox Symbol bindings.

The maintained SafeJS unit route passed 15,591 tests (41 skipped), without
exclusions. One obsolete rejection test was replaced with a positive execution
assertion. Changed-file lint, package types, the selected workspace build,
maintained skill sync and skill validation passed. The CLI harness passed with
zero spawns; its screenshot was inspected without warnings.
No publication is claimed by this document.

## Separately confirmed remaining gap

A declaration initializer containing an observable function call still runs
again before a partial pattern resumes. A direct restoration probe returning
`[count,first,second]` produced `[2,2,4]`, versus native `[1,2,4]`. The acquired
iterator and partial bindings are retained by this change, but preserving the
declaration/assignment source value requires a separate continuation fix.
That follow-up is tracked in `safejs-pattern-source-continuations.md`.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-array-pattern-continuations.md` and inspect the PNG. Expect a
passed harness with zero spawns, no warnings, and the asserted for-in and
destructuring results. This pair grants no capabilities. Portable restoration
is covered by the unit tests, not by this CLI smoke check.
