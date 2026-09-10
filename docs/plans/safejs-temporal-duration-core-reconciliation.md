# Temporal Duration private core and input validation

## Validated defect

The private factory inspected field descriptors before validating the input
record. A Proxy could execute `getOwnPropertyDescriptor` traps, and primitive
numbers, strings, booleans and functions were silently accepted as empty
duration records. Five new cases failed against the unchanged implementation
(4d205d); the null control already threw. This is an internal storage-boundary
defect, not a claim that guest `Temporal.Duration` constructors should refuse
their specified argument coercions.

Reject non-object, null and Proxy inputs before reading descriptors, matching
the private record boundary used by other Temporal storage factories. Inspected
call sites supply constructed field records or validated snapshot slots. The
public constructor still performs guest numeric conversions in parameter order
before invoking this private factory.

## Reconciliation scope

Commit the existing private Duration storage/host readers and their core tests,
including the validated input guard. Fields remain private and immutable, with
same-sign enforcement, signed-zero normalization and exact BigInt arithmetic
for the combined time range. No public Temporal API or CLI appearance changes.
Cross-cutting copy, public constructor and snapshot code remain uncommitted;
their tests below qualify this working tree, not an isolated complete checkout.

## Verification

- Node 22: seven selected files, 106 tests passed. Coverage includes private
  storage, copying, host import/export, public constructor behavior, snapshots
  and replay (`temporal-duration` core/copy/export/import, globals construction,
  and snapshot storage/replay tests).
- `npx tsc -p packages/safe-js/tsconfig.json --noEmit` passes.
- Focused core/test ESLint passes.
- Node 18.18.2: private core and public construction files pass all 37 tests.

The previously failing full integration gate is not superseded by these
focused results. No general JavaScript or Temporal completeness claim follows.

## Delivery

Local commit only under the release hold. No push, release or issue closure;
unrelated staged Safe Bash changes remain untouched.
