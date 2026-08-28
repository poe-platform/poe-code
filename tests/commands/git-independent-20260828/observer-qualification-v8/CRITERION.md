# v8 causal observer — finite preseal, not candidate authority

Friday, August 28, 2026. Only this new v8 directory is owned. Prior v5/v6/v7
history and all failed/unexecuted records stay immutable. Frozen product input
9885390fb11454fa194a3e60fdbef198dbfdf633 is SOURCE/DATA only except the explicitly
authorized unchanged isolated writer. Dirty live codec/index/io/repository files
belong to others, neither enter this cohort nor veto the frozen input. No edits,
build/import, whole-codec, native Git, private integration, OS fence or284 replay.

## Primary sources and what the hook can establish

Exact tagged Node22.22.2 readable.js, destroy.js, end-of-stream.js and README,
plus exact-version official stream/zlib docs were fetched via web. Direct captured
bytes/status/hashes are in NODE-PRIMARY.json; source ranges and hashes are in
NODE-PROVENANCE.json. Separate async_iterator.js is not referenced: the actual
createAsyncIterator implementation is in readable.js. No main-branch issue is
used. The writer correspondence JSON and writer-surrogate.mjs retain v7 bytes.

Tagged createAsyncIterator's finally calls destroyer(stream,null). For an unfinished
stream, destroyer creates an AbortError and calls public stream.destroy(err).
onDestroy sets closed before nextTick error/close delivery; that delivery emits
error before close. EOS has separate error/close callbacks and does not establish
native allocation or arbitrary callback settlement. These are version-specific
source facts, not a portable causal API guarantee. Public docs advise implementors
not to override destroy; this reversible fixture observer is not a recommended
production implementation extension point.

On each OWNED stream the observer captures the original destroy reference and
own descriptor before any operation. It wraps only that instance, preserving the
receiver and arguments. A direct-owned-destroy token names its exact argument
before invocation. An owned iterator wrapper delegates next/return to the actual
Node iterator: return enrollment begins BEFORE the original return call, ends
when its returned promise settles, and requires the iterator was yielded. Reader
next and return promises are separately enrolled operations. The return token
may enroll only its FIRST destruction on the same not-yet-destroyed stream, and
only while that return is the sole pending owned operation. No arbitrary read,
command lifetime or broad temporal window grants error authority.

The destroy wrapper records resource/iterator/operation/token identity, destroy
call number, exact reason identity and monotonic sequence BEFORE forwarding to
the original method. Later error acknowledgment requires that SAME reason object
on that SAME resource. No AbortError name, ABORT_ERR code, message, instanceof
test, stack text, private handle or mere arrival-window check grants acceptance.
Only the observed exact argument is predesignated; there is no post-hoc whitelist.
The v7 name/code acceptance clause is removed. Explicit prior operation-primary
identity handling remains for ordinary invalid-zlib and S11 writer controls.

**Observability limit:** the public hook proves an argument was forwarded during
the recorded owned return operation; it cannot authenticate JavaScript caller
origin against malicious/reentrant host code. Iterator causes are therefore
classified exactly as source-linked-owned-iterator-return-observation, NOT proven
native caller identity. Direct manual causes are direct-exact-owned-argument.
This qualification trusts its finite owned fixtures and source-bound Node profile,
not arbitrary host JavaScript. Unknown outside-intent errors are never auto-owned;
borrowed receiver calls are rejected; changed method descriptors make HOLD.

## Nineteen fixed outer controls

IDs/order and expected outcomes stay R01–R06, S01–S11, D01–D02:6 real,11 synthetic,
2 data, with NO twentieth row. R01–R04 repeat v7 passes; R05 repeats v7 FAIL with
new disclosed causal instrumentation, never changing that old result. Remaining
14 v7 rows were unexecuted. Inputs/error assertions are unchanged. DELTA-V7.json
authenticates the exact changes and added retirement module.

R01 nominal blob, R02 invalid, R03 truncated, R04 framing/checksum, R05 exact
blob8388609 NUL early refusal, R06 idle destroy use fresh createInflate and small
constant-derived builtin zlib data. No8MiB allocation. The isolated writer's exact
close fallback, type-erasure map/source hashes and Promise idempotence remain.
Raw callback absence is diagnostic when its owned operation settled by fallback.
R05 must show closed-but-not-notified settlement, the pre-forward owned argument
identity, its later SAME error event, close completion, fulfilled actual cleanup
and terminal PASS. Cause registration must precede error delivery. R06 separately
requires positive closed-before-close-notification sequencing.

S01 delayed notification; S02 destroyed/not-closed; S03 open; S04/S05 actual pending
owned write/end operations; S06 pending cleanup despite closed AND delivered close;
S08 undefined cleanup failure; S09 false primary plus null cleanup failure; S10
unknown state; S11 source-correspondent close fallback followed by delayed raw
callback are unchanged controls. No actual pending operation/cleanup is retired
by flags or by waiting out its violation. S11 preserves explicit expected primary
identity; a distinct secondary error would not be accepted.

S07 strengthens its old generic-late-error negative WITHOUT a new outer row:

1. unowned-late-abort: inject a new Error with name AbortError/code ABORT_ERR/message
   The operation was aborted after settlement, with no enrolled destruction cause.
2. owned-cause-plus-secondary: direct-owned destroy pre-enrolls one exact Error;
   its queued notification is acknowledged. A DISTINCT object with IDENTICAL
   name/code/message is injected after settlement and MUST remain unowned/HOLD.
3. destroy-hook-tamper: change the owned instance method after settlement; detect
   tampering and HOLD, then restore the exact original descriptor.

All three bounded synthetic subcases expect HOLD. They count as ONE passing S07
only if all assertions hold, not three native passes. Planned actual createInflate
objects6; synthetic EventEmitter facades4 (S07 three, S11 one); other synthetic
controls are state-only. S07 restores/compares descriptor function identity and
attributes. No synthetic event is reported as a native zlib event.

D01 preserves original289/288 and unknown missing states; D02 checks unchanged
full-source/isolated-writer correspondence and cleanup order as DATA. Neither
can rescore v5 H09/69 passes/215 remaining groups or historical v6/v7 failures.

## Settlement, notifications and restoration

Resource closed/destroyed, owned operation promises, actual cleanup promises,
raw callback delivery and close/error notifications are separate. Settlement
rejects unknown states, hook-integrity failure, genuinely pending operations or
cleanup/rejection, and unacknowledged errors. All-known-settled resources may be
NOTIFICATION_PENDING until close and predesignated cause error delivery complete.
Cause identity enrollment is NOT cleanup settlement. Falsy reasons retain
hasPrimary/hasFailure and exact reason IDs; secondary failures are preserved.

After actual owned cleanup, await the previously registered owned close notification
promise, then exactly TWO nextTick -> Promise microtask -> setImmediate rounds.
The surrounding horizon timeout is3s; there is no calibrated sleep or unbounded
future-error promise. Every enrolled cause must receive its actual error event;
missing notification remains pending/HOLD. Unexpected error at any observed phase
HOLDs. Verify hooks at settlement and horizon. Finally restore exact destroy and
write/end descriptors and remove only observer listeners AFTER this barrier;
restoration receipts stay in raw evidence. It does not promise no later external
error after the finite observation interval.

Per-observer trace256, reasons/failures64, resource2, operations64, retirement
tokens8; a token owns at most one new cause. Trace includes monotonically sampled
timestamps/order and reference-derived identity IDs. Max unobserved close events,
raw callback notifications, not-closed states and pending states are separate;
none is a one-live-native/RSS/allocation/workerpool-preemption claim.

## One bounded cohort

Node22.22.2 executable/path/hash is the prior binding, verified before/after.
One sequential worker plus coordinator, peak2; direct child cap6, planned1;
syntax children0, separate control children0. Immediate known ChildProcess
enrollment remains the next statement after spawn, before fallible helpers.
Finally observes owned child/pipe closure before captures. No global ps/fence,
native observer, helper child or descendant claim. Metadata Git tools are logged
separately. Any assertion/safety/capture/unknown-closure stop ends the cohort;
NO second attempt or single-case retry.

600000ms qualification aggregate includes guards, worker, known cleanup and
receipt publication. Worker60s/hard67s/final cleanup5s; per owned operation3s.
Captures32MiB, scratch128MiB, stdio4MiB, per-case256KiB. Post-receipt clock sampled;
its own last write is the disclosed unsampled tail. Source prep wall/monotonic
time separately recorded; no inherited110-minute budget or whole-task claim.
Pre/post authenticate sealed v8 inputs, all old v5/v6/v7 regular files AND empty
directory census, reject symlinks, detect new entries. Unrelated live edits do
not enter/veto this frozen qualification. No network during the cohort.

Exact ONE command after committing this preseal, from repository root:

```sh
env -i PATH=/Users/kjopek/.nvm/versions/node/v22.22.2/bin UV_THREADPOOL_SIZE=1 /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/commands/git-independent-20260828/observer-qualification-v8/run.mjs
```

RUN-01 must not exist. Success is review-ready finite observer evidence only.
Only after success prepare an UNAPPROVED284-fresh-layout/15-child proposal for
DIFFERENT review and fresh ROOT GO; no candidate execution here. Failure leaves
that proposal unpromoted. Six native Git workflows remain held either way.
