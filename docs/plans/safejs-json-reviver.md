---
title: JSON revivers and source context
---

## Validated gap

Eight regression cases failed because JSON.parse ignored its reviver. A separate
test showed that its declared length did not include the second parameter.

## Implementation

Validate JSON grammar natively, then capture source records with a bounded token
reader. This works on Node 18 as well as newer hosts with native source context.
Build the parsed graph and visit guest properties in postorder,
calling the reviver with the holder, key, current value and a fresh context.
Preserve source only for SameValue matches with the original parse record.
Snapshot keys and array length at entry; read current values during traversal.
Ignore failed deletion/redefinition, but propagate callback errors. Bound work,
depth and allocated values; retain original values until traversal completes.

The normative reference is
[InternalizeJSONProperty](https://tc39.es/ecma262/multipage/structured-data.html#sec-internalizejsonproperty).
Node 22 retains source when -0 becomes +0; the specification uses SameValue and
requires invalidation. An explicit test follows the specification rather than
using that native result as an oracle.

## Verification

Cover primitive source spellings, duplicate keys, __proto__, receiver binding,
deletion, holes, getters, mutations, non-configurable properties, async callback
results, pending/completed checkpoints, host-effect replay and fatal budgets.
Run maintained package tests, scoped lint/types, selected build and this real
CLI harness; inspect the screenshot before pushing.

- Focused reviver tests: 40 passed.
- Scoped ESLint and TypeScript checks pass.
- Maintained SafeJS package suite: 15,966 passed, 41 skipped.
- Selected workspace build and real CLI harness pass. The inspected screenshot
  shows Harness passed, with zero spawns.

## Next validated gap

Runtime probes return undefined for both JSON.rawJSON and JSON.isRawJSON.
Raw JSON values, stringify integration and checkpoint branding need their own
atomic implementation, with validation against the same normative JSON section.
