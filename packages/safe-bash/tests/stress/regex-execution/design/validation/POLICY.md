# Recommendation for the ROOT DECISIONMAKER

This is a proposal, not an adopted API, product default, or authorization to
edit product code. Curie is not the policy decisionmaker. No whole new regex
engine, elaborate pool, or default native-process execution is proposed.

## Scheduling

Prefer bounded FIFO **per-request execution leases** over a process-global
reject-on-busy slot held throughout a command invocation. Workers can be reused
while idle without pinning an execution lease. Hold the lease only across
dispatch, reply validation, and (on failure) awaited retirement. Release it
before awaiting upstream `next()`, downstream writes, or VFS work. Never await
another leased request while holding one. This removes the obvious pipeline
resource cycle; FIFO plus finite request service avoids starvation **among
already admitted** requests, not all tenants under unlimited arrival.

The small model admits eight waiters/four reusable descriptor sessions and one
active request, enough for the stated benign concurrent pipelines. Those are
test bounds, not production sizing. An actual shared execution host must own
the worker count, queue byte/count bounds, cancellation removal, and lifecycle.
Queue overflow must have a deliberate policy: bounded admission waiting with
abort/deadline, or documented overload failure. There is no finite-memory design
that promises immediate admission/success for unbounded concurrent requests.
Do not fix this by letting every invocation allocate an unbounded private worker.
No slot may be held while waiting for queue admission, source, or sink.

The adapter reuses a small descriptor session set, rather than implementing
worker reinitialization/eviction. It demonstrates scheduling and exact fixture
outputs; it does not prove isolation between tenants, complete aggregate-budget
sharing, arbitrary pattern combinations, or cancellation-aware queue fairness.
Original Capacity's idle invocation pin is retained as a negative control only.

## Explicit no-signal containment proposal

For a **future opt-in experimental host policy**, propose static-worker regex
compilation and matching even when the caller supplies no AbortSignal, with a
finite **1,000 ms active request watchdog** and **3,000 ms startup watchdog**.
Start request time after queue admission/posting; do not charge upstream/sink
idle time against regex service time. Caller abort remains an additional stop
condition; terminate/await the affected worker and observe late rejections.
These numeric candidates are uncalibrated, require root approval, and are not
established by this benign benchmark. The current prototype's **75 ms request /
3,000 ms cumulative work / 1,000 ms startup** remain EXPERIMENTAL test caps, not
existing grep/rg/Shell defaults or approved replacement values.

Keep current Shell shared output/command/source/expansion limits and signal
propagation intact. `src/shell/runtime.ts` currently has no default wall-time
limit, and `src/shell/types.ts` exposes none. Do **not** silently impose a 3s
invocation duration or 1,024 internal request limit on existing commands.
Preserve rg's current 1MiB record, 64MiB file, 16MiB output, 8KiB pattern, and
1,024-pattern admission promises unless root approves an explicit change.
Worker frames should chunk transport where semantics permit; arbitrary record
splitting changes anchors/captures and is not automatically safe. The prototype
256KiB UTF-16 batch frame, 16-pattern, 64KiB-result, 8MiB cumulative-input,
4MiB cumulative-output, and 1,024-call caps do not cover those product limits.

Proposed default whole-invocation wall-time cap: **none**, preserving the current
API; host may explicitly configure one. Thus a single stuck call is contained
without relying on a caller timer, but repeated slow admitted requests can still
consume substantial total resources. If root requires a hard aggregate no-signal
availability bound, it must approve a new shared execution budget and documented
timeout behavior; there is no transparent way to preserve every long-running
command while guaranteeing finite total CPU service. Preemption/worker startup
has latency and cannot provide hard real-time guarantees on a stalled process.

## Literal paths and semantics

Only a proven fixed, case-sensitive byte-search path with matching empty-pattern,
overlap, ordering, output, and byte-offset rules is a plausible main-thread
fast path. The ordinary fixed ASCII punctuation fixture is evidence for that
fixture, **not** a universal proof or shipped optimization. Leave Unicode `-i`
and `-w`/`\b` boundaries isolated pending exact equivalence: Kelvin `K` under
`rg -Fi k` matches while ASCII-lowercasing/byte includes would not. Native and
documented JS Unicode behavior also differ. Preserve intentional JS dialect
choices; close documented-unsupported named backrefs only by explicit root
decision backed by the captured default-rg oracle.

## Security and availability tradeoffs

- Static workers avoid eval/generated source, but a worker is not a process or
  OS security boundary. Node resourceLimits are not hard RSS limits; message
  copies/external buffers and process-wide OOM remain relevant.
- Reusing idle workers saves startup but retains memory; retiring each record
  avoids idle memory but is unacceptable as a recommended throughput strategy.
- Batching lowers IPC overhead but must flush available records: a producer
  awaiting each output cannot fill a batch. No speculative upstream read while
  downstream is suspended. Generic uncooperative iterators cannot be forcibly
  canceled; this remains a host/source contract issue.
- A native-equivalent linear engine could remove backtracking risk for its
  supported dialect, but swapping engines changes declared semantics and
  dependency/packaging constraints. This leaf does not implement one.

## Exact proposed ownership, only if root authorizes integration

| Proposed file(s) | Owner / decision needed |
| --- | --- |
| `src/commands/regex-execution/{client,worker,protocol,matching}.ts` (new proposed paths) | Root assigns implementation owner; static worker, bounded request service, compile isolation, cancellation and proven result shape. Current design files are test prototypes, not public imports. |
| `src/commands/grep.ts`, `src/commands/search/matcher.ts`, `src/commands/search/rg.ts` | Root assigns command adapter owners; preserve parser/byte/format semantics, await matching, retain shared budgets, add explicit named-backref policy only if approved. |
| `src/commands/search/options.ts`, `src/commands/README.md`, `src/commands/search/README.md` | Root decides host-policy scope/defaults and migration language; do not implicitly turn experimental caps into defaults. |
| `src/contracts/command.ts`, `src/contracts/command.md`, `src/shell/types.ts`, `src/shell/runtime.ts` | Root assigns contract/runtime owner **only if** a shared scheduler/budget binding is needed; avoid inventing public API from this adapter. Internal synchronous `Matcher.matches` would become asynchronous. |
| `src/index.ts`, `package.json`, build/pack validation | Assigned integration owner only; root decides whether any export is warranted. Worker sibling must be in emitted and published files. Existing product exports are unchanged. |
| This `validation/**` subtree | Validation leaf only; independent reviews belong to `revision-review/**`; author owns `client.ts` and `revision/**`. |

Approval sequence: choose intentional dialect and no-signal/overload policy;
assign integration owners; retain scoped byte/capture fixtures; calibrate on
representative host loads; run broader public consumer/backend gates. This
bounded evidence alone does not authorize production integration.
