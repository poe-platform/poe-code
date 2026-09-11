---
title: Pending Promise subclass continuations
---

# Pending Promise subclass continuations

Follow-up to remote-main 0a2d8e36e. The intrinsic pending-promise snapshot change
explicitly rejects custom-species producer continuations rather than silently
dropping their callbacks. Extend that representation to Promise subclasses,
preserving their actual resolver pair, prototype/private state, reaction ordering
and settlement semantics. Do not invoke a species constructor again on restore.

First reproduce direct restoration for an ordinary subclass with a private field
and for an explicitly selected subclass handling rejection. Each test runs its
unsnapshotted control first. General custom species can return non-Promise objects
or provide arbitrary resolving functions; support for an ordinary subclass does
not prove those cases or aggregate continuations complete.

The predecessor release workflows are live: scoped packages 34161862492 and CLI
34161862592. Continue implementation while monitoring publication separately.

Both direct-restoration tests are now validated red (1.77 seconds): their original
closures returned [8,true,9] and ["handled:reason",true], respectively; fresh
serialization then rejected the unrepresented continuation. No implementation
change for this follow-up has been made yet.

Producer metadata groundwork is now uncommitted. A subclass can expose its
result resolver and settle the result before the source reaction executes.
Accordingly, the existing discarded native reaction-completion wrapper now owns
the reaction record, and a separate result-to-producer weak link retains that
record until the handler finishes. The result capability is not overwritten.
The metadata test first failed, then proved that early settlement to 99 preserves
the producer, the later source settlement runs its handler exactly once, and
both source/result links are removed only after completion.

The metadata test observes the native wrapper settlement directly: calling the
guest await adapter on the subclass from an unrelated test context attempted to
construct a new species without the interpreter invocation context. The actual
guest subclass execution paths remain covered by the two restoration controls.

A retained-payload test first measured zero growth through the result. Measurement
now follows producer links and the producer's actual promise/resolve/reject
capability, without traversing native callback fields. The 400-character growth
is counted once across shared links; ignoreClosureCaptures still excludes it.
All 73 related promise/job/admission/metadata checks pass in 1.94 seconds.

Snapshot admission guards are intentionally still present: this groundwork does
not yet encode producer references or capability callbacks. Next, encode those
links on pending and settled results, validate reciprocal ownership, and restore
the source reaction through runCapabilityReaction with the captured resolver pair.
Keep its completion wrapper distinct from its result, including when the result
settled before snapshot. Do not invoke the species constructor again.

Snapshot encoding now includes optional producer lists on pending, settled and
reaction promises, plus the actual promise/resolve/reject capability on producer
reactions. Validation requires reciprocal producer ownership and callable
resolvers. Restoration reconnects the source to the captured capability through
runCapabilityReaction, while its separate completion wrapper owns cleanup. The
species constructor is never invoked by this reconstruction.

Both original restoration regressions pass. Additional passing checks cover a
constructor counter remaining at one before resumed execution, a result settled
early to 99 whose handler still runs once, and a result-only root retaining its
producer/source links. The old rejection expectation for the now-supported
ordinary subclass was reproduced failing, then replaced with the positive
result-only producer-link check; aggregate admission guards remain in place.

A malformed snapshot could initially substitute a producer as its own result.
Its test failed before validation rejected that impossible ownership. After the
fix, all 208 focused promise/job/snapshot/policy checks pass in 3.96 seconds.
Changed-file checking also found a test narrowing issue across the old admission
assertion callback; capturing its already-validated array element in a local
binding resolves it without changing runtime behavior.

Previous delivery is now confirmed published: @poe-platform/safe-js@0.1.398,
scoped release 34161862492, receipt 2026-09-07T21:09:59.2525258Z. CLI release
34161862592 remains in progress. The subclass improvement is still uncommitted
pending broader tests, lint, fresh build and CLI validation.

Broad verification finished with 19,558 passes, 41 skips and two checkpoint
failures (453.83 seconds). Both co workflow failures came from trusted public
dump indexing reaching the low-level unrepresented-promise guard before its
replay metadata path. That regression is addressed independently in
safejs-trusted-promise-replay.md, preserving low-level rejection and keeping the
fix in a separate commit. Its two formerly failing files, replay policy and
admission checks pass after the correction; the direct trust-boundary test brings
that focused verification to 62 passing tests in 8.41 seconds.

The subclass CLI harness pair is prepared but has not run against a fresh build
yet. It checks constructor count, reaction ordering, subclass identity and a
private field, without agent spawns.

Changed-scope lint and the maintained build now pass. The real subclass harness
passed and its screenshot was viewed. Node 18.18.0 restored the built subclass
snapshot to [8,true,9], including its private field and instanceof identity.

The checkpoint fix is separately delivered and verified on remote main as
7b55163a8d32509ea44c501d5681bffdb685cf9c. Its scoped release 34163119749 and CLI
release 34163119929 are pending publication. A fresh full SafeJS package run is
active in terminal session 86194 before the subclass commit, using only the two
documented weak-collection/host-promise-property experimental exclusions.

That rerun finished with 19,558 passes, three completed resolver replay failures
and 41 skips in 415.46 seconds. The trusted metadata fallback was too broad for
settled targets; the separate follow-up in safejs-trusted-promise-replay.md now
passes all 87 affected resolver/checkpoint/admission checks. Subclass delivery
remains pending until the replay correction and final verification are complete.

The resolver-target replay follow-up is now separately delivered and verified on
remote main as 608db2093fa94dfa4593c70c43bd5e486473e396. A fresh maintained
build passed, and the actual subclass CLI harness saved and resumed its checkpoint
successfully; both PNGs were viewed. Its release runs are scoped 34163841582 and
CLI 34163841745. A new full package verification is active in terminal session
3218, with only the original two experimental exclusions, before subclass delivery.

Final combined verification is green: 19,563 tests passed, 41 skipped, 623 files
passed and one file skipped, in 373.77 seconds. No timeout or coverage limits were
changed. Lint, fresh build, Node 18 restoration and the real CLI checkpoint/save
resume screenshots were already verified against this source. Ready for the
separate subclass continuation commit.

The predecessor replay correction is confirmed published as
@poe-platform/safe-js@0.1.400 by run 34163841582, receipt
2026-09-07T21:42:19.2534319Z. CLI publication remains a separate verification.
