# Pending output lifecycle: contract-owner design review

August 26, 2026. Design only: no shared I/O API or runtime change is approved or
implemented by this review. Sagan owns shell, Archimedes owns curl, and Curie
owns contracts/core commands. The source proposal is
`/tmp/safe-bash-shell-first-read-dependencies.txt`.

## Recommendation

Use an explicit, optional output-operation lease for deliberately owned,
output-bound work. Do **not** automatically acquire one in existing `pipeBytes`
or for every stdin read. The existing borrowed/shared-input behavior is part of
the tested contract. `stdinIsDefault` describes origin, not resource ownership
or permission to cancel a cursor.

The proposed `ByteSink.beginOutput?(): () => void` is a plausible minimal shape,
but its meaning must be settled before implementation: Sagan's design cancels
the **command stage**, not merely an individual operation. Acquiring such a
lease must explicitly consent to abandoning that stage when the output reader
closes. It is unsuitable when independent effects must still finish. If the
intended guarantee instead preserves concurrent independent work in that same
stage, the lease needs operation-local cancellation; a release-only hook cannot
provide that guarantee by itself. Do not advertise those two designs as equal.

Required rules for a stage-scoped version:

- Acquire before starting the owned lazy source/authorization/transport work;
  release in `finally`, including failures. Release is idempotent. Unsupported
  sinks are a no-op. No fake empty write, EOF probe or command-name heuristic.
- Track leases independently per pipe/stage; nested acquisitions must not clear
  one another. A reader already closed when acquiring must be handled before
  new host work. A released lease cannot cause a later abort.
- Preserve already-settling failures and statuses before close cancellation.
  Keep all late rejections observed. Do not promise that a future host failure
  after intentional cancellation will replace the cancellation result.
- Preserve caller/budget abort reasons and existing successful-write/EPIPE
  handling. A one-turn grace is an ordering policy, not a latency guarantee.
- Forward the hook through transparent sink wrappers: `Budget.sink`,
  `signalSink`, invocation wrappers, and redirected/duplicated descriptors.
  File-output sinks must not inherit an unrelated pipeline stdout lease.

Core `cat` can explicitly bind a **named VFS file** transfer, releasing before
moving to another operand. Do not wrap the whole concatenation when operands
also contain borrowed `-`/stdin. Leave ordinary `pipeBytes` unchanged; an opt-in
helper or explicit acquisition can serve commands that know they own a source.
The new local pending-source test must declare that ownership instead of using
a universal helper change to invalidate existing shared-stdin tests.

Curl must bind its actual stdout-directed transfer before pending headers/body
work, not merely its body-copy loop. A pure `-o file` transfer must survive an
unrelated closed stdout reader. Mixed header/stdout/file transfers need explicit
effect/cancellation tests before extending the lease across the whole request.
Do not enable network access, change authorization or reset budgets here.

## Evidence and profile distinction

The unchanged shell lifecycle suite passes **13/13**, including the delayed
shared generator and both retained/abandoned delayed-error cases. The focused
`first-read-head-zero` control passes **1/1**: zero reads, one return, empty
output, status zero and no residual process group. No core head fix is indicated.

Fresh native controls pass **3/3 each** on pinned Bash 3.2.57 and 5.3.0:

| Control | Observed bytes/statuses on both profiles |
| --- | --- |
| `(sleep 0.05; printf kept > marker) \| :; cat marker` | stdout `kept`, no stderr, exit 0 |
| `(sleep 0.05; printf delayed-error >&2; exit 7) \| :; printf '%s\n' "${PIPESTATUS[*]}"` | stdout `7 0\n`, stderr `delayed-error`, exit 0 |
| `(sleep 0.05; printf payload) \| :; printf '%s\n' "${PIPESTATUS[*]}"` | stdout `141 0\n`, no stderr, exit 0 |

Both executable hashes matched the existing
`benchmarks/shell-stress/diagnostic-profiles/native-baseline.json` before the
fresh runs. Controls used isolated temporary directories, a 2-second timeout,
64-KiB capture limit and no network. The first attempted closed-reader control
used Apple's `/usr/bin/head -n 0`, which exits 1 with `illegal line count -- 0`;
that is an invalid oracle for this case, not a virtual-shell failure. The table
uses the valid no-read builtin `:` instead, preserving the invalid observation.

These observations do not authorize unconditional cancellation when a downstream
command exits: independent no-write effects and delayed diagnostics still occur.
Pre-first-byte cancellation of explicitly leased host work is a **proposed
cooperative resource-lifecycle policy**, not a claim that native Bash knows
about pending fetches or will cancel them before any attempted pipe write.

Sagan reports five failing first-read cases (local owned source, S3, WebDAV,
curl body and curl headers) at the 1200-ms acceptance boundary. This review does
not rerun or close that five-case cohort, nor reclassify the curl corner as a
pass. Required acceptance includes those cases, all existing shared-cursor and
delayed-error controls, file-only/mixed output transfers, nested leases,
acquisition-after-close, release-before-close, cancellation and late rejection.

Review commands:

```sh
node --import tsx --test tests/shell/lifecycle.test.ts
node --import tsx --test --test-name-pattern='first-read-head-zero' tests/shell/remote-close.test.ts
```
