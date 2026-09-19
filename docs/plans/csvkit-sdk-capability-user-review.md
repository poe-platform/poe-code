# SDK capability user review

1. Compare original `csvgrep -c a -f matches` with the typed SDK request on
   the same in-memory CSV and host without a match-file opener. Assert exact
   stdout, stderr and status. Reproduce the SDK exception before changing code.
2. Route an SDK acquisition `CsvkitBlocked` through the shared diagnostic engine.
   Keep malformed SDK input as TypeError and caller cancellation as rejection.
3. Inject an opener that refuses with CsvkitBlocked. Verify no stdin acquisition,
   status 78 with zero output capacity, and exact cancellation-reason identity.
4. Have a separate agent stress actual Shell input cleanup. Register its exact
   test path in the maintained integration-input inventory. Preserve the documented
   borrowed external stdin boundary rather than silently changing ownership.
5. Run uncached selected csvkit and safe-bash build closures, domain tests/lint,
   safe-bash maintained runner tests and focused command tests. Record successful
   scopes and remaining compatibility blockers; never credit skips/TODOs as passes.
6. Preserve unrelated files and staging. Do not commit, push, publish, modify
   the ssconvert plan or add README content.
