# L02 source diagnosis and minimal change proposal — NOT implementation GO

Original5001adc71a9c1549822843d9cdd3bc2410fcf357 remains **75PASS/1nonpass/59UNRUN**, cell76 Worker telemetry UNKNOWN. Nothing is replayed or rescored.

## Established source sequence

1. Exact bridge05e485aa... line3 creates NativeWorker and installs its OWN observers using NativeWorker.prototype.once/on before replacing instance once. Those observer records live only in memory until final RESULT publication. The replacement throws raw **false on EVERY exit registration**, not just the first setup call.
2. Bound owner.js16306b78... line83 calls worker.once(exit). That is the first injected synchronous throw(false); exitListenerInstalled staysfalse. start catch calls fail(false), preserving raw first failure and rejecting ready. stdout/stderr enrollment at91–92 is never reached on this branch.
3. close begins asynchronously and awaits worker.terminate(). The adapter forwards to NativeWorker.prototype.terminate.call(this). We inspected ONLY the pinned Node public prototype method source:834 bytes, SHA256 **a418b39c68a6c0b6c8c839c5bedfbe01dc01f04fb0b4e7f5072f3b560dbd9b89**; no constructor/terminate invocation or private binding.
4. On its live-handle/no-callback path that exact method calls ref(), stopThread(), then constructs a Promise whose executor calls **this.once(exit,resolve)**. The persistent override throws false AGAIN. **The resulting terminate call returns a rejected Promise(false); it is not a synchronous throw out of terminate on this path.** stopThread was requested before the rejected registration. If the native handle were already null, the method instead returns a resolved Promise; that alternate branch cannot be eliminated from missing original telemetry.
5. Owner.close resolves its fallback exited waiter only AFTER successful await terminate. With termination rejection and no installed owner exit listener, no resolver remains. Promise.allSettled waits indefinitely on that inert dependency. Root execute awaits retirement at252, so its user-facing rejection is also delayed. Independent fixture observers seeing exit would not resolve the OWNER's different waiter.

**Thus the two-fault/unresolved-wait path is proved by pinned source and reproduced with pure host doubles.** It is consistent with original unsettled-top-level-await/exit13, but does not retroactively prove original handle state, actual termination rejection or Worker exit/drain. The original process exit13/close and absence of RESULT are the only runtime facts for cell76.

## New finite evidence

Source-metadata preseal c3c3a2784 precedes helper1. Host-double preseal ea8bf1313 precedes helper2. Both helpers exit0/empty stderr. Six groups6/6: persistent double fault; one-shot setup fault; false primary/undefined cleanup; independent owner exit with failed termination; constructor nonacquisition; normal exit plus both streams. No product imports, actualWorker, native terminate invocation, compiler/build or OS fixture.

D01/D03 observe unresolved model promises after16 microtask turns; structural missing-resolver reasoning establishes the dependency issue. This is NOT an OS-time/all-jobs guarantee. D01 detail keys setupThrow and terminationPromiseRejects store the raw reason **false**, not a boolean assertion that no fault occurred. D02's successful model cleanup does NOT prove skipped real stream ownership. Result SHA256 **6288ae921fa579fccc79cf67bc31c828588187a4cf45d768d83ff377fa6c6f29**.

## Fixture semantics decision

The case is named handler-setup-throws, and the frozen runner expects the execute rejection false followed by joined cleanup. Its adapter instead imposes a persistent exit-hook outage, which also faults native termination's registration. This is a double-fault fixture relative to the named single setup event, NOT grounds to waive the owner's genuine unresolved-wait edge.

Recommend a NEW explicit L02-v2 single-fault fixture: throw false only for the first owner setup exit registration; record the count/phase, then delegate later registrations unchanged. Preserve the original fixture as a separate persistent-registration-failure/unknown-retirement obligation. Do not silently edit the old name/input, drop the double-fault obligation, weaken cleanup assertions, use prototype bypass registration or call a mock/observed process close known Worker retirement. ROOT must ratify that split before editing.

## Minimal production proposal and ownership boundary

Proposed write paths ONLY:
- src/commands/regex-execution/ere/transport/owner.ts
- src/commands/regex-execution/ere/transport/root.ts, only to carry/retain explicit unconfirmed-retirement state
- NEW owned fixture/evidence version; no engine5, protocol wire/limits, public Expr/RegexExecutionOptions, parser/conditional/runtime edits.

Owner change: separate acquisition/exit/stdio observation state, first setup failure {present,value}, termination/cleanup failure {present,value}, and retirement confirmation. When exit observation is unavailable and termination rejects, record **UNCONFIRMED** and reject stop-observation with the exact cleanup reason instead of feeding an unresolvable exited promise into an unconditional join. Never resolve exited to fabricate evidence, never clear the Worker/streams or release charged metadata on that branch. Ordinary observed-exit paths still join termination and BOTH enrolled streams. Late events/errors stay owned/observed.

Root change: preserve first setup/caller reason precedence separately from cleanup/retirement. Unknown retirement must not set retired, refund reservations, clear the retained active ticket/owner, publish clean, or admit another Worker. The current complete() clears active after rejection; a bounded retained active slot (existing storage, no new uncharged map) needs an explicit unknown branch. close() must not wait on active.done forever after a definitive unconfirmed observation; it must report unconfirmed while retaining the actual retirement join/ownership. These are two different facts, not a successful cleanup return.

Also address skipped stdio enrollment: exit-listener setup failure currently prevents91–92. A claimed clean single-fault recovery must explicitly enroll/observe both streams during the cleanup acquisition path with separately retained enrollment errors. No undocumented fallback EXIT listener or prototype bypass is proposed. If stream observation cannot be enrolled, mark unconfirmed rather than treat undefined promises as drained.

**Required ROOT policy before code:** approve a private stop-observation/retirement-status distinction while preserving close rejection/raw reasons and root-owned resources. No new public option/wire field is required, but private owner/root declarations may gain an internal status type/getter. For an actually nonsettling terminate/exit/stream, a product-level bounded observation needs an explicit existing deadline authority or new private policy; the harness10s/TERM2s/observe1s must NOT be silently imported as product thresholds. The narrow known-rejection fix alone is not a hard-completion guarantee.

## Proposed future validation, all UNRUN

After source/fixture decisions and fresh different review:13cells maximum,10Workers maximum, sequential/peak1. Constructor-false no-acquisition3layouts; ordinary P01 three layouts; existing postMessage-throws three layouts; NEW one-shot setup-false three layouts; persistent double-fault one built-layout terminal cell LAST. All75 old passes inherited, not replayed broadly. Every source/fixture delta gets fresh load hashes.

Propose600s inclusive/22knownOS (owner1+13cases+8admin),peak3; case10s/TERM2s/observe1s and180s publication reserve;64MiBcapture/256MiBwork unchanged.13×13s+180s=349s, leaving251s admission/publication margin. These are proposed, NOT granted. The final unknown case cannot become ordinary PASS or permit another case; capture bounded owner-observed setup/termination/exit/stream facts DURABLY before depending on RESULT, and retain unknown ownership. No automatic59-tail continuation.
