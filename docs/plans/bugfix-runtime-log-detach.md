# Runtime log detach cancellation

## Confirmed bug

Ctrl+C prints `detaching (job continues running)` but can leave the public
`runtime jobs attach` command pending indefinitely. Calling an async generator's
`return()` does not interrupt its pending `next()`: Docker log reads, internal
status reads, outer CLI status polling, or polling sleeps can still be blocked.
With `--sync-on-exit`, attachment can also re-enter status polling after detach.

## Fix and invariants

- Add optional `signal` options to `JobHandle.stream` and `JobHandle.status` in
  both process-runner and agent-harness-tools contracts. Existing callers need
  not supply them.
- Give CLI streaming one AbortController. Ctrl+C aborts the stream and outer
  status polling, reports detach, and leaves iterator cleanup to one owner in
  `finally`. Await the pending read and iterator return, remove the SIGINT
  listener, and clear the polling timer. Suppress only the owned cancellation
  reason or the matching timer AbortError; preserve unrelated failures.
- Pass cancellation into local Docker log/status reader executions and an
  interruptible polling sleep. Observe process-result, stdout, and stderr
  promises together. On failure, abort the local reader and await all three
  before returning or throwing. An already-aborted request starts no reader.
- Keep job execution independent: detach never calls `job.kill` or `env.close`.
  Skip status/download synchronization after manual detach, including with
  `--sync-on-exit`; retain synchronization after natural completion.
- Preserve the previous final-tail fix: one additional Docker log read after
  observing detached-job exit, and CLI draining through iterator completion
  after terminal status. Preserve byte offsets and UTF-8 buffering.
- Add no dependencies, SDK flags, README changes, or production inline comments.

## TDD

- Before production edits: 15 new regressions failed, one natural-completion
  control passed, and 103 existing cases were excluded by the focused filter.
- After the fix: all 16 focused cases passed. Three additional reader-failure
  cleanup cases passed for stdout, stderr, and process-result rejection.
- CLI shared tests cover blocked reads, outer status, and terminal draining;
  exactly one iterator return; awaited cleanup; no late writes; timer/listener
  restoration; status failure; and iterator-cleanup failure propagation.
- Docker tests cover blocked log reads, internal status, direct detached and
  container status, polling sleep, and pre-aborted requests. Controlled delayed
  reader closure proves cancellation waits for local cleanup rather than merely
  abandoning a promise.
- Public command tests use registration and memfs to verify detach with and
  without `--sync-on-exit`, plus normal completion synchronization. No job kill,
  environment close, or post-detach download is permitted.
- New tests use fake timers, in-memory streams, mocks, and memfs. They create no
  real subprocess, Docker, network, LLM, or filesystem fixtures. Bounded red-path
  gates prevent test hangs and are released during cleanup.

## Validation

- All 122 tests in the three edited test files pass; all intentional reds are
  cleared. Scoped ESLint passes for all eight edited TypeScript files.
- An extended run passes 140 tests across those files and the 18 existing
  host-runner tests. That existing suite includes local Node subprocess checks;
  it was not modified and is separate from the mock-only new regressions.
- Both workspace builds pass:
  `npm run build --workspace=@poe-code/process-runner` and
  `npm run build --workspace=@poe-code/agent-harness-tools`.
- `npm run lint:types` passes after those builds refresh ignored workspace
  declarations. The earlier root type errors referred to stale declarations,
  not source contract mismatches; no casts or type workarounds were added.
- Parent combined validation passes all 1,891 tests across 95 files covering
  toolcraft-design, agent-trace-viewer, process-runner, runtime commands, and
  trace commands. Real-Docker integration was excluded. The run completed in
  20.13 seconds, including 7.77 seconds of test execution.
- Scoped `git diff --check` passes. No files were staged, committed, or pushed by
  this worker; unrelated staged traces changes and other work remain untouched.

## Parent integration and visual QA

Parent executed the actual public CLI and Docker adapter with an abort-aware
in-memory runner and memfs, using `--sync-on-exit` in each detach case:

1. A blocked log read was aborted and attachment returned.
2. Simultaneously blocked internal and outer status reads were both aborted.
3. A polling sleep was interrupted and attachment returned.

Each case logged exactly `detaching (job continues running)`, with no late
commands/logs, job kill, environment close, or download. Owned reader listeners
and pending reads returned to zero; process SIGINT listeners were restored;
memfs bytes were unchanged. No actual Docker, subprocess, or network was used
in this integration QA.

Parent also verified natural completion with a 350 ms delay: logs were
`Starting task` followed by `Task complete`, with two tail reads and two status
reads. The final tail was preserved, SIGINT listeners restored, and memfs
unchanged.

Parent captured and inspected the diagnostic screenshots
`screenshots/ux-runtime-log-detach-before.png` and
`screenshots/ux-runtime-log-detach-after.png`. Parent owns review, commit, and
push; no screenshot tests or persisted QA scripts were added.

## Changed files

- `packages/process-runner/src/types.ts`
- `packages/agent-harness-tools/src/execution-env.ts`
- `packages/process-runner/src/docker/docker-execution-env.ts`
- `packages/process-runner/src/docker/docker-execution-env.test.ts`
- `src/cli/commands/runtime/jobs/shared.ts`
- `src/cli/commands/runtime/jobs/shared.test.ts`
- `src/cli/commands/runtime/jobs/attach.ts`
- `src/cli/commands/runtime.test.ts`
- `docs/plans/bugfix-runtime-log-detach.md`
