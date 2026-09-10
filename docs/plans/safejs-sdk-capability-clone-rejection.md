# SDK structured-clone capability rejection

## Validated mismatch

Live and revoked guest-reference tests returned TypeError instead of the guest
serializer's DataCloneError in structured-clone mode (ada09c). Keep the existing
capability rejection and select DataCloneError only for structured cloning.
Tests cover direct and nested references, confirm no activation callback runs,
and retain ordinary-copy TypeError as a control. No capability contents are
admitted or traversed by this repair.

## Verification

- Node 22: 184 tests pass in 18 filename-selected structured-clone files.
- Package TypeScript no-emit check passes.
- Node 18.18.2: both capability regression cases pass.
- Focused lint passes for values.ts and the new regression file.

## Separate validated weak-state gap

A read-only source-runtime probe (025c7a) finds that low-level structured cloning
accepts newly constructed WeakMap, WeakSet, WeakRef and FinalizationRegistry
values. Native Node 22 structuredClone rejects all four with DataCloneError.
The weak-state brand maps and their integration are still uncommitted. Repair
this admission gap with failing regressions while reconciling those dependencies;
do not count it as covered by the passing filename-selected suite above.

Only the capability error-selection change, its tests and this plan belong in
this local commit. Preserve unrelated values.ts and staged Safe Bash changes.
No full conformance or clean full-gate claim; broader integration remains open.
No CLI appearance changes. Release hold remains active: no push, publication or
issue closure.
