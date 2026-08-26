# Explorer grapheme Backspace

## Confirmed bug

Five Explorer input paths remove one UTF-16 code unit with `slice(0, -1)`:
the main filter, focused filter, second-list filter, modal input, and palette query.
Deleting emoji can leave a lone surrogate; combining sequences, ZWJ sequences,
flags, and skin-tone modifiers can also be split. A corrupted filter can hide all
rows, and submitting a modal can return the corrupted string.

## Minimal fix

Import the existing `graphemes` function from `dashboard/terminal-width.ts`. At
exactly those five sites, replace code-unit deletion with
`graphemes(value).slice(0, -1).join("")`.

Do not add a production helper or dependency. Preserve the existing DEL-byte and
`ESC[3~` Delete mappings, ignored Ctrl+H behavior, keybindings, filtering, layout,
modal submission, and palette cursor clamping.

## TDD coverage

Add `reducer-unicode.test.ts` using the real `parseKeypress` and reducer with
in-memory states. Feed Unicode code points through parsed terminal key events,
then delete through the real DEL-byte mapping.

- Across all five input paths, cover emoji, combining marks, ZWJ sequences, flags,
  skin-tone modifiers, mixed ASCII/emoji, ASCII-only input, and empty input.
- Verify exact remaining strings after each deletion, restored list rows and
  cursors, an empty modal submission result, and palette cursor clamping.
- Across all five paths, verify Ctrl+H stays ignored and `ESC[3~` still performs
  Backspace, now deleting the whole grapheme.
- Keep action handlers inactive. No real files, LLM calls, network requests,
  screenshot tests, or persisted QA scripts are introduced.

## Validation

- Red: 35 failures and 10 passing ASCII/empty controls before production edits.
- Green: all 45 regressions pass after the import and five replacements, with
  12 ms of test execution.
- Scoped ESLint and package TypeScript checking pass.
- Before the approved boundary update, Explorer tests had 142 passes and one
  import-boundary failure; the full package had 1,457 passes and that same failure.
  After the exact allowlist addition, all 1,458 package tests across 74 files pass.
  Scoped ESLint and package TypeScript checking also pass on the final source.
  The parent confirmed the disjoint prompt worker was green before full-package
  testing.
- Parent approved expanding scope only to `reducerAllowed` in
  `explorer/imports.test.ts`. Add exactly `dashboard/terminal-width.ts`: it is an
  existing pure `Intl.Segmenter`/width utility with no I/O, and the render boundary
  already permits it. Keep the rest of the boundary test intact rather than moving
  or duplicating the helper, broadly allowing dashboard imports, or bypassing the
  check.
- Parent owns after-change screenshot QA and repeats the actual `runExplorer`
  runtime in a real PTY with the terminal driver, typed emoji, DEL, and Ctrl+C.
  Parent inspected both before artifacts:
  `screenshots/ux-explorer-grapheme-backspace-before.png` and
  `screenshots/ux-explorer-grapheme-backspace-tty-before.png`.
- Parent repeated the real-PTY runtime with the same synthetic rows and tool-fed
  emoji, DEL, and Ctrl+C. After one Backspace, the filter is empty, both rows and
  their preview return, and the runtime exits cleanly. No business actions were
  configured or executed.
- Parent inspected `screenshots/ux-explorer-grapheme-backspace-tty-after.png`
  alongside the actual-PTY before image; the corrupted glyph and empty results
  are gone.
- Final parent validation passed 835 Explorer, prompt, loop, and worktree tests
  across 40 files, including all four isolated UX fixes together.

## Changed files

- `packages/toolcraft-design/src/explorer/reducer.ts`
- `packages/toolcraft-design/src/explorer/reducer-unicode.test.ts`
- `packages/toolcraft-design/src/explorer/imports.test.ts` (`reducerAllowed` only)
- `docs/plans/bugfix-explorer-grapheme-backspace.md`

No loop command files, other workers' changes, README, commits, or pushes are part
of this task.
