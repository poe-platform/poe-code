# B01 focused baseline

Fixture version 2 ran once against the unchanged rejected helper
`373437cf84424939e1792470805cdd9e60bd3898`, blob
`3b7b55abc14718c0e23aa0c352af392b967a4905`, SHA-256
`f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5`.

Command from `/Users/kjopek/Workspace/safe-bash`:

```text
node --import tsx --test tests/shell/cancellation-stage1-20260827/extension-v1/repair-b01-v1/cancellation-repair-b01.test.ts
```

Exit status: 1. Exact result: 4 pass / 4 fail. The four B01 matrix cases
failed: budget observed, pipeline observed, budget descendant report, and the
equal-reason pipeline descendant report. The root, unknown-equal, genuine-invoke,
and close-stability neighbors passed. `baseline-v1.tap` preserves the raw TAP
bytes. This corrected fixture was not retried.

Before that execution, the focused strict command exited 0:

```text
./node_modules/.bin/tsc -p tests/shell/cancellation-stage1-20260827/extension-v1/repair-b01-v1/tsconfig.strict.json
```

`PREFREEZE-ATTEMPT-v0.md` separately discloses the earlier fixture-v0 mistake.
No independent 12-case layout, original independent Stage 1 family, nearby four,
Runtime, Shell, native, timeout, or Stage 2 cohort ran. Every boundary, listener,
and process created by this fixture closed or settled naturally.
