# Issue 621: bounded persistent Memory storage and filesystem work

Author: kamilio. Status: implementation and fresh TDD in progress.

## Evidence and intended correction

Current-source inspection confirms Memory has no default storage ceilings.
Seven fresh bounded controls showed persistent metadata growth across three
Shell executions with zero output allowance (4, 8, then 12 entries), retained
capacity slack, unlinked handle retention and old stream-generation retention.
The current optional byte quota bounds visible logical names; its scan ceiling
does not prevent directory creation and is not an inode quota. No 200k-inode,
128 MiB isolate, heap/RSS, timing or fatal-OOM threshold is inferred from these
tiny controls.

The default Memory constructor and factory must become bounded, not merely gain
another opt-in wrapper. Shell borrows its filesystem: it must not silently impose
Memory storage policy on Real, remote or other host-supplied filesystems.

## Approved policy

Flat `MemoryFileSystemOptions` overrides the frozen `defaultMemoryFileSystemLimits`:

| Field | Default | Accounted resource |
| --- | --- | --- |
| `maxFileBytes` | 16 MiB | One file's logical size. |
| `maxRetainedBytes` | 64 MiB | Owned buffer capacity and retained string charges. |
| `maxMetadataUnits` | 10,000 | Inodes, directory-name entries and active handle/stream reservations. |

Missing fields default. Supplied values must be finite safe integers; byte
limits may be zero and metadata must permit the root inode (at least one).
Explicit undefined/null field values, accessors and unknown options are refused. Constructor,
factory and filesystem configuration use the same validation and snapshot.

These are selected finite defaults, not empirically proven 128 MiB heap-safe
thresholds. Intentional larger stores require explicit finite overrides.
Caller-owned returned reads/stat observations and general JavaScript overhead
are not represented as a hard heap quota.

Storage accounting admits before allocation/publication. It includes capacity
slack, two bytes per retained UTF-16 code unit, and old generations retained by
owned streams. Hard links add a name charge, not duplicate inode/data charges.
Unlink releases names but not resources still held by active handles/streams.
Close, cancellation, overwrite, rename replacement and recursive removal must
refund exactly the resources no longer owned. Failed allocation must not leak
reservations. Geometric growth remains amortized and is clamped to available
capacity. Per-file overflow uses EFBIG; store exhaustion uses ENOSPC.

`ShellLimits.maxFileSystemOperations` defaults to 100,000 per execution and
10,000 in the existing Worker preset. Admission precedes filesystem API dispatch
and is shared across execution children, pipelines, substitutions and invocation.
Zero refuses operations. New executions reset this work allowance, not the
Memory instance's storage ledger. Internal backend subcalls and stream chunks
are not fabricated extra API calls. Exhaustion must not prevent owned cleanup.
Transparent metering must preserve optional methods, receiver binding, aliases,
entry authority, path capabilities and descriptor/stream semantics.

## Ownership and validation

Memory worker owns the native implementation, accounting helpers and focused
Memory-limit tests. Shell worker owns the execution meter, limits and focused
Shell tests. Root owns configuration tests/wiring, compatibility exports,
contracts, registration, integrated default-path controls and delivery. No
README additions are authorized.

Required TDD covers finite defaults and tiny overrides, persistence, hardlinks,
names/targets, retained generations, slack, unlink/close, rollback and concurrent
streams; configuration parity; shared/reset execution allowances and cleanup;
and borrowed external filesystems without replacement storage policy.
After workers freeze, run normal build, maintained type/consumer checks, scoped
tests, full cross-workspace unit validation and root lint. Inspect a built public
CLI screenshot. Pull with rebase, push only validated changes, verify remote main,
close the issue immediately after verified delivery, and monitor release separately.

## Configuration checkpoint

Root's fresh configuration RED had three failures and 37 passes: valid finite
Memory options were rejected as unknown. Directly assigning the shared
`normalizeMemoryFileSystemLimits` validator fixed the adapter boundary without
a proxy wrapper or duplicate numeric policy. The focused rerun passed 40/40;
the helper, adapter and test hashes were unchanged throughout that run. This
does not qualify the still-in-progress native ledger or execution meter.

The root's built-public-path RED has four failures: constructor, factory and
configuration each admitted the 5,000th directory instead of refusing the
default metadata boundary, and configured persistent Shell storage rejected
the new options as unknown. The bounded controls create only empty in-memory
directories; they do not reproduce a fatal heap threshold. The integrated
regression also checks a fresh execution and a borrowed replacement store,
disposal without storage reset, and reclamation after removal.

Independent bounded review found two execution-view regressions before delivery:
an unstarted read stream remained usable after its invocation ended, and reverse
S3-to-scoped-Memory comparison lost a genuine `distinct` answer. Both require
regression coverage and correction before the integration gate. No concrete
native-ledger corruption was established by that review.

The native Memory owner is frozen after an initial RED of 16 failures and three
passes, followed by 32 new passing tests. Its final focused selection passed
397/397 across eight files with unchanged source/test hashes. An additional
native allocation-failure regression was reproduced and fixed before that
checkpoint. No remaining native-ledger blocker was reported; integrated build,
types, full unit validation and lint are still separate requirements.

Integration exposed test-only typing errors and a new filesystem test using
the Bash runner instead of its maintained Vitest runner; those were corrected
without relaxing assertions. The composed Shell test was corrected to assert
the established exit-1/ENOSPC result rather than an escaping filesystem error.
The first corrected checks passed all 26 maintained consumer groups and 1,482
filesystem tests; the public-path selection then passed after that result-profile
correction.

A second independent tiny control confirmed that rejecting a cancelled stream's
`next()` without closing its underlying iterator retained six bytes and three
metadata units, while native Memory released them to zero bytes and one root
unit. Three fresh regressions failed alongside eight passing scope controls.
Using an async generator's `for await` cleanup changed that selection to 11/11,
including pre/post-next cancellation and preservation of a primary falsey reason
when cleanup itself fails. This is a resource-reclamation fix, not a heap claim.

The first full cross-workspace run passed 36,052 shared tests (42 skipped) and
279 Bash runner controls, then exposed further Bash regressions before delivery.
The async-generator scope wrapper serialized cleanup behind an opaque pending
read and did not forward cleanup for unstarted inputs; existing column and
redirected-input lifecycle contracts must remain unchanged. The stream owner
is correcting those paths with independent, idempotent iterator return.

The existing sort buffer-failure fixture requires a file one byte above 32 MiB,
which now exceeds the intended default 16 MiB file ceiling. Its fresh 9-pass /
1-fail reproduction became 10/10 after giving only that fixture an explicit
finite file ceiling; all input bytes, buffer-failure and no-partial-replacement
assertions remain unchanged.

An existing bridge test compared the command filesystem object's reference.
Metering intentionally introduces an execution view, not a different store.
That observable identity change is documented in the resource contract. The
test now explicitly requires a distinct view with genuine `same` entry authority,
and retains all original pipe/redirection bytes and isolation checks; its
2-pass / 1-fail reproduction became 3/3. This is not a claim of unchanged object
identity or universal compatibility.

The completed first full run had 21,478 Bash passes, six failures, one cancelled
test and 63 skips. Its other failures were the same stream-lifetime regression
in ordinary and hard-timeout cleanup cohorts, plus the 12,000-directory native
stack-safety fixture exceeding the default metadata ceiling. That fixture keeps
its full depth and assertions with an explicit 24,003-unit ceiling; its focused
104-pass / 1-fail reproduction became 105/105.

The stream owner added five focused pending-read, unstarted-iterator and cleanup
controls: 11 passed / five failed before the repair, then 16/16 passed. Manual
forwarding starts one shared, unmetered return independently of pending next,
automatically closes on admission failure and preserves primary falsey reasons.
All earlier reclamation controls remain active. The unchanged public lifecycle
cohorts and a fresh full cross-workspace run remain required after rebuilding.

That corrected full `npm test` run completed successfully: 36,210 shared tests
passed (42 skipped), Python 29 passed, Bash runner 279 passed, Bash 21,485 passed
(63 skipped), terminal-pilot 288 passed and posttest two passed. It qualifies
the recorded corrected tested commit, not subsequent source changes.

Final independent review then reproduced a narrow remaining iterator barrier:
synthetic EOF could settle before an already-started close. Both EOF branches
now join the shared close promise. Fourteen fresh controls failed alongside the
previous 16 passes, then all 30 passed, including exact falsey close failures.
This follow-up changes only the existing scoped iterator's settlement behavior,
not storage policy, exported signatures or workspace orchestration. Delivery
validation repeats the complete filesystem selection, the 434 affected public
Shell/lifecycle controls, build, maintained types and root lint. Upstream-only
SafeJS changes are checked separately after rebase. This is a full-base plus
focused-final-delta qualification, not a claim that the earlier full run tested
the later barrier fix.
