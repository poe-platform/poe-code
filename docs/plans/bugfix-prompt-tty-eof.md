# TTY prompt EOF lifecycle bugfix

## Scope

- Change only lifecycle handling in `packages/toolcraft-design/src/prompts/interactive/core.ts` and add focused in-memory lifecycle tests beside it.
- Preserve the committed Unicode fix, tracked input editing, and existing Ctrl+D keybindings. React to actual readline/input closure, not the key itself.
- Unexpected readline close or input close must finalize cancellation, settle `CANCEL`, restore terminal state, and detach prompt-owned listeners.
- Cleanup must remain idempotent when normal submission, cancellation, abort, and repeated close events overlap.
- Preserve pre-abort behavior, non-TTY text/password EOF values, and non-TTY option-prompt rejection.
- No dependencies, README changes, code comments, commits, pushes, or unrelated changes.

## Execution

1. Inspect current prompt lifecycle and the existing memory-only stream harness.
2. Add red tests for empty-buffer Ctrl+D, empty/nonempty EOF and destruction, cleanup, repeat-close and finalization races, preclosed input, and normal behavior controls.
3. Add minimal shared unexpected-close cancellation and listener cleanup without changing editing.
4. Run focused lifecycle and interactive tests; notify the parent when green before extended checks.
5. Run package tests, ESLint, package/test TypeScript checks, and diff checks; record evidence.

## Validation And Handoff

- All new fixtures use in-memory streams, immediate event-loop flushes, and settlement spies; no slow timeout assertions, filesystem fixtures, LLM calls, or network calls.
- The parent already captured `screenshots/ux-prompt-eof-before.png`; do not revert or recreate the baseline.
- The parent owns real-PTY after validation, screenshots, final review, commits, and releases.
- Red: before production edits, the focused lifecycle suite reported 38 failures and 33 passing controls (71 tests, 54 ms test execution), with unsettled promises detected by spies after immediate event-loop flushes.
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 196 tests in 11 files, preserving all 125 existing interactive/Unicode controls. The parent was notified before extended checks.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,085 tests in 68 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checking.
- Test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/toolcraft-design/src/prompts/interactive/lifecycle.test.ts` passed.
- `git diff --check` passed. The production diff changes lifecycle setup, cancellation, and cleanup only; committed Unicode editing/rendering and Ctrl+D editing semantics remain unchanged.
- Existing dirty manifests, the unrelated plan, and terminal-pilot assets remain untouched. Ready for the parent's real-PTY after check and screenshots; no commits or pushes performed.

## Parent review and QA

- Reviewed closure-event ordering, finalization guards, listener removal before normal readline closure, and the preclosed-input branch. Unicode editing and non-TTY behavior are unchanged.
- Re-ran all interactive and completion tests together: 419 tests passed across 12 files.
- Before the patch, real Ctrl+D on an empty text prompt left the result unresolved and cursor cleanup missing; Node exited 13 with an unsettled-top-level-await warning.
- After the patch, the same real PTY sequence returned cancellation and restored the cursor. A subsequent select prompt on the same input also cancelled cleanly; no option was submitted.
- A nonempty text control (`abc`, Ctrl+D at end, then Enter) remained active after Ctrl+D and submitted exact `abc`, confirming that the fix does not turn every Ctrl+D into cancellation. The full after run exited 0.
- Captured and inspected `screenshots/ux-prompt-eof-before.png` and `screenshots/ux-prompt-eof-after.png`. No dependencies, user configuration changes, or business operations were involved.
