# Minimal old-worker adapter delta — DATA proposal, NOT executable approval

This document is the exact scope of the proposed adapter, not an applied patch.
Base worker: m1a-review-v5/worker.mjs at
f38984ec68477a620792b5e899f7f29aa586bc9f, SHA256
4ed48d8e1a40a7abc298d9ac16d6fcaba3d844c5a1673835868a586c3844182c.
Observer proposal: observer.mjs v6.1, SHA256
2f6b88f05d53d8c4c5b95724baddc3b6b7e825163f05abb6c69bcdf161de4abb.
It is NOT qualified for candidate continuation. The original worker remains intact.

## Only proposed changes to a NEW worker copy

1. Import the versioned observer into the isolated worker copy. Preserve the
   actual module loading, candidate bindings, matrix selection, command arguments,
   assertions, fixture bytes, expected diagnostics and effect checks verbatim.
2. In the already-present createInflate instrumentation hook, reserve/enroll an
   observation scope BEFORE calling the original factory. Immediately retain the
   returned owned stream, then attach the instance observer. Never patch stream
   prototypes or a product source module. Restore the existing factory hook in
   an outer finally even on capture/import/assertion failure. The current harmless
   qualifier did not use that global factory hook at all.
3. Use one bounded observer record per created stream, not one v6 instance for
   an entire layout: v6.reserve has a two-resource test bound. Proposed candidate
   cap is 1024 observed streams per layout; overflow is HOLD, not eviction. Preserve
   cumulative creations and delivered notifications; separately aggregate actual
   not-closed and known-state-pending counts. Do not call any of these native live
   handle counts. Remove the unsupported one-live-native-resource assumption.
4. At the existing case boundary, preserve the original semantic PASS/FAIL and
   every other safety predicate. Record the old event-only predicate alongside
   new settlement and horizon snapshots. Replace ONLY the event-difference safety
   term with the new terminal observation verdict after the bounded horizon.
   Keep immutable original v5 fields in their historical schema; new schema calls
   the old maximum maxUnobservedNotifications, with no historical rewriting.
5. Never manufacture cleanup settlement from stream.closed or from a delivered
   event. Mirror explicit known registered-cleanup settlement and admitted resource
   release evidence at the actual host contract boundary. Existing case helpers
   explicitly invoke registered callbacks after direct command.execute; that is
   not identical to the public Shell.exec settlement boundary. A row-level sample
   alone cannot certify every earlier command-return boundary. Unknown provenance
   must HOLD; any necessary new helper instrumentation requires its own disclosed
   harness-only seal, without modifying original semantic assertions or fixtures.
6. Retain error listeners through bounded closure and record late failures with
   hasFailure independent of reason truthiness. Keep actual write/end callback
   notification pending distinct from the caller's close-fallback operation
   promise, explicit cleanup promise, stream state and notification delivery.
   Registered cleanup remains idempotent and admission-closed; no new guarantee
   is imposed on opaque uncooperative external work. Never suppress a pending
   write or lost cleanup failure merely to obtain a passing score.

## Blocking findings — ROOT decision required

The actual v6 R02 worker waits only for its write callback. The frozen product
codec has a close-listener alternative for the writer's operation promise. This
missing surrogate close alternative was a harness preparation defect: the real
error control did not match that relevant product cleanup shape. On the bound
runtime, the R02 close event and closed state were observed while this harness's
write callback/owned writer promise remained pending. The 3s cleanup timer rejected;
the observer correctly held its own unsafe surrogate, but the frozen expected
PASS failed. No production defect follows, and no new expected result is substituted.

The current observer requires actual callback delivery. Even adding the omitted
close-fallback to a successor harmless harness would not, by itself, qualify that
requirement: a caller operation can settle by close while the raw callback
notification is absent. ROOT must decide whether a narrowly evidenced, explicit
callback-retirement model is acceptable for this exact Node profile; without such
evidence it remains pending/unknown and HOLD. Closed or _handle alone cannot retire
it. Conversely a genuinely pending owned callback/cleanup must continue to HOLD.
This is a model/proposal limit, not permission to relax the frozen v6 assertions.

No executable adapter claiming those missing facts is supplied. Before any
candidate run, a successor observer and adapter must be frozen and independently
qualified under a fresh ROOT GO, preserving this failure and the 16 unexecuted
controls. Candidate continuation needs a separate GO after that qualification.
Neither this document nor CONTINUATION-PROPOSED.json is such authorization.
