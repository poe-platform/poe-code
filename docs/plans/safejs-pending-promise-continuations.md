---
title: Pending promise continuations
---

# Pending promise continuations

Validated against the built alias-accounting candidate based on 44df48515:

```js
const {promise, resolve} = Promise.withResolvers();
return async () => {
  resolve(7);
  return await promise;
};
```

Calling the returned closure directly, using invokeBuiltinClosure and
awaitSandboxValue, returns 7. A separate fresh run serialized with that closure
as a module root fails with TypeError: Cannot serialize host reference at
scopeChain[0].bindings.read.<guest>.<guest>.promise.

Settled promises and settled no-op resolver functions are supported. This is a
distinct missing continuation capability: preserve a pending promise together
with the guest resolver that can settle it after restoration. Native then/reaction
callbacks, adoption of another promise or thenable, first-call settlement locks,
rejection handling and active guest awaits must not be silently discarded.

Before implementation, add failing direct-restoration tests for resolution and
rejection, shared/cyclic resolver identity, pending then chains, thenable adoption
and repeated resolve/reject calls. Track explicit continuation state and rebuild
the native scheduling adapters on restore. Unknown pending host effects still
require reconciliation, not blind replay or an inert replacement promise.

No runtime change has been made for this gap yet. It remains separate from
weak collections and the currently running alias-accounting regression suite.

Alias accounting was delivered separately as remote-main commit 465892623.
Four continuation regressions now fail in 1.55 seconds, each after first proving
its unsnapshotted control: fulfillment returns 7, rejection returns "reason",
a pending then chain returns 8, and pending-promise adoption ignores a later
resolve(99) and eventually returns 7. All four then fail during serialization
of the fresh pending state, before restoration. No continuation implementation
has been added yet.

Continuation-state groundwork is now in progress, uncommitted. Two metadata
regressions initially failed because pending capabilities, locked resolution
inputs and reaction links were not represented. The runtime now records these
in weak maps while keeping the existing native reaction scheduling path.
Reaction records distinguish waiting from running handlers; restored execution
must not replay a running handler. Settlement removes records and outgoing links
and clears captured resolution inputs to avoid retaining completed state.

Both metadata regressions and 70 related promise/job/settled-resolver checks
pass (72 total) in 2.04 seconds. The four pending snapshot regressions are still
unresolved: serialization, restoration, metadata accounting, custom species,
thenable side effects and queued/running continuation policy still need work.
Do not publish this groundwork as completed pending-promise snapshot support.

The ordinary constructor and restoration now share actual pending capability
creation, including first-resolution locking and self-resolution rejection.
Resolver action metadata identifies resolve versus reject without changing their
guest properties. Pending capability snapshots currently admit only unresolved,
unobserved capabilities without reaction links. Observed continuations remain
rejected until their state is represented, preventing silent handler loss.

The direct fulfillment and rejection restoration regressions now pass. Pending
then chains and adoption remain red. Added a fifth regression for a discarded
then-result whose handler mutates captured state; its unsnapshotted control
returns 9, and serialization currently rejects it rather than losing the effect.
Current continuation result: two passes, three failures, in 1.54 seconds.
Eighty related promise/job/settled-resolver checks pass in 2.35 seconds and the
changed TypeScript files have zero diagnostics. The implementation remains
uncommitted and incomplete; next work is explicit reaction reconstruction,
adoption without repeated thenable effects, accounting and full validation.

Waiting intrinsic then-reactions are now represented with their source,
handlers and ordered outgoing results, including discarded results. Snapshot
validation requires reciprocal source/result links and rejects duplicate or
unlisted reactions. Unrepresented observers and running reactions remain
rejected rather than being dropped or re-executed.

An added reversed-binding-order regression exposed incorrect reconstruction:
the restored trace was ["second", undefined] rather than ["first", "second"].
Reconstruction now attaches handlers after heap initialization, in each source's
registration order, under one shared SandboxJobQueue context. That regression
passes. Rejection handlers, default forwarding and thrown handler errors also
pass. Current direct continuation coverage: eight passing cases, one failing
adoption case, in 1.91 seconds. This is still uncommitted work, not full support.

Adoption inspection shows resolvePromiseResult creates an internal native
promise and resolving callbacks before attaching them to the adopted promise.
Those callbacks need explicit origin/state and reconstruction; re-running the
original resolve input can repeat thenable code or change scheduling. Preserve
that resolution path rather than adding an inert promise or ignoring reactions.

Two malformed-snapshot tests proved that self-cyclic and two-node cyclic reaction
source graphs were accepted. Heap graph validation now rejects both, using an
iterative traversal with completed-node tracking, alongside scope-parent cycle
validation. The continuation/restore/policy run now has 116 passes and the one
still-failing adoption restoration case (117 total, 3.64 seconds).

The native adoption bridge now has explicit weak metadata: an opaque token,
source/owner promises, settlement lock and the origins of its two callbacks.
The token itself contains no native callbacks or promise fields. Normal resolution
uses the same job and callback path through a shared bridge constructor; future
restoration can reconstruct that bridge without invoking the original then method
again. Metadata assertions first failed, then passed. Settlement cleanup is also
verified: bridge, owner and callback mappings are removed after fulfillment.
Seventy-two related promise/job/resolver tests pass in 2.59 seconds, and all six
TypeScript files changed in this step have zero diagnostics. Snapshot encoding,
validation and restoration of adoption bridges are not implemented yet; the
adoption regression remains unresolved. No commit or push for this unfinished
continuation improvement has been made.

Release monitoring: scoped SafeJS 0.1.397 succeeded. CLI run 34159690917 failed
its two Float32 camera tests at the existing 5000ms limit (36,327 passing tests);
release-stable was skipped. This failure is not treated as a successful CLI
publication and does not pause continuation implementation.

Adoption bridges are now encoded and restored explicitly, with owner/source
references and action-tagged internal resolver nodes. Restoring a bridge locks
the owner's original resolver pair and connects its native capability to the
bridge promise; it does not repeat the original resolve or then method. The
original adoption regression now passes, as do rejection propagation, a
three-promise adoption chain, and a later thenable getter evaluated exactly once.
Two additional malformed snapshots (missing callbacks and wrong callback action)
were accepted before validation was tightened; both are now rejected. Each bridge
must have exactly one matching callback pair on its source's reaction list.

Three memory-accounting regressions initially measured zero growth for a
400-character retained payload. Measurement now traverses pending capability
resolution inputs, reaction sources/handlers and ordered outgoing results;
adoption callbacks declare their retained source/owner. All three pass, including
post-settlement release checks. The focused promise/snapshot/job/policy suite has
197 passes in 3.83 seconds. Changed-file ESLint passed. An older private-element
test that asserted the pending-promise limitation was reproduced failing because
serialization now succeeds, then replaced with a restored private-slot promise
and resolver that settle to 7. All 31 private-element tests pass in 3.45 seconds.

This remains uncommitted pending broader verification, real CLI validation and
review of unsupported running/custom-species/host-observer continuations. Neither
full pending-continuation coverage nor full JavaScript completeness is claimed.

The broad package suite is running in terminal session 60111 with only the two
previously documented experimental exclusions. No final result yet. A same-name
harness pair is prepared for the real CLI after a fresh maintained build; it
checks adoption locking and reaction order across an await, without agent spawns.

Review identified a possible result-only capture gap in custom-species reactions
and aggregate promises: source-side observation flags may not protect a result
whose prototype has been reset to the intrinsic Promise prototype. Four tests in
pending-promise-species.test.ts first settle an unsnapshotted control, then check
that an unrepresented result is not silently serialized as an inert capability.
These tests have not run yet; execute them after the full package suite exits.
Do not treat this review hypothesis as a validated bug or publish until checked.

The broad package run completed successfully: 19,549 passed, 41 skipped,
620 passing files and one skipped file, in 400.63 seconds. The four result-only
tests then all failed: custom-species then, custom-species all, intrinsic all
and intrinsic race were accepted despite missing producer continuation state.
The unsnapshotted controls completed correctly first. These incomplete producer
results are now marked as unrepresented, without marking their rejections handled.
Capture rejects them explicitly instead of falling back into arbitrary native
properties. Settled results remain supported. Full custom-species/aggregate
continuation serialization is still required; this guard prevents silent loss,
not a claim that those continuations are implemented.

After that guard, all 232 focused promise/snapshot/private-element/job/policy
checks pass in 5.39 seconds. The broad result above predates this final guard;
the focused rerun covers the changed admission path. Final lint, build, CLI and
delivery checks remain outstanding.

Final changed-scope lint passed. The maintained build completed all 70 declared
workspace builds, fresh SafeJS ESM import checks and the root suffix stages.
Node 18.18.0 restored the built adoption snapshot and returned 7, preserving the
first-resolution lock. The real CLI harness passed; its rendered PNG was opened
and inspected. It reported the title/values/order result and zero spawns, so this
is runtime/CLI evidence, not real-model evidence. Ready for the atomic pending
intrinsic-promise snapshot commit; aggregate/custom-species and active running
continuations remain explicit follow-up work.
