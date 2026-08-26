# Non-TTY prompt input-error bugfix

## Scope

- Change only `readNonTtyLine` in interactive `core.ts`, plus focused `non-tty-error.test.ts` regressions.
- Reject pending text/password input errors with the exact original Error object, without converting them to cancellation or partial values. Skip validation and successful finalization.
- Use the existing single-settlement path, marking settlement before closing readline. Remove only owned readline error/line/close and input close/abort listeners; preserve unrelated listeners.
- Preserve normal line/EOF, consumed EOF, abort, premature close, validation/default handling, silent non-TTY output, and all TTY behavior.
- No process-level exception handlers, raw-value/password logging, dependencies, proxy helpers, comments, README edits, commits, pushes, or unrelated changes.

## Execution

1. Inspect the published reader and existing in-memory transport/validation coverage.
2. Run bounded public-wrapper regressions red using synchronous input error emission, so missing readline error handling does not create global uncaught-exception races.
3. Add rejection and owned interface-listener cleanup within the existing settlement path.
4. Verify real `destroy(originalError)` through public wrappers once the error handler exists, without synthetic cleanup.
5. Run focused interactive regressions and targeted lint/types. Notify the parent when green; avoid full-package tests while the disjoint Explorer worker is red.

## QA And Evidence

- The parent captured and inspected `screenshots/ux-non-tty-input-error-before.png`, a diagnostic public API probe rather than an interactive UI or live CLI exploit. The parent owns after-QA using actual destruction, screenshots, review, and publication.
- Tests use memory streams, the existing harness, direct settlement assertions, and immediate event-loop flushes. No files, subprocesses, network/LLM calls, timeout assertions, or global exception handling.
- Preserve unrelated manifest/security-plan/assets changes and the disjoint Explorer worker's edits.
- Red before production edits: 8 failures and 1 passing EOF control across 9 cases (11 ms test execution). Failures reproduced synchronous forwarded errors and owned listeners remaining attached at settlement or immediately before helper-driven closure.
- Initial green: all 9 cases passed after changing only `readNonTtyLine` to reject errors through its guarded settlement path and detach its named interface listeners.
- Added 4 real `destroy(originalError)` cases after the handler existed: public text/password wrappers, empty/partial Unicode input, with/without a signal. These reject with exact Error identity, complete stream destruction, remove owned listeners, skip validation, and remain silent without synthetic cleanup.
- Focused green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/non-tty-error.test.ts --reporter=dot` passes all 13 cases (13 ms test execution). Readers remain real; ownership cases reuse an observed real interface to inspect listener references before and after closure.
- Interactive green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passes 537 tests in 17 files, including prior Unicode, rendering, pagination, EOF/abort/close, and validation regressions. The parent was notified before extended checks.
- Targeted ESLint passes for `core.ts` and `non-tty-error.test.ts`. Strict ES2022/NodeNext TypeScript checking of both files and their imports passes. `git diff --check` passes.
- Full-package tests were deliberately not run while disjoint Explorer work was active; parent coordination/global hooks own that combined check.
- Source is stable and ready for parent after-QA/review. No after-QA screenshots, process-level exception handlers, commits, pushes, dependencies, or unrelated edits were made.
- Parent repeated real `destroy(originalError)` through both public wrappers,
  with empty and partial input and empty-message errors. All promises rejected
  the original objects, validation was skipped, output stayed silent, and owned
  listeners were removed while caller listeners remained intact. No global
  exception catcher or synthetic end event was needed.
- Parent inspected `screenshots/ux-non-tty-input-error-after.png` alongside the
  baseline; both are diagnostic public-API reports.
- After both disjoint workers finished, parent full-package validation passed all
  1,494 tests across 76 files, including Explorer quit and every prompt regression.
- Final parent validation passed 1,723 design-system and Gaslight/loop/worktree
  command tests across 79 files with all seven queued fixes together.
