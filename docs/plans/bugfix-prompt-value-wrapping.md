# Prompt value-body wrapping bugfix

## Scope

- Update only value-body rendering branches in interactive `text.ts`, `password.ts`, `select.ts`, and `multiselect.ts`.
- Call the existing `wrapTextWithPrefix` directly with each existing styled payload, the existing state-colored bar plus two spaces, and `opts.output ?? process.stdout`.
- Cover text/password active, validation-error, submitted, and cancelled bodies; cover select/multiselect submitted and cancelled bodies. Password bodies must use masked content only.
- Preserve raw values, Unicode editing, ANSI inverse/dim/strikethrough styles, state colors, default/custom masks, count summaries, and unwrapped rendering.
- Keep the active-menu prefix fix unchanged. No new helpers/proxies, dependencies, core/pagination/generic wrapping changes, header/error-footer policy changes, README changes, comments, commits, or pushes.
- Widths at or below the prefix width are out of scope. Preserve unrelated dirty work and incoming committed files.

## Execution

1. Inspect the renderers, existing wrapping helper, and public prompt tests.
2. Add bounded red tests using real key bytes and in-memory streams for affected states, explicit blank lines, long placeholders, mid/end cursors, Unicode raw returns, ANSI styles, and secret masking.
3. Wrap only affected styled body payloads with the existing helper.
4. Run focused and interactive tests, notifying the parent when green before extended checks.
5. Run package tests, lint/types, and diff checks; record evidence for handoff.

## Validation And Handoff

- Every asserted physical body line must carry its state-colored prefix and stay within the tested display width. Headers and error footers are not included in body assertions.
- All new fixtures stay in memory; no filesystem fixtures, LLM calls, network calls, or timeout assertions.
- The parent already captured and inspected `screenshots/ux-prompt-value-wrap-before.png`; do not recreate or revert the baseline.
- The parent owns after-PTY/screenshots/review and any commit/release workflow.
- Red: before production edits, the focused suite reported 29 failures and 9 passing unwrapped/count-summary controls across 38 tests (64 ms test execution).
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/value-wrapping.test.ts --reporter=dot` passed all 38 tests (91 ms test execution).
- Interactive: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 324 tests in 13 files, including existing active-menu, pagination, Unicode, navigation, and lifecycle coverage. The parent was notified before extended checks.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,213 tests in 70 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checking.
- Test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/toolcraft-design/src/prompts/interactive/value-wrapping.test.ts` passed.
- `git diff --check` passed. The production diff imports the existing helper in four renderers and wraps affected styled body payloads only; active-menu assembly, core, pagination, helper implementation, headers, and error footers remain unchanged.
- Exact raw Unicode returns, masked-only password output, inverse/dim/strikethrough ANSI sequences, gray/cyan/yellow body prefixes, blank rows, 20-column body widths, and 80-column/count-summary controls are covered.
- Ready for the parent's after-PTY/screenshots/review. Incoming committed files and unrelated dirty manifests, the shell-quote plan, and terminal assets were preserved; no dependencies, commits, or pushes were made.
- Parent review: a real 20-column PTY captured six active/submitted text/password and submitted select/multiselect frames. Every continuation retained its border, passwords stayed masked, and all raw returned values matched the input. `screenshots/ux-prompt-value-wrap-after.png` was inspected against the before capture.
- Parent regression run: all 385 interactive-prompt and launch-command tests passed in 14 files. No dependency was added.
