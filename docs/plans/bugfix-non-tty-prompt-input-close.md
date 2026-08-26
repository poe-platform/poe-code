# Non-TTY prompt input-close bugfix

## Scope

- Change only `readNonTtyLine` in interactive `core.ts`, with a new focused `non-tty-close.test.ts` beside it.
- Cancel pending input closure without EOF and already-destroyed input that has not ended.
- Return an empty string for already-consumed readable EOF, checking `readableEnded` before `destroyed` so normal auto-destruction does not turn EOF into cancellation.
- Observe input close only while pending and remove owned close/abort listeners before the helper closes readline on settlement.
- Preserve existing abort behavior, setup races, normal buffered lines/EOF, raw return values, unrelated listeners, and remaining input consumers. Do not drain foreign buffers.
- Stream error propagation, validation/default semantics, TTY rendering/lifecycle, and core code outside the helper remain out of scope.
- No new helpers/proxies, dependencies, comments, README changes, commits, pushes, or unrelated edits.

## Execution

1. Inspect the published helper, abort regressions, and memory-only stream harness.
2. Add red public-function/wrapper tests for pending destroy/close, closed startup, setup races, EOF/autoDestroy controls, cancellation races, and listener/buffer preservation.
3. Add startup checks and pending input-close settlement entirely inside the helper.
4. Run focused and interactive tests; notify the parent when green before extended checks.
5. Run package tests, lint/types, and diff checks; record evidence.

## Validation And Handoff

- Fixtures are in memory with actual public functions/wrappers, settlement spies, and immediate event-loop flushes. No filesystem fixtures, network/LLM calls, or timeout assertions.
- Synthetic `end` events, where needed, are test teardown only after the observed result/assertions; they never drive the result under test.
- The parent reproduced and inspected the before-QA diagnostic API probe at `/tmp/poe-code-non-tty-close-before.txt` and `screenshots/bin-cat-tmp-poe-code-non-tty-close-before.txt.png`. This is not an interactive UI screenshot; do not recreate or revert the baseline.
- The parent owns after-QA/screenshots/review and any commit/release workflow. Preserve unrelated dirty manifests, the security plan, terminal assets, and disjoint worker changes.
- Red: before production edits, the focused suite reported 56 failures and 48 passing controls across 104 tests (111 ms test execution), reproducing pending close/destroy/startup reads and incorrect post-close line/EOF settlement.
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/non-tty-close.test.ts --reporter=dot` passed all 104 tests (58 ms test execution).
- Interactive: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 490 tests in 15 files. The parent was notified before extended checks.
- Final close/abort rerun: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/non-tty-close.test.ts packages/toolcraft-design/src/prompts/interactive/non-tty-abort.test.ts --reporter=dot` passed all 166 tests.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,379 tests in 72 files, including the final rerun after making the setup-time nullable reader initialization explicit for lint.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checking.
- Test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/toolcraft-design/src/prompts/interactive/non-tty-close.test.ts` passed.
- `git diff --check` passed. The production diff is confined to `readNonTtyLine`: readable EOF takes precedence over destroyed startup state, input close is observed before readline setup, owned close/abort listeners are removed on settlement, and a reader created during synchronous cancellation is closed without attaching late listeners.
- Tests verify no startup reads/resumes on closed inputs, preservation of buffered raw values and normal autoDestroy EOF, and preservation of unrelated listeners plus buffered data for a remaining consumer.
- Ready for parent after-QA/review. Baseline diagnostic paths are recorded above. No after-QA screenshots, commits, or pushes were performed; unrelated manifests, the security plan, terminal assets, concurrent Gaslight changes, and other committed files remain untouched.
- Parent public-wrapper after-QA passed all six baseline cases without synthetic events: premature destruction cancels, already-consumed EOF returns empty text, normal partial EOF remains intact, owned input listeners are removed, and output stays silent. The parent inspected `screenshots/bin-cat-tmp-poe-code-non-tty-close-after.txt.png` against the before diagnostic.
- Parent combined regression run passed all 686 interactive-prompt, Gaslight-command, and spawn-command tests in 17 files after preserving incoming main changes.
