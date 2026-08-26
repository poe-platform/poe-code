# Unicode prompt editing bugfix

## Scope

- Change only tracked text/password editing and rendering in interactive `core.ts`, `text.ts`, and `password.ts`, with focused in-memory tests alongside them.
- Reuse the existing zero-dependency `graphemes()` implementation from `dashboard/terminal-width.ts`.
- Preserve UTF-16 cursor offsets at grapheme boundaries, including after insertion, deletion, and `setUserInput` merge adjacent sequences. Snap an offset inside a newly merged grapheme to its end.
- Highlight whole text/placeholder graphemes and render one complete mask string per password grapheme without exposing plaintext.
- Preserve ASCII, initial values, validation, defaults, cancellation, non-TTY input, and untracked option cursors.
- No dependencies, README changes, comments, commits, pushes, or changes to unrelated work.

## Execution

1. Inspect scoped instructions, prompt implementations, and existing stream harness/tests.
2. Add failing regression tests for emoji, combining marks, ZWJ sequences, flags, skin tones, movement/insertion/deletion, line editing, merged grapheme boundaries, colored rendering, placeholders, and password masks.
3. Implement minimal grapheme-aware tracked editing and rendering.
4. Run focused interactive tests, package tests, targeted ESLint, and package TypeScript checking.
5. Hand off the green changes for the parent's full prepush, screenshots, review, and release workflow.

## Validation

- Baseline visual reproduction is already owned by the parent: `screenshots/ux-unicode-prompt-editing-before.png`. Do not revert files or recreate it.
- All new fixtures use the existing memory-only prompt harness; no filesystem fixtures, LLM calls, or network calls.
- Red: the focused Unicode suite failed 71 assertions with 18 controls passing before production edits (89 tests, 45 ms test execution).
- The existing `fast-wrap-ansi` dependency NFC-normalizes rendered frames. Rendering assertions account for this existing display behavior; submission assertions still require the exact original Unicode sequence. No input normalization or replacement is added.
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 125 tests in 10 files, including all 89 focused Unicode tests and existing nontracked prompt controls.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,014 tests in 67 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checks.
- Test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/toolcraft-design/src/prompts/interactive/unicode.test.ts` passed.
- `git diff --check` passed. Unrelated dirty manifests, plans, and terminal-pilot assets remain untouched.
- Ready for the parent's full prepush. Screenshots, final review, commits, and releases remain with the parent; none were performed here.

## Parent review and QA

- Reviewed cursor-boundary changes, whole-grapheme text highlighting, and mask positioning. The existing segmentation helper is reused without new dependencies; nontracked selection cursors are unchanged.
- Re-ran all 125 interactive tests successfully (1.04 seconds total).
- Repeated real PTY text editing before and after the patch: `A😀B`, Left twice, then `X` previously split the surrogate pair and now returns exact `AX😀B`; deleting the initial emoji now returns the empty string instead of a lone surrogate.
- The real password prompt previously left one invalid surrogate after typing an emoji and deleting it. Afterward, an emoji displays one mask; a subsequent Chinese character displays a second mask, and two Backspaces remove both completely. Only synthetic input was used; plaintext was never rendered by the password prompt.
- Captured and inspected `screenshots/ux-unicode-prompt-editing-before.png` and `screenshots/ux-unicode-prompt-editing-after.png`. The screenshot renderer's bundled font lacks the emoji glyph and displays a missing-glyph box for the intact emoji; real PTY output and exact-string assertions verify the correct character. No font installation or renderer changes were made.
- The colored PTY frames highlight the entire emoji rather than separate replacement characters. Existing unit checks cover combining marks, ZWJ sequences, flags, placeholders, and custom masks.
