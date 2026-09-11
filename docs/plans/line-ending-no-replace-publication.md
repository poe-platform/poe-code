# Preserve concurrently created line-ending outputs

For an initially absent `-n` output, require the existing filesystem
`atomicRenameNoReplace` capability before creating a stage and pass `noReplace`
to publication. Keep ordinary replacement for an originally existing target.
This does not add an identity lease or transaction for existing paths.

The dedicated in-memory regression uses the actual MemoryFileSystem behind a
faithful rename barrier. A writer creates the output after the final precheck;
both commands must fail without replacing those bytes, changing the input, or
leaving their known stage. Capability controls cover supported, false and absent
assertions, refusal before mutation, and existing-target compatibility.

Initial reproduction: eight tests, two pass and six fail. Both race cases
replaced concurrent bytes; false and absent capabilities allowed publication.
After the fix, the original and independent line-ending command tests, new
publication regressions, and line-ending plugin tests passed: 483 tests,
zero failures, cancellations or skips, in 11.29 seconds. Validation used the
maintained `scripts/test-reporting.mjs --import tsx --test-concurrency=1` route.
