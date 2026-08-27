# Cooperative invocation cleanup: runtime author handoff

Date: August 27, 2026. This is runtime-author evidence, not independent
acceptance, compiled/packed worker acceptance, a full gate, or Bash parity.

## Frozen inputs and ownership

- Contract: `07acb1a4d30b7592cf247a0220250317be4e2038`, unchanged.
- Reviewed baseline: source `ef8bbe749b1d4cf129f758ded158f5611b8ac894`,
  review `839f2d468311d170ba80d5bf19db94484f9afd66`.
- Red regression commit: `9dccc4c8d14390cb5b35b5987b4a71f44480da82`.
- Frozen runtime implementation and 43 author tests:
  `4c16d9c5a0e8661bc326a754205559a3e7ea6a32`.
- Author changes are exclusively `src/shell/{cleanup,runtime,shell}.ts`,
  `tests/shell/invocation-cleanup*.test.ts`, and this evidence directory.
  Independent author/holdout/Arch fixtures, contracts, commands, exports,
  filesystem implementations, manifests and dependencies are untouched.
- Arch callback revision observed clean in Git:
  `01aa1bffe0568cc6787d5ff8e0331e024a787385`. This observation is not an
  independent callback review or compiled/packed worker acceptance.

SHA-256:

| File | Baseline | Frozen implementation |
| --- | --- | --- |
| `src/shell/runtime.ts` | `5589f60a1db983538d37168e3b9276555ef71a2bc67446783535e47789f9d6eb` | `2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b` |
| `src/shell/shell.ts` | `4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e` | `0e1d1396490970bf8db4d74ab07115d73e8303d29d7b748e145a06b13b316fee` |
| `src/shell/cleanup.ts` | absent | `134f55641d6437681cd185960a2923d68086096921758717c5b8059595304385` |
| `src/shell/input.ts` | `7af2dac6dfd6290e9f189590e9190b2e0703dcd99998212e471378063cd9a7b4` | unchanged |

The tests import actual `../../src/contracts/index.js`,
`../../src/shell/index.js` and `./helpers.js`; helpers import the actual Shell,
registry and memory filesystem, resolved to TypeScript by tsx. They do not use
stub invokers, alternate runtime copies, or import compiled/packed artifacts.
The accompanying manifest records final source/test hashes. Baseline shell
hashes were checked before writing; no full baseline archive was necessary.

## Implementation and preserved behavior

Every public exec is admitted to its Shell's active registry before command
execution or input construction. Each dispatch and nested invoke has an explicit
private parent-linked scope, carried in internal IO, including redirections,
substitutions and source/eval/function/interpreter contexts. Public command
contexts expose only the committed optional registration capability, not the
scope's close authority. Middleware is admitted before every handler call.

Close synchronously seals the scope tree before notification or callbacks. All
accepted callbacks are started, including siblings of pending/failing callbacks;
all completions are awaited. The memoized drain is established before reentrant
notification. Cleanup is never raced against abort or abandoned on a timeout.
Callbacks must themselves be cooperative and own an idempotent close barrier.

Private scope-interruption signals are separate from public command signals.
Nested invocation retains public signal identity; normally completed contexts
remain un-aborted but reject new registration/invoke. Late invoke is rejected
before iterator construction, filesystem work, middleware or command entry.
Closed detached middleware cannot use saved `next` to enter later middleware.

The public exec outcome is selected after drain: exact caller abort reason,
including an abort arriving during drain, then the existing selected execution
rejection, then one unchanged cleanup failure or an AggregateError of failures.
Presence flags preserve undefined/null rejection values. Ordinary command throws
retain existing diagnostic/status conversion; a nonzero result cannot hide a
cleanup-only rejection. Internal EPIPE/PipelineClosed is not caller abort.
Early-pipeline output/status/pipefail selection remains intact.

Dispose immediately closes new Shell admission, seals active scopes, and aborts
only that Shell's active execution budgets. Repeated/reentrant dispose returns
the same promise. It awaits active scope drains, then already-admitted plugin
setup settlement, then disposes successfully installed plugins in reverse order.
Setup rejection remains observed; setup attempting new host registration after
Shell admission is closed is rejected. Plugin failures are aggregated with
active cleanup failures; cleanup-only failures use their ordinary identity/
aggregation rule. Dispose does not join opaque command/middleware/input losers.
This retains the existing wait for plugin setup and cooperative plugin disposal;
it is not a hard-preemption guarantee for uncooperative plugin setup/disposal.

The existing nonblocking pending-input-close policy is unchanged. Runtime race
losers and returned nested-invocation rejections are observed without joining
opaque host work. Shared leases are closed only by their registered owner hooks;
there is no global worker cancellation, global worker-zero wait, or ambient
current scope. No new budget, first-read/beginOutput API or runtime dependency.

## Evidence, including failed intermediate runs

All counts below are actual executions, not inventories. Node v22.22.2,
npm 10.9.7, Darwin arm64; zero runtime dependencies. Local scheduling/concurrent
repository work is not controlled, so these durations are not benchmarks.

| Run | Result | Evidence and scope |
| --- | --- | --- |
| Untouched-runtime focused red | 0/5 pass, 5 fail | `red.tap`; before source edits, baseline hashes above |
| First expanded intermediate run | 380/389 pass, 9 fail | `initial-controls.tap`; dirty intermediate implementation, not frozen or source-snapshotted |
| Final author + preservation | 366/366 pass | `final-controls.tap`; 43 author cases plus 323 existing controls, source content matches frozen commit |
| Final selected remote controls | 20/20 pass | `final-remote.tap`; on frozen commit, exact positive scenario selection below |
| Global build | exit 0 | `final-build.txt` |
| Global typecheck | exit 2 | `final-types.txt`; six unrelated native-fixture errors, no source/owned-test diagnostics |

The TAP and typecheck copies retain original bytes. The build text display omits
one terminal blank line; `manifest.json` retains the exact original build stdout
string and its hash, as well as hashes of the displayed evidence artifacts.

All final executed tests have zero failures, cancellations, skips and TODOs.
The 366-case run uses an external 60-second process deadline; the 20-case run
uses 20 seconds plus each existing remote probe's own 3-second process deadline.
Both exited naturally, without deadline kills. Every selected remote probe
reported no residual child process group. The new tests also have 2-second test
deadlines. Production cleanup has no abandonment deadline.

The first intermediate run found **four genuine author regressions**: nested
signal reference identity and completed-stage EPIPE reasons in three cases.
These were fixed, not waived, by separating private closure from public signals.
All four pass in the frozen remote run. That intermediate source was not
snapshotted, so its transcript is historical failure evidence, not a separately
reproducible source profile.

The other **five intermediate failures remain OPEN**: first-read-local,
first-read-s3, first-read-webdav, first-read-curl-body, first-read-curl-headers,
each with the existing 1200ms assertion. Their original failures are retained;
none is relabeled as passing, fixed, or covered by the later selected cohort.
They are distinct from the user's five premature worker-termination observations
per compiled/packed run. The latter require Arch's frozen worker fixtures and
independent callback/runtime integration acceptance, which this author did not run.

The final remote selection is exactly transport, pipefail, middle, middle-status,
nested-invoke, redirect, group, consumer-rejection, consumer-status,
late-read-rejection, iterator-return, caller-abort, budget-abort,
completed-success, completed-failure, completed-rejection, delayed-no-write,
closed-before-write, zero-byte-no-write, first-read-head-zero. No test files or
expectations were modified to make this selection pass.

The final global typecheck errors are TS2304 `Cannot find name 'hit'` in six
pre-existing files under
`tests/commands/regex-execution/continuation/artifacts/native/`:
`dialect-bFUsLx/{alpha,beta}.ts`, `dialect-uhGVu3/{ab,🙂}.ts`,
`dialect-xj7h8F/{a,d}.ts`. These foreign artifacts were not changed or removed.
Earlier own type errors were fixed before the final typecheck.

## Author coverage and remaining acceptance

The 43 author cases cover admission-before-acquisition; sync/async cleanup;
normal completion, ordinary throw, selected execution rejection, cancellation,
early pipe and dispose; delayed barrier completion; drain-all failures including
undefined/null; caller reason identity and abort during drain; duplicate
registrations; shared finally cleanup; synchronous closed registration; late
invoke without iterator/FS/middleware effects; detached descendants; closed
middleware `next`; concurrent exec/Shell/shared-owner isolation; late opaque
handler/sink rejections; opaque input/return; nested environment overlays;
source/dot/eval/function/interpreter/substitution paths; exact bytes/BOM/shared
output accounting; and repeated/reentrant dispose with reverse plugin order.

These are cooperative host-resource controls, not real regex workers. ROOT must
route the frozen runtime and Arch callback hash to a different verifier, rerun
the frozen real-worker compiled/packed fixtures, and perform independent holdout
acceptance. No source ownership is retained for that verification phase. No
overall green, five-first-read resolution, superiority, full Bash/native parity,
72-hour duration, or full completion claim is made.

No author archive, server, worker or persistent test process remains. Author
scratch transcripts were outside repository test trees; retained copies here are
durable evidence, not scratch. Foreign staging, files and processes are preserved.
