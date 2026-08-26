# Tasks sync confirmation cancellation

## Confirmed behavior

Interactive Escape at the resource-provisioning confirmation returns the real
`Symbol.for("poe.cancel")`. The command treats it like an explicit decline,
prints the incomplete-sync report, and sets exitCode to 1.

## Scoped fix

- Change only `src/cli/commands/tasks.ts`, `tasks-command.test.ts`, and this plan.
- Throw `OperationCancelledError` on cancellation before provisioning or reporting.
- Reuse `handleCommandError` and bootstrap silent-error handling unchanged.
- Preserve explicit false decline, JSON, --yes, non-TTY, authentication/report
  failures, and any pre-existing exitCode 130.
- Add no dependencies, README edits, or cancellation UI.

## TDD and validation

- Remove the always-false isCancel mock and exercise the real predicate.
- Mock confirmation with the real symbol; mock sync/auth and use memfs workflows.
- Confirm red before changing production: cancellation must reject with the
  correct class, skip a second sync and reporting, and leave memfs unchanged.
- Exercise the command through real bootstrap with error logging and process exit
  intercepted: cancellation must resolve silently, leave default success status
  unchanged, and preserve a pre-existing exitCode 130.
- Run the full tasks-command and existing bootstrap suites for green, then notify
  the parent before targeted ESLint and type checking.
- Make no real GitHub, credentials, network, or host-file mutations in test flows.

## Parent QA handoff

The parent saved the before-change source at `/tmp/poe-code-tasks-before-cancel.ts`
and owns actual prompt QA, screenshots, and releases. Compare Escape against an
explicit false decline using the same fixture; only cancellation becomes silent.

## Validation results

- Red: all four cancellation regressions failed before the production change;
  direct invocation resolved instead of rejecting, and bootstrap left exitCode 1
  instead of preserving undefined or 130.
- Green: `vitest run src/cli/commands/tasks-command.test.ts src/cli/bootstrap.test.ts --no-cache`
  passed all 85 tests (70 tasks-command, 15 bootstrap), including the existing
  explicit-false decline, JSON, --yes, non-TTY, and report-error controls.
- The parent was notified of green before lint/type validation began.
- Targeted ESLint, `npm run lint:types`, and scoped `git diff --check` passed.
- Actual prompt QA and screenshots remain with the parent.

## Parent review and QA

- Reviewed the cancellation-only branch. Explicit false continues into the existing incomplete-sync report and failure status.
- Re-ran tasks, bootstrap, and completion suites together: 220 tests passed, including decline, JSON, non-TTY, and existing-exit-status controls.
- Ran the real design-system confirmation in a PTY before and after the patch, using actual task command registration, logger, and bootstrap. Pressed Escape in both runs.
- Before: the cancelled prompt was followed by the failed-sync report and status 1. After: no report or extra error, normal status 0. Both runs made exactly one mocked non-provisioning sync call, no provisioning call, no process-exit call, and no error-log write; memfs remained unchanged.
- Task-list/auth operations and workflow-option resolution were injected boundaries for this UI check. No real GitHub operation, credential lookup, or workflow parsing was attempted; parser coverage remains in the unit suite.
- Captured and inspected `screenshots/ux-tasks-sync-cancel-before.png` and `screenshots/ux-tasks-sync-cancel-after.png`. Screenshots are ad hoc artifacts, not committed tests.
- No dependencies, README changes, or user configuration changes were introduced.
