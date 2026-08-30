# Independent frozen review allocation

Owner: DIFFERENT INDEPENDENT REVIEW leaf. Only this new `review/` subtree is
writable. Author source freeze: `4484026b9e0f87359733ac5f2dcbd49798473aa6`.
Production, author fixtures, author build and reports are read-only. No delegates,
dependencies, engine integration, native dangerous baseline, or author runner.

Commit these static files before building or executing any probe. Rebuild the
author's exact TypeScript configuration with only outDir redirected into this
directory's `.temporary/js`; reject source/compiler/type/build drift. Record
Node executable hash, versions, compiler/config/source/emitted hashes and dirty
state. Freeze literal native expectations below before executing the prototype.

## Fixed benign scenarios (16, not author counts)

1. Ordinary optional/empty/unmatched captures: `(q)?(b*)`, `b`, g/all =>
   `[0,1,["b",null,"b"]]`, `[1,1,["",null,""]]`.
2. Unicode fold `(σ)`, `Σς`, gui/all => two one-code-unit captures; empty
   expression on `𝄞x` => g offsets 0,1,2,3 versus gu offsets 0,2,3.
3. Alternation `(r|rs)` on `rs`: native first `r`, bounded byte Pattern `rs`.
   Separate z/r descriptors on `rz` first => z@1, all => z@1 then r@0;
   actual grep -o sorts r then z; actual rg combined alternatives selects r@0.
4. Current tool dialect gates: grep BRE numeric backreference/POSIX class
   accepted, special group rejected; rg named backreference accepted, numeric
   and lookbehind rejected. Preserve empty-pattern byte enumeration,
   invalid-byte anchor boundaries, and grep word-filtered later match.
5. Preabort before invalid descriptor validation: zero workers/messages/compile.
6. Synchronous abort during startup: same reason, termination before rejection.
7. Idle abort: automatic termination, capacity and abort-listener release.
8. Consumer paused after successful batch, then abort: automatic worker cleanup
   before manual iterator return; no further source reads.
9. Real unexpected idle worker exit: automatic capacity/listener cleanup within
   40ms observation window, without needing another request or manual close.
10. Injected idle worker error: automatic cleanup, no unhandled late rejection.
11. Injected malformed active reply and benign invalid regex compilation:
    reject with errors, never successful no-match; cleanup before rejection.
12. Input-row cap, descriptor-count cap and tiny-data result cap (16 empty
    patterns x 128 one-character rows): fail closed, release all capacity.
13. One ordinary line then source stalls: first stream result within 40ms for
    batchSize 16 without EOF; required liveness, known design limitation, do
    not change expectation to green. Explicitly unblock/close owned source.
14. First result then consumer return: no readahead while paused, return awaits
    source and worker cleanup. Three subsequent batches reuse one worker.
15. Shared capacity contention fails promptly rather than queues/creates workers;
    same-client concurrency rejects BUSY; capacity usable after holder closes.
16. Concurrent/idempotent dispose and late message/error handlers after cleanup:
    one termination, no pending request, no worker/signal listeners, no release
    duplication. Late error is injected through captured handler, not an
    unhandled EventEmitter `error` event after its listeners have been removed.

Expected native positions are UTF-16, not public rg byte positions. Actual tool
assertions are separate. Tiny same-thread native oracles run only in protected
static review children. No source string or pattern is accepted from argv/IPC.

## At most two additional potentially pathological executions

Historical accepted compiled-matrix `df4d05b` = 7 cumulative; author = 3;
starting total = 10. Reserve exactly these ordered rows, no warmup/retry/growth:

1. `risk-default`: `^(a+)+$`, g, exactly 24 `a` plus `!` (25 ASCII bytes),
   one scan in one already-ready worker, no signal. Expect WORK_DEADLINE
   (75ms configured), not a match/no-match result. Termination must be awaited
   before rejection, parent event loop heartbeat must advance.
2. `risk-abort`: identical fixed pattern/input, one already-ready worker;
   abort after 20ms with REVIEW_INFLIGHT_ABORT. Expect that exact error before
   the default deadline, with worker termination awaited before rejection and
   responsive event loop. Only run if risk-default met every frozen outcome.

Each gets its own static child, one child at a time, strict unhandled rejections,
64MiB old-space and 2MiB stack flags. Keep author worker resourceLimits unchanged.
Parent hard kill targets only the exact child handle at 250ms AFTER ready;
startup guard 3s, cleanup guard 1s. IPC/output are bounded. Persist each claim
before launch; existing claims prohibit retries. Stop risk family on unexpected
outcome, retain raw failure and unused reservation. Maximum cumulative = 12.
250ms is a test watchdog, not a product hard-deadline contract or RSS guarantee.

## Evidence policy

Capture observation before caller-finally cleanup and record cleanup separately.
Failures remain failures even when explicit cleanup later succeeds. No expansion
after lifecycle/liveness findings. Run these 16 scenarios once, plus reserved
risks only if useful; no author 144-run benchmark rerun or timing superiority
claim. Inspect author equality gates/order/startup/steady denominators separately.
Report NO-GO-for-production or conditional GO with exact owner fixes, Node22 ESM
asset/integration paths and resource-ceiling conflicts. Final report/raw evidence
commit is separate from this freeze. Remove only the exact owned temporary build.
