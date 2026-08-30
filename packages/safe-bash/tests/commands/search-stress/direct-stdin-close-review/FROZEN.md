# Independent direct rg stdin close holdouts

Frozen before candidate inspection/execution. Baseline is the committed supplied
proof `c5d44262ecca11009df6ce32a180005d3f3cb574`, not an inferred current HEAD.
Its raw stdin selection feeds `AvailableRecords.source` directly. The wrapper's
`for await` hides a structural pending-next iterator's callable `return` behind
an opaque async-generator read. The separate Shell cursor owns and closes input.
The historical sidecar 9/10 and earlier whole-gate failures remain separate.

## Frozen requirements

`cases.mjs` is the authoritative independent schedule/expectation executable.
`consumer.mjs` executes it through public `virtual-bash` exports from a genuinely
packed, extracted, renamed package with no source checkout import fallback.
Every case records exact output hex, status/reason reference, producer acquisition,
next/return counts, supplied bytes, EOF/closure and before/after cleanup states.
Assertions are named; a failed assertion does not suppress remaining observations.

1. Direct plugin-registered execution: first pending structural read, without a
   cleanup hook; caller abort must reach upstream return exactly once before
   settlement, close the fixture resource, preserve reason identity, read once.
2. Same after empty + split nonmatching record; abort fourth next; hook present.
3. Public Shell positive control after a nonmatching record and pending next.
4. Direct opaque generator and separate Shell opaque generator: return called
   once before settlement, finalizer still pending until explicitly released.
   This is not a requirement to preempt arbitrary await or await opaque cleanup.
5. Quiet early success, multi-record first chunk: one read only, await cooperative
   non-aborted asynchronous return completion before success. No read-ahead.
6. Direct EPIPE early output closure: one read/write, no diagnostics, status zero;
   signal-aware return call does not require awaiting gated opaque return work.
7. Abort during held stdout write: caller/late-sink/return-failure are distinct
   objects; exact caller object wins, no diagnostics, no unhandled late errors.
8. Input failure versus failing return: preserve input diagnostic, status two,
   close resource exactly once; do not replace it with return error diagnostic.
9. Separate input-byte, line-byte, output-byte limit violations: exact diagnostic,
   exact accepted output, no read beyond the violating chunk, one return.
10. Exact-boundary binary natural EOF: split bytes, empty chunks, NUL and 0xff
    preserved in text mode, no return after EOF, exactly one terminal next.
11. Bounded 64/256 four-byte chunk schedules: one output handshake per next,
    no speculative read, exact N+1 nexts, N writes, 4N input/output bytes.
12. Pre-aborted invocation and invalid zero maxWorkers policy: no stdin access,
    no workers; exact reason / documented positive-worker validation respectively.
    Zero *active* workers is checked after each independent completed case.
13. Concurrent sibling invocations on the SAME plugin/registry/executor: both
    pending reads admitted, one caller cancelled and closed, other neither
    returned nor settled until released, then exact successful output and EOF.

All patterns are fixed ordinary `hit`; no pathological/native/feature corpus.
The shared regex defaults, worker retirement and Shell contracts are unchanged.
Direct hosts do not gain a generic cleanup settlement barrier: the structural
fixture closes synchronously in return; only non-aborted cooperative return is
explicitly awaited. All intentionally held promises are released in finally;
manual baseline cleanup is labelled fixture work, never product closure.

## Bounds and authentication

Each owned child gets a generous 30-second hard parent watchdog; cases run
serially except the explicit sibling case. The watchdog kills only that exact
child PID. Node runs with `--unhandled-rejections=strict`. Phase handoff requires
natural child exit or explicit recorded watchdog failure, and no live workers.
No broad process kills, external services, native oracles or root build writes.

Node's synchronous module load hook records actual moved package module URLs and
SHA256. A forwarding Worker subclass records constructed worker URLs, byte hashes,
exit events and untouched options. The full packed dist manifest authenticates
worker static imports; worker modules do not inherit the main-thread load hook.
This is static-asset authentication, not a claim of instrumenting worker loads.

Baseline static complexity: `readBytes` retains one current producer result, calls
one next per yielded chunk plus EOF, and performs no accumulating concatenation;
`AvailableRecords.source` copies each input chunk once. The proposed change is
unvalidated and not inspected. Candidate review must verify its exact diff and
unchanged surrounding algorithms; bounded chunk accounting is not a performance
benchmark nor proof that existing long-line processing is globally linear.

## Reproduction and immutability

From repository root run `node tests/commands/search-stress/direct-stdin-close-review/prepare.mjs baseline-01`.
Only preparation/run output files may be appended after freezing. Holdout
expectations and schedules cannot be revised after seeing any candidate.
Preparation errors must be retained and corrected separately without changing
these holdouts. Candidate not routed: no source acceptance or approval is given.
