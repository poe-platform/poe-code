# Bounded adapter, policy, and prototype-package validation

Owner: validation leaf. Only this new subtree is owned. No product, exports,
root package, revision, review, or historical source edits. No subagents.
Zero risky/pathological executions allocated or implemented. Native fixtures and
all matching workloads are benign and finite. Archived risk12 is not rerun.

## Frozen workload

- 22 command vectors: actual current Shell/registry commands and generated
  test-only copies with the existing parser, byte decoding, formatter, and status
  handling. Exact stdout **and stderr** bytes plus status must agree.
- 6 raw capture vectors: literal hand-written capture expectations plus exact
  current synchronous scanner / static-worker result equality.
- 5 policy/liveness vectors, including one-record-await-result streaming,
  three concurrent three-stage real Shell pipelines, and a live producer that
  waits for the final sink before producing another record.
- Two workloads, three engines (same synchronous scanner, explicit worker
  batches, revised one-record worker stream), three rotated-order repetitions.
  Each child gates exact equivalent logical hits/captures/call counts before
  timing. Input, output, and canonical result hashes accompany all timings.
- One packed-and-moved Node22 ESM consumer proof. No install, external runtime
  dependency, root manifest, exports, or dist changes.

`build.mjs` refuses to compile/freeze before the author's ready marker. It copies
source into an owned ignored scratch tree and uses installed TypeScript. Adapter
transformations are exact-anchor guarded, with hashes of original and generated
source. They are **not** product changes. Matching is awaited and downstream
formatting preserves original bytes. Generated copies still compile benign
patterns on the child main thread; they do not prove an isolated production
compile boundary, full caps, cancellation propagation, or all-input parity.

`adapter.ts` is a deliberately small test model: FIFO request lease, at most eight
waiters, at most four reusable descriptor sessions, one active matching request.
Each session has its own prototype Capacity. A request releases its scheduling
lease before source/sink awaits. It does not create a worker per record. Idle
workers remain memory-resident but do not pin an execution lease. Session/queue
overflow is a harness error, not a proposed product overload policy. No eviction,
tenant fairness, cooperative abort queue removal, or production pool is built.

The benchmark isolates **equivalent matcher/capture work**, not complete command
throughput. The synchronous baseline is the same static `matching.ts` scanner
on the current V8 engine, not grep/rg with omitted result materialization. The
separate 22 command vectors establish scoped byte-output equivalence. Streaming
uses one worker per stream, not per row, and auto-disposes; its work interval
therefore includes final disposal, also reported separately via metrics.

## Reproduction

From the repository root, after the authoritative ready marker exists:

```sh
node tests/stress/regex-execution/design/validation/build.mjs
node tests/stress/regex-execution/design/validation/package.mjs
node tests/stress/regex-execution/design/validation/run.mjs
```

The supervisor is a bounded copy/adaptation of `../run.mjs`'s existing safe
child lifecycle. Only fixed benign jobs are exposed. Each child has a ready/go
handshake, separate startup/execution watchdogs, bounded streams/IPC, sampled RSS
cutoff, exact-PID SIGKILL fallback, and exit/disconnect/stream-close evidence.
Sampled RSS is not a hard memory cap. Source/build/harness hashes are checked
before and after every job. Evidence creation is exclusive; no automatic reruns
or overwrites. The harness/expectations commit precedes build/execution evidence.
The independent native baseline is permitted before author readiness and retained
as `evidence/native.json`. Its initial empty-rg expectation was wrong: installed
rg produced three newlines for UTF-8 `é\n`. The original expectation and failure
remain there; fixtures explicitly correct the expected bytes before final freeze,
also supported by the product's byte-empty path and Printer source inspection.

No full-suite, current full gate, deployed-provider, security, native parity,
just-bash superiority, or actual product-package integration claim is made.
