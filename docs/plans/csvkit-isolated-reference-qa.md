# Isolated csvkit reference and coverage QA

Read root and safe-bash AGENTS.md. Preserve existing edits/staging. Do not commit,
push, publish or add README content. This procedure qualifies only the new
reference tooling; it does not certify complete csvkit support.

1. Run `node --import tsx --test packages/csvkit/tools/reference/checks.ts`.
   These explicit tooling checks use in-memory streams and memfs. Confirm exact
   stderr paths, newline/file differences, incomplete captures, missing
   distributions and locale/buffering drift cannot receive compatibility credit.
2. Run `node_modules/.bin/tsc -p packages/csvkit/tools/reference/tsconfig.json`.
   From packages/csvkit run `npm exec -- eslint tools/reference`.
3. Run the maintained `npm test --workspace=@poe-code/csvkit`,
   `npm run lint --workspace=@poe-code/csvkit` and selected uncached build closure
   `npm run build:workspaces -- --workspace=@poe-code/csvkit`. Preserve skips/TODOs
   and explicit refusal assertions outside compatibility pass denominators.
4. Run `node --import tsx packages/csvkit/tools/reference/coverage.ts`.
   Authenticate input hashes and reconcile every option/branch/test/assignment
   against the historical full inventories. Regenerate twice and compare the
   coverage file hash. No historical input, failure or uncollected test is removed.
5. For native qualification, follow docs/csvkit/isolated-reference-tooling.md.
   Use existing, explicitly supplied hash-pinned prerequisites only. Record
   missing binaries/archive/installations as blocked; do not guess paths or use
   a newer Python/csvkit installation as the frozen profile. Native capture is
   outside canonical unit discovery. Keep disposable inputs/output in out.
6. A different agent independently exercises registered safe-bash tools with
   focused ownership, backpressure, cancellation, probe and SQL cleanup cases.
   Fix only reproduced defects after failing regressions. Root owns integration,
   exports and Git. Record refusal assertions separately from differential passes.
7. Reduce final command/results and blockers into docs/csvkit. Purge only scratch
   created by this QA. No release/full-support claim follows from these checks.

TTY/IPython, native DB transactions/results, real drivers/services, controlled
performance, native signal equivalence and any unavailable workbook/compression
oracle require separate cases and qualified captures. Leave them unmeasured.
