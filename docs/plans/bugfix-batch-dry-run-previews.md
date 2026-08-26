# Batch dry-run previews

## Bug and scope

Both registered run commands return from the entire action after previewing the
first positional document. Later documents are neither read nor previewed, so a
missing or malformed second document is silently ignored.

Change only the dry-run branch's `return` to `continue` inside each document loop:

- `src/cli/commands/ralph.ts`
- `src/cli/commands/experiment.ts`

Keep SDK dispatch, configuration resolution, finalization, and integration cleanup
unchanged. No other harnesses, dependencies, README edits, or generated assets are
part of this fix.

## TDD regression coverage

Add eight parameterized cases in `src/cli/commands/experiment-ralph.test.ts`, using
the public command registrations and existing plan fixtures and mocks. For each
command, verify:

1. Both documents are read and previewed in positional order with their own agent
   configuration; Ralph also retains each document's iteration count.
2. CLI agent and iteration/experiment-limit overrides apply to both previews.
3. A missing second document raises a path-specific validation error after the
   first preview.
4. Malformed second-document frontmatter raises a path-specific validation error
   after the first preview.

All cases run with `--yes --dry-run`, explicit document paths, and supplied agent
configuration. Assert unchanged memfs contents and fail closed on SDK execution,
journal access, spawning, integration loading, dashboards, or prompts. Fixtures
exist only in memory; no real LLM, network, or filesystem fixture creation occurs.
Existing single-document dry-run and non-dry batch tests remain unchanged.

## Validation

- Red: all eight new cases fail before the two-line production fix. Four observe
  only one preview; four resolve instead of rejecting the invalid second doc.
- Green: all eight pass after the fix; regression execution takes 68 ms.
- Scoped ESLint for the three TypeScript files and `npm run lint:types` pass.
- The entire `experiment-ralph.test.ts` suite passes: 130 tests, 327 ms of test
  execution.
- Parent owns after-change screenshot QA, review, commit, push, and release
  monitoring. The parent already captured and inspected the before screenshot at
  `screenshots/ux-batch-dry-run-before.png`.
- Parent review and actual-PTY registered-command QA passed with memfs and
  fail-closed SDK mocks. Both commands preview A then B, report a missing B after
  previewing A, and leave all files unchanged. The parent inspected
  `screenshots/ux-batch-dry-run-after.png` against the before image; diagnostic
  annotations are distinguished from command output.
