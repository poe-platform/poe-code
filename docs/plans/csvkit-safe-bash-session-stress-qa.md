# CSVKit safe-bash session and option-boundary stress QA

Run these procedures against the compiled csvkit domain engine used by the actual
safe-bash registration. All test fixtures use in-memory sources and filesystems;
do not run native programs, network requests, or real databases.

1. Run the uncached actual-command suite with
   `node --import tsx --test --test-reporter=dot 'packages/safe-bash/tests/commands/csvkit*.test.ts'`.
   Require exact stdout, stderr, statuses, and recorded cooperative resource
   effects. Keep any TODO differential explicitly unresolved.
2. Run `npx vitest run packages/csvkit/src/sql2csv.test.ts --reporter=dot`.
   Verify engine and execution options retain null prototypes, `__proto__` is an
   ordinary own property, repeated options preserve last-value precedence, and
   stream/query defaults reach the injected provider unchanged.
3. Verify the csvpy work-budget fixtures actually contain `/data.csv` before
   invoking the command. Named input opening precedes interpreter admission;
   a missing-file failure is not evidence about interpreter work limits.
4. Run scoped lint and strict test declarations, then rebuild csvkit through the
   maintained workspace build closure before rerunning actual-command tests.
   The shell suite imports compiled APIs, so a source-only result is insufficient.
5. Run `csvkit-byte-ownership-review.test.ts` through the actual command suite.
   A named producer repeatedly yields the same one-byte Buffer view and poisons
   its backing storage during finalization. Require exact multibyte output and
   one finalization for csvcut, csvjson, and in2csv JSON without stdin acquisition.

The initial review reproduced three failures: the execution-option object lost
its null prototype, and two interpreter-budget tests omitted their named input.
An original provider-boundary regression reproduced the prototype failure before
the implementation fix. The Unicode long-s duration differential remains an
explicit reference-parity blocker and must not be reported as a pass.
