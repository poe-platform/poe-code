# Pre-implementation baseline

Helper source existence check: absent.

Command:

```text
node --import tsx --test tests/shell/cancellation-stage1-20260827/cancellation.test.ts
```

Exit status: `1`.

Raw output:

```text
TAP version 13
# node:internal/modules/run_main:123
#     triggerUncaughtException(
#     ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/kjopek/Workspace/safe-bash/src/shell/cancellation.js' imported from /Users/kjopek/Workspace/safe-bash/tests/shell/cancellation-stage1-20260827/cancellation.test.ts
#     at finalizeResolution (node:internal/modules/esm/resolve:275:11)
#     at moduleResolve (node:internal/modules/esm/resolve:861:10)
#     at defaultResolve (node:internal/modules/esm/resolve:985:11)
#     at nextResolve (node:internal/modules/esm/hooks:748:28)
#     at resolveBase (file:///Users/kjopek/Workspace/safe-bash/node_modules/tsx/dist/register-C4vWVmug.mjs:2:10334)
#     at async resolveDirectory (file:///Users/kjopek/Workspace/safe-bash/node_modules/tsx/dist/register-C4vWVmug.mjs:2:11415) {
#   code: 'ERR_MODULE_NOT_FOUND',
#   url: 'file:///Users/kjopek/Workspace/safe-bash/src/shell/cancellation.js'
# }
# Node.js v22.22.2
# Subtest: tests/shell/cancellation-stage1-20260827/cancellation.test.ts
not ok 1 - tests/shell/cancellation-stage1-20260827/cancellation.test.ts
  ---
  duration_ms: 196.4095
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
# duration_ms 199.941125
```

This is the required pre-candidate missing-module baseline. It does not claim an
implemented helper failure.
