# Temporal guest-heap integration

## Evidence and scope

At `b1b930f53`, evaluating the committed guest-heap capture module in memory with
current owned-value imports returns `undefined` for an owned Instant at 123
nanoseconds. The committed capture path has no Temporal private-slot record.
The pending implementation supplies capture, validation and restoration for all
eight Temporal types. Integrate that existing work without claiming a new
language-semantics fix.

## Commit boundary

- Temporal imports, node types and capture branches in `guest-heap.ts`.
- Temporal kind admission, canonical slot validation and Proxy target admission
  in `guest-heap-validation.ts`.
- Temporal kind admission and private allocation in `restore.ts`.
- Eight per-type heap test files, including their existing replay controls.

Leave weak references, weak collections, finalization activation/rollback,
intrinsic capture classification, object-model realm changes and generator field
reordering outside this commit. Keep the existing Proxy-local object-kind list
in the committed version; the pending relocation belongs to weak validation.

## Verification

- Current worktree: 248 Temporal snapshot/replay tests pass in 13 files on both
  Node 22 and Node 18.20.8.
- Tests cover epoch endpoints, Duration limits, private reference dates and
  calendars, aliases, symbols, frozen cycles, prototypes, recapture stability,
  malformed slot records and accessor rejection.
- Tests run against the current worktree, which still includes separate pending
  realm and weak integration. They do not establish an isolated clean-tree gate.
- Focused ESLint passes for the three implementation files and eight test files.
- `npm run build:workspaces -- --workspace=@poe-code/safe-js` passes its
  declaration-derived 23-build closure, including all five fresh-process built
  import checks. This is not the full unit gate or a release result.

## Remaining work

Full-package verification is still non-green. Locale/runtime compatibility,
weak serialization and broader realm qualification remain open. No push or
release is authorized during the release hold.
