# Candidate attempt failures

The frozen fixture was not changed after either failure.

## Attempt 1

Command: `node --import tsx --test tests/shell/cancellation-stage1-20260827/cancellation.test.ts`

Exit status: `1`. Tests executed: `0`.

Verbatim failure output:

```text
TAP version 13
# node:internal/modules/run_main:123
#     triggerUncaughtException(
#     ^
# Error [TransformError]: Transform failed with 1 error:
# /Users/kjopek/Workspace/safe-bash/src/shell/cancellation.ts:121:23: ERROR: Expected identifier but found "["
#     at failureErrorWithLog (/Users/kjopek/Workspace/safe-bash/node_modules/esbuild/lib/main.js:1752:15)
#     at /Users/kjopek/Workspace/safe-bash/node_modules/esbuild/lib/main.js:1019:50
#     at responseCallbacks.<computed> (/Users/kjopek/Workspace/safe-bash/node_modules/esbuild/lib/main.js:886:9)
#     at handleIncomingPacket (/Users/kjopek/Workspace/safe-bash/node_modules/esbuild/lib/main.js:941:12)
#     at Socket.readFromStdout (/Users/kjopek/Workspace/safe-bash/node_modules/esbuild/lib/main.js:864:7)
#     at Socket.emit (node:events:519:28)
#     at addChunk (node:internal/streams/readable:561:12)
#     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
#     at Readable.push (node:internal/streams/readable:392:5)
#     at Pipe.onStreamRead (node:internal/stream_base_commons:189:23)
# Node.js v22.22.2
# Subtest: tests/shell/cancellation-stage1-20260827/cancellation.test.ts
not ok 1 - tests/shell/cancellation-stage1-20260827/cancellation.test.ts
  ---
  duration_ms: 164.94325
  type: 'test'
  location: '/Users/kjopek/Workspace/safe-bash/tests/shell/cancellation-stage1-20260827/cancellation.test.ts:1:1'
  failureType: 'testCodeFailure'
  exitCode: 1
  signal: ~
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 168.41375
```

The candidate source syntax was corrected; no fixture byte changed.

## Attempt 2

Same command. Exit status: `1`; 22 tests executed, 20 passed, 2 failed.

Verbatim failing assertion messages:

```text
# Subtest: parent closed admission is stable but an aborted ancestor has priority
not ok 7 - parent closed admission is stable but an aborted ancestor has priority
  ---
  duration_ms: 2.342375
  type: 'test'
  location: '/Users/kjopek/Workspace/safe-bash/tests/shell/cancellation-stage1-20260827/cancellation.test.ts:1:5313'
  failureType: 'testCodeFailure'
  error: |-
    Expected "actual" to be reference-equal to "expected":
    + actual - expected

    + Error: Cancellation admission is closed
    - {
    -   marker: 'late-root'
    - }
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  operator: 'strictEqual'
  ...
# Subtest: a closed inner boundary does not retroactively change after ancestor abort
not ok 14 - a closed inner boundary does not retroactively change after ancestor abort
  ---
  duration_ms: 1.88075
  type: 'test'
  location: '/Users/kjopek/Workspace/safe-bash/tests/shell/cancellation-stage1-20260827/cancellation.test.ts:1:10316'
  failureType: 'testCodeFailure'
  error: |-
    The expression evaluated to a falsy value:

      assert.ok(Object.is(selection.outcome.reason, reason))

  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  ...
1..22
# tests 22
# suites 0
# pass 20
# fail 2
# cancelled 0
# skipped 0
# todo 0
# duration_ms 165.907667
```

The candidate separated admission rechecks of original ancestor signals from a
closed boundary's immutable settlement snapshot. The unchanged frozen suite then
passed 22/22.
