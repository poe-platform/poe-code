# Release test runtime: 20-minute target

## CI evidence — September 1, 2026

- Run `33519041060`, job `99893321213`, ran the workspace-test step from
  `14:26:05 UTC` until `14:54:28 UTC`: 28 minutes 23 seconds, then exit code 1.
- Its last test output was at `14:26:52 UTC`. There is no failed-test summary in
  the downloaded job log; the final annotation only reports exit code 1.
- The preceding successful release's workspace-test step took approximately
  24 minutes 41 seconds. This is not merely time spent waiting for a runner.
- The CI revision is `500a0c17d87fe436849618f3ab91b098ea2a700d`. The local checkout
  is based on `c51139eca`, with additional working-tree changes. CI uses
  `packages/safe-js` and `scripts/build-workspaces.mjs`; this checkout uses
  `packages/safejs` and Turbo. Do not equate local timings with CI timings.
- The CI workspace runner selects the root test script and each workspace's
  test script. The root Vitest configuration already includes package tests.
  This creates overlapping test ownership; the downloaded log does not establish
  how many workspace stages the failing run reached.

## Implemented in this checkout

- Removed the second identical JSON-decoded restore from 21 snapshot matrices.
  Every case and captured checkpoint still runs, with its result, queue cleanup,
  call depth, and snapshot immutability assertions. The smaller generator-call
  prefix suite retains repeated restoration coverage.
- Replaced real retry delays with zero-delay scheduled callbacks in three stash
  test suites. The retry count, ordering, asynchronous boundary, and assertions
  remain intact; production retry timings are unchanged.
- Cached the default log sink per stdout stream, preventing one permanent error
  listener per log module. A regression test creates 20 modules and checks one
  listener and shared broken-pipe behavior.
- Recognized GitHub's `CI=true` in postinstall, avoiding failed skill syncing.
- Updated the release actions to Node-24 implementations and the deprecated
  `glob` override to `13.0.6`. The token action is pinned to `v3.0.0`, which accepts
  the existing app-ID secret without requiring a new client-ID secret.
- Captured expected CLI/progress output in tests and retained console output
  for failing tests with Vitest's `silent: "passed-only"` option.
- No worker counts, pools, workflow concurrency, or task concurrency changed.

## Measurements and validation

Representative local file runtimes, milliseconds:

| Suite                            | Before |  After |
| -------------------------------- | -----: | -----: |
| Native iterator snapshots        | 99,797 | 57,080 |
| Collection constructor snapshots | 35,668 | 21,554 |
| Constructor snapshots            | 24,175 | 13,431 |
| Stash browse                     | 15,634 |    146 |
| Stash upload/download            | 15,674 |    196 |
| Stash sync                       | 10,659 |    177 |

The full diagnostic run executes 29,296 tests across 1,064 files. Seven SafeJS
tests fail in files outside this patch's behavior changes: CLI cleanup, public
exports, snapshot yields, budget accounting, interpreter host contexts,
recursive callback ownership, and restored-generator ownership. The recursive
callback test times out. These failures are also reproducible separately from
the modified test suites.

The JSON-reporter whole-suite samples took 359.8 seconds before and 367.4 seconds
after. These shared-machine measurements do **not** establish an overall runtime
improvement, despite the individual hot-spot reductions. The diagnostic run with
both default and JSON reporters took 421.3 seconds. Do not use these numbers to
claim the CI budget has been met.

Focused warning regressions, retry tests, output-capture tests, V8 coverage with
the new glob version, workflow lint, and SafeJS typechecking pass. The CLI help
screenshot was generated and visually inspected.

## Remote-main delivery scope

The warning fixes, retry-delay mocks, expected-output capture, action updates,
and dependency override are ported onto `500a0c17d` in a separate worktree. The
original dirty checkout remains untouched by that integration. SafeJS module
changes use the current `packages/safe-js` path.

The 21 snapshot-matrix files are unpublished files from the original checkout;
they do not exist on remote main. Their edits remain local rather than adding
unrelated, incomplete SafeJS implementation to the delivery. The snapshot
timings above therefore do not measure improvements included in the push.

The user requests pushing with normal hooks without waiting for release CI;
release repair is assigned separately. A push does not verify the time budget.

## Remaining acceptance

The 20-minute CI target is **not verified**. The local suite and release revision
are different, and the complete local suite is not green.

Before claiming the target:

1. Integrate the applicable changes into the CI revision without overwriting
   existing working-tree work.
2. Give each test file one owner in the workspace runner; retain the Python and
   virtual-bash suites rather than dropping their coverage.
3. Resolve the remaining failing tests and retain a reporter that identifies
   completed files and prints failure summaries.
4. Measure a cold release on the same runner class, with all existing gates and
   unchanged concurrency, and confirm the complete release finishes in 20 minutes.
