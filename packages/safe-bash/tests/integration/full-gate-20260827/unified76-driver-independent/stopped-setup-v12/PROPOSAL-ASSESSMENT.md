# Scoped environment adapter — conditional authoring recommendation

**ALLOW BOUNDED AUTHORING WITH CONDITIONS**, as a review recommendation only.
Root retains the decision; no implementation, execution or release is authorized
by this receipt. Assessed August 28, 2026 after the source-only diagnosis
`b7c2c05537ffd7ab9db7a886c9178f65e22a350c`; that seal and its isolated-context
suggestion remain unchanged. This additive assessment evaluates the supplied
proposal, not an inspected implementation or demonstrated fix.

Source pin: `fe15f1e406fa1039accddec25c696ae7187f6135`.
Helper pin: candidate `f5e9fc49b6abb38e180cc9de16c95fced102ff75`, SHA256
`60ae62f6bab6e0348288cd04a6f69c551ce13769bd7ea9e47fb251b9a9dfa2db`.
Below, driver paths are under
`tests/integration/full-gate-20260827/unified76-driver/launcher-v3/`;
helper is `tests/integration/full-gate-20260827/combined-8670ebe8/prerequisites.mjs`.

## Why this narrower direction is defensible

`execute.mjs:73` awaits prerequisites before creating/running phases at95–96.
Wrapping that entire await covers its implicit Git call at helper:22 and both
internal privateState calls at54/73, including awaited imports at26–27.
The two additional outer calls are **execute.mjs:137 and141**; both need the
adapter, but only around privateState itself, not surrounding verifyExternal.
`execute.mjs:91` and `external-admission.mjs:27` explain why permanent GIT_*
injection is incompatible with existing ambient rejection.

Normal preceding transport awaits closure, clears timers and checks survivors
(`transport.mjs:46`,83,90). Normal phases require closed/clean/no-survivor results
(`phase-runner.mjs:18`,22) before final-sweep. The outer observer and phase
supervisor live in another process (`fenced-supervisor.mjs:49`); worker-local
environment changes do not mutate their environment or that of existing children.
The inspected prerequisite route uses synchronous subprocess calls after its
imports; its directly imported harness exposes spawnSync with explicit env
(`tests/plugins/stream-five-public/harness.mjs:13`). Those explicit environments
are **not** repaired or widened by this adapter. No conflicting in-process env
consumer was identified in this narrow trace; this is not an exhaustive callback
or dependency-wide concurrency proof.

## Required authoring conditions

1. Acquire one worker-process-local exclusion lock **before mutation**, reject
   nesting/concurrency, and retain it through awaited callback and restoration.
   Verify the admitted binding immediately at entry (`tool-routing.mjs:195`,
   including native PATH and Git-core hashes); do not trust incoming parent PATH.
   Install only its exact PATH/GIT_EXEC_PATH and literal GIT_OPTIONAL_LOCKS="0".
   Leave HOME/TMP, observer, loader, permissions, selectors and helper unchanged.
2. Snapshot each key's own presence and exact string value. Restore absence by
   deletion and present-empty as empty; attempt every restoration even on error.
   Check expected installed values at exit and exact restored state afterward.
   Preserve callback, drift and restoration failures separately in retained
   diagnostics; none may mask another or become success. An unrestored/poisoned
   context must not be released for further gate work.
3. Keep the adapter's verified handle available to both outer callsites,
   including finally. Restore before later ambient checks/canonical work. Do not
   suppress a required private guard to obtain green, or accept injected parent
   GIT_* merely because the adapter will overwrite selected keys.
4. Treat exceptional finally separately: `execute.mjs:141` can follow a failed
   phase, while remote timeout/disconnect (`fenced-supervisor.mjs:68`,70) is not
   proof of completed child cleanup. Cancellation/throw must restore without
   admitting overlapping work. Do not race restoration against an unresolved
   callback or claim await settles arbitrary detached tasks; unresolved ownership
   remains HOLD. Retain existing outer shutdown and failure diagnostics.
5. A lock covers cooperating adapter users, not arbitrary host JavaScript.
   Entry/exit comparisons cannot detect a transient env mutation subsequently
   undone. No hostile-host, all-background-task, Git-configuration sanitization
   equivalence or universal process-isolation claim follows from these three keys.

**Actual EPERM executable remains unproven.** Existing captures lack resolved
target/original PATH/structured spawn fields; this proposal addresses the proven
inherited-routing defect, not a proven kernel target or guaranteed successful
setup. No new worker architecture or broad experiment is required by this
assessment. Root controls any later bounded implementation verification/release.

Only pinned source text was reread; no artifact verification, author/helper
imports, tests, subprocess probes, private access or gate execution occurred.
One reader shell command failed before Git because its zsh loop variable `path`
shadowed PATH; only that source-read command was corrected. No runtime attempt
or source/environment repair was performed. All earlier evidence stays sealed.
