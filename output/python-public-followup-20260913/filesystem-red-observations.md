# Filesystem edge regression observations

These are transcribed observations from tool output, not raw captured logs.

Before the fix, `node --test --test-name-pattern='canonical immediate|quota refusal' packages/safe-bash/tests/integration/pyodide-runtime/public-lifecycle.test.mjs`
failed the immediate and delayed authority subtests: `os.rmdir('/protected/empty')`
raised `OSError(138, 'Not supported')`, while the script required `errno.EROFS`.
Both new quota refusal subtests passed and preserved storage bytes and namespace.

The fast regression command `npx vitest run packages/safe-fs/tests/python-filesystem.test.ts`
then produced 1 failed / 12 passed: expected `{ code: 'EROFS' }`, received
`FsError { code: 'ENOTSUP' }` at the new readonly rmdir assertion.
After the narrow read-only precedence fix, the same command passed 13/13.

An additional snapshot-only refusal regression initially had an invalid test
fixture: spying on absent `MemoryFileSystem.capabilitiesFor` failed before product
execution. The fixture now explicitly supplies that optional method. This is
not a product bug; the final raw green log records its corrected run.

The required quota workflow was separately executed with the test-name pattern
`required Python quota`. It remained a failing TODO at its first input read:
`OSError: [Errno 138] Not supported: '/quota/input'`. The test runner reports
0 passes, 0 failures, 1 TODO; its successful process exit does not mean quota
workflow compliance. No writable-descriptor approximation was added.
