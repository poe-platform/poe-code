# Auth migration/delete resurrection

## Scope

- `packages/auth-store/src/provider-store.ts`
- `packages/auth-store/src/provider-store.test.ts`
- This plan. Commits, pushes, and release monitoring remain with the parent.

## Confirmed failure

The primary store starts empty and the legacy store contains a synthetic old
credential. A `get()` captures the legacy value and pauses before returning it.
On the same wrapper, `delete()` completes and both backing stores become empty.
When the read resumes, its queued migration sees an empty primary and writes the
captured credential back. A fresh wrapper then reads the resurrected credential.
A completed `set()` followed by `delete()` during the pause has the same failure.

The overlapping read may return its captured value. The invariant is that a
completed deletion must not be persistently undone by that stale migration;
later, non-overlapping reads must return null.

## Completed implementation

1. Added deferred, entirely in-memory regression cases for delete and set-then-delete,
   with read-only controls for both. No sleeps, disk, keychain, or real credentials.
2. Observed both writable cases fail before changing production code. Both
   read-only controls passed. A revalidation-error control also failed as expected.
3. Inside the existing serialized migration, retained the empty-primary check and
   added a current-legacy equality check against the captured value before writing.
4. Kept the new legacy read inside the best-effort persistence boundary: failed
   revalidation skips migration without losing the readable captured value.
5. Verified both stores remain null after the paused read settles, same-wrapper
   and fresh-wrapper subsequent reads return null, and no further mutations occur.
   The overlapping read's return value is deliberately unconstrained.
6. Retained existing newer-concurrent-set, normal migration, persistence failure,
   rollback, and read-only coverage. Updated the subsequent-primary-read test to
   assert no legacy reads during that second get, independent of revalidation.

This fix relies on mutation serialization within one wrapper. It does not claim
cross-wrapper or cross-process atomicity against independent backing-store writes.
There are no CLI visual changes, so screenshot validation is not applicable.

## Validation

- Red: `npx vitest run packages/auth-store/src/provider-store.test.ts`
  — 3 failed, 19 passed: two resurrection regressions and the revalidation-error
  control. The original 17 tests and both read-only race controls passed.
- Green: the same command — 22 passed.
- Package suite: `npx vitest run packages/auth-store/src` — 62 passed across 3 files.
- Targeted lint: `npx eslint packages/auth-store/src/provider-store.ts packages/auth-store/src/provider-store.test.ts` — passed.
- Package types: `npx tsc -p packages/auth-store/tsconfig.json --noEmit` — passed.
- Source and test types: `npx tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node,vitest/globals packages/auth-store/src/provider-store.ts packages/auth-store/src/provider-store.test.ts` — passed.
