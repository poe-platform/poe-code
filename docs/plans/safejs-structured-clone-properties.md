---
title: Structured clone guest accessor validation
---

# Validated structuredClone property gaps

Built SDK probes on 2026-09-07 confirm two mismatches with native JavaScript:

- An enumerable guest getter returning 7 is never invoked; SafeJS throws TypeError
  instead of returning a clone containing 7 after one getter call.
- An enumerable symbol-keyed data property is retained rather than omitted.

The generic copy helpers in interp/values.ts enumerate string and symbol keys and
reject accessors before cloning. Those semantics are needed for capability-safe
host imports and must not be relaxed globally. Structured cloning needs its own
property selection and guest accessor evaluation semantics.

Add failing regressions before changing implementation. Cover ignored symbol
getters and values, enumerable string getters, property deletion during traversal,
cycles, shared backing references, thrown getters, budgets and transfer ordering.
Transferred buffer bytes may change during getter evaluation: do not detach or
freeze their bytes too early. Preserve native host-accessor rejection outside
explicit guest accessor invocation.

Symbol-key omission was delivered separately in 7a34bc066. The six regressions in
structured-clone-accessors.test.ts all fail against that commit (2026-09-07):
normal getters, cyclic getter results, deletion/addition during traversal,
depth-first getter ordering, transfer-time byte mutation, and thrown getter
propagation. These are the next implementation target; no getter fix is present
yet at that baseline. Native expected transfer bytes are read after getter evaluation.

## Implementation

A generator-based graph traversal suspends for guest accessor reads and remains
synchronous for ordinary data. Snapshot enumerable string keys before reads;
check ownership again before each read. Traverse results depth-first, retaining
partially built graphs and map/set entry snapshots across getter execution.
Reject uncloneable values at their traversal position, not after later getters.
Preserve ordinary host-import accessor rejection.

Transferred buffers use destination placeholders during serialization. Refresh
their bytes and resizable length after getters, before the preflight and ordered
ownership-transfer pass. Non-transferred buffers are copied when first visited.

Charge primitive limits during traversal and reconcile retained memory before
getter invocation. Two regression tests caught late string/data budget checks.
All ownership-loss operations still follow fallible SafeJS budget preflight.

HTML StructuredDeserialize restores view internal slots directly. The explicit
out-of-bounds DataView regression follows that algorithm: a later getter may
shrink a transferred resizable buffer after the view has been serialized.
Node 22 instead throws `Error: Unable to deserialize cloned data` after detaching
the buffer, so it is not the oracle for this case.

## Manual validation

Run `npm run screenshot-poe-code -- harness run
docs/plans/safejs-structured-clone-properties.md` and inspect the PNG. This tests
the real harness runner without model spawns. Check the built SDK on Node 18,
public snapshot restoration, related clone tests, TypeScript and ESLint.

## Validation so far

- Six original getter regressions failed before implementation.
- Expanded coverage: 17 getter tests, including transfer resize/byte timing,
  collection snapshotting, error ordering, memory checks and public snapshots.
- Maintained package run: 18,861 passed, 41 skipped, two failed in 307.38 seconds.
  The unresolved Promise-import policy probe was explicitly excluded, not passed.
- Both failures were regressions introduced here: lost error branding and lost
  hardened null-prototype preservation for imported JSON. Restored both existing
  behaviors, then reran the two failing files and related clone tests: all 103
  tests passed across six files. The initial package run itself was not green.
- Final TypeScript and ESLint checks passed.
- The real harness passed after 70 uncached build tasks; screenshot inspected.
- Node 18.18 built SDK getter/transfer probe returned `[1,true,true,7]`, confirming
  one getter read, detached original, cyclic identity and retained mutated byte.
- No matching open GitHub issue was found.
