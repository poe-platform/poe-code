# Fix plan selection cancellation

## Scope and contract

Changes are limited to `src/cli/commands/plan.ts`,
`src/cli/commands/plan-command.test.ts`, and this plan. Preserve the committed
archived-plan read fix. No dependencies, README changes, inline comments,
commits, pushes, or unrelated edits.

When interactive `plan view`, `edit`, `archive`, `unarchive`, or `delete` has
no path and the user cancels selection, throw the existing
`OperationCancelledError`. Apply the same behavior through the `plans` alias.
Bootstrap already returns silently for this error without calling
`process.exit`; do not change bootstrap or force an exit code.

An unmatched non-cancel selection must still throw `ValidationError`.
Non-TTY and `--yes` invocations without a path must still require one rather
than prompting or automatically selecting a plan. Cancellation must not
render a preview, open an editor, request confirmation, mutate plans, or
print action output.

## Implementation sequence

1. Add parameterized tests using the real command registration, memfs, and
   the real `isCancel` predicate with `Symbol.for("poe.cancel")`.
2. Cover both aliases and all five commands, including an archived fixture
   for unarchive, plus unmatched-selection, non-TTY, and `--yes` controls.
3. Confirm the cancellation tests fail before changing production code.
4. Import `OperationCancelledError` and use it only in the
   `isCancel(selected)` branch. Leave unmatched-selection validation intact.
5. Run focused command and related bootstrap tests. The parent handles the
   full prepush suite, screenshots, and any release work.

## TDD evidence

Red command:

```sh
node_modules/.bin/vitest run src/cli/commands/plan-command.test.ts --reporter=dot
```

- Before the production fix: 10 failed, 77 passed, 87 total; test execution
  took 130 ms.
- Each cancellation case received `ValidationError` instead of
  `OperationCancelledError` across both aliases and all five commands.
- Unmatched-selection, non-TTY, `--yes`, and existing archived-read controls
  passed. Shared assertions verify unchanged memfs contents and no preview,
  editor, confirmation, outro, stdout, or stderr output.

Green command:

```sh
node_modules/.bin/vitest run src/cli/commands/plan-command.test.ts src/cli/bootstrap.test.ts --reporter=dot
```

- 102 passed across two files; test execution took 428 ms. Includes the
  existing bootstrap cancellation tests asserting no logging or exit call.
- Scoped ESLint, scoped `git diff --check`, and plan-document Prettier
  checks passed.
- The production diff changes only the error import and the cancellation
  throw; unmatched-selection validation and archived-plan reads are unchanged.
- Parent reported a before screenshot at `screenshots/ux-plan-cancel-before.png`
  from an actual PTY Escape through command and bootstrap using memfs:
  red cancellation output and `process.exit(1)`. After screenshot verification
  remains with the parent.
- No full suite, screenshots, commits, or release commands were run here.

## Parent terminal validation

Repeated the real interactive select in a PTY through public command creation
and the actual bootstrap, using the same memfs fixture and pressing Escape.
Visually inspected `screenshots/ux-plan-cancel-before.png` and
`screenshots/ux-plan-cancel-after.png`. The cancelled prompt remains visible;
the redundant error disappears and the observed exit status changes from 1 to 0.
Assertions confirm no exit call with a failure code, no extra cancellation error,
and unchanged in-memory files. No user plan, credential, network, or LLM access
was needed. Screenshots remain ignored; no persistent QA script was added.
