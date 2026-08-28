# Minimal candidate-worker adapter proposal — UNAPPROVED DATA

This is a bounded integration proposal, not an executed or certified adapter.
Base: v5 worker at f38984ec68477a620792b5e899f7f29aa586bc9f,
SHA2564ed48d8e1a40a7abc298d9ac16d6fcaba3d844c5a1673835868a586c3844182c.
Use qualified v8 observer.mjs SHA256
30d33df91fe6bfbb89a10ac81b93e39d321bdc7aa39a6133fa2e0dfd65e1f7c1 and
retirement.mjs SHA256
c8a19a9389d045b2807eb1d60534747297e2430fd93c7950e1e5025e698720f2.
No edit is applied to the old worker, case module, fixtures or candidate.

## Exact scope of proposed changes in a NEW worker copy

1. Preserve candidate/loader hashes, imports, scenario selection/order, all71
   semantic assertions, fixture bytes, arguments, expected status/diagnostics,
   filesystem effects and every non-zlib safety predicate. Import only the two
   versioned v8 observer modules as new harness dependencies.
2. Within the existing createInflate factory interception, allocate an observation
   record and enroll its cleanup BEFORE calling the original factory. Retain the
   returned actual stream immediately; install instance-only observation before
   returning it. Use one v8 observer/resource record per stream, not one instance
   for an entire layout (v8's per-observer resource bound is2). Proposed total
   admission ceiling1024 observed streams per layout; overflow HOLDs.
3. The product's actual iterator must go through the same owned-return enrollment,
   not a synthetic replay of its close error. The new adapter must intercept the
   actual stream's Symbol.asyncIterator entry while preserving the original
   iterator factory. Current retirement.iterator() calls the underlying factory;
   naively replacing that method with retirement.iterator recurses. A facade
   returning retirement.iterator() while leaving the underlying stream untouched
   is a possible harness-only seam, but its complete forwarding/identity behavior
   requires DIFFERENT review and exact new-byte sealing. Do NOT claim that a proxy
   or method wrapper is transparent merely because these harmless controls pass.
4. Enroll direct-owned closure only for actual known cleanup calls. Keep the exact
   stream/iterator/operation/cause identity and first-call/quiescent-return rule.
   Do not auto-own every factory-observed destroy(error), and do not infer ownership
   from AbortError shape or a command-duration window. Restore descriptors/factory
   hook in finally after bounded error/close notification drain.
5. Preserve the old event-only predicate as historical diagnostic. Add separate
   snapshots at the actual applicable command/host-cleanup settlement boundary
   and at notification horizon. Replace ONLY the old outstanding-close-event
   safety term with the new verified state/operation/cleanup/error verdict. Keep
   semantic outcome separate. All other old safety checks remain unchanged.
6. Record unobserved close events, raw callbacks, not-closed states and pending
   owned work independently. Drop the unsupported one-live-native assumption.
   Never derive operation settlement from missing callback counts, closed flags,
   private _handle state or from merely reaching the end of a case.

## Required integration review before any candidate admission

The harmless qualifier can directly observe its isolated writer Promise. A public
createInflate factory wrapper alone cannot read the candidate's lexical writer
Promise. Its exact frozen codec finally awaits written, but any source-linked
inference from that fact must be explicitly reviewed and labeled—not silently
recorded as a directly observed promise. Likewise, the old case helper invokes
registered cleanup after direct command.execute; that is distinct from public
Shell.exec/root cleanup. A row-end sample alone cannot certify all earlier return
boundaries. Actual cleanup registration, idempotent completion and per-invocation
resource association need a disclosed harness seam, with unknown state HOLDing.

Therefore this document intentionally does not provide a pretending-to-be-ready
executable adapter. A different reviewer must settle these seams, freeze the
concrete adapter/helper delta and any source-linked observation assumptions, and
request fresh ROOT GO before candidate admission. Semantic assertions/fixtures
must remain unchanged, but instrumentation helper byte changes must be disclosed.
No production API/private-source modification is proposed to solve observability.

## Proposed finite sequence

After those prerequisites, recommend all71 source groups in original order,
not H09-only: all previous69 source groups need a fresh observer binding. Then
the original14 other children: compiled/staged/moved3, declaration positive1 plus
negative4, mutants3, binding negatives3. Total15 proposed future children;284
fresh layout groups, consisting of69 repeated source groups plus all215 originally
unexecuted groups. Types/mutants/binding controls are not added to layout counts.
Authenticate frozen source/archive/package/consumer inputs, no live source overlay;
no gratuitous new build/control/oracle children are included. If additional
preparation execution is required it needs a revised explicit seal/GO.

CONTINUATION-PROPOSED.json binds the exact historical inputs, v8 modules and this
proposal hash, sequence, fresh600000ms aggregate, sequential peak2,15-child future
cap and32MiB/128MiB file budgets. These are PROPOSED, not this qualification's
authority. Each admission must fit remaining time/capture/cleanup budget; otherwise
STOP with unexecuted rows, never omit evidence. No inherited110-minute allowance.
The current user-authorized cohort remains one child with no candidate execution.
Six native Git workflows stay held. Different review plus fresh ROOT GO is still
required; this successful observer qualification supplies neither.
