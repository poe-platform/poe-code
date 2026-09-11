---
title: Partial object-pattern continuations
---

# Partial object-pattern continuations

## Validated defects

Six sync/async generator regressions failed before implementation: restoration
redeclared an earlier binding, reread an earlier getter, and reevaluated a
computed property key. The latter two repeated observable side effects.

## Implementation

Preserve the property index, key/reference/binding phase, evaluated key,
already-excluded rest keys, read value and prepared assignment reference.
Resume only the unfinished operation. Encode symbols and guest references
through the heap, retain their resource roots, and validate the continuation
against the suspended property's source ancestry.

## Verification

Focused cases cover nested array/object patterns, repeated suspension,
computed and symbol keys, assignment references, rest targets and for-of
bindings. Public snapshot validation rejects unrelated positions/phases,
invalid keys and excluded keys, missing state and unpaired references.
All 31 focused cases pass. Changed-file lint, package types, selected workspace
build and the skill-guided CLI harness passed. The screenshot was inspected:
zero spawns and no warnings.

The initial full route passed 15,641 tests (41 skipped). A rerun overlapped the
CLI build and failed when child imports encountered a temporarily missing
`tiny-mcp-client/dist/index.js`; one camera case also timed out. Final verification
must run after builds have finished, without increasing the test timeout.
The affected camera/integration cohort then passed all 14 tests, and the final
maintained package run passed 15,641 tests (41 skipped), without exclusions or
timeout changes. Remote delivery and publication are tracked separately.

## Visual QA

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-object-pattern-continuations.md` and inspect the PNG. Expect
a passed harness with zero spawns and no warnings. The skill-guided pair grants
no capabilities. Unit tests, rather than this CLI smoke run, verify portable
restoration and reference identity.

## Next validated gap

A completed default initializer still runs again if its nested binding pattern
yields. A direct restoration probe of
`const {first:{second=yield 1}=input()}={}` returned a call count of 2, while
native execution returned 1. Preserving default-expression results requires
its own continuation state; the property-read value alone is insufficient.
That follow-up is tracked in `safejs-pattern-default-continuations.md`.
