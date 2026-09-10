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

## Whole-restore control

A follow-up Node 22.23.2 in-memory probe (853771) serializes a real guest
closure, then points a forged weak-map or weak-set key at its fully formed
scope-frame node. Both whole restores reject with SnapshotValidationError:
`Internal scopes cannot be guest data`, at the collection entry key path.
This uses an existing valid internal record rather than a kind-only placeholder.

Thus the direct node-validator inconsistency does not establish a full restore
admission bug for scope frames. Treat a stricter node check as defense in depth,
not a demonstrated escape repair. Keep the validated host Instant clone defect
ahead of this work; do not change runtime code merely because one validation
layer is less restrictive than another. Other internal kinds have not received
equivalent whole-restore qualification in this probe.

## Valid Promise aggregate records pass whole restoration

At `7e2f89d7c` with the current pending weak integration, read-only probe a87382
captured a real construction environment and real Promise aggregate records.
The construction-environment weak key is rejected by whole-snapshot validation.
However, keys pointing at `aggregate-entry` and `promise-aggregate` records both
survive restoration and are installed in the restored weak map.

Probe c35eb2 confirms all four combinations: WeakMap/WeakSet with either internal
record kind. It starts with a valid collection containing one rooted ordinary
object key; unmodified restoration preserves one key. Only the serialized key
reference is replaced, retaining each map value or undefined-only set value.
All four forged snapshots restore with one weak entry. Records come from:

```js
const c = Promise.withResolvers();
const p = Promise.all([c.promise]);
return () => { c.resolve(1); return p; };
```

This changes the next action: there is now a demonstrated whole-restore
admission defect for internal aggregate records, not merely disagreement between
validation layers. It does not demonstrate a sandbox escape or arbitrary host
access. Scope/construction rejection must remain intact.

After frozen full session 15942 ends, add failing map/set regressions using
these valid internal records plus ordinary-object controls. Restrict weak keys
to guest object kinds and eligible symbols using the existing weak-target
validation, without allowing absent keys. Preserve duplicate checks, symbol
registry rejection and undefined-only WeakSet values. Qualify the pending weak
integration separately from a claim that all snapshot limitations are fixed.

No runtime or test file changed during these probes; the full-gate fingerprint
is unchanged by this documentation update. No fix, push or release is claimed.
