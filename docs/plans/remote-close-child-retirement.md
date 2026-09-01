# Remote-close child retirement — September 1, 2026

## Failure and scope

CI run 33569856461, job 100062323609, revision 9c5c2170 failed only the Bash
`first-read-head-zero` supervisor assertion. Its direct child closed successfully
after 497.562ms, with no timeout or oversized output, but the process group still
existed. The captured log does not identify the residual group member.

One local observation of the unchanged failing scenario found both Node and its
tsx esbuild service in the same process group. It passed locally; this establishes
a compiler descendant exists, not that the CI residual was conclusively esbuild.
Direct-child `close` and descendant retirement are distinct lifecycle events.

Scope: `tests/shell/remote-close.test.ts`, new cohort-local
`tests/shell/remote-close-child.ts`, and this plan. Neither probe nor production
`src/shell/input.ts` changes. Shared process helpers remain untouched: their
kill-on-exit behavior would not establish natural retirement here.

## Contract and TDD

Keep every original probe, assertion, 1 MiB ceiling and total three-second hard
deadline. After direct-child close, observe natural process-group retirement only
within the remaining original deadline. Never restart the probe or the deadline,
and never turn a killed lingering group into a passing result.

A controlled descendant installs a SIGUSR1 release handler, then announces IPC
readiness before its parent can exit. It remains alive until the test's signal
spy successfully delegates the first real group-liveness probe, then releases
that exact group with SIGUSR1. It must retire naturally without SIGKILL and pass;
no fixed sleep determines whether it outlives its parent. A controlled 10-second descendant
whose parent stays alive for one second must fail at the original total deadline,
remain classified as a residual, and receive group SIGKILL. The elapsed-time
control allows scheduler overhead but does not change the actual 3000ms timer.
Only these two process-group controls are explicitly POSIX-only; Windows skips
them with that reason. All 29 original scenarios still run on every platform.

First extract the existing immediate-check behavior unchanged and demonstrate
both controls failing. Then retain the timer across retirement synchronization
and rerun controls, all original probe scenarios and focused typechecking.

## Implementation

The supervisor keeps one absolute deadline, established before spawn, through
direct-child execution, stdio close and natural descendant retirement. Group
liveness is polled every at most 10ms, bounded by the original remaining time;
this does not re-execute the probe or restart its timer. Immediate retirement
adds no wait. The 1 MiB ceiling and original acceptance assertions remain intact.

Expiry records timeout and sends process-group SIGKILL. A group still outstanding
at expiry remains `residual: true`, even if the forced stop promptly removes it.
Forced cleanup is idempotent: deadline handling and final cleanup cannot issue
duplicate kills against a retiring group. Unexpected signal errors still fail.
Diagnostics distinguish `residualAtClose`, final `residual`, direct close time
and total elapsed time. No compiler/prebundle infrastructure was introduced.

## TDD and current validation

Both controls fail under the extracted original logic: the naturally retiring
descendant is rejected after about 44ms, and the lingering descendant is rejected
at its parent's roughly one-second close without a total-deadline observation.

Initial complete source run: **31/31 pass**, all 29 original scenarios plus two
controls; zero skipped, cancelled or failed; 18.176s wall time.

- Original CI-failing `first-read-head-zero`: passes in 540.883ms, status0,
  signalnull, no timeout, oversize or residual group.
- Natural control: direct child closes at 46.053ms with a residual; the descendant
  retires naturally by 281.563ms. No SIGKILL is issued, and the group is absent.
- Lingering control: direct child closes at 1040.350ms with a residual; the
  supervisor returns at 2999.558ms with timeout/residual both true. The real kernel
  accepts exactly one group SIGKILL. A subsequent read-only check confirms both
  process group 23594 and descendant23595 are absent, not merely ignored.

The initial natural control used a fixed 200ms lifetime; parent review correctly
identified that scheduling could let it retire before observation. The IPC-ready,
observation-triggered release above replaces that control without adding any
supervisor hook or modifying the supervisor implementation.

Hardened requalification: **31/31 pass** on the local POSIX host, zero skips or
failures, 14.801s wall time. The release-driven control observes direct close at
64.063ms while its descendant is still live, then natural retirement at75.445ms
after the first successful real group-liveness observation releases SIGUSR1.
No SIGKILL is issued. The unchanged lingering control closes its parent at
1036.463ms and fails at3000.464ms with timeout/residual both true and exactly one
accepted group SIGKILL. Focused strict TypeScript checking also passes.

The Windows guard is a platform qualification, not a claim of a Windows test
run: only the two unsupported process-group controls skip there. Original probe
coverage remains unguarded on all platforms.

The second control explicitly distinguishes the original total budget from a
fresh post-close three-second wait. Its elapsed-time tolerance covers scheduler
overhead only; the supervisor never increases the actual 3000ms budget.

Commands, from `packages/safe-bash`:

```sh
node --import tsx --test --test-concurrency=1 tests/shell/remote-close.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --module NodeNext --moduleResolution NodeNext --skipLibCheck --types node tests/shell/remote-close.test.ts
```

Focused strict typechecking passes. These are current local source results, not
a rerun or successful qualification of the failed CI revision. Neither probe,
production input implementation nor shared process helper was edited. No Git,
raw/root ESLint, frozen checkout or unrelated edits were performed.
