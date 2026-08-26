# Prompt pagination focus bugfix

## Scope And Invariants

- Change `pagination.ts` and its tests, with public select/multiselect regression tests only where needed.
- Keep a contiguous window of original option indices containing the active option; remove only inactive boundary options.
- Derive omission markers from the final original-index window, not the initial candidate window.
- Count wrapped option rows and wrapped marker rows against the available row budget.
- If the budget cannot accommodate the active option, keep that entire option ahead of neighbors or markers. This does not promise physical fit in an impossibly small terminal.
- Preserve the existing explicit minimum-five candidate behavior for `maxItems` values 1, 4, and 5, normal windows, APIs, and visual language.
- No dependencies, README changes, code comments, commits, pushes, or edits to unrelated work, including concurrent completion changes.

## Execution

1. Inspect pagination, option renderers, and the existing in-memory prompt harness.
2. Add red tests for short/narrow windows, final omission markers, wrapped row budgets, impossible budgets, and public navigation/toggling/resizing.
3. Replace unsafe trimming with original-index boundary trimming that preserves focus and budgets final markers.
4. Run focused pagination and interactive tests, then package tests, targeted lint/types, and diff checks.
5. Record red/green evidence and hand off to the parent for screenshots and review.

## Validation

- All new stream fixtures are in memory and use actual key bytes and resize events; no filesystem fixtures, LLM calls, network calls, or timeout-based assertions.
- The parent already inspected `screenshots/ux-prompt-pagination-before.png`; do not recreate the baseline or revert files.
- The parent owns after screenshots, final review, and any commit/release workflow.
- Red: before production edits, the pagination/select/multiselect suites reported 19 failures and 18 passing controls across 37 tests (45 ms test execution). Failures reproduced missing active options, stale markers, wrapped-budget errors, and public navigation/toggle/resize bugs.
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/pagination.test.ts packages/toolcraft-design/src/prompts/interactive/select.test.ts packages/toolcraft-design/src/prompts/interactive/multiselect.test.ts --reporter=dot` passed all 37 tests (34 ms test execution).
- Interactive: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 229 tests in 11 files. The parent was notified when green before package checks.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,118 tests in 68 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checks. Targeted TypeScript checking of all three changed test files also passed with `--noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck`.
- `git diff --check` passed. Existing minimum-five windows remain covered for `maxItems` 1, 4, and 5 at the beginning, middle, and end.
- Ready for parent screenshots/review. Concurrent completion/text changes and unrelated dirty manifests, plans, and terminal assets were preserved; no dependencies, README changes, commits, or pushes were made.

## Parent Review And Visual QA

- Reviewed original-index boundary trimming, final omission markers, and wrapped marker accounting. The active option is never removed; impossible row budgets preserve it without claiming the entire frame physically fits.
- Repeated the original 80-column, seven-row scenario in an actual TTY. Four Down keys now show focused Echo and a top omission marker; Enter returns Echo. The multiselect equivalent visibly checks Echo on Space and returns only Echo on Enter. Both restore the cursor and exit cleanly.
- Captured and inspected `screenshots/ux-prompt-pagination-select-after.png` and `screenshots/ux-prompt-pagination-multiselect-after.png` against the before image.
- With public prompt functions and in-memory streams, resized a focused long Charlie label from 80x20 to 12x10 and back. Focus and submitted value remain Charlie. Inspected `screenshots/ux-prompt-pagination-narrow-after.png` for the narrow wrapped state; this resize check is not a real-terminal resize claim.
- Parent reran all interactive tests plus completion tests: 507 tests across 12 files passed. QA adds no dependencies or persistent test scripts.
