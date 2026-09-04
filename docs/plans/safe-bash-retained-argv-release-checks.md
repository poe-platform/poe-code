# Retained function-argument release checks

## Observed failure

GitHub release run `33885105811` at `a18a8313f` failed five current foundation
tests in Bash shard 4. The tests expected 3,000 retained `"x"` positional values
to fit in one byte. Issue #578 deliberately introduced aggregate UTF-16 payload
accounting, including replacement function positionals; the corresponding
implementation plan is `bugfix-578-aggregate-string-storage.md`.

The five failures reproduce locally. These tests must continue proving that
scalar function arguments do not activate the private indexed-array ledger or
consume automatic status capacity, but their public byte budget must admit the
retained scalar payload.

## Narrow correction

- Admit exactly 6,000 retained payload bytes for 3,000 one-code-unit values.
- Require rejection at 5,999 bytes and when the payload grows to 6,002 bytes.
- Keep the exact field-limit and command-limit failures independent of the byte
  limit, and retain all observed argument-count and inactive-guest-ledger checks.
- Change only the current foundation test; preserve runtime behavior and all
  historical manifests/evidence. This is a current contract-alignment change,
  not unchanged-input qualification of the old foundation file.

## Validation

Run the complete foundation file, retained-value and byte-value regressions,
and scoped lint. Keep this correction in an atomic commit separate from the
release-speed pipeline change. Monitor the resulting GitHub release and verify
the npm publication; a queued, superseded, or green-but-unpublished run is not
successful delivery of a release.

The complete foundation file plus `value-state`, `byte-values`, and
`invocation-cleanup` passed 168 tests with no failures or skips after the
correction. The original five failures supplied the red baseline.

The full maintained `npm test` route subsequently passed on the pipeline
checkout plus this correction: 29,691 shared Vitest passes, 241 Bash runner
passes, 18,338 Bash passes, 239 remaining workspace-test passes, and both
post-test lint stress cases. The route reported 43 shared-test skips and 63
Bash skips separately; unavailable optional profiles are not claimed as passes.
Full guarded `npm run lint:eslint` also passed after the correction, with all
9,617 configured files linted and zero errors or warnings.
