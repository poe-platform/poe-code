# Task-list lock ownership bugfix

## Scope

- `packages/task-list/src/backends/utils.ts` and `utils.test.ts`
- `packages/task-list/src/backends/lock-concurrency.test.ts`
- `packages/task-list/src/types.ts`
- `packages/task-list/src/tasks.fire.test.ts`
- This plan; no README, dependencies, worktree-package changes, commits, or push.

Preserve the committed `Date.parse` created-order comparison and its regression tests.

## Confirmed failures

Exclusive `writeFile(..., { flag: "wx" })` can expose an empty file before writing
the PID. A contender interpreted that live lock as abandoned and unlinked it.
Two stale observers could also unlink a replacement owner after reading the old
contents (ABA). Non-`EEXIST` acquisition errors unconditionally unlinked the path,
even when another caller owned it. Unconditional final unlink compounded these
failures and could reject an already-persisted transition with `ENOENT`.

Both public file backends reproduced concurrent `onExit` calls reading `draft`,
lost metadata patches, and a transition rejecting during release after its write.

## Implemented protocol

- Acquire with nonrecursive `mkdir(lockPath)`. An empty directory is already held;
  initialization is not a reason to steal it.
- Use a unique PID/UUID child directory as an ownership marker, not a liveness
  signal. Separate filesystem wrappers coordinate through the same filesystem.
- Retry only `EEXIST`, with a real 10 ms timer and a 30-second wait bound. Do not
  inspect lock contents, signal PIDs, or automatically remove abandoned locks.
- Reject symbolic-link components before acquisition, on retries, before marker
  initialization, and before release, using the existing path-checking policy.
- Failed acquisition or ambiguous marker initialization never cleans up a path
  whose ownership has not been established. This deliberately leaves abandoned
  directories rather than risking removal of a foreign replacement.
- Release the unique marker with nonrecursive `rmdir`, then remove the empty lock
  directory. Missing/replaced markers stop release, including empty replacement
  directories. Preserve release errors; aggregate operation and release errors
  when both occur.
- Add `rmdir` to `TaskListFs`. Existing Node/memfs-backed consumers already expose
  it; no adapter changes or shared package are necessary.

This is a cooperating-filesystem protocol, not protection against arbitrary
administrative or hostile path replacement between syscalls. Removing or replacing
an active lock is unsupported. The marker detects replacements visible before
marker removal; it does not make multiple path-based syscalls atomic.

## Recovery contract

Legacy PID files (including empty, malformed, stopped-PID, and current-PID files)
fail closed. Empty or abandoned directory locks also fail closed. A timeout names
the exact lock path and says it may only be removed after confirming **all
task-list operations have stopped**.

An operator must stop and confirm idle every process using that task-list store,
inspect the named path, remove the confirmed abandoned file or directory and its
marker without following symlinks, then retry. Never infer safety from a PID,
mtime, empty contents, or the timeout itself. Do not run older lock-stealing
clients concurrently with the new implementation.

## TDD and validation

- [x] Add regressions before the production change. Initial run: 24 failing tests.
- [x] Correct the public fixture to use two legal, distinct transitions; wildcard
  events exclude self-transitions. Recheck expanded regressions against the
  original implementation: **31 failed, 2 passed, 32 skipped** in 703 ms.
- [x] Strengthen ABA coverage with a real replacement `withFileLock` holder.
  Independently recheck red: both stale contenders fulfilled while that holder
  was still active. Restore the fix and confirm they time out without stealing.
- [x] Final focused run: **65 tests passed** in 1.62 seconds.
- [x] Final package suite: **374 tests across 19 files passed** in 3.50 seconds.
  No repository-wide suite was run.
- [x] Package ESLint, package production types, and explicit focused test types pass.
  The public test helper now accepts the state-machine types its callers use;
  memfs writes use its typed encoding-options form.

Coverage includes empty initialization; actual replacement ownership with two
stale observers; timer pacing and deadline; acquisition errors; normal/error
release; empty, owned, legacy-file, and symlink replacements; ambiguous marker
creation; symlink ancestors, dangling links, marker links, and links appearing
during contention; inspection and release errors; and both public backends using
distinct wrappers in one process. Both public transitions must fulfill, observe
`draft` then `planned`, preserve both metadata patches, and leave no lock behind.

Fixtures use memfs only. Contention/deadline tests use fake timers and gates; PID
probes are intercepted during red runs, never delivered to real processes. No
real fixture files, LLM calls, or OS-process QA are used by these unit tests.

Validation commands:

```sh
node_modules/.bin/vitest run packages/task-list/src/backends/utils.test.ts packages/task-list/src/backends/lock-concurrency.test.ts packages/task-list/src/tasks.fire.test.ts
npm run test:unit --workspace=@poe-code/task-list
node_modules/.bin/eslint packages/task-list/src
node_modules/.bin/tsc -p packages/task-list/tsconfig.json --noEmit
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --strict --skipLibCheck --types node,vitest/globals packages/task-list/src/backends/utils.test.ts packages/task-list/src/backends/lock-concurrency.test.ts packages/task-list/src/tasks.fire.test.ts
```

## Parent review and QA

- Reviewed acquisition, initialization, marker ownership, bounded retry, and release-error preservation. Existing created-time sorting is unchanged; no dependencies are introduced.
- Re-ran the focused suite: 65 tests passed in 885 ms.
- Used independent Node processes for both YAML and Markdown stores. Held the first transition in `onExit`, observed the second process encounter the held lock, then released the first. The second observed `planned` rather than `draft`; both metadata patches persisted and the lock was removed.
- Killed a deliberately paused holder in a disposable YAML store. A fresh process waited the actual 30-second deadline and failed with recovery guidance, leaving the task bytes and ownership marker unchanged. Cleanup happened only after every child had stopped.
- Captured and inspected the resulting timeout message with the repository screenshot renderer. The screenshot displays the actual API error and recovery guidance, with the temporary root redacted; it is not a full CLI command invocation.
- Corrected two QA fixture issues before the successful run: canonicalized macOS's symlinked temporary-directory ancestor and compared metadata contents without requiring an ordinary-object prototype. No production change was needed for either.
- Legacy-file timeout behavior remains covered by deterministic unit tests; the manual crash scenario used an abandoned directory lock.

## Original parent QA checklist

1. Use independent OS processes against the same YAML store, then the same Markdown
   list. Hold the first transition in `onExit`; confirm the second cannot enter
   until release. Verify both legal transitions succeed and retain both patches.
2. Stop a holder abnormally. Confirm a fresh process times out without changing
   the lock or task; only recover after confirming every store user is stopped.
3. Check legacy PID-file timeout messaging and the operator recovery procedure.
4. Capture CLI screenshots for the changed error path. Parent owns manual
   OS-process QA, screenshots, any commit/push, and release monitoring.
