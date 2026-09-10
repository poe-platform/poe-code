# Retained filesystem cleanup

Actual Shell ZIP and unzip cancellation tests reproduce retained temporary entries
after cooperative work drains. Ordinary `scopeFileSystem` operations correctly
reject the captured aborted signal, including attempts to pass a fresh signal.
Do not bypass that scope or weaken the namespace assertions.

Add an explicit SafeFS cleanup registration captured while its scope is open.
Its idempotent close callback receives only metadata and nonrecursive removal
operations, with a bounded operation count. Reject late registration and escaped
view use after closure; drain admitted operations before close settles. Preserve
underlying readonly, quota, mount and provider policy rather than exposing a raw
filesystem. The callback remains responsible for checking ownership of resources
it created; this is not a host-JavaScript isolation boundary.

Provide a separate scoped cleanup accounting callback. Shell cleanup operations
share the existing filesystem-operation counter and limit, but do not reject
solely because ordinary command work has been cancelled. Normal operations keep
their existing signal and CPU checks. Budget exhaustion and provider errors can
still prevent cleanup and must remain observable.

Use in-memory TDD at both SafeFS and actual Shell boundaries, including falsey
cancellation, idempotence, limits, escaped views, unawaited admitted operations and
unchanged ordinary-operation refusal. Export consistently from public Node and
portable surfaces. Commit this shared improvement separately from ZIP commands;
then consume it for identity-checked owned archive staging cleanup.

Budget-only TDD starts with five missing-method failures and passes after adding
the separate shared-counter charge method. Actual Shell coverage then reproduces
the remaining four falsey-cancellation cleanup failures through the public API,
after generating the canonical SafeFS facade with the normal build. Adding the
fourth scoped accounting callback makes all nine tests pass:
`/tmp/retained-cleanup-shell-red-v3.log` and
`/tmp/retained-cleanup-shell-green-v2.log`. Earlier red/attempted-green files
preserve missing public-facade prerequisites rather than runtime proof.

A selected SafeFS workspace build alone does not refresh the canonical
`poe-code/safe-fs/core` runtime facade under SafeJS. Do not substitute a direct
source import, which would create a different scoped identity map. The normal
build supplies matching public runtime identities; final artifacts must be rebuilt
again after the source wiring and archive consumers are frozen.

The final focused SafeFS cohort passes 84 cases in
`/tmp/issue687-retained-cleanup-final-tests.log`, with strict types passing in
`/tmp/issue687-retained-cleanup-final-types.log`. The final normal build is
`/tmp/issue687-build-v5.log`; all twelve production-input hashes in
`out/issue687/final-build-inputs-v2.sha256` remain unchanged afterward. Build v4
completed its commands but failed its post-build hash check because a concurrent
unzip cleanup fix changed one input; it is not the final qualification.

The complete maintained `npm test` route passes in
`/tmp/issue687-full-test-v4.log`, including native pre/post lifecycle scripts and
the final lint-stress task. It uses the explicitly approved external test-scratch
root recorded in `out/issue687/unit-temp-external.path`; earlier checkout-local
scratch let negative dependency-isolation tests find ancestor repository modules.
Those isolation assertions remain unchanged and pass with proper separation.
Repository lint/types/workflows pass in `/tmp/issue687-lint-v5.log`. Run the normal
build after unit tests before packing: their dependency builds overwrite portable
bundle outputs with plain compiler wrappers.

Normal build v6 passes with all twelve production hashes unchanged. Fresh scoped
and root tarballs then pass all 22 Node, Bun, browser-platform bundle/runtime and
strict-type profiles in `/tmp/issue687-packed-v6.bMxoMk/results.tsv`. Explicit
public cleanup probes cover falsey cancellation, accounting, restricted views,
handled errors and pending-work draining. Artifact/source closure checks remain
unchanged before and after. This browser profile executes bundles in Node, not a
real browser; offline installs omit optional native dependencies. The full report
and exact commands remain beside the results. Final package lint passes all 17
rules, and the maintained 26-group Bash type route passes again after v6.
