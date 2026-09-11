---
title: Settled promise snapshots
---

# Settled promise snapshots

## Validated gap

Four direct low-level snapshot/restore cases fail on remote main 9e3e0920e:
fulfilled values, handled rejections, shared fulfilled object identity and private
slots stamped onto promises. Each fails with Cannot serialize host reference.
Public replay already supports these programs; this improvement must execute
restored closures directly, not claim success by rerunning their source.

## Implementation and remaining scope

Record sandbox settlement in a WeakMap; do not copy native promise own properties
or async-context metadata. Encode settled outcomes and guest property/private
state with reference identity. Allocate restored promises before decoding outcomes
so cyclic outcome graphs remain possible. Validate malformed settlement states.
Pending reactions and host effects require their existing replay/reconciliation
paths; adding settled heap records does not establish direct pending-promise
continuation support. Preserve cancellation, unhandled rejection and job ordering.

The initial four direct-restore tests now pass in 1.50 seconds. Two additional
regressions show fulfilled/rejected 200-character outcomes were charged only 28
units. Added settlement traversal to data accounting; verification is pending.
Required next: cycles, properties/prototypes, malformed payloads, rejection and
job-order tests, budget tests, maintained package route, lint/types, built imports
and real CLI validation before any commit or push.

Expanded direct restoration covers outcome graphs pointing back to their promise,
hidden string properties, symbol properties and Promise subclasses with private
fields. A malformed fulfilled-self reference was accepted; validator now rejects
it while permitting a legitimate rejected-self reference. All ten direct promise
snapshot tests pass in 1.87 seconds. The old private-state limitation control now
explicitly uses a pending promise, since settled promises are supported.

A rejected-self probe initially failed because its captured scope also retained
the native resolver closure returned by Promise.withResolvers. Moving the resolver
into an expired block scope isolated and passed the actual rejection-cycle case.
Direct serialization of retained resolver functions remains a distinct limitation;
do not conflate it with settlement snapshot support or claim it fixed.

Package TypeScript checking passes after adding SandboxPromise to the maintained
RuntimeSnapshotValue union. Changed-file lint and broader gates are in progress.

The full maintained package route finished in 343.43 seconds with 19,499 passes,
41 skips and one failure: an old copied-root test expected managed settled
promises to be rejected. Replaced it with explicit serialization, restore and
execution checks preserving the custom prototype and settlement; the data-only
export rejection test remains unchanged. A separate getter-side-effect probe
passed: restoring a settled outcome does not invoke its later-added guest then
getter. No speculative restoration change was made. All eleven direct promise
snapshot tests pass in 1.85 seconds. Added a paired CLI harness; actual build,
execution and screenshot checks remain pending.

Delivery checks: changed-file TypeScript diagnostics and ESLint are clean. The
normal build passed all 70 declared workspace builds, all root stages and four
fresh-process SafeJS import checks. The real CLI harness passed; inspected its
PNG and confirmed Harness passed and zero spawns. The built SDK on Node 18.18.0
also passed promise-subclass execution and dump/replay with [7,9]. These checks
do not establish pending-promise or retained-resolver continuation support.
Started a final full package run after correcting the old expectation and
success assertions in the touched test file.

The previous main CLI release 34154772844 did not publish: unit job 101844875134
failed two unchanged 5,000ms float32-camera tests, with 36,286 other tests passing,
42 skipped and 746.94 seconds duration; release-stable was skipped. Scoped
SafeJS 0.1.392 is published separately. Keep the camera timeout issue open.

Final maintained package run: 614 files passed, one skipped; 19,500 tests passed,
41 skipped, zero failures in 353.88 seconds. Only the separately documented
host-promise property-admission probe was excluded. Ready for the atomic commit
and direct-main push; remote delivery and actual publication are separate checks.
