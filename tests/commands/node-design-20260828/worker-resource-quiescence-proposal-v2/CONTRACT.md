# WRQ v2: synchronous entry retirement

Status: Proposed corrections under ROOT-ratified D1–D3.
Implemented Through: Not applicable.
Purpose: resolve reviewed design gaps without authorizing implementation.

## Boundary

MUST/MUST NOT describe future conformance, not observed behavior. One invocation
owns one trusted static Worker entry, one evaluator run and one transport session.
Only a legitimately supplied optional provider owns native Worker/SAB/ports;
guest evaluation is interpreted, never native eval/Function/subprocess/fallback.
Core runtime dependencies remain zero. Trusted provider JavaScript is not sandboxed.

The selected lifetime is actual settlement of the single bound entry API, not an
invented top-level checkpoint or all-Promise census. Primitive print must complete
its authorized, quota-counted sink publication including LF before terminal intent.
Promise-fs and modeled exit are absent; ordinary permitted language continuations
may be abandoned. Their pending/runnable/unobserved counts remain unknown.

## Admission and transport

`RPC.json` defines version2's finite states, word layout, counters, phases and
ownership transfers. Slots1/2 remain physically allocated but inactive. Parent
cleanup MUST be registered synchronously before SAB/Worker/input/output acquisition;
the same idempotent cleanup is used by finally and the root cleanup barrier.

A request header reserves transport and full-operation staging; it does not
authorize a filesystem effect. Upload credits transfer payload ownership for
exact bounded chunks. Parent MUST copy each chunk before crediting reuse. Only
complete validated source bytes, exact totals, route/grants, confinement and all
reservations can enter the parent-local synchronous admission transaction. This
enrolls operation cleanup before calling VFS/sinks, including synchronous throws.
The transaction and cutoff share one non-reentrant monotonic gate. No await or
untrusted callback separates the final gate check from enrollment.

Normal cutoff freezes the admitted set, closes the admission timer, requests
Worker retirement and drains preadmitted parent work without aborting it or
resetting quotas. Staged-but-unadmitted bytes are discarded, never written.
No postcutoff response service, new effects, retry, cache load or slot reuse is
authorized. A previously published response may already be observed by Worker;
parent chronology does not prove cross-thread observation order.

ACK proves transport buffer consumption only. Even final ACK plus FREE does not
prove bridge delivery, guest catch execution or Promise settlement. Known rejected
operations remain parent-owned outcome records until a qualified post-bridge
witness is validated before cutoff, or remain undelivered failures. The proposed
sync terminal witness in `RPC.json` is explicitly qualification-blocked; an event
name or terminal watermark alone cannot establish successful copy/error handoff.

## Resources and cancellation

`CAPS.json` preserves ratified maxima and names precharges, overlapping copies,
releases and excluded/unqualified allocation categories. Sixteen MiB measures
named command-owned live reservations, not guest graphs, RSS or whole-guest8MiB.
Each full frame, staging buffer, decoder/string copy, journal/error record and
retained cache input needs a reservation before allocation. Provider pre-copy and
producer-owned memory remain qualification gaps, not zero-cost exclusions.

Cancellation closes admission, records actual parent provenance/presence/value,
sets the independent stop latch, wakes blocked sync and requests termination
immediately, with zero grace. It never overwrites peer-owned payload. Caller
cancellation remains active through drain. Unknown exit or unclosed tracked
parent work keeps public settlement pending; no timer fabricates clean ownership.
Opaque uncooperative host work acquires no arbitrary preemption guarantee.

## Values and failures

`CACHE.json` specifies invocation-local interpreted value ownership. Ordinary
injection copies arguments before callbacks and uses a fresh map per return;
returning one host object repeatedly cannot implement guest cache identity.
Primitive-text signatures avoid promising deep original-descriptor validation.
Required options-record/exclusive-create and hidden-scaffold paths remain blocked
until legitimate provider evidence exists; no forged private brands/new exports.

`ERRORS.json` enumerates all28 pinned typed FS codes and exact metadata variants.
Guest own-data validation ignores realm prototype identity and performs no
coercion/getter invocation. This does not promise safe introspection of hostile
host proxies. Typed FS outcomes, invalid requests, profile failures and parent
control are different routes. Arbitrary host rejection objects never cross to guest.

After confirmed Worker exit AND actual parent cleanup, raw intentional retirement
maps to0, guest program failure to1 and private-profile failure to2. These rows
cannot override parent failures. Bound command contracts preserve root caller
over escaping execution/control over local cancellation; cleanup-only failure
rejects unchanged or aggregates multiple failures as specified there. Retain all
secondary failures without modifying the selected primary. A mapped status never
creates new escaping provenance. Worker exit code and stop flags are not outcomes.
Destination-only stdout closure MUST NOT cancel sibling files/stderr. Partial
effects survive failure; no rollback claim.

## Proof and hold

`OBLIGATIONS.json` maps exactly L01–L08 to unchanged WRQ01–WRQ08. Its actions and
expected results are future obligations, not new inputs, a broad cohort or passes.
`DISPOSITIONS.json` resolves each F1–F7 design concern and records remaining proof
blockers. `SOURCES.json` distinguishes inherited source inspection from freshly
authenticated artifact bodies. `SEAL.json` hashes every input/output body except
itself; its complete-body hash is delivered externally to avoid recursive sealing.
No executable recipe, provider acceptance, implementation or experiment grant is
included. A different review and explicit later ROOT authorization are required.
