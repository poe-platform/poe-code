# let declaration lookahead QA

1. Reproduce sloppy Script and dynamic async/generator early errors with the
   independent test, retaining valid normal-function await/yield declarations,
   explicit semicolons and string-literal ASI controls.
2. Run the five affected parser test files, scoped lint and maintained SafeJS build.
   Verify the exact proposed parser/test bytes in the isolated HEAD candidate.
3. Rerun the two ledger failures and their recorded controls in original pinned
   strict/sloppy upstream contexts. Check source hashes and terminal accounting.
4. Execute built SDK/native syntax, sloppy direct/indirect eval, saved generator
   source, three pending replay cycles, completed replay, authority denial and
   enforced step-budget controls on the available Node binaries and Bun.
5. Capture and inspect the built CLI error, comparing line/column/message to SDK.
   Record all failed probe attempts and unverified runtime/publication cells.
