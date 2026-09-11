# Post-loop-header integration gate

## Completed run

The maintained `npm test --workspace=@poe-code/safe-js` route, with JSON
reporting, completed with exit code 1 in session 93978. Runtime revision was
3cd9fad79; HEAD 8a95d0e6b added documentation only. Main runtime and test sources
were left unchanged during this run.

- Filesystem type contracts: 100 passed.
- Unit assertions: 28,271 passed, 15 failed, 47 skipped.
- Test files: 1,247 (`testResults.length`, not the nested suite count).
- Report: `/tmp/safejs-post-loop-header-integration-results.json`.

Fourteen failures remain in Promise import properties (2), standalone/range ISO
month names (6), Temporal PlainMonthDay locale output (3), and native
PlainYearMonth locale preconditions (3). These are not resolved by the recent
loop and optional-chain changes.

The additional failure is the regex cursor independent case for `match`,
pattern `(a)(.)`, flags `gims`, initial lastIndex 10, input `A\nab\naZ`.
Its recorded duration is 23,241.863875 ms and its failure message is
`STACK_TRACE_ERROR` from the test runner. This is not sufficient evidence of
incorrect regex semantics or a diagnosed timeout cause.

## Targeted revalidation

The unchanged regex file filtered with `-t "gims.*from 10"` passes all 12 selected
cases, including the failed case, in 388 ms of test execution (b1f412).
The other 1,015 cases are skipped by that diagnostic filter, not counted as
passes. The full unchanged regex file subsequently passed all 1,027 cases in
21.25 seconds of test execution (57cacd). The integration-only failure is not
reproduced by either rerun; its cause remains unproven. These passing reruns do
not turn the failed integration gate green.

## Next actions

Investigate the full-run regex failure without raising timeouts or changing
semantics without reproduction. Integrate the independently validated literal
member and sloppy-let parser candidates as separate improvements, each with
main-worktree checks. Keep the Promise and locale failures visible.

Release hold remains active. No push, release, or issue closure is claimed.
