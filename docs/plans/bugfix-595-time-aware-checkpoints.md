# Issue #595: time-aware text-program checkpoints

## Validated gap and scope

The shared sed/awk Budget checkpoint only yields every 256 calls. Small probes
confirmed a scheduled caller abort remains undelivered through 255 checkpoints
and preserves its exact falsey reason when the 256th checkpoint yields.
The reported 80–150-second timings and RSS workloads were not reproduced.

Add an elapsed-time trigger at 25ms using existing monotonicNow, alongside the
unchanged cumulative 256-call trigger. Check cancellation before inspecting the
clock and after the checkpoint. Record the next elapsed-time baseline after a
successful yield completes. Reuse yieldTurn and its existing setImmediate or
setTimeout(0) scheduling; do not introduce policy options or public APIs.

This improves cooperative checkpoint cadence, not total execution latency or
preemption inside one synchronous/native operation. Byte-work admission and
allocation concerns in #594/#575 remain separate. Existing callers, step charges,
CPU and wall-clock limits, and documented uncooperative-host limits stay unchanged.

## TDD and verification

Extend the existing cancellation.cases.ts imported by text-programs.test.ts;
no new discovery membership is needed. Mock only the clock and preserve real
event-loop turns. Cover below-threshold behavior, early elapsed triggering,
stationary-clock count fallback, timestamp reset after a completed yield,
cumulative count cadence after an elapsed yield, falsey already/during-yield
cancellation, and real setTimeout(0) fallback. Restore clock mocks, global
descriptors and pending handles between cases.

The unchanged runtime produced nine expected failures and eleven passing
preservation controls in the 20-case focused run. The elapsed-time implementation
then passed all 20 without fixture changes. The complete text-program owner plus
the existing yield test passed 70 cases; the focused shell CPU/wall-clock controls
passed two cases. No cases were skipped or cancelled.

Independent review then found a test-fixture defect: registering a second clock
mock in already-aborted cases restored the first mock rather than the original
clock. Those green runs did not establish clock restoration and could leave later
same-process elapsed checks using a frozen clock. An explicit post-fixture clock
identity control reproduced this with 20 passes and one failure. Keeping one
installed mock and toggling a forbidden-read flag fixed the fixture without
changing production source. The updated focused run passed 21 cases, the full
text-program owner plus yield control passed 71, and the CPU/wall-clock controls
again passed two, with no skips or cancellations.

The maintained `npm run build:workspaces -- --workspace=virtual-bash` closure
passed before that fixture-only repair, building safe-fs and virtual-bash from
maintained declarations. Production source remained frozen; no build was rerun
for the fixture repair. Root owns
independent review, consumers, lint, Git delivery and release monitoring. Only
shared.ts, cancellation.cases.ts and this plan are implementation-owned.
