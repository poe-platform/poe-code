# Non-TTY prompt validation bugfix

## Scope

- Validate finite piped text/password input exactly once through the stored validator, then apply successful finalization.
- Text validates and returns raw input or its default or empty text. Initial values and placeholders do not replace empty piped input; whitespace and Unicode remain unchanged.
- Reject invalid finite input without reprompting: truthy string results become errors, returned Error objects retain identity even with empty messages, and thrown errors propagate. Empty-string validation results succeed.
- This restores public API consistency for finite non-TTY reads; it is not a claim of a live CLI exploit. Rejections use only validator-supplied messages/errors, without adding piped values or password contents to errors or terminal output.
- Preserve one-line reads, partial and consumed EOF, abort/close cancellation without validation, transport listener cleanup, silent non-TTY output, and unchanged raw mode.
- Keep TTY behavior and option prompts unchanged. No dependencies, proxy helpers, comments, README edits, commits, pushes, or unrelated changes.

## Execution

1. Inspect stored validation, text finalization, and existing in-memory non-TTY transport tests.
2. Add bounded public-wrapper regressions and run them red before production edits.
3. Share non-TTY validation and finalization in the prompt entry point without changing transport cleanup.
4. Run focused and interactive tests; notify the parent when source is stable and green before extended checks.
5. Run package tests, lint/types, and diff checks; record results.

## QA And Evidence

- The parent captured and inspected `screenshots/ux-non-tty-validation-before.png`; the parent owns after-QA, screenshots, review, and publication.
- Tests use real public text/password wrappers and the existing memory-stream harness. No filesystem fixtures, network, LLM calls, or timeout assertions.
- Preserve all unrelated manifest/security-plan/assets and disjoint loop/worktree changes.
- Initial red: 25 failures and 8 passing cancellation controls across 33 public-wrapper tests, before production edits (14 ms test execution).
- Initial green: all 33 tests passed (10 ms test execution). Review then added a required-multiselect disabled-prompt control, observed its failure, and restricted shared validation/finalization to tracked input so option defaults remain unchanged.
- Final implementation changes only the non-TTY branch of `Prompt.prompt()` in `core.ts`. It uses the stored validator and existing text finalizer; `readNonTtyLine`, TTY handling, and text/password renderers remain untouched.
- Green: all 34 focused cases pass within the interactive run, which passes 524 tests in 16 files. Existing Unicode, pagination, rendering, abort, close, and option-prompt controls remain green.
- Package validation: `npm run test --workspace=toolcraft-design -- --reporter=dot` passes 1,413 tests in 73 files.
- `npm run lint --workspace=toolcraft-design` passes package ESLint and TypeScript checks. Direct strict NodeNext TypeScript checking of `non-tty-validation.test.ts` and `git diff --check` also pass.
- Rejection tests compare exact validator-supplied messages or Error identity and assert silent output with distinctive private Unicode input, including passwords.
- Parent repeated public-API probes with in-memory streams: invalid string/Error
  results reject after one validation call, including empty-message Error identity;
  empty line/EOF use the effective default; whitespace and Unicode stay intact.
  Cancellation skips validation, owned listeners are removed, and output is silent.
- Parent inspected `screenshots/ux-non-tty-validation-after.png` alongside the
  before image. Both are diagnostic API reports, not interactive UI screenshots.
- Final parent validation passed 835 Explorer, prompt, loop, and worktree tests
  across 40 files, including all four isolated UX fixes together.
