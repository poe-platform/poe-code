---
title: Collection own properties
---

## Evidence and scope

Six initial tests failed for Map/Set assignment, own accessors and guest names
that overlap internal storage. Native JavaScript accepts these operations.

The runtime now uses separate WeakMap-backed guest property tables; internal
brands and entry storage remain frozen and hidden. Lookup, assignment, deletion,
enumeration, descriptors and hasOwn use the guest table. Initial six tests pass.

Direct round-trip tests then exposed ten failures: snapshot/replay/clone/host
copying lost properties, and data-size accounting ignored them. Replay-driven
pending/completed run tests passed despite this loss, so those tests alone are
not proof of persistence. Direct graph round trips are required.

Copying and measurement now preserve own data descriptors, aliases/cycles and
extensibility. Accessors remain disallowed on data-only copy boundaries; public
guest snapshots preserve accessor closures using descriptor serialization.
Snapshot and replay heap nodes now carry optional property descriptor state;
empty ordinary collections retain their previous encoding. Validators reject
duplicate/invalid keys, invalid flags and invalid accessor references. Replay
data rejects accessor descriptors entirely, retaining its data-only boundary.

Eight expanded runtime failures identified deletion admission, freezing the
internal wrapper instead of guest properties, ignored coercion hooks and JSON
enumeration. Those now pass. Twenty-two runtime tests and 30 direct round-trip,
measurement and malformed-state tests pass.

Two native-input tests exposed missing host-to-sandbox descriptor copying; that
path now preserves data descriptors and cycles. Structured clone intentionally
omits custom properties, without invoking accessor getters. Budget checkpoint
tests charge retained accessor-closure captures, not only direct property data.

Two initially reported output failures were invalid tests: `run()` returns a
sandbox value, not a native collection. Using the required `deepCopyFromSandbox`
conversion passes. No output API change was made for that false report.

## Delivery verification

- Maintained package suite and scoped lint/types passed.
- Selected workspace build passed, including four built-import checks.
- Real CLI harness passed; its screenshot was visually inspected. The root
  build completed all 70 tasks uncached.

TypeScript and scoped lint pass. The first full run had 16,512 passes and two
native-input failures captured before that implementation was updated. The final
full run passed 16,516 tests, with 41 skipped; the two additional accessor-budget
tests passed in the 30-test focused snapshot cohort. Incoming disjoint playground
changes were fast-forwarded through 1b309fea1 before the final full run.

Custom prototypes and subclass construction remain subsequent collection work.
Four failing subclass tests confirm missing derived prototype identity and
methods. They were added after the green package run and remain outside this
own-property commit.
