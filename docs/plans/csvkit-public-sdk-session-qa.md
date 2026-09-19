# csvkit public SDK integration QA

1. Preserve existing edits and staging; do not commit, push, publish or edit
   README files. Follow root and safe-bash AGENTS.md.
2. Reproduce missing SDK command/flag/cardinality checking through compile-only
   original requests. Invalid csvcut inference/selectors, scalar SQL query lists,
   malformed DB tuples and an invented executable must fail TypeScript checks.
   Keep JavaScript runtime rejection tests for these malformed inputs.
3. Reproduce absent public workbook exports before exposing the actual CLI
   WorkbookInput and Runtime. Verify constructor identity, then import compiled
   declarations from both public package routes under strict NodeNext.
4. Independently stress implemented safe-bash tools with another agent. Exercise
   Buffer views reused during producer advancement/finalization, named source
   cleanup, cancellation, SQL option-map identity and interpreter work refusal.
   Use in-memory/memfs input and exact stdout/stderr/status/effects.
5. In separate build QA, bundle compiled codec routes with browser target and
   inspect the dependency graph. Deny workbook/database/Node dependencies during
   the regression. Verify decode/encode in a browser-like context with no process
   or Buffer. Do not invoke a native bundler from canonical unit tests.
6. Run the maintained uncached selected csvkit build, package tests and lint.
   Complete the normal repository build and maintained root test/lint routes for
   public integration. Record failures/timeouts and unavailable profiles as gaps,
   never passes. Keep worker concurrency explicit without increasing timeouts.
7. Run built public-consumer declaration checks and exact package export inventory
   assertions. Describe actual workbook SDK exports with a link to the separate
   ssconvert plan, without executing or modifying its tasks.
8. Store temporary consumer/bundle/log evidence under out; reduce results into
   docs/csvkit and remove only this session's temporary evidence. Preserve prior
   artifacts. Keep all unsupported/unmeasured profiles explicit.
