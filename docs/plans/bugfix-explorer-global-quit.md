# Explorer global quit

## Confirmed bug and contract

`docs/plans/explorer-tui-overhaul.md` specifies that Ctrl+C always quits. The
reducer instead dispatches modal and focused-filter input first. Ctrl+C is ignored
by focused filters, palettes, help, and content overlays; input and confirmation
modals are dismissed without quitting.

An exit-only fix is insufficient: an action awaiting `ctx.promptText` or
`ctx.confirm` remains pending unless its modal resolver is cancelled. The runtime
correctly waits for pending effects before settling the Explorer promise.

## Minimal fix

- Handle the existing builtin quit immediately after resolving the keybinding,
  before modal and focused-filter dispatch.
- If a modal exists, call the existing `modalDismissed` with `null`. Input resolves
  to `null`; confirmation resolves to `false`. A destructive action is never
  confirmed or dispatched by this path.
- Emit one exit effect using the resulting state, and remove the old later quit
  case. Do not alter runtime cleanup, pending-effect waiting, Escape semantics,
  keybindings, or the prior grapheme Backspace fix.
- Add no helpers, dependencies, production comments, or SDK behavior.

## TDD coverage

Use real `parseKeypress` events and in-memory reducer/runtime fixtures:

- Ten reducer states cover list, detail, main filter, focused filter, second-list
  filter, palette, help, content, input, and confirmation. Each checks one-key quit
  and unchanged Escape behavior. Modal cases also retain an underlying focused
  filter and verify cancellation values without destructive dispatch.
- A runtime palette test verifies that one parsed Ctrl+C settles Explorer and
  stops the fake terminal driver exactly once.
- Two runtime action tests await input or confirmation, then verify one Ctrl+C
  cancels the resolver and stops the driver exactly once. A controlled cleanup
  promise proves Explorer still waits for the action before settling.
- Assertions use bounded event-loop turns, not hanging waits for the regression.
  Red-path cleanup releases test gates and closes an active fake terminal.
- Existing ordinary quit, Escape, destructive-confirmation, detail cancellation,
  and suspension controls remain in place. No real files, network calls, LLMs,
  business actions, screenshot tests, or persisted QA scripts are introduced.

## Validation

- Red: nine failures and 20 passing controls before production changes.
- Green: all 29 focused tests pass after the reducer fix; focused test execution
  takes 373 ms.
- Scoped ESLint and package TypeScript checking pass.
- All 166 Explorer tests across 23 files pass, including the existing grapheme
  Backspace regressions.
- The full-package run passes 1,482 tests and encounters eight failures in the
  concurrently added `prompts/interactive/non-tty-error.test.ts`. That disjoint
  worker's files remain untouched; the full package is not yet green.
- Parent owns after-change actual-PTY QA, review, commit, and push. Parent inspected
  `screenshots/ux-explorer-modal-ctrl-c-tty-before.png`, where Ctrl+P followed by
  Ctrl+C left the palette open and required Escape plus Ctrl+C for cleanup.
- Parent repeated the public runtime in a real PTY for palette, awaited input,
  and awaited confirmation. One tool-fed Ctrl+C exited each run; input resolved
  to null and confirmation to false. Raw mode and input/resize listeners were
  restored, and no timeout cleanup was used.
- Parent inspected `screenshots/ux-explorer-modal-ctrl-c-tty-after.png`, a
  diagnostic report of those actual-PTY assertions. Only synthetic dialog actions
  ran; no agents, commands, network requests, or business-file changes occurred.
- After both disjoint workers finished, parent full-package validation passed all
  1,494 tests across 76 files, resolving the temporary concurrent-test failures.
- Final parent validation passed 1,723 design-system and Gaslight/loop/worktree
  command tests across 79 files with all seven queued fixes together.

## Changed files

- `packages/toolcraft-design/src/explorer/reducer.ts`
- `packages/toolcraft-design/src/explorer/reducer-quit.test.ts`
- `packages/toolcraft-design/src/explorer/runtime.test.ts`
- `docs/plans/bugfix-explorer-global-quit.md`
