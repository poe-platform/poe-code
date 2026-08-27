# Runtime error log tail

## Confirmed bug

The public `runtime jobs logs` and `runtime jobs attach` commands buffer partial
lines while streaming. Their final flush previously ran only after a successful
stream. If a reader, iterator cleanup, or attach status poll failed after reading
`complete line\npartial diagnostic`, only `complete line` reached the logger.
The original error propagated, but the already-read diagnostic tail was lost.

## Minimal fix

- Wrap each existing `await streamJobLog(...)` in `try`/`finally` and move its
  post-stream `logWriter.flush()` into `finally`.
- Retain the attach callback's flush before the detach message. Flushing the
  emptied buffer again in `finally` produces no duplicate output.
- Keep `--sync-on-exit` after successful streaming, outside `finally`, and retain
  its manual-detach guard. A stream failure must not sync, kill, or close the job.
- Leave shared streaming, cancellation, iterator cleanup, SDK contracts, and
  normal line buffering unchanged. Add no dependencies or production comments.

## TDD coverage

Five parameterized public-registration regressions use the existing fake runtime
factory, memfs job state, real command handlers, and real shared streaming:

- Reader failure in `logs` and `attach`.
- Iterator-return cleanup failure in `logs` and `attach`.
- Outer status-poll failure in `attach`, with an abort-aware pending read.

Each stream splits the partial diagnostic across chunks. Assertions verify the
complete line and diagnostic tail exactly once, original error identity, no
unexpected status re-entry, no download/kill/close, unchanged saved job bytes,
restored SIGINT listener counts, and no remaining timers. Attach cases specify
`--sync-on-exit` to ensure errors do not trigger synchronization.

Fake timers advance status polling without real waits. Pending-read gates are
released in test cleanup, including the red phase. No new filesystem,
subprocess, Docker, LLM, or network fixtures are used.

Existing controls cover natural completion, split lines and blank lines for both
commands, normal completion synchronization, and detach with and without
`--sync-on-exit`. Detach retains exactly one partial tail before its message.

## Validation

- Red before production edits: all five new cases failed specifically because
  `partial diagnostic` was absent; five existing controls passed, with 46 tests
  excluded by the focused filter. Error identity and cleanup assertions already
  passed before the output assertion failed.
- Green after the two command changes: all ten focused cases passed, with 46
  excluded. All intentional reds are cleared.
- Full affected command and shared-stream suites: 70 tests across two files pass
  (56 runtime command tests and 14 shared tests), with 68 ms test execution.
- Scoped ESLint passes for all three edited TypeScript files.
- `npm run lint:types` and scoped `git diff --check` pass.

## Visual QA and ownership

Parent captured the before state through the actual public CLI with memfs in
`screenshots/ux-runtime-error-log-tail-before.png` and reviewed the minimal
production diff. Parent then ran ten actual registered-CLI cases with memfs and
an in-memory runtime factory: reader, cleanup, combined-failure, and natural
completion for both commands, plus attach status failure and detach, including
`--sync-on-exit` coverage.

All ten passed: original error identity was retained, partial diagnostics appeared
without duplication, failures and detach did not sync, only natural completion
synced, cleanup ran once, SIGINT listener counts were restored, and memfs bytes
were unchanged. Parent captured and inspected
`screenshots/ux-runtime-error-log-tail-after.png`. This worker did not duplicate
the ad hoc probe; no screenshot tests or persisted QA scripts are added.

Only the following files are changed for this fix. Shared streaming and other
workers' changes remain untouched; this worker does not stage, commit, or push.

- `src/cli/commands/runtime/jobs/logs.ts`
- `src/cli/commands/runtime/jobs/attach.ts`
- `src/cli/commands/runtime.test.ts`
- `docs/plans/bugfix-runtime-error-log-tail.md`
