# Pre-freeze fixture attempt v0

Before any helper edit, the initial fixture ran once against rejected helper
`373437cf84424939e1792470805cdd9e60bd3898`. It exited 1 with 3 pass / 5 fail.
R01, R02, and R03 failed because `Object.is(actual invoke reason, expected
control reason)` was false. R04 failed because the returned report origin was
the outer `invoke-option`, not the expected `pipeline-control`. Those are the
intended B01 red results.

R08 also failed at its second assertion with exact diagnostic `'return' !==
'throw'`. That v0 assertion incorrectly required a closed control origin to
replace a successful return, behavior neither required by B01 nor allowed by the
frozen selector policy. Fixture v2 replaces only that assertion with the correct
successful-return preservation check. It also changes the origin-identity
assertion form to avoid a very large structural diff while retaining exact
reference identity. No B01 expectation was weakened.

The v0 command was:

```text
node --import tsx --test tests/shell/cancellation-stage1-20260827/extension-v1/repair-b01-v1/cancellation-repair-b01.test.ts
```

Its raw TAP was emitted in the author execution transcript but was not redirected
to a repository file. This retained note does not relabel it as the frozen
baseline or as an independent result. The corrected fixture receives one fresh
baseline execution and preserves that raw TAP separately.
