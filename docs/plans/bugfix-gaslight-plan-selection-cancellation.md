# Gaslight plan-selection cancellation

## Confirmed behavior

Cancelling the interactive plan multiselect returns `Symbol.for("poe.cancel")`.
Gaslight recognizes cancellation but throws an ordinary `Error("Gaslight cancelled.")`,
so bootstrap reports an error and exits with status 1. Normal execution also writes
an error log; dry-run reports the error without writing the log.

## Scope and implementation

- Modify only this plan, `src/cli/commands/gaslight.ts`, and its colocated test.
- Import `OperationCancelledError` and replace only the plan-selection throw.
- Keep install cancellation, validation, running-agent abort status 130,
  configuration loading, and execution flows unchanged.
- Add no dependencies, cancellation notice, comments, or new mock framework.

## TDD and validation

- Remove the always-false `isCancel` mock so tests exercise the real predicate.
- Return the real cancellation symbol in normal and dry-run regression cases.
- Assert the cancellation class/message, unchanged memfs, and no configuration
  loading, execution, spawning, later prompts, or logging.
- Confirm both regressions fail before the production fix and pass afterward.
- Run the existing Gaslight suite for successful selection and explicit-path controls.
- Reuse existing bootstrap tests for silent cancellation without error logging or exit.
- Run targeted ESLint and the repository type check without emitting files.
- Use no actual LLM calls, external commands from Gaslight, network, or host-file
  writes from tested command flows.

## Visual QA handoff

The parent captured the actual PTY before-image at
`screenshots/ux-gaslight-cancel-before.png`, intercepting the real ErrorLogger method
to count one attempt without writing to disk. The parent owns after-change PTY QA:
cancel the same prompt and verify no ERROR, stack/log pointer, or failure exit.

## Validation results

- Red: both new cases failed because the thrown error was not an
  `OperationCancelledError`.
- Green: `vitest run src/cli/commands/gaslight.test.ts src/cli/bootstrap.test.ts --no-cache`
  passed all 61 tests (46 Gaslight, 15 bootstrap).
- Targeted ESLint, `npm run lint:types`, and scoped `git diff --check` passed.
- Parent repeated Escape through the actual command and bootstrap in a PTY with
  the same discoverable-plan memfs fixture. Visually inspected
  `screenshots/ux-gaslight-cancel-after.png`: the cancelled prompt remains, but
  the error and log pointer disappear. Assertions verify no exit call, zero
  diagnostic log attempts, and unchanged memfs. The before capture recorded
  exit 1 and one intercepted log attempt; after returns normally with status 0.
- Diagnostic logging was intercepted in both captures, so no host log was
  written. No credentials, network, LLMs, or agents were used. The ignored
  screenshots use the existing terminal-png package; no QA script was added.
