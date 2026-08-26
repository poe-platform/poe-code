# Harness prompt cancellation

## Scope and contract

Only `src/cli/commands/harness.ts`,
`src/cli/commands/harness-command.test.ts`, and this plan change. No dependencies,
README edits, new code comments, commits, pushes, or unrelated changes.

Both interactive prompt cancellations must retain exactly one existing
`cancel("Operation cancelled.")` notice and throw `OperationCancelledError`
instead of `ValidationError`. Existing bootstrap handling then returns without
redundant error logging or an error exit. Unmatched selections and blank
directories remain validation errors. Explicit paths, single-pair discovery,
non-TTY checks, `--yes`, scaffolding, and running-agent cancellation remain intact.

## Sequence

1. Add memfs regressions for both prompts in normal and dry-run modes, using
   `Symbol.for("poe.cancel")` and the real design-system cancellation predicate.
2. Confirm cancellation tests fail before changing production code; retain
   controls for unmatched selections and blank directory answers.
3. Import `OperationCancelledError` and replace only the two cancellation throws.
4. Run scoped harness/bootstrap tests, scoped ESLint, and TypeScript checks.

Cancellation regressions require two complete discovered markdown/script pairs
for `harness run`, and `harness new ralph-demo audit` without `--dir` or `--yes`.
Assert one notice, no execution/worktree/spawn calls, no output beyond the existing
`harness new` heading (no output for selection cancellation), and an
unchanged memfs volume, including templates. No new runtime execution, host-command
execution, network calls, LLM calls, or disk fixtures are used by these tests.
Reuse existing bootstrap silent-cancellation tests rather than adding another
bootstrap mocking layer.

## Visual QA ownership

Parent reports actual PTY reproductions in
`screenshots/ux-harness-run-cancel-before.png` and
`screenshots/ux-harness-new-cancel-before.png`. The run reproduction was verified
with two complete pairs after correcting an initial one-pair setup. Both show
the cancellation notice followed by a redundant error and exit 1, without a
diagnostic-log attempt. Parent owns after-change PTY/screenshot QA; this worker
does not create screenshots or execute actual harnesses/agents.

## Validation evidence

### Red

`node_modules/.bin/vitest run src/cli/commands/harness-command.test.ts -t 'silently cancels|unmatched harness selection|blank harness directory' --reporter=verbose`

- Before production edits: four cancellation cases failed with `ValidationError`
  instead of `OperationCancelledError`; four validation controls passed, 91 skipped.
- Test execution: 14 ms. Both prompts were reached in normal and dry-run modes.

### Green

`node_modules/.bin/vitest run src/cli/commands/harness-command.test.ts src/cli/bootstrap.test.ts`

- 114 passed: 99 harness tests, including eight new cases, and 15 existing
  bootstrap tests. Harness execution: 116 ms; total command duration: 2.41 s.
- The first post-fix run exposed two overly strict output assertions: scaffold
  cancellation retains the existing `harness new` heading. Corrected only those
  assertions, preserving production output; the subsequent full scoped run passed.
- Existing bootstrap tests confirm silent cancellation causes neither error
  logging nor `process.exit`. Existing cancelled-spawn behavior stays covered.
- The runner emitted a `MaxListenersExceededWarning` and the expected Commander
  diagnostics from invalid-template controls; no tests failed in the final run.

### Static checks

- `node_modules/.bin/eslint src/cli/commands/harness.ts src/cli/commands/harness-command.test.ts`: passed.
- `npm run lint:types`: passed (`tsc -p tsconfig.build.json --noEmit`).
- `git diff --check -- src/cli/commands/harness.ts src/cli/commands/harness-command.test.ts docs/plans/bugfix-harness-prompt-cancellation.md`: passed.

No dependencies added. Production changes are one import and two error-class
replacements. Parent was notified immediately after the scoped suite turned green;
after-change visual QA is recorded below.

## Parent terminal validation

Repeated Escape through actual command creation and bootstrap for both prompts.
Run discovery was explicitly checked to contain two complete memfs pairs, so it
reached the selector rather than auto-selecting a single pair. Scaffold creation
used the same valid built-in kind and basename as the before capture.

Visually inspected `screenshots/ux-harness-run-cancel-after.png` and
`screenshots/ux-harness-new-cancel-after.png` against their before counterparts.
Each retains exactly one cancellation notice and removes the additional error.
Assertions confirm normal return with no exit call, zero diagnostic log attempts,
and unchanged in-memory files. No harness script, agent, network request, or
template write ran. Screenshots remain ignored and use the existing terminal-png
package; no persistent QA script or dependency was added.
