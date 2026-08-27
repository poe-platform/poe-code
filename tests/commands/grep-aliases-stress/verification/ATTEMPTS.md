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
