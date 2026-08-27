# Independent writer-isolation controls, frozen before author changes

Owner: independent verifier leaf. Only this new review directory and
`/tmp/byte-writer-fix-verifier-*` markers are writable. Product, canonical fixture,
other review directories, and historical evidence remain read-only.

Baseline requested HEAD: `954406871fae381b1c69441b34946a224201d7ad`.
Historical gate: `b494675c34dc289f4ad4b10a9201e1211eb0a7d8`, unqualified
16,520 pass / 307 fail / 13 skip. The 2/2 direct-curl result does not excuse
artifact mutation and does not itself explain 99 TAP hash-guard failures.

## Ten independent bounded controls

1. Execute the old canonical writer only in a fresh archived b494 source copy;
   preserve exact affected bytes and full tracked-test hashes before/after.
   Never restore the failed copy or use it for candidate verification.
2. In a different clean candidate archive, execute the actual canonical test
   normally with strict unhandled rejection handling. Both real binary-vector
   assertions must run and pass, with no expectation/source-pin rebaselining.
3. Execute two independent canonical Node processes concurrently in that same
   clean candidate archive. Each must run both assertions and terminate normally.
4. All tracked test fixtures and sealed artifact subtrees remain byte-identical
   across default serial and concurrent executions. Existing read-only sentinel
   bytes in the historical artifact path and repository remain unchanged.
5. Default execution either persists nothing or uses unique OS temporary paths;
   concurrent persistent outputs must not collide. Temporary resources owned by
   the fixture must be cleaned and no process watchdog may be needed for success.
6. An explicit capture, if provided, targets a newly created output only, records
   actual source/test/fixture bindings and both observed cases, and never silently
   treats a stale historical source pin as actual current execution provenance.
7. Explicit capture refuses an existing directory and sealed artifact directory
   without changing their contents or accepting their contents as new evidence.
8. Explicit capture refuses a symlink target without modifying its referent;
   supplement the same invariant with symlink-parent coverage when supported.
9. Force a real assertion failure by modifying only a verifier-owned source copy
   (not expectations). Failure must remain nonzero, retain original expected
   binary vectors, preserve sentinel bytes, and not autoaccept/rebaseline results.
10. Capture and replay must remain separate: capture records actual outcomes,
    including failure, rather than accepting them. Any implemented replay must
    validate actual bindings and refuse mismatches rather than repairing pins.

The author may implement no-persistence default or isolated OS-temp default.
These invariant expectations do not prescribe an API. The eventual public
test-only capture entrypoint will be exercised as implemented, without changing
expectations to obtain green results. API-specific supplements are disclosed.

## Execution and attribution

Use Node strict unhandled rejections, 45-second process watchdogs, and exact
owned-child termination only. No network, regex probe, broad process kill, full
gate rerun, or production edits. Retain raw stdout/stderr/status and commands.
Inspect every one of 99 routed diagnostics and its relevant pin guard, compare
expected/actual paths against precisely changed writer artifacts, and, when
possible, execute just those guard preflights before the archived writer runs.
Report gate immutability failure separately from TAP guard failures; unsupported
causal fractions stay unproven. Initial foreign changes are recorded, not restored.
