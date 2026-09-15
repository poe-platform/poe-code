# Joined nested source suspension

Task: qualify-lifecycle-and-retention. SafeJS's authorized nested-source contract
requires completion before the enclosing host call returns. The minimum
counterexample is `await 0; value=7` inside `evaluateNested`; the enclosing
`nested(); return value` never completed. The neighbor `value=7` without await
passed. Node 22.23.2 / ICU 78.2; reproduced on the dirty local baseline and
isolated remote main `d3acfb10092c3b4b39aa3f370464dee1a774da53`.

`npx vitest run packages/safe-js/src/realm-nested-suspension.test.ts`:
red 1 failed/1 passed, 51 ms tests, 1.57 s command. The regression observes the
next host turn rather than waiting for a slow unit-test timeout.

Authorized nested source now joins the enclosing execution token. Its guest
await can release/reacquire that token. Ordinary host implementation awaits do
not become guest suspension. A rejected intermediate host-bridge repair broke
three prefix/cancellation tests and was removed; no such bridge change ships.

Final focused command selects realm-nested-suspension.test.ts,
realm-resource-ownership.test.ts, realm.test.ts and realm-callback-phases.test.ts:
65 passed, 1.41 s tests, 3.09 s command. It covers nested atomic waits, callback
worker reuse, host-yield prefix ordering and close/abort of unfinished prefixes.
Budgets, timeout values, reentry rejection and explicit source:nested grants
are unchanged. Additional isolated-main checks are recorded in task evidence.
