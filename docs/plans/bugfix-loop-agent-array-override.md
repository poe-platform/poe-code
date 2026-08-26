# Loop agent array overrides

## Confirmed bug and rationale

Ralph and experiment run commands ignore explicit single-agent CLI overrides when
frontmatter supplies an agent array. This contradicts their CLI override contract
and the shared resolver's precedence for an explicitly provided agent. Invalid
explicit agents are also silently ignored.

The existing Ralph test named “keeps frontmatter array fan-out when --agent is also
provided” encoded that defect. Replace its expectation with the explicitly selected
agent while retaining its document and iteration assertions.

## Minimal fix

- In Ralph's existing array branch, resolve a nonblank explicit agent before
  returning the configured array. Keep existing frontmatter validation in place.
- In experiment's existing array branch, resolve an explicit single agent before
  returning the configured array. Leave comma-separated multi-agent handling and
  scalar resolution unchanged.
- Preserve alias normalization and model suffixes through the existing command
  resolvers. Unsupported explicit agents must raise validation errors rather than
  silently falling back to the array.
- Preserve no-override rotation and existing blank-string behavior. With array
  frontmatter, an empty string retains the array in both commands. Whitespace-only
  input retains Ralph's array but selects experiment's existing default agent.
- Do not change SDKs, flags, providers, configuration resolution, or cancellation.

## Read-only investigation

Experiment's scalar path calls `resolveDefaultAgent` without a read-only option;
the underlying non-read-only config reader can recover malformed configuration.
However, dry-run command configuration is already resolved read-only before agent
selection, so malformed static configuration fails before reaching that lookup.
There is no confirmed ordinary static mutation repro from this observation.

The fix resolves array overrides directly in the existing array branch rather than
routing them through that lookup. No unrelated read-only change is included.

## TDD and validation

Use public command registrations, existing SDK mocks, and memfs fixtures only:

- Add 28 cases covering both commands in actual mocked dispatch and dry-run modes:
  explicit `codex`, `claude`, and `claude:cli-model`; invalid explicit agents;
  no override; empty input; whitespace-only input.
- Assert exact SDK agent values for dispatch and resolved agent summaries for
  previews, including retained frontmatter ordering and model suffixes.
- Assert unchanged memfs contents, no prompts or spawning, and no execution SDK or
  integration loading during dry runs.
- Correct the existing Ralph array-override test and strengthen experiment's
  comma-separated override control with array frontmatter and a CLI model suffix.
- Red: 17 failures and 13 passing controls before production edits.
- Green: all 30 focused cases pass after the six-line production addition; focused
  test execution takes 40 ms.
- Scoped ESLint and `npm run lint:types` pass.
- The entire command test file passes: 158 tests, 156 ms of test execution,
  including existing scalar precedence, validation, cancellation, and batch paths.
- Parent owns after-change public CLI screenshot QA, review, commit, and push.
  Parent already inspected `screenshots/ux-loop-agent-override-before.png`.
- Parent reran both public command registrations against memfs with fail-closed
  SDK, prompt, command, and HTTP dependencies. Explicit `codex` and model aliases
  took precedence; no override preserved rotation; unsupported overrides failed.
  All eight cases left fixture files unchanged and invoked no blocked dependency.
- Parent inspected `screenshots/ux-loop-agent-override-after.png`, a diagnostic
  capture of actual dry-run CLI logger output, alongside the before image.
- Parent combined validation passed all 168 loop and worktree command tests.
- Final parent validation passed 835 Explorer, prompt, loop, and worktree tests
  across 40 files, including all four isolated UX fixes together.

## Changed files

- `src/cli/commands/ralph.ts`
- `src/cli/commands/experiment.ts`
- `src/cli/commands/experiment-ralph.test.ts`
- `docs/plans/bugfix-loop-agent-array-override.md`
