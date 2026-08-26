# Wrapped menu line prefixes bugfix

## Scope

- Change only active-menu line assembly in `select.ts` and `multiselect.ts`, plus their tests.
- Split each already-wrapped pagination entry at newline boundaries and apply the existing colored bar and two-space indent to every physical line, including blank lines and wrapped omission markers.
- Preserve existing ANSI sequences, wrapping decisions, row counts, focus, checked values, omission markers, and resize behavior.
- Multiselect menu bars remain cyan while active and yellow during a genuine required-selection validation error.
- No rewrapping, helpers, pagination/core changes, API changes, dependencies, README changes, comments, commits, pushes, or unrelated edits.
- Width three cannot fit prefix plus content and remains out of scope, as do submitted summaries, error-message text, headers, and generic frame wrapping.

## Execution

1. Inspect current active-menu rendering and public stream tests.
2. Add red tests for labels/hints wrapped at widths 4, 8, 12, 20, and 80; explicit newlines/blank lines; marker continuations; and real multiselect validation errors.
3. Update existing focus/resize assertions to require the entire wrapped label with every expected prefix, preserving focus and checked-value assertions.
4. Apply the minimal `flatMap`/newline split in both active-menu renderers.
5. Run focused and interactive tests, notify the parent when green, then run package tests, lint/types, and diff checks.

## Validation And Handoff

- Tests use existing memory-only prompt streams and actual key bytes; no filesystem fixtures, LLM calls, network calls, or slow timeout assertions.
- The parent captured and inspected `screenshots/ux-menu-wrapped-lines-before.png`; do not recreate or revert the baseline.
- The parent owns after-PTY/screenshots/review and any commit/release workflow.
- Red: before production edits, the select/multiselect suites reported 18 failures and 15 passing controls across 33 tests (63 ms test execution). Failures covered missing continuation/blank/marker prefixes, yellow error bars, and prefix-aware focus/resize assertions.
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/select.test.ts packages/toolcraft-design/src/prompts/interactive/multiselect.test.ts --reporter=dot` passed all 33 tests (65 ms test execution).
- Interactive: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 286 tests in 12 files. The parent was notified before extended checks.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,175 tests in 69 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checking. Targeted TypeScript checking of both changed test files also passed with `--noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck`.
- `git diff --check` passed. The production diff changes exactly one active-menu mapping expression in each renderer, leaving pagination, core, wrapping, and out-of-scope frame policies untouched.
- Tests retain exact wrapped content, checked values, focus, marker, and resize assertions while requiring each physical prefix. Width 80 supplies unwrapped controls; widths 4/8/12/20 retain the existing wrapped row counts and ANSI sequences.
- Ready for parent after-PTY/screenshots/review. Unrelated dirty manifests, the shell-quote plan, and terminal assets remain untouched; no dependencies, commits, or pushes were made.

## Parent Review And Visual QA

- Reviewed both active-menu mapping changes: each existing wrapped physical line receives the existing border and indentation, without additional wrapping, row-budget changes, or altered values.
- Repeated the 20-column actual-TTY scenario in select and multiselect with the original long label and dim hint. Every active-menu continuation now remains inside the frame. Enter and Space/Enter still return the expected alpha selection; both prompts restore the cursor and exit cleanly.
- Captured and inspected `screenshots/ux-menu-wrapped-lines-after.png` against `screenshots/ux-menu-wrapped-lines-before.png`. These images show active menus; submitted summaries and header/error-message wrapping remain outside this fix.
- Parent independently reran interactive and completion suites: all 624 tests across 13 files passed. Existing focus, pagination, and input-editing regressions remain covered. No dependencies or user configuration changes were introduced.
