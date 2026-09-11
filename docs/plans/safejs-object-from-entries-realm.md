# Object.fromEntries result realm

## Reproduction

Five SDK tests failed before the fix. A different run's Object.getPrototypeOf
resolved a result against its own realm rather than the creator's realm.
The same problem affected direct synchronous calls to the exported intrinsic.
After modifying the originating Object.prototype, data copying silently lost
that guest behavior instead of rejecting the copy.

Native VM controls check default prototype identity and own descriptors for
empty entries, ordinary entries, duplicate keys, and an own __proto__ key.
SDK tests cover results created during a run and after its cleanup.

## Change

Store the originating default prototype on the guest iterator construction
result and on the synchronous adapter result. Existing descriptor creation,
iterator closing, native adapter hooks, and synchronous return behavior stay
unchanged. Use the weak realm lookup preserved by the object-literal fix.

## Verification

All 99 tests across the four Object.fromEntries files pass after the change.
Scoped ESLint passed. The maintained workspace build completed 23 builds and
four fresh-process import checks. The first standalone TypeScript check
overlapped the dependency rebuild and could not resolve tiny-mcp-client;
rerunning it after the build passed. A built ESM SDK smoke check confirmed
the adapter stays synchronous, preserves creator identity, and copies data.
Broader snapshot/object/retained-root checks passed all 2,180 tests across
150 files. This is a focused selection, not a fresh full-package gate.
This is not a visual CLI change.

No push or release while the release hold is active. Object construction,
destructuring rest, and boxed-value realm gaps remain separate work.
