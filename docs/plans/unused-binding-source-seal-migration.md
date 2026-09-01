# Authenticate the unused-binding source migration

The full suite exposed an exact source-seal failure introduced by the warning
cleanup: `structured/helpers.ts` renamed two discarded byte bindings to the
configured `ignored` spelling. The helper's behavior is unchanged, but the
historical seal correctly refused different current bytes.

Authenticate the exact current path, sizes and hashes, then reverse only those
two names at fixed byte offsets and compare with the original sealed snapshot.
Keep historical evidence, snapshots, existing repair receipts and helper source
unchanged. Do not skip a comparison or broaden a lint exception.

Audit all 140 comparisons: 135 remain byte-identical, four use existing reviewed
migrations and one uses the new exact helper migration. TDD controls reject body
drift, wrong names, wrong path/digest and extra bytes. All 307 tests across eight
focused suites pass, including all 23 historical snapshots. Rerun the full suite
and monitor the release after this independent corrective commit.
