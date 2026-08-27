# Independent read-only adjudication

**Recommendation: ACCEPT slot 5 as the bounded benign queued-protocol control; reject the alleged sibling-one cleanup violation.** The inspected source and existing trace sufficiently resolve this specific STOP concern. No product fix, harness change, reset, or replay is indicated. No test/product execution or probe was performed; only this report was written.

## Evidence coordinates

- Review files: `tests/stress/regex-execution/runtime-containment-final-review/`.
- Frozen source: `tests/stress/regex-execution/cleanup-boundary-review/.temporary/runtime-r1-verified/src/`.
- Exact packed client: `tests/stress/regex-execution/cleanup-boundary-review/.temporary/runtime-r1-verified-packed-old-five/production-continuation-review/node_modules/virtual-bash/dist/commands/regex-execution/client.js`.
- Requested candidate: runtime `1b133a8662a32ee84524794842074c9c98d5f6c3`, registration `01aa1bf`. Trace entry points at the specified packed package. The trace SHA-256 independently reads `572f59ca68457ae070a8bba059a14776e28b8446d119a338a831df4868ff94c5`, matching `evidence/STOP.json:5`. This was not a fresh whole-package provenance audit.

## Exact ownership diagnosis

1. Frozen `contracts/command.md:76` requires releasing invocation requests/leases and awaiting retirement owed by that ownership—not global worker zero. Lines 84–95 require registered cleanup before public settlement. Worker construction provenance is not perpetual invocation ownership: `observe.mjs:35` records construction-time AsyncLocalStorage, while `observe.mjs:82` captures **all** workers at each boundary. The label does not track current leases or retirement responsibility. `terminationAwaited` records completion of the observer's native-terminate await (`observe.mjs:59`), not which invocation awaits that promise.

2. Cleanup is registered before session acquisition and shared with finally: source `commands/regex-execution/client.ts:36`, `:43`, `:49`; packed client lines 16–38. Successful request completion first removes the abort listener, clears `slot.busy`, and pumps the pool, **then** resolves the pending request (source lines 240–251; packed 270–286). A creator's successfully completed request therefore no longer owns that worker lease when its command proceeds to close.

3. Session close is idempotent, aborts further session work, awaits pending requests, and awaits its own retirement set plus `executor.close()` (source lines 264–279; packed 302–320). Executor close decrements the shared session count; only the transition to zero awaits pool retirement (source lines 140–148; packed 148–158). Failed active requests separately record and await their retirement (source 235–239; packed 261–266). Slot retirement awaits native termination before removing product listeners (source 111–127; packed 117–136).

4. Consequently, after the queued session closes, successful sibling-one can release its session without waiting for shared-pool termination owed by last-closing sibling-two. Sibling-two can begin both terminations before sibling-one's outer public-result callback runs. Sibling-one's snapshot is a real in-progress retirement snapshot, not falsely measured zero; it simply does not establish unfinished cleanup owed by sibling-one. The trace does not directly instrument session-close counters; the assignment of retirement responsibility follows from this source ordering plus the recorded outcomes.

## Trace cross-check

- `evidence/grep-queued-abort.json:384`: queued-target rejects with `exactCallerReason:true`, caller listeners zero, tracked signal listeners all zero. Both workers retain held responses and have `terminationCalls:0`. Details at line 217 report zero queued-owned workers and two live siblings. Source queue-abort lines 181–187 (packed 194–204) remove/reject an unassigned pending request without failing sibling slots. The four posted requests remain sibling validations/matches, not queued-target work (`child.mjs:62`, `:91`).
- Trace line 554: sibling-one returns status 0, stdout `YWIK` (exact `ab\n`), empty stderr, tracked signal listeners zero. Both workers have `exited:false`, `terminationCalls:1`, `terminationAwaited:false`, held responses zero, and message/messageerror/error/exit listener counts `1/1/1/2` (worker records at lines 584 and 657).
- Trace line 732: sibling-two returns the same exact output/status, tracked signal listeners zero. **At its public settlement**, both workers have `exited:true`, `terminationCalls:1`, `terminationAwaited:true`, held responses zero, all worker listeners zero (records at lines 762 and 836). This is the relevant last-closer settlement evidence, not merely a later dispose result.
- `beforeDispose` and `finalWorkers` also show zero live workers/listeners; `lateErrors` is empty. Final zero alone would not retroactively prove cleanup at settlement. The earlier sibling-two boundary and source ordering supply that missing distinction here.

## Assertion gap and continuation

No real product bug is established by this trace. There is a bounded harness assertion gap: `child.mjs:153` skips per-boundary worker-retirement assertions for every queued boundary; `:144` only enforces global retirement after both siblings complete. Thus raw pass alone does not certify last-owner settlement. The existing captured sibling-two boundary resolves that gap manually for this run; it must not be generalized into a stronger automated guarantee. Creator filtering alone would likewise be insufficient to establish ownership in arbitrary reuse scenarios.

Slot 5 is a **queued protocol/control-boundary pass, not pathological matching** (`EXPECTATIONS.md:50`; trace `pathologicalRequests:0`). The four earlier pathological passes are supplied context, not rerun or independently recertified here. Five of six slots remain consumed; only benign `rg-queued-abort` is unused.

**The sixth control is technically eligible to proceed unchanged if root explicitly resolves the STOP and confirms valid frozen-identity authorization.** Preserve the original STOP and raw evidence, record this adjudication separately, and retain the same expectations, harness, runtime, reservation/no-retry rules, and total budget. Do not erase/bypass STOP, reset slots, or infer execution authority from this report. The recorded authorization has an expiry; current validity is for root to confirm. This leaf neither launched nor authorizes a launch. The sixth control remains unmeasured until its single authorized run and boundary review.
