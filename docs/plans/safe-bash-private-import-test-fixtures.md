# Private imports in safe-bash test fixtures

## Validated failures

The September 17, 2026 package unit run discovered 1,178 active TypeScript
test files and executed 41,080 tests. It reported 40,252 passes, four failures,
one cancellation and 823 skips. The 522 runner checks passed separately.

The packed S3 export verifier rejected `#safe-bash-zip-aes-crypto` as an
unbound dependency. Three writer-isolation cases failed because their copied
packages lacked the built private-import targets declared in package.json.

## Changes

- Bind exact private package imports using Node's active import conditions and
  the authenticated manifest. Require canonical relative targets and bound file
  membership; retain the separate authenticated native peer-edge policy.
- Copy declared built private-import targets into writer fixtures, retaining
  canonical paths, held-source admission and regular-file checks.

## Validation

The new memfs regression failed before the verifier change and passed afterward.
The packed integration rerun passed all 222 tests. All six writer-isolation
tests passed after their fixture change.

The cancelled environment-splitting case passed unchanged in isolation; its
complete file passed all 29 tests. No reproducible product defect was established
for that cancellation, and its code was left unchanged.

An additional full run with explicit concurrency of two passed the repaired
fixtures but reported three failures and two cancellations in timing-sensitive
checks. All affected files passed unchanged on focused reruns. The macOS power
log recorded repeated maintenance sleeps, including a 119-second sleep during
these runs; product and test deadlines were not relaxed.

The final maintained package run used default sequential scheduling under
`caffeinate -dimsu npm run test:unit --workspace=virtual-bash`. It passed all
522 runner checks and completed 41,081 unit cases: 40,258 passed, zero failed,
zero cancelled and 823 skipped. Skips and optional unavailable comparisons are
not passes or qualification of external services.

The selected workspace build closure passed. Final package source/test and all
26 current consumer typecheck groups passed, including expected negative
diagnostics. Final guarded repository lint completed with zero errors and four
warnings in unchanged files. ZIP help/version screenshots were inspected.
