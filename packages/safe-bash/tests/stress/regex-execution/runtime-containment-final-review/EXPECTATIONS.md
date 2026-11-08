# Independent expectations, frozen before fixture migration

This leaf owns only this new directory. Production, contracts, root configuration,
other harnesses and historical evidence are read-only. Source is exactly
1b133a8662a32ee84524794842074c9c98d5f6c3, including registration 01aa1bf and
messageerror fixture 1027335. The package is virtual-bash, not safe-bash.

The original prepared runtime remains 7/8, with its 16 positive variants preserved.
The wrong-layer assertion diagnosed in c630382 must not become a production fix.
The corrected execution rejection must be a genuine public Shell execution
rejection (ShellLimitError), preserving the primary object's identity when there
is no caller abort, and exact caller identity for 0, false, empty string and an
errno-shaped object during cooperative cleanup. Both registered cleanups run.
A distinct ordinary handler Error control must resolve status 1, empty stdout,
and the exact ordinary diagnostic, rather than claim rejection identity.
Retain all other original fixture cases and assertions. Compare exact committed
fixture bytes to the pre-migration fixture, with every delta disclosed. Count
author compiled results and independent moved-package results separately.

Original five 5/5 compiled and packed are accepted scoped evidence from c3a3647;
do not rerun. Five custom pre-first-read requirements remain separate. Preserve
17.784 versus 15.617 benchmark history without rerun or performance-win claim.

## Exactly six slots, initially UNUSED

| Order | Probe | Native pathological requests | Parent watchdog |
| --- | --- | --- | --- |
| 1 | grep-default | 1 | 6000 ms from fork |
| 2 | rg-default | 1 | 6000 ms from fork |
| 3 | grep-abort | 1 | 6000 ms from fork |
| 4 | rg-abort | 1 | 6000 ms from fork |
| 5 | grep-queued-abort | 0 | 8000 ms from fork |
| 6 | rg-queued-abort | 0 | 8000 ms from fork |

Four risky requests use only historical ^(a+)+$, 28 ASCII a followed by ! and
newline, via the actual public command and actual static native worker module.
No regex execution in the host main thread. Keep request 1000 ms, startup 3000 ms,
maxWorkers 2, family byte/result limits and shell defaults unchanged. Defaults
have no caller signal. Expected result is status 2, zero stdout bytes, exact
`<command>: regex REQUEST_TIMEOUT: active request exceeded 1000ms\n` stderr;
Shell outer timeout and parent kill are failures, not containment successes.

Abort cases require ready worker and an accepted nonempty matching request,
then a 5 ms host timer and abort scheduled at 10 ms. Record schedule/due/actual
times, no-response/busy observation and exact caller reason identity. Host timer
lateness and abort settlement latency must each be under 500 ms (diagnostic
bounds, not a product SLA). Acceptance is a protocol boundary, not proof of
native instruction entry; no native-call instrumentation is claimed.

Queue controls hold real worker response events for two benign sibling public
invocations in one shell/family. Observe third invocation's pending request
abort-listener admission with both leases held, then abort only that invocation.
No third worker/replacement or third posted request; queued invocation owns zero
workers and no surviving tracked abort listeners while sibling workers may live.
Release original response events unchanged; both siblings must finish with exact
benign output and final workers/listeners zero. This is explicitly a trusted
protocol/control-boundary test, not catastrophic matching. Extra native risky
requests to fill leases are prohibited. If this design needs more exposures,
stop and report; never expand or reset budget.

One static compiled owned child at a time. Child heap 128 MiB, stack 1024 KiB;
product worker resource defaults unchanged (128 MiB old generation, 4 MiB stack).
Combined stdout/stderr at most 16384 bytes, cumulative IPC at most 65536 bytes.
Exact child.kill only, awaited close plus IPC/stdout/stderr closure; no group kills.
At exec settlement inspect owned workers, worker listeners and caller/context
abort listeners BEFORE shell.dispose; then final zero and late error window.
No external/user files/network. Product reads only in-memory fixtures; trusted
harness reads only frozen package and owned/historical evidence.

Durably reserve each slot before fork, no automatic retry. Stop the whole matrix
on any failed/ambiguous target, retaining unused slots. Root authorization must
explicitly bind reviewed independent benign green, frozen harness/matrix hashes,
source/package identity and all six slots via
/tmp/regex-containment-six-authorized.txt. Readiness is NOT authorization.
Phase 1 ends with an early handoff and WAIT; no target may execute beforehand.
