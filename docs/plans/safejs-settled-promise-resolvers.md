---
title: Settled promise resolver snapshots
---

# Settled promise resolver snapshots

Three direct snapshot regressions on a34cfad2b fail when a closure retains the
resolve/reject functions from Promise.withResolvers. Two fail on native call
references; a third fails when resolver properties have been materialized.
The promise itself is already settled. Later resolver calls must remain no-ops,
but argument evaluation, callable identity, length/name, descriptors, private
slots and retained promise accounting must be preserved.

Add resolver-origin metadata referring to its promise and native already-resolved
state. Serialize a resolver only after that flag is set and the target promise
has a captured settlement. Restore its callable and guest object state with a
reference to the same restored promise. Validate target kinds and retain the
resolving-function brand for runtime job behavior. Never serialize native
resolver implementations or assume unresolved callbacks can be ignored.

Initial implementation passes 73 resolver/settled-promise/runtime checks in
1.89 seconds. Bound functions, cyclic custom properties and ignored late thenable
arguments are being checked next. Pending promises, resolver callbacks required
to complete them, and pending reaction queues remain a separate continuation
capability, not claimed solved by this atomic improvement.

This work is uncommitted. Require focused and full package tests, lint/types,
build and actual CLI validation before its own commit and push to main.

Resolver metadata now uses the same shared boolean settlement cell as the native
resolve/reject pair, avoiding additional getter closures. All 109 focused
resolver, settled-promise, generic-promise and job tests pass in 2.21 seconds.
Changed-file TypeScript diagnostics are zero; the initial changed-file ESLint
check passed. Started the maintained full package route with only the separately
documented host-promise property-admission probe excluded.

Full package run: 19,507 passes, 41 skips, one failure in 343.64 seconds. The
failure was an old expectation that materialized resolver state must be rejected
in copied snapshot roots. Replaced it with serialization, restore and execution
assertions preserving a custom resolver name and first-settlement-wins behavior.
Also made existing result assertions in that touched file type-safe. Final gates
remain pending before this resolver change is committed or pushed.

Previous settled-promise commit a34cfad2b published as @poe-platform/safe-js@0.1.393
in workflow 34156448898 at 2026-09-07T19:44:37.4062744Z. This publication does not
include the uncommitted resolver snapshot work.

Final delivery checks: changed-file ESLint and TypeScript diagnostics pass. The
normal build passed all 70 declared workspace builds and root stages, including
four fresh-process SafeJS import checks. The real CLI harness passed; inspected
its PNG and confirmed the visible success and zero spawns. Built SDK execution
and dump/replay on Node 18.18.0 preserve resolver length and the original value
after late resolve/reject calls, returning [1,7]. A final full package run is
in progress after the corrected copied-root test expectation.

Final maintained package run completed: 615 files passed, one skipped; 19,508
tests passed, 41 skipped, no failures, in 342.43 seconds. The only explicitly
excluded file is the separately documented host-promise property-admission probe.
All delivery gates above are now satisfied for this atomic resolver improvement.
