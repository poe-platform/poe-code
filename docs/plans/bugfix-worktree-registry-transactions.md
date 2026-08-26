# Worktree registry transactions

## Scope

Fix confirmed lost updates and create/remove lifecycle compensation races in
`packages/worktree`. No dependencies, manifests, README edits, commits, or releases.

## Implementation sequence

1. Reproduce overlapping public API operations with gated memfs/mock-exec tests.
2. Confirm failures before changing implementation.
3. Add a filesystem mutex shared by every wrapper/process using the registry path.
4. Hold it across registry read, mutation, short Git lifecycle operations, status
   writes, and rollback. Never hold it across an agent conversation.
5. Keep transaction-internal writes non-locking to avoid nested-lock deadlocks.
6. Test lock contention, error release, ownership, and symlink protection; run
   existing package tests and source checks.

## Safety decisions

- Use exclusive directory creation, unique owner markers, and nonrecursive cleanup.
- Markers are empty directories named with a PID and UUID, not files whose empty
  contents could be mistaken for an abandoned owner. Waiters never inspect or
  delete ownership markers. Missing/replaced markers make release fail closed.
- Wait a bounded time; never reclaim a lock based on age or PID alone. Abandoned
  locks fail closed and require operator recovery after verifying all owners are
  stopped. This trades automatic crash recovery for protection against lock theft.
- Contention retries every 10 ms and stops after 30 seconds. A failed release is
  reported; if the operation also failed, an AggregateError preserves both errors.
- All mutators participate, including direct registry replacement. Replacement
  remains a replacement API, not a merge API for caller-supplied stale snapshots.
- Preserve registry symlink checks, temporary-file staging, and atomic rename.
- Separate fs wrappers and independently loaded modules must coordinate via memfs
  in unit tests. This does not establish real multiprocess/runtime proof.

## Validation record

- Red: the first 13 gated lifecycle regressions all failed against the original
  implementation (323 ms total runner duration). With initial ownership-safety
  cases added, 24 failed and 3 passed before implementation changes.
- Green: `node_modules/.bin/vitest run packages/worktree/src --reporter=dot`
  passes all 85 tests: 53 existing tests and 32 concurrency/lock-safety cases.
  Runs completed in under one second, with memfs and mocked exec only.
- Initial source checks passed: `npm run lint:types`, package `tsc --noEmit`,
  focused ESLint, and `git diff --check`. The initial root typecheck used stale
  dependency declarations and did not prove all filesystem adapters were updated;
  the fresh-build integration results below supersede that claim.
- The new concurrency test file also passes standalone strict TypeScript checking
  with ES2022/NodeNext and `--skipLibCheck`.
- Separate wrappers and independently loaded API modules coordinate through shared
  memfs. Empty initializing locks, concurrent abandoned-lock waiters, replacement
  owners (including empty locks), error cleanup, and symlink rejection are covered.
- No real OS-process concurrency proof was run by the implementing agent. Parent
  can execute the non-Git manual QA below. No dependencies or public lock options
  were added; no commits or pushes were performed by the implementing agent.
- Parent executed the public API through six independent Node processes against
  one owned temporary registry: all 120 shared-counter increments and all six
  distinct status updates persisted, with no lock or staging files left behind.
- Parent terminated only its own synthetic lock-holder child, then verified a
  competing mutation timed out after 30,011 ms without changing the registry or
  removing the abandoned owner marker. After confirming that child had exited,
  explicit idle-only lock cleanup restored successful mutation. The owned
  temporary directories were removed; no Git branches or worktrees were created.

## Adapter integration follow-up

- The actual package build exposed a missing `rmdir` in superintendent's default
  Node worktree adapter. Added direct forwarding to `fsPromises.rmdir`, without
  exporting the helper or changing unrelated adapter behavior.
- Regression: the public superintendent command supplies its default dependency
  adapter to a mocked worktree operation. Its directory removal is exercised
  against memfs, including nonempty-directory rejection and owner/lock cleanup.
  No real files, Git operations, or LLM calls are used by the regression.
- Red: the focused command test failed with `deps.fs.rmdir is not a function`;
  the other two tests passed. Green: all 394 worktree and superintendent tests
  pass across 32 files after wiring the adapter.
- Both actual builds pass, in dependency order:
  `npm run build --workspace=@poe-code/worktree`, followed by
  `npm run build --workspace=@poe-code/superintendent`.
- `npm run predev` then rebuilt the full workspace successfully: 67 successful
  tasks, zero cached. The subsequent `npm run lint:types` exposed the same missing
  method in the root SDK adapter at `src/sdk/worktree.ts:377`.
- Parent authorized completing the SDK adapter in `src/sdk/worktree.ts` and its
  existing test file. Added direct forwarding to `nodeFs.rmdir` and updated the
  mocked failure-dependency fixture to satisfy the filesystem interface.
- SDK red: the public `runInWorktree` adapter regression failed with
  `deps.fs.rmdir is not a function` while the other seven tests passed. The
  regression exercises nonempty-directory rejection and owner/lock cleanup using
  memfs; worktree calls and agent execution remain mocked.
- Final green: all 402 SDK worktree, worktree-package, and superintendent tests
  pass across 33 files. Both actual package builds were rerun successfully, then
  `npm run predev` completed all 67 workspace build tasks with zero cached.
- After those fresh builds, `npm run lint:types` passes, as do focused ESLint and
  `git diff --check`. The original failing command, `npm run dev -- --help`, also
  exits successfully and displays help. No remaining adapter compilation blocker
  was found by these checks.
- These adapter follow-ups change only the two adapters, their existing test
  files, and this plan. No commits, pushes, or unrelated edits were performed;
  parent will fold them into the original unpushed worktree change.

## Remaining risks

- Every writer must use this protocol. Older clients and direct file edits bypass
  the mutex; externally deleting a live lock is unsafe and unsupported.
- Crashes and release failures can leave a lock requiring verified-idle manual
  recovery. A crash between Git and registry updates is not made crash-atomic.
- Reads remain unlocked and can observe a complete intermediate lifecycle status.
  Raw `writeRegistry` replaces a document; it does not merge stale external input.
- Real multiprocess QA passed on the parent's current macOS filesystem; other
  filesystem/platform semantics remain untested. The locking scope is one
  registry location, not every repository/registry globally.

## Manual QA for parent

1. Allocate an owned temporary directory outside the repository and initialize a
   valid registry there with several named entries. Do not create Git branches,
   worktrees, or repositories.
2. Start independent OS processes importing the public worktree API and using
   Node filesystem promises. Concurrently call `updateWorktreeStatus` on distinct
   entries and `updateWorktreeEntry` to increment a shared entry's numeric prompt
   value. Each increment must compute its value inside the update callback.
3. Wait for every process to exit successfully. Read the registry through the
   public API and verify every status and the exact total increment count. Check
   that no lock or temporary registry file remains.
4. In that same owned directory only, create an empty registry lock directory to
   simulate an interrupted owner. Confirm concurrent mutations time out without
   removing it or changing the registry. Stop all participating processes before
   removing that QA-created lock and checking that updates work again.
5. Clean up only the temporary directory created by this QA. Lifecycle coverage
   stays in gated memfs/mock-exec unit tests; no actual Git operations are needed.
