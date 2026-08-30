# Pre-candidate extension baseline

The accepted helper was authenticated before this run at commit
`fbbe1ef793b7434871403125efbeb46624a8e081`, blob
`a7742b7f7e81bcd8c1c2a6be35092d8b5f41102f`, and SHA-256
`ee048f6c38086dd40573db57e002e596029174ee2afc5f888e516779e5a718ac`.

Command (run once, without retries):

```text
node --import tsx --test tests/shell/cancellation-stage1-20260827/extension-v1/cancellation-extension.test.ts
```

Exit status: `1`. The raw output is preserved in `baseline.tap`. It fails during
module instantiation because the accepted helper does not yet export
`activateChildCancellation`. This is the expected missing-API RED only; it is not
evidence of a semantic defect. No test body ran, no product source changed, and
no independent or Stage 2 cohort was executed.

