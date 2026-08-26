# Runtime final log tail

## Confirmed causes and scope

- Detached Docker streaming reads logs before checking the exit marker, so output
  arriving between those operations is lost. The producer publishes its marker
  only after tee ends; one post-exit read can safely collect the final bytes.
- CLI streaming independently truncates output after a status-check timeout: it
  awaits one pending chunk and then breaks instead of consuming iterator completion.
- Change only Docker execution-env implementation/tests, runtime jobs shared
  implementation/tests (runtime command tests only if needed), and this plan.
- Do not modify SDKs, log producers, cancellation behavior, dependencies, README
  files, comments, or unrelated changes. The separately confirmed Ctrl+C issue
  is explicitly deferred.

## TDD and implementation

1. Demonstrate deterministic red in both layers using bounded memory runners and
   fake timers, including delayed CLI chunks after a terminal status check.
2. Reuse Docker's offset and UTF-8 decoding loop for exactly one final read after
   a detached exit marker. Do not poll again or read again for lost jobs,
   non-follow snapshots, or container-level completion without a detached job.
3. After terminal CLI status, consume the existing pending read and all remaining
   iterator output to completion without additional status polling.
4. Cover empty first/final reads, split UTF-8, resumed offsets, nonzero exits,
   final read errors, ordinary polling, and non-follow controls. Preserve cleanup.
5. Run focused tests, process-runner unit tests excluding real-Docker integration,
   runtime command tests, scoped ESLint, package/root types, and diff checks.

## Parent visual QA

The parent captured and inspected `screenshots/ux-runtime-final-log-tail-before.png`
and owns after-change actual CLI QA/screenshots/review. Verify the final chunk is
printed exactly once even when terminal status arrives before a pending chunk.

## Validation results

- Deterministic red: seven Docker cases and four CLI cases failed, with 44
  controls passing. The clean red run had no unhandled rejections or timeouts.
- Focused green: all 55 Docker/shared tests passed after the two-layer fix.
- Updated two existing Docker polling fixtures with an empty final-read response;
  their original output and UTF-8 assertions remain unchanged.
- Full process-runner unit package plus runtime command/shared suites: all 208
  tests passed across 10 files in 2.44 seconds. Real-Docker integration was
  explicitly excluded; new regressions use only memory runners and virtual time.
- Scoped ESLint, process-runner package types, root `npm run lint:types`, and
  scoped `git diff --check` passed.
- No changes were needed in `runtime.test.ts`. Ctrl+C cancellation remains
  deferred; no signal emission or cancellation fix was added.

## Parent after-change integration QA

- Passed the actual public CLI with the actual Docker adapter, a mock runner,
  and memfs, delaying the first tail response by 350 ms.
- Output was exactly `["Starting task", "Task complete: 3 files processed"]`,
  with no leading space on either message.
- Observed two tail reads (the second using `tail -c +15`) and two status reads.
- No fixture disk mutation or job kill occurred.
- The parent captured and inspected
  `screenshots/ux-runtime-final-log-tail-cli-after.png` against
  `screenshots/ux-runtime-final-log-tail-cli-before.png`.
