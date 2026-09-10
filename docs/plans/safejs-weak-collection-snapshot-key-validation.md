# Weak-collection snapshot key validation

## Evidence

A read-only Node 22.23.2 probe against the current source (e4fcb5) creates an
empty weak-map snapshot, then supplies an entry referencing each of five heap
record kinds: scope-frame, construction-environment, thenable-state,
guest-script and promise-aggregate. `validateGuestHeapNode` accepts all five.
The probe mutates only in-memory data; it does not change runtime/test files.

The weak-collection branch calls `reference(entry[0])` without an allowed-kind
list. In contrast, the existing `weakTarget` helper restricts WeakRef and
finalization targets to the guest object-kind catalogue or symbols and rejects
registry-owned symbols. Internal execution records are not guest weak keys.

This establishes a node-validator gap, not successful whole-snapshot restore
or an exploitable escape. The forged records in this probe contain only a kind;
whole-snapshot validation can reject them for other reasons.

## Follow-up after the frozen full run

Keep runtime/test sources unchanged while session 36884 is live. Add failing
validator regressions for both map and set entries, with valid object/symbol
controls. Reuse the existing weak-target admissibility rules while retaining
the required-key check, duplicate rejection, registered-symbol rejection and
undefined-only weak-set values. WeakRef permits an absent target; collection
entries must not inherit that permission accidentally.

Qualify focused weak collection/reference/finalization snapshot tests and
TypeScript/lint. Record separately whether a fully formed internal record can
pass whole-snapshot validation; do not overstate the direct-validator finding.

No fix or release is claimed. The release hold remains active.
