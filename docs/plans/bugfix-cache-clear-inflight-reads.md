# Drain in-flight cached-resource reads before clearing

## Contract and scope

For one cached-resource instance, `clear()` drains `get()` and `refresh()`
operations started before that clear, including disk promotion, persistence,
and background revalidation spawned by those operations. It then clears memory
and removes the disk entry. Foreground rejection does not reject clear; disk
deletion failures still do. Concurrent clears independently drain shared work.

This is a snapshot barrier, not a lock: later operations may run and repopulate
the cache, and other instances are not coordinated. Preserve immediate stale
returns and background-fetch deduplication. No cancellation, generations,
global mutexes, public flags, README edits, dependency changes, commits, or push.

Changes are limited to this plan, `packages/cached-resource/src/create-cached-resource.ts`,
and `packages/cached-resource/src/clear-concurrency.test.ts`.

## Implementation sequence

1. Add deferred fetch, memfs read, and memfs rename regressions before changing
   production code. Use fake-clock zero-time advancement to flush pending work;
   no sleeps, network access, or real fixture files.
2. Record red evidence for cold get, refresh, fresh offline disk promotion,
   late stale revalidation, delayed persistence, concurrent clears, and rejection.
3. Track pending `resolveData` promises synchronously per instance in `get()`;
   remove each on fulfillment or rejection without an unhandled rejected chain.
4. In `clear()`, snapshot and `allSettled` foreground operations, then wait for
   background revalidation, clear memory, and remove disk data.
5. Run all cached-resource tests, type checks, scoped lint, and diff checks.
   Leave whole-suite execution to the parent after all workers are green.

## Validation evidence

### Red, before production changes

`node_modules/.bin/vitest run packages/cached-resource/src/clear-concurrency.test.ts --reporter=verbose`

- 9 failed, 2 passed (11 tests; 44 ms test execution).
- Cold get and refresh completed clear before fetch release and repopulated
  memory and disk. Delayed fresh offline reads repopulated memory.
- Delayed stale reads registered revalidation after clear returned; delayed
  rename recreated the deleted cache entry. Both concurrent clears returned
  before the shared foreground request completed.
- Clear returned before a pending rejected read settled; deletion errors were
  preserved but foreground work still repopulated memory afterward. The later
  operations case likewise exposed missed earlier work.
- Immediate rejection handling and cross-instance independence already passed.
- No unhandled rejections in this red run.

### Green

- Focused command above: 11 passed (29 ms test execution), no unhandled errors.
- `node_modules/.bin/vitest run packages/cached-resource --reporter=verbose`:
  122 passed across 2 files (177 ms test execution), including the existing
  background-revalidation wait, deduplication, and deletion-error cases.
- `node_modules/.bin/tsc -p packages/cached-resource/tsconfig.json --noEmit`:
  passed.
- All package source types, including tests and compile checks, passed:

  ```sh
  node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --types node,vitest/globals packages/cached-resource/src/*.ts packages/cached-resource/src/testing/index.ts
  ```

- `node_modules/.bin/eslint packages/cached-resource/src --ext ts`: passed.
- `git diff --check`: passed.
- `node_modules/.bin/prettier --check packages/cached-resource/src/clear-concurrency.test.ts docs/plans/bugfix-cache-clear-inflight-reads.md`:
  passed. The existing production file retains its surrounding style.
- Final post-format package rerun: 122 passed across 2 files (158 ms test
  execution); package ESLint and diff checks also passed again.
- No CLI visual behavior changes, so no screenshots are applicable. No whole
  repository test suite was run; parent coordination remains unchanged.

The implementation adds an instance-local pending-promise set, two handled
settlement callbacks, and a snapshot `Promise.allSettled` before the existing
background wait and cache deletion. Later foreground operations remain runnable
and may repopulate after clear; other instances remain independent.

## Parent integration review

Reviewed the snapshot barrier and handled settlement callbacks against the
foreground resolution and existing background-revalidation lifecycle. The patch
does not serialize later reads, alter the public API, or add a dependency.
The complete repository pre-push suite passed 19,052 tests, including all 11
clear-concurrency regressions; the log is
`/tmp/poe-code-ux-push-root-help.log`. The existing package-level 122-test result
and the foreground/background boundary cases remain applicable. This is an
API-only state-lifecycle fix, with no changed CLI rendering to screenshot.
