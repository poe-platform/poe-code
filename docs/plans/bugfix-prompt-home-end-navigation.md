# Prompt Home/End navigation bugfix

## Scope

- Change only `updateTrackedInput` in interactive `core.ts` to move to offset zero for normalized `home` and to `userInput.length` for normalized `end`, returning immediately.
- Add bounded stream regressions in `home-end.test.ts` using the existing in-memory harness.
- Preserve Unicode grapheme editing, password masking, Ctrl+A/E, lifecycle handling, non-TTY behavior, and option prompts.
- Do not change raw escape parsing, `mapKey`, Ctrl+D, Ctrl+W, word movement, other keybindings, APIs, or visual language.
- No dependencies, README changes, code comments, commits, pushes, or unrelated edits.

## Execution

1. Inspect the current tracked-input handler and public prompt test harness.
2. Add red tests for all eight Home/End encodings in both text and password prompts, Ctrl+A/E controls, Unicode, text initial values, empty/repeated boundaries, and rendered cursor/mask positions.
3. Handle the two normalized key names directly without modifying other editing paths.
4. Run focused and interactive tests; notify the parent when green before extended checks.
5. Run package tests, lint/types, and diff checks, then record evidence.

## Validation And Handoff

- All fixtures use memory-only prompt streams and actual key bytes; no filesystem fixtures, LLM calls, network calls, or timeout-based assertions.
- The parent already captured and inspected `screenshots/ux-prompt-home-end-before.png`; do not recreate or revert the baseline.
- The parent owns after-TTY validation, screenshots, review, and any commit/release workflow.
- Runtime: Node v22.22.2, matching the independent verifier.
- Red: before production edits, the focused suite reported 35 failures and 6 passing Ctrl+A/E and empty-input controls across 41 tests (53 ms test execution).
- Green: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive/home-end.test.ts --reporter=dot` passed all 41 tests (43 ms test execution), covering every requested escape encoding in both public prompts.
- Interactive: `node_modules/.bin/vitest run packages/toolcraft-design/src/prompts/interactive --reporter=dot` passed all 270 tests in 12 files. The parent was notified before extended checks.
- Package: `npm run test --workspace=toolcraft-design -- --reporter=dot` passed all 1,159 tests in 69 files.
- Lint/types: `npm run lint --workspace=toolcraft-design` passed package ESLint and TypeScript checks.
- Test types: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck packages/toolcraft-design/src/prompts/interactive/home-end.test.ts` passed.
- `git diff --check` passed. The production diff adds only two early-return key handlers inside `updateTrackedInput`; other keybindings, Unicode editing, rendering, lifecycle, and non-TTY paths are unchanged.
- Ready for the parent's after-TTY/screenshots/review. Unrelated dirty manifests, the shell-quote plan, and terminal assets remain untouched; no commits or pushes performed.

## Parent Review And Visual QA

- Reviewed the eight-line production change: it uses normalized key names and existing tracked-input boundaries, without altering shared action mapping or lifecycle behavior.
- In an actual TTY, typed `abcd`, moved Left twice, pressed Home, then typed `X`: both text and password prompts submitted `Xabcd`. The matching End sequence submitted `abcdX` in both prompts. All four prompts restored the cursor and the process exited cleanly.
- Captured and inspected `screenshots/ux-prompt-home-end-after.png` against the text-only before screenshot. The after image includes the corrected text results and masked cursor frames immediately after Home/End; password sample contents were asserted without displaying them.
- Parent independently reran all 270 interactive tests across 12 files; all passed. No business command, user configuration, dependency, or unrelated file was involved in QA.
