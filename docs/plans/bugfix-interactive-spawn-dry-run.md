# Interactive spawn dry run

## Independently confirmed behavior

Interactive spawn calls `spawnInteractive` before reaching the ordinary spawn
dry-run guard. The actual PTY reproduction used a partial agent-spawn mock with
all child-process methods blocked: `--yes --dry-run spawn --interactive claude-code
hello --mode auto` still called the blocked interactive executor and emitted no
preview. Memfs remained unchanged. Memory probes also confirmed flag placement,
alias canonicalization, and explicit model/mode/argument forwarding.

## Scoped fix

- Modify only `src/cli/commands/spawn.ts`, `spawn-command.test.ts`, and this plan.
- Build the resolved interactive options once and share them between the existing
  dry-run formatter and actual interactive execution.
- Place the guard after existing interactive validation and model resolution,
  immediately before execution, inside existing cleanup try/finally blocks.
- Preserve unsupported-mode, worktree-conflict, and TTY validation order. Non-TTY
  interactive dry runs still reject; worktree conflicts still precede TTY errors.
- Preserve non-dry exit codes and integration/workspace cleanup.
- Reuse `formatSpawnDryRunMessage` without reconstructing executable argv. It
  redacts prompt text and reports its character count; forwarded arguments remain
  visible and quoted as before, not secret or redacted.
- Do not change SDK options, providers, integration-loading policy, dependencies,
  comments, README files, or unrelated work.

## TDD and validation

- Confirm red with bounded registered-command tests using existing mocks and memfs.
- Cover both dry-run flag placements, canonical agent and alias, empty/typed
  prompts, shared model/mode/cwd/resume/argument options, and cleanup.
- Assert no executor/SDK/command calls, unchanged memfs, and preserved exit status
  during dry run; preserve real-execution and validation controls.
- Notify the parent when green and source is stable, then run the full spawn
  command suite, scoped ESLint, type checking, and scoped diff checks.
- Never execute an agent, LLM, network request, or host-file mutation in test flows.

## Parent visual QA

The parent captured and inspected
`screenshots/ux-interactive-spawn-dry-run-before.png` and owns after-change PTY QA,
screenshots, review, and commit. Reuse the blocked-executor fixture: expect a
redacted-prompt preview and no interactive executor call.

## Validation results

- Red: five expected failures showed interactive executor calls during dry run;
  four execution/validation controls passed before production edits.
- Green: all nine focused tests passed in 18 ms, including unchanged memfs,
  preview option parity, cleanup, validation ordering, and exit-code preservation.
- Full spawn-command suite: all 135 tests passed in 287 ms.
- Scoped ESLint, root `npm run lint:types`, and scoped `git diff --check` passed.
- The parent was notified when focused tests were green and source was stable,
  then again after full validation. After-change PTY QA remains with the parent.
- Parent actual-PTY after-QA passed using the public registered command with both
  SDK and child-process execution blocked. The command prints the existing
  redacted-prompt preview, leaves memfs and exit status unchanged, and never calls
  an executor. The parent inspected
  `screenshots/ux-interactive-spawn-dry-run-after.png` against the before image.
- Parent combined regression run passed all 686 interactive-prompt, Gaslight,
  and spawn-command tests in 17 files after preserving incoming main changes.
