# Attempt history and bounded corrections

## c9-01: original candidate, original execution harness

The first moved standalone run used committed product c9bd0dbb and the unchanged
38-row holdout corpus plus A01-A03 adversarial groups. Build and strict consumer
types passed. It executed 71 subcases: 64 passed, seven failed. All 71 created
workers exited; no verifier termination or supervisor timeout occurred.

Two failures were verifier API-wiring errors, not product failures. Shell.use
queues plugin setup for readiness rather than registering synchronously. The
registry was inspected too early, and assert.throws incorrectly expected Shell.use
to throw a setup collision synchronously. The corrected harness inspects after
exec readiness, checks synchronous preflight through the actual plugin.setup
with a real Shell host, and separately verifies deferred Shell.use rejection via
exec. It does not change any corpus input, native golden or product profile.

Four failures expose alias-only object-spread forwarding: both aliases lose
inherited required CommandContext fields, and both omit a nonenumerable optional
registerCleanup hook. The former throws before signal validation; the latter
silently skips registration while still doing finally cleanup. No shared source
change is needed to preserve accessible structural context fields and hook calls.

The seventh failure is shared external Shell stdin handling. The borrowed source's
return method was called once but its rejected return sentinel was suppressed;
exec returned status zero with empty stderr. Direct-context and owned-VFS return
failure controls passed. This is not the absence of a return call in this candidate,
nor an alias-only failure. Keep it failed and route to the shared owner.

The original harness bytes and raw outcomes/process output are retained under
attempts/c9-01. Corrections are tested in a new isolated attempt, never overwritten.
Additional A04 class-getter/private-field cleanup-receiver controls are specified
before that run to ensure a legitimate fix reads the original host and invokes
its hook with the original receiver, rather than merely copying prototype values.

## c9-02: corrected harness, identical original candidate

All 73 subcases ran: 66 passed and seven failed. The two registration/readiness
corrections passed. Six alias regressions failed (A01, A02, A04, each spelling),
alongside the unchanged external-stdin shared failure. All 77 actual workers
exited with no forced cleanup. Both runs produced 16/26 exact BSD tuples, 0/26
exact GNU tuples, and 26/26 GNU stdout/status/file-effects projections; the latter
explicitly excludes stderr and is not exact-native parity. All 26 bounded-product
semantic/profile rows passed in both runs.

## Alias-only fix awaiting a fresh committed pack

The fix reads required fields from the original structural context, forwards the
optional provenance value, and preserves optional callback receivers with bound
functions. It still dispatches directly to the family's shared grep definition,
does not invoke a registered grep or create another executor, and keeps the original
argv untouched. The six unchanged regression assertions will be rerun from a new
committed-source archive. No original input, golden, comparison profile, shared
grep/regex/Shell source, root export, package or existing author test was edited.

## fixed-01: committed alias fix, unchanged corrected regression harness

Fresh committed-product source 04644bc2 builds and strict-types successfully, then
packs offline and physically moves. All six previously failing alias controls
pass. The 73 subcases now give 72 passes and the same one shared S07 failure;
81 workers are created and all 81 exit without forced cleanup. Frozen native
comparison counts are unchanged. The full candidate also includes six other-owner
column files committed since c9bd0dbb; they are actual archive inputs, not overlaid
live files. Shared grep/regex/Shell/package/root source is unchanged from c9bd0dbb.

A final bounded extension adds A05 real-worker ERE timeout and in-flight caller
abort, with an ordinary fixed-string control. A 64-character adversarial input
is below the original bound. This is not a native timing comparison. S09 also
records external/owned return-call counts explicitly; no assertion is weakened.
The fixed-01 results and original harness remain retained beside this extension.

## fixed-02: real-worker timeout/cancellation extension

The same immutable fixed pack executes 75 subcases: 74 pass, the same S07 shared
failure remains. A05 reaches a real data request, times out the adversarial ERE
at the configured 75 ms, and observes the worker exit before return. Its fixed
control and exact caller-abort identity check pass. All 84 workers exit; none is
terminated by the verifier. S09 records one return at abort settlement for both
external stdin and the owned VFS source. Sink-only S09 has no source return.

Final closing checks explicitly overlap the registered regex cleanup callback
with a held output write and normal finally, and run the identical return-failure
requirement against the public registered grep definition with no aliases. The
shared control is not granted a passing status merely for reproducing a bug.

## fixed-03: final completed cohort, HOLD

All 77 subcases execute: 75 pass and two fail. Both failures are the same shared
return-error loss, once through egrep and once through registered grep without
aliases. All original 38 holdout groups execute: 37 pass and S07 fails. The five
additional alias-adversarial groups pass (nine subcases); the separate shared
control fails. All 86 workers exit. Registered regex cleanup overlap, queue bounds,
real timeout/cancellation, and all source/ownership controls finish without a
supervisor timeout or verifier worker termination.

Across the five preserved candidate attempts, 399 actual Worker instances were
created and all 399 emitted exit. Historical workerEvents.threadId is the
observer's monotonic worker identifier, not an OS thread ID; lifecycle observation
uses actual Worker object identities. The original and corrected harnesses remain
alongside raw process output. The final canonical harness is byte-identical to
the fixed-03 copied-and-typechecked source; no golden or assertion was relaxed to
turn the shared failures into passes. No GO is issued while that blocker remains.

## Final diagnostic assertion audit

Before sealing the final evidence, strengthen the G and e diagnostic assertions
from loose character occurrence to complete option tokens. This prevents an
unrelated letter in utility wording from satisfying the frozen offending-option
requirement. No expected native byte or product profile changes. Keep fixed-03
and run a separate fixed-04 attempt with the stronger canonical assertions.

## fixed-04: overly narrow option-token boundary, retained failure

The audit run executes 77 subcases: 72 pass and five fail, with 86 workers created
and exited. Three new failures are assertion grammar defects: the diagnostic
spells the option as a quoted token (`-- 'G'` or `-- 'e'`), but the newly added
left boundary accepted whitespace only. Full original stderr is retained and the
required option letter is correct. Add quote characters as legitimate token
boundaries while still requiring the entire exact option token, then replay in
fixed-05. This is a narrowly disclosed assertion correction, not warning stripping
or blanket diagnostic relaxation; the independent corpus/profiles remain unchanged.

## fixed-05: final stronger diagnostic assertions, HOLD unchanged

All 77 subcases execute: 75 pass and only the two manifestations of the shared
return-error failure remain. The three diagnostic-token controls now correctly
accept complete quoted option tokens, with their original raw stderr unchanged.
All 86 workers exit; strict types and package/archive integrity checks pass.
The final maintained harness is byte-identical to the fixed-05 snapshot. Seven
preserved candidate processes created 571 actual workers and observed 571 exits;
none required supervisor timeout or verifier worker termination. No further
source edits or candidate execution are planned before a new root handoff.
