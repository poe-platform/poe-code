# Author revision: two prototype fixes, not production integration

## Frozen identities and ownership

Only `design/client.ts` changed among existing files. New author material is
restricted to `design/revision/**`. No product/shared API/root files, original
frozen evidence/reports, review, revision-review or validation files changed.
No delegation, dependency installation, native product processes or network.

The independent baseline-ready marker was read before any prototype edit. It
identifies original client SHA-256
`6a19d72697a73ec03be929e4494a00afb87edaecdd3a43d5dfc5e624e7d202f2`,
author freeze `4484026b9e0f87359733ac5f2dcbd49798473aa6`, original reviewer
expectations `ad4c5adda0ea430438a1d3235520760270ad882e`, and baseline manifest
SHA-256 `9bf449f36b68aecd0afb72750ce0e34a09427a804092ecb5da6cd5e1eb0c966d`.
The marker is retained verbatim as a parsed object in `evidence/build.json`.
Original review's **14/16 benign** and two blockers remain unchanged; independent
old-code reproduction belongs to the revision-review leaf. These new author
tests are a different cohort, not an assertion of original-suite replay.

* Harness/expectation freeze, before any runs:
  `960f3b909c1de34f0e525e0ce97d286a8e981003` (nine files).
* Both bounded fixes: `398143a253ada226340c05a8028add4df78d00ae`.
* Revised client source SHA-256:
  `f2c5512b2785f146e68f3a335afd646ab74a3fdfa2370743151a05a7827044d5`.
* Revised emitted client SHA-256:
  `abb22e92de0cc3f2a2fea18fed63b6d5b6f7e6694cdea0f72e709129e76b4e01`.
* Build evidence SHA-256:
  `58f3b81a5c49e12c08c93c536f2b5914ba1d6bef295d9b4e27f7a83bd9e1e346`.

Build recorded **August 27, 2026, 05:18:29.704 UTC**: installed Node **22.22.2**,
V8 **12.4.254.21-node.39**, Darwin arm64, TypeScript **5.9.3**. Installed binary
and compiler/type inputs are hashed, not inferred from documentation or latest
version claims. Existing strict NodeNext configuration is inherited; the new
config narrows compilation to exactly four prototype modules. All **177 input
identities**, **four emitted hashes**, and nine frozen harness hashes are
checked before/after every child and by the audit. Consumed source is committed;
unrelated concurrent dirty paths and live build HEAD are recorded separately.

## Root causes and exact behavioral changes

**Terminal idle exit:** the old exit handler set an error but did not start
disposal; no pending caller existed to execute catch/finally. The exit handler
now invokes the existing idempotent awaited disposal path. Pending work rejects,
the exact worker is awaited, owned listeners are removed, and Capacity releases
once. A known exit code is retained when terminate on the already-exited Worker
returns undefined. Late callbacks and repeated dispose do not double-release.
The `terminated` metric counts completed worker-backed client disposals, not
proof that all workers needed active termination: the idle cases externally
terminate their exact Worker first, then assert automatic client cleanup before
manual dispose.

**Live partial flush:** the old fill-to-count loop requested another record
before submitting the first partial batch; a producer waiting for its first
result could not progress. The AsyncIterable<Row> API has no non-consuming
readiness query. The revised loop therefore treats each Row as its available
input boundary and submits a **one-record partial batch**. It never requests a
speculative next record and never pulls while downstream is suspended at yield.
One worker is reused; explicit `batch(Row[])` still processes multi-row batches.

Constructor, ready, batch, stream, dispose, Capacity, descriptors, results and
protocol signatures are unchanged. **Result grouping changes:** stream's
batchSize remains validated as an upper bound, not a fill target; stream now
yields one result row per input record. Finite-source batching amortization is
not preserved. Request/work accounting and caps remain unchanged, so this path
spends the prototype 1,024-call budget faster. This is an explicit small
correctness tradeoff, not a performance fix or an unchanged all-input contract.

Source iterator acquisition occurs after preabort checks. Reads are awaited,
not raced or abandoned. On early close or failure, source return is called once
and awaited **after worker cleanup**. A secondary return rejection is observed
without replacing the primary read/body failure; a return-only failure rejects.
Natural EOF needs no return. Cancellation is checked before each new read and
after fulfilled reads; rejected reads preserve the source error.

### Deliberate cancellation limitation

There is **no ability to forcibly interrupt arbitrary iterator next/return**.
If a pending read ignores cancellation, the client's Worker is disposed by its
abort listener, but stream.next and any queued generator.return remain pending
until the source read settles. A late rejection remains awaited and owned;
return does not overlap next. The controlled late-read test proves this limited
behavior, not prompt cancellation of an uncooperative iterator. The same
limitation applies to a source return that never settles. An uncooperative
first read has no Worker yet and also needs the source to settle.

Prompt read cancellation requires a source that honors the caller's signal.
The actual supported-stream control uses Node's signal-aware object-mode
PassThrough async iterator: a single written row yields a first result without
EOF, the next read blocks, abort rejects with the source's ABORT_ERR/cause, and
the source and exact worker close. This is not VFS/product stream integration
or proof for every third-party iterator. Callers must retain iterator ownership
and return it; worker disposal alone does not forcibly run source finally.

The unchanged one-slot invocation-owned Capacity is **not a proposed production
global rejection or idle-invocation pinning policy**. Root and the disjoint
validator own per-request leasing versus invocation-policy analysis. No pool,
queue, idle lease or production-policy change was added here.

## Frozen author results

**16/16 benign scenarios pass**, 16 exact children, 16 workers created and
disposed, zero retries, zero outer kills, zero active owned children. Fixtures
and expectations were not changed after running. Each child records exact
exit/disconnect/stdout-close/stderr-close/close; worker thread IDs, pending
requests, capacity ownership and inspected listeners are clean at final
settlement. Automatic idle cleanup is asserted before explicit cleanup.

| Frozen scenario | Required result |
| --- | --- |
| idle-exit | Automatic listener/capacity cleanup and preserved exit code; successor acquires |
| idle-idempotence | Duplicate dispose/late exit/error/abort do not double-release |
| pending-exit | Actual pending scan rejects WORKER_EXIT and cleanup is awaited |
| live-feedback | First result before the producer may request its feedback-dependent next row |
| paused-backpressure | One read only while output is paused, one awaited return |
| paused-abort | Automatic worker cleanup; resume does not read again |
| preabort | Zero iterator acquisition, worker creation and requests |
| cooperative-pending-abort | Source honors signal; one non-overlapping return |
| late-read-rejection | Aborted uncooperative read stays owned; late failure observed |
| pending-consumer-return | Return queues behind pending next; no concurrent source return |
| awaited-return | Worker already clean while source return remains pending |
| read-return-rejection | Read error preserved when awaited return also rejects |
| return-rejection | Return-only failure rejects after worker cleanup |
| node-stream-abort | Actual Node stream yields first row and cancels its pending read |
| empty-source | EOF creates no worker; no unnecessary return |
| explicit-batches | Three two-row batches reuse one worker, four init+scan requests |

Benign children use 3s startup/after-ready watchdogs, strict unhandled
rejections, 64MiB old-space and 2MiB stack flags, <=128KiB IPC and <=16KiB
combined stdout/stderr. Only the exact child handle could be killed; none was.
Worker heap requests and their inherited-flag caveats are unchanged: no exact
RSS or effective 32MiB worker-heap guarantee. The unchanged static worker graph
has only node:worker_threads transport plus matching/protocol imports; no
eval, subprocess, filesystem or network in that graph. Worker threads are not
a sandbox for arbitrary host JavaScript.

## Probe ledger, verification and handoff

Archived old 12 risky runs remain archived, not retried. New six-probe tranche:
**author 0/2 used (both unused)**; reviewer maximum 2; root 2 reserved unused.
This author executed no pathological regex, current dangerous baseline,
benchmark, warmup or fuzz. No count for another leaf's current execution is
asserted here. Unused author capacity is not automatically transferred.

Commands actually run, once, in order:

```
node tests/stress/regex-execution/design/revision/prepare.mjs
node --check tests/stress/regex-execution/design/revision/child.mjs
node --check tests/stress/regex-execution/design/revision/prepare.mjs
node --check tests/stress/regex-execution/design/revision/run.mjs
node --check tests/stress/regex-execution/design/revision/audit.mjs
node --check tests/stress/regex-execution/design/revision/cleanup.mjs
node tests/stress/regex-execution/design/revision/run.mjs
node tests/stress/regex-execution/design/revision/audit.mjs
node tests/stress/regex-execution/design/revision/cleanup.mjs
```

Audit preserved all 36 then-existing raw evidence/claim files and checked all
source/build/harness identities. Cleanup hash-checked and removed exactly four
owned emitted files and now-empty owned temporary directories. Its evidence
records the directory absent. No original/reviewer build or other temp path
was touched. Preparation/run/audit are deliberately no-overwrite; do not rerun
these evidence paths. Independent verification uses a disjoint emitted build.

No approval refusal occurred. No broad suite, packaged consumer, performance
claim, production approval, full parity/superiority or 72-hour completion claim.
Existing protocol/capacity/dialect/descriptor-cap integration issues outside
the two authorized fixes remain with their owners. Interface notice was
published at `/tmp/regex-revision-author-interface.txt`; stable source/evidence
commits and exact identities are handed off through
`/tmp/regex-revision-author-ready.txt`. Source edits stop at that handoff.
