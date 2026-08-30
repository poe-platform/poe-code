# Production author: content-regex executor handoff

## Status and scope

**Partial production handoff, not default acceptance.** Source is frozen at
`b1939d76b8e28687320a7253380a00b446424548`. The independent verifier must review
this batch before acceptance. The root explicitly prohibited expanding into
`src/commands/search/{glob,walk}.ts` pending user authorization. Those files still
construct/execute untrusted CLI/ignore-file regexes on the host; broad rg regex
safety remains blocked. No walker copy, disabled ignore workflow, new lifecycle
contract, unapproved export value, registry behavior or unrelated source change
was used to evade that boundary.

The independent baseline-ready marker was read before production edits. Its
freeze is `5d1e65357734198744004baa0d5724ee4ebb6688`; manifest SHA-256 is
`772f035871d070c7b2966a003ae51fa670faa608010265286dd2feaacc92a645`.
Author expectation freeze: `1a9b20d`. Current root authorization separately
allowed `StandardCommandsOptions.regex` and its single grep-factory forwarding
call, plus a type-only root export. These are the only related integration edits.
Historical design/review/validation files were not edited. `audit.json` checks
all **659** historical artifact hashes against the independent freeze.

## Exact API and behavior

```ts
import {
  MemoryFileSystem, Shell, standardCommands, searchCommands,
  type RegexExecutionOptions,
} from "virtual-bash";

const regex: RegexExecutionOptions = {
  requestTimeoutMs: 1000, startupTimeoutMs: 3000, maxWorkers: 2,
};
const shell = new Shell({ fs: new MemoryFileSystem() })
  .use(standardCommands({ regex })).use(searchCommands({ regex }));
const result = await shell.exec("printf 'cat\\n' | grep -E 'c.t' | rg cat -");
await shell.dispose();
```

Both `createStandardCommands({ regex })` and `createSearchCommands({ regex })`
also accept this typed option. Actual moved bare-ESM and declaration consumers
verify these APIs. No command-line flags or ambient configuration are introduced.

Defaults per configured executor: active request **1000ms**, worker startup
**3000ms**, **2** live/terminating workers, **64** FIFO waiters, **128MiB** accounted
queued input, **100ms** idle retirement, requested **128MiB** V8 old generation
and **4MiB** stack. Queue counts/bytes may be zero; other values are positive
safe integers, timers at most 2,147,483,647ms. These are explicit resource-policy
values, not cumulative Shell/descriptor-session allowances. Queue input includes
UTF-16 descriptor storage, row bytes and documented per-item accounting overhead.
No prototype pattern/record/hit/result/call caps were copied into production.
`resourceLimits` are not RSS, external-buffer, process-OOM or hard real-time bounds.

All dynamic content-pattern construction, validation and matching, including rg
fragment variants, occurs in static workers. The matching graph imports only
`node:buffer`, `node:worker_threads` transport and its local protocol/matching
modules; it contains no FS/network/subprocess, eval or generated-source path.
Grep byte/BRE/ERE/capture/selection behavior and rg JS Unicode/empty-byte/invalid-
UTF8 behavior are preserved. The existing named-rg-backreference loophole remains
accepted and is now explicitly documented; no dialect migration was made.

Each command definition owns a lazy pool. Request leases span dispatch, reply
validation and awaited cleanup, not source/sink/VFS waits. Idle invocation
handles do not reserve workers. Last-invocation close awaits retirement; idle
workers/timers are unref'd and retire automatically even during open I/O waits.
Abort removes its queued entry or terminates only its active worker, awaits
cleanup and retains caller error precedence. The worker cache holds one
descriptor with rg's bounded fragment variants, not cumulative session counters.

Ordinary available records batch at targets of 128 records/64KiB, with no new
source-chunk reads and no arbitrary anchor splitting. The target is checked
before taking another available record; a legitimate larger record stays whole.
Quiet, file-list, finite-match-count and binary early-stop paths use single-row
requests to avoid evaluating records after selection would already have stopped.
An ordinary multirow active-request resource failure rejects that request; this
granularity is documented, not presented as unchanged per-line timeout behavior.

## Validation and preserved failures

Final scoped run: **730/730**, zero failed/cancelled/skipped/TODO. This consists
of **56 author tests** plus **674 existing grep/search tests**, including local
native comparisons, actual Shell pipelines, streaming and stdin metadata.
`scoped-handoff.tap` is the raw result. No full `npm test` run was performed.
The historical dangerous search-stress safety test was explicitly excluded.

Author controls include real workers with controlled transport faults, FIFO
count/byte exhaustion, queued/startup/active cancellation, separate executors,
worker exit/malformed replies, idle retirement, disposal, default inspection,
explicit short benign request/startup timeouts, host-construction tripwires,
1030 sequential requests, >16 patterns, >4096 hits/>64KiB range results, >8MiB
input, rg's full 100000-hit boundary, real blocked VFS/sink capacity reuse,
entered uncooperative stdin/stdout cancellation and late rejections.

Preserved outcomes, no expectation relaxation:

- Initial existing cohort 111/111; initial executor cohort 13/13.
- `commands-initial.tap`: 29/30. The author fixture incorrectly supplied an array
  to `ShellOptions.commands` instead of the inspected public `.use(...)` API.
  Typecheck also caught nonasync test sinks. Corrected only the fixture/types;
  the expected pipeline status/output stayed unchanged. Next cohort 43/43.
- `batch-budget-before.tap`: 0/1. A later 100001-match benign rg record suppressed
  earlier `a\n` output. Preflight batching now flushes before crossing its target;
  unchanged regression passes in `batch-budget-after.tap` and final cohort.
- `early-stop-before.tap`: 0/4. Grep/rg `-q` and `-m1` initially dispatched three
  available rows even though the first sufficed. Single-row early-stop requests
  preserve the frozen one-dispatch expectation; `early-stop-after.tap` is 4/4.
- Initial build hit unrelated concurrent `src/commands/split/split.ts:69` typing.
  Later product builds pass. A later global typecheck hit unrelated
  `tests/commands/stream-next-stress/independent.test.ts:91`; its raw diagnostic
  remains. Scoped source/public-consumer/test typechecks pass. No foreign fix.
- One formatting-only generated apply_patch envelope had duplicate patch
  delimiters and was rejected without edits; a corrected envelope applied.

Three actual product packaging passes are retained across source refinement:
`package-evidence.json`, `package-final-evidence.json` and the authoritative
`package-handoff-evidence.json`. Each creates an offline npm tarball, extracts
then moves it, checks eight JS/declaration worker assets against emitted hashes,
compiles a public consumer, runs a bare Node22 ESM consumer and an idle-exit child.
No runtime dependency installation or copied prototype package was involved.

Each packaging pass includes six tiny complete-command output-equivalent timing
observations (three/tool, alternating order), plus a real pipeline. Thus **18**
author tiny timing observations were actually executed across the three passes;
only the final six describe the handoff source. No baseline speed ratio or large
duplicate benchmark is claimed; independent verification owns comparative timing.
Final complete-command observations: grep 12.61–18.50ms, rg 12.42–13.88ms;
corresponding worker startup approximately 10.77–12.65ms. These are small cohosted
Darwin ARM64 Node22.22.2 observations, not performance superiority or peak RSS.
Local oracle identities: rg 15.2.0, Darwin BSD grep 2.6.0-FreeBSD; no GNU grep
installation or GNU/Linux profile is claimed.

Final package archive SHA-256:
`31ed4fbddc7c22b00fb9acb0d5213c8be08a323e4cb0a9079970278b2c48c4dd`.
Its consumer records **8 workers**, all terminated exactly once, threadId -1,
zero remaining owned message/error/exit listeners, zero active workers before
process exit. The final executor cohort separately records **17 workers**, zero
active before safety cleanup and zero owned listeners afterward. Other test
cohorts are not falsely assigned these exact instrumentation counts. The
idle-exit child deliberately proves non-pinning, distinct from awaited cleanup.
All package child commands exit zero; artifacts are retained ignored, not deleted.

## Commands and remaining limits

Key final commands (raw earlier runs remain beside them):

```sh
npm run build
node_modules/.bin/tsc -p tests/commands/regex-execution/tsconfig.json
node --import tsx --test tests/commands/regex-execution/commands.test.ts tests/commands/regex-execution/executor.test.ts tests/commands/search.test.ts tests/commands/search/rg.test.ts tests/commands/search/safety.test.ts tests/commands/search/pipelines.test.ts tests/commands/search-stress/streaming.test.ts tests/commands/search-stress/pipelines.test.ts tests/commands/search-stress/review.test.ts tests/commands/search-stress/differential.test.ts tests/commands/search-stress/stdin-metadata.test.ts tests/commands/search-stress/stdin-shell.test.ts
node tests/commands/regex-execution/package.mjs handoff
node tests/commands/regex-execution/audit.mjs
```

Evidence scripts use no-overwrite claims; do not rerun their existing output
labels. `audit.json` records exact source/emitted/package/TAP identities. Its
source hashes distinguish this batch from the moving shared worktree/HEAD.
The package captures the actual dirty-vs-frozen status and other-owner context.

Production pathological allocation: **author 0/2 used**; independent maximum four
remains separate, no transfer/retry. Historical twelve are archived; prior
revision author use was zero. No dangerous current baseline, nested-pattern
warmup/fuzz or default-1000ms pathological measurement occurred. Explicit 25ms
timeouts were tested only with benign withheld transport/ready messages. No
approval refusal, broad kill, user/native artifact removal or claim of 72 hours.

Residuals: host glob/ignore regex is an explicit acceptance blocker; a different
verifier's current-source review is still required. Event-loop/termination delay,
process-wide OOM, uncooperative host work and ordinary multirow resource-failure
granularity remain documented limits. This is not a full-project gate, universal
parity, full production/default acceptance or superiority claim. Source edits
stop after the stable author-ready marker pending root/independent findings.
