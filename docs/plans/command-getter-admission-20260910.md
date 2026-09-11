# Close canceled callback admission in pr and tsort

During factor review, independent tests reproduce the same direct-public-factory
cancellation gap in the delivered pr and tsort readers and diagnostic writers.
The exact minimized cohort is preserved in
`/tmp/issue682-factor-independent-v1/cross-command.test.ts`, its source hashes
in `cross-source-before.sha256`, and all 32 failures in
`cross-command-red-v1.log`. Sixteen cases per command cover iterator-factory,
iterator-next, stderr-capability and stderr-write getters that abort with false,
zero, empty string or null before returning a method. That method must not then
be invoked. This is validated callback admission, not a host-JavaScript sandbox
or preemptive cancellation guarantee.

The prior DeviceFS getter fix governs the public Shell wrapper, not every direct
factory invocation with a custom CommandContext. Fix the actual command-local
boundaries rather than adding a pathname exception, weakening cancellation, or
claiming the existing wrapper covers unwrapped contexts. Capture each capability
and method once, recheck the existing lifecycle/signal after getters, then invoke
with its original receiver. Preserve cleanup admission, enrolled output drain,
primary/cleanup errors, byte semantics and already-published effects.

The implementation worker owns only `src/commands/pr/io.ts` and
`src/commands/tsort/io.ts` for this follow-up. Independent tests belong in
`tests/commands/command-getter-admission/pr-tsort.test.ts`; the inventory owner
adds direct-factory packed canaries without altering prior Shell canaries.
Root owns registration, this plan, atomic commits, delivery and issue status.

Reopen #680 and #681 while this newly identified gap is unresolved; the already
delivered null-device and ordering fixes remain valid. Retest the exact cohort,
existing author/independent suites and types, then include this separate atomic
improvement in full repository and fresh packed qualification with factor.
Verify remote main before re-closing issues, and distinguish publication of the
prior commit from resolution of this new follow-up. No README additions.

## Provider method boundaries

The bounded extension validates another 32 pre-fix failures for pr/tsort VFS
stat, capabilitiesFor, readStream and readFile method getters. Evidence is
`/tmp/issue682-fs-getter-red-v1.log`, with pre-fix source hashes in
`/tmp/issue682-fs-getter-before.sha256`; maintained cases are separately kept in
`tests/commands/command-getter-admission/fs-getters.test.ts`.

Distinguish a getter that aborts before its method is admitted from an already
admitted readStream method whose body allocates a source and then aborts. The
latter still needs iterator acquisition for cleanup, followed by return without
next. Preserve the existing eight body-abort controls; do not trade a prevented
read for a leaked admitted resource. These tests do not establish arbitrary
host-JavaScript preemption or a full audit of other command families.

The corrected readers pass all 64 unchanged independent cases in
`/tmp/issue682-command-getter-green-v1.log`, and focused types pass in
`/tmp/issue682-command-getter-types-v2.log`. All 232 existing author cases
(134 pr and 98 tsort) pass in `/tmp/issue682-pr-tsort-author-v1.log`, including
the eight readStream-body cancellation controls. Source/test hashes are frozen
in `/tmp/issue682-command-getter-freeze-v1.sha256`. Broad and packed gates remain
separate requirements before delivery.
