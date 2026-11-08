# Frozen author regression plan

This leaf owns only the four existing prototype TS files if needed and new
`revision/**`. No product, public API, root, original evidence/reports,
`review/**`, `revision-review/**` or `validation/**` edits. No subagents.

Baseline gate observed before prototype edits: independent marker
`/tmp/regex-revision-baseline-ready.txt`, manifest SHA-256
`9bf449f36b68aecd0afb72750ce0e34a09427a804092ecb5da6cd5e1eb0c966d`.
Original client SHA-256
`6a19d72697a73ec03be929e4494a00afb87edaecdd3a43d5dfc5e624e7d202f2`;
original author freeze `4484026b9e0f87359733ac5f2dcbd49798473aa6`;
original review expectation freeze `ad4c5adda0ea430438a1d3235520760270ad882e`.
The independent leaf owns reproduction of original 14/16, not this author.

## Exactly two changes

1. Terminal idle exit automatically starts idempotent disposal, settles pending
   work, removes owned listeners, awaits the exact Worker handle and releases
   capacity once. Do not replace a known exit code with undefined from a second
   terminate call. Reentrant/duplicate dispose and late callbacks stay harmless.
2. Flush each available Row immediately. The unchanged AsyncIterable<Row>
   protocol has no readiness/chunk-boundary operation: speculatively requesting
   another row cannot promise both zero read-ahead and first-output liveness.
   Each Row is therefore a one-record partial batch. batchSize is still a
   validated upper bound; explicit batch(Row[]) still amortizes full batches.
   Reuse one worker, do not invent a per-line worker or a global pool.

No race-and-forget source reads. Await next() before any return(). Await source
return exactly once on early close/error; preserve primary failure if return
also rejects. Already-aborted stream does not acquire the iterator, read,
validate rows, create worker or post requests. After yield, check cancellation
before the next read. Worker cleanup precedes potentially slow source return.

**Explicit limitation:** an arbitrary iterator's pending next()/return() cannot
be forcibly cancelled. The stream awaits it and observes late rejection rather
than abandoning it. Prompt cancellation requires source cooperation with the
same AbortSignal. A consumer return queued behind an active next remains queued
until that operation settles. Tests release controlled stalls after observing
this limitation. Actual supported Node PassThrough input uses its signal-aware
async iterator. No claim about every external stream, source internals or VFS.

Existing invocation-lifetime Capacity is a prototype, not a proposed global
single-slot rejection or idle-invocation production policy. Validator/root own
policy exploration. Per-record flush spends unchanged call/work budgets faster;
not a performance recommendation. No benchmark is in this author's scope.

## Frozen controls and execution

`fixtures.mjs` enumerates benign cases and static expectations. `child.mjs`
asserts actual idle exit, exact cleanup/idempotence/capacity reuse, pending
request terminal exit, live feedback producer, paused backpressure, cooperative
abort, late rejected pending read, queued consumer return ownership, awaited
return, return-error precedence, actual Node stream cancellation, empty input,
preabort and explicit multi-row batching. Freeze all harness/expectation files
in a commit before any run. Preserve any failed evidence rather than overwrite.

Compile only the four prototype modules using installed tsc and the existing
strict NodeNext options. No runtime loader/dependency. Each benign case runs in
one exact static child with 3s startup and 3s after-ready watchdogs, 64MiB old
space, 2MiB stack, bounded stdout/stderr/IPC, and awaited Worker/child close.
Record complete source/compiler/type/emitted hashes, runtime and dirty paths.
No broad tests or process kills. Parent can kill only its exact child handle.

New six-probe tranche: author maximum 2, reviewer maximum 2, root 2 reserved
unused. This author schedules **zero pathological probes**, so author 0/2 is
unused. Old 12 stays archived. No risk row, warmup, retry, benchmark or current
tool catastrophic evaluation occurs here. Any later approved risk execution
requires a separately frozen claim, exact `^(a+)+$` / 24 `a` + `!`, single child,
<=250ms after-ready hard guard and the root's remaining-allocation coordination.
