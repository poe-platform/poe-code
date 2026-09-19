# csvclean independent safe-bash stress QA

Reference: csvkit 2.2.0 source archive SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Frozen differential cases are in `docs/csvkit/additional-operation-reference.json`
(Darwin CPython 3.14.2 reference profile); source control-flow evidence is in
`docs/csvkit/source-flow-audit-20260917.json`.

## Procedure

1. Read `packages/safe-bash/AGENTS.md` and inspect the released `RowChecker`
   control flow before evaluating the current implementation.
2. Run `node --import tsx --test packages/safe-bash/tests/commands/csvclean-stress.test.ts`
   from the repository root. This uncached focused suite uses the actual Shell,
   registered csvkit executable and injected MemoryFileSystem; it performs no
   native execution, network work, database calls or physical file creation.
3. Compare exact stdout, stderr and exit status for all nine frozen csvclean
   cases, including parser errors, line numbering and the released successful-
   join/list-removal exception.
4. Exercise header-only, empty, blank and multiline input. Verify physical
   reader line numbers and data-row error ordering.
5. Exercise length-based omission without enabling length checking, file-level
   empty warnings, fill-before-check behavior and incremental edge-cell joins.
   Verify previous stdout rows remain present after subsequent joins.
   Check null versus empty-string fill, empty separators, full-row candidate
   resets and overflow joins that discard the oldest candidate. An initial blank
   candidate must preserve the released `IndexError` and exact partial stdout.
   Verify zero-based empty-column recommendations, empty labels and Python
   whitespace normalization, including control separators.
6. Redirect CSV diagnostics to the injected filesystem with `--label -` and
   a source filename. Check exact diagnostic bytes, unchanged source bytes and
   the exact resulting directory inventory.
7. Abort cooperative pending stdin with the literal reason `false`. Require
   the exact rejection reason and one iterator-return call before settlement.
8. Delay the stdout header sink using a promise barrier. Verify no later cleaned
   row sink write is admitted and invocation settlement remains pending. Release
   the barrier and compare exact captured and sink output plus CSV diagnostics.
   Assert every sink write completes before the next write begins.
9. Have root register the exact new test path in the maintained integration
   inventory and run package build/type checks and maintained lint checks.

## Observations

The focused suite passed all 24 tests on 2026-09-18. Nine additional cases were
derived independently from the sealed released-source control flow; these are
source-based expectations, not new external Python differential captures.
No product defect was found in the added join, fill, label, numbering or header
normalization cohort. An initial test harness
failure assumed directory listings contained strings; MemoryFileSystem returns
entry objects. The assertion now compares entry names. The added sink case
initially assumed a supplied sink disabled Shell stdout capture; Shell preserves
that capture, so the exact expected stdout was corrected. No engine defect was
found in this measured cohort.

Released csvkit 2.2.0 removes the current joined-row error before appending it,
which can produce `ValueError: list.remove(x): x not in list`. The frozen case
requires that released exception and its partial stdout, rather than silently
repairing upstream behavior.

This scoped run does not qualify every encoding, database driver, locale,
verbose traceback path, hostile producer or output ownership combination.
Unmeasured cases remain outside this result; broader repository integration
checks are root-owned.
