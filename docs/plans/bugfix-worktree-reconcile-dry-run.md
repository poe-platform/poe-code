# Worktree reconcile dry run

## Independently confirmed behavior

The public registered CLI calls reconciliation unconditionally for
`--dry-run worktree reconcile example --agent codex`. Both leading and trailing
dry-run flags invoke the SDK and produce no preview. The parent and an independent
verifier confirmed the behavior separately.

## Scoped fix

- Modify only `src/cli/commands/worktree.ts`, `worktree-command.test.ts`, and this plan.
- Resolve command flags once, retain the intro, and emit a dry-run preview naming
  the requested worktree and agent before returning without SDK execution.
- Preserve Commander-required name/agent arguments, normal SDK options, and the
  successful reconciliation summary.
- Add no registry preflight, agent policy, confirmations, SDK dry-run flag,
  dependencies, README changes, or unrelated edits.

## TDD and validation

- Confirm red before the production edit using registered commands and mocked SDKs.
- Cover leading/trailing dry-run without --yes and without a TTY.
- Assert zero reconcile/list/remove calls, blocked executor/prompt calls, unchanged
  memfs, and preview-only output rather than a fake successful reconciliation.
- Keep required-argument and normal reconciliation controls.
- Run the full worktree-command suite, scoped ESLint, type checking, and diff checks.
- Use no real agents, LLMs, network requests, or host-file mutations in test flows.

## Parent visual QA

The parent inspected `screenshots/ux-worktree-reconcile-dry-run-before.png` and
owns the after-change actual public CLI screenshot and review. Reuse the safe
fixture to confirm a named worktree/agent preview with no reconciliation call.

## Validation results

- Red: both leading/trailing dry-run regressions failed because reconciliation
  was called once; eight controls passed before the production edit.
- Green: all 10 worktree-command tests passed in 10 ms, including required
  arguments and the unchanged normal SDK options and success summary.
- Scoped ESLint, root `npm run lint:types`, and scoped `git diff --check` passed.
- The parent was notified when tests turned green and source was stable.
- Parent reran the public registered CLI with leading/trailing dry-run flags,
  no TTY or `--yes`, memory-only fixtures, and fail-closed SDK, command, prompt,
  and HTTP dependencies. Both previews named the worktree and agent, invoked
  zero dependencies, and left all fixture files unchanged.
- Parent inspected `screenshots/ux-worktree-reconcile-dry-run-after.png` alongside
  the before image. These are diagnostic captures of actual CLI logger output.
- Parent combined validation passed all 168 worktree and loop command tests.
- Final parent validation passed 835 Explorer, prompt, loop, and worktree tests
  across 40 files, including all four isolated UX fixes together.
