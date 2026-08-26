# Gaslight dry-run previews

## Confirmed bug

The registered `gaslight` and `gaslight daemon` actions ignore the existing global
`--dry-run` flag at their execution boundaries. Both call the execution SDK even
when a preview was requested, including with `--worktree`.

Configuration and selection already use read-only resolution. The fourth argument
to `resolveAgentAndModel` is `useConfiguredAgent`, not a read-only switch. This fix
does not claim or address configuration writes.

## Command-only fix

- Add a dry-run return after existing selection and configuration resolution, but
  before each execution SDK call.
- For an ordinary run, show ordered plan paths, resolved agent and optional model,
  known configuration source, explicit mode, worktree intent, and effective
  archive-on-success behavior: CLI, then command configuration, then YAML, then
  false.
- For the daemon, show the configured watch directory, ready regular plan
  eligibility, poll interval, agent and optional model, known configuration source,
  explicit mode, worktree intent, and its existing archive-on-success behavior.
- Parse daemon polling before the preview guard and before registering signal
  handlers. Reuse the parsed value for normal execution.
- Do not load business plans to build previews, scan the daemon directory, compute
  rounds, or report invented completion counts. Preserve existing selection
  cancellation and configuration errors.
- Leave normal SDK options, ingest, and install behavior unchanged. No SDK changes,
  new options, dependencies, helpers, README changes, or other harness changes.

## TDD and checks

Use public command registration, existing SDK mocks, and memfs-only fixtures in
`src/cli/commands/gaslight.test.ts`:

1. Six run/daemon cases cover global flag placement before, between, and after
   command arguments, including worktree intent, configuration paths, explicit and
   configured models, ordered plans, configured watch directory, and explicit and
   default polling.
2. Five run cases cover agent/model and archive precedence, omitted unknown details,
   and disabled worktree intent.
3. Two configuration-error controls preserve failures without preview output.
4. Two invalid-poll cases cover normal and dry-run daemon invocation without signal
   registration.

Execution SDKs and spawning fail closed. Assert they are never called, so their
worktree, archive, and daemon-loop execution paths remain unreachable. Assert
unchanged memfs contents, no prompts, no signal registration, no completion outro,
and no reads of explicitly supplied business plans. No real runner, LLM, network,
or on-disk test fixtures are used.

- Red: 13 failures before the fix; 11 preview cases reach the SDK sentinels and two
  invalid-poll cases register signal handlers. Both configuration-error controls
  already pass.
- Green: all 15 focused cases pass after the fix, with 34 ms of test execution.
- Scoped ESLint and `npm run lint:types` pass.
- The full Gaslight command suite passes: 61 tests, with 84 ms of test execution,
  including existing normal-dispatch, ingest, install, and cancellation controls.
- Parent owns after-change screenshot QA, review, commit, push, and release
  monitoring. Parent already inspected
  `screenshots/ux-gaslight-dry-run-before.png` using fail-closed execution probes.

## Parent QA

Parent actual-PTY after-QA passed both registered commands with fail-closed SDK
stubs: previews return without execution, memfs changes, or SIGINT/SIGTERM listener
registration. The parent inspected `screenshots/ux-gaslight-dry-run-after.png`;
run output shows the ordered plan and effective settings, while daemon output
describes monitoring rather than claiming completed work.

The parent combined regression run passed all 686 interactive-prompt, Gaslight,
and spawn-command tests in 17 files after preserving incoming main changes.

## Changed files

- `src/cli/commands/gaslight.ts`
- `src/cli/commands/gaslight.test.ts`
- `docs/plans/bugfix-gaslight-dry-run.md`
