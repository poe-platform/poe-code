# Non-TTY prompt abort bugfix

## Scope

- Change only `readNonTtyLine` in interactive `core.ts`, plus a new focused `non-tty-abort.test.ts` beside it.
- Widen line-reader settlement to `string | typeof CANCEL`; a local abort handler sets cancellation state and settles `CANCEL`.
- Keep one settlement guard, remove the helper's abort listener before closing readline on every settlement, and recheck the signal after listener registration.
- Preserve normal/empty lines, partial/empty EOF, pre-abort behavior, silent non-TTY output, untouched raw mode, and select/confirm/multiselect non-TTY rejection/defaults.
- Cover actual text/password prompt functions and exported wrappers without mocking them.
- Input close/destroy/preclosed hangs, validation/default semantics, TTY lifecycle, and all core code outside the helper remain out of scope.
- No dependencies, proxy helpers, comments, README changes, commits, pushes, or unrelated edits.

## Execution

1. Inspect the helper, public wrappers, and memory-only stream harness.
2. Add red tests for empty/partial abort, pre-abort, normal settlement and late abort, repeated/racing abort, setup races, and listener cleanup ordering.
3. Add local abort settlement inside the existing helper only.
4. Run focused and interactive tests, notifying the parent when green before extended checks.
5. Run package tests, lint/types, and diff checks; record red/green evidence.

## Validation And Handoff

- Fixtures use in-memory streams, actual public functions/wrappers, settlement spies, and immediate event-loop flushes; no filesystem fixtures, network/LLM calls, or slow timeout assertions.
- The parent captured and inspected `screenshots/ux-non-tty-abort-before.png`: a clearly labeled diagnostic API probe, not an interactive UI screenshot. Both public text/password wrappers stayed pending after abort, then returned the buffered value at EOF while output remained silent. Do not recreate or revert this baseline.
- The parent owns QA/screenshots/review and any commit/release workflow.
- Unrelated dirty manifests, the shell-quote plan, terminal assets, and concurrent disjoint work must remain untouched.
- Red: before production edits, the focused suite reported 28 failures and 34 passing controls across 62 tests (54 ms test execution). Abort regressions reproduced both pending promises and partial-value returns after EOF through actual public functions and wrappers.
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/non-tty-abort.test.ts --reporter=dot` passed all 62 tests; the final focused rerun took 34 ms of test execution.
- Interactive: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 386 tests in 14 files. The parent was notified before extended checks.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,275 tests in 71 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checks. Targeted test checking caught cleanup callbacks returning streams; those callbacks now return void, and the focused suite and all checks were rerun successfully.
- Test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/toolcraft-design/src/prompts/interactive/non-tty-abort.test.ts` passed.
- `git diff --check` passed. The production diff is confined to `readNonTtyLine`, retaining one settlement guard and removing only its own abort listener before its readline close call.
- Ready for parent after-QA/review. The diagnostic before-QA path is recorded above; no after-QA screenshots, commits, or pushes were performed here. Unrelated dirty manifests, the shell-quote plan, terminal assets, and other committed files remain untouched.
- Parent review and public-wrapper after-QA passed: abort settled text and password with `CANCEL` before EOF, removed input data/end/error listeners and the owned abort listener, and left output silent. The parent inspected `screenshots/ux-non-tty-abort-after.png` against the before diagnostic. Neither image is presented as interactive UI output.
- Parent regression run passed all 802 interactive-prompt, launch-command, and completion-command tests in 16 files.
