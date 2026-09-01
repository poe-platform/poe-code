# Preserve callable APIs through harness replay

## Required behavior

Running a harness pair must preserve the supported callable module API exposed
by direct interpreter execution. Native async host functions must keep their
promise behavior, including chaining, while synchronous functions must retain
synchronous return and throw behavior. Function-valued helper properties such
as `spawn.parallel` and `spawn.retry` must remain callable, including async
helper methods attached to a synchronous callable.

Preserve those semantics on a first execution and after recovery. Durable
completed host calls must not repeat merely because the interpreter resumes;
pending calls must continue following the existing replay policy. Keep current
clock/random restoration, argument matching, invocation ordering, callbacks,
usage accounting, and host-call journal behavior intact.

## Scope

All three historical loader/direct-interpreter scenarios pass on the current
source. Upstream commit `fcd82b6ed` preserves callable properties and host promise
values, and is an ancestor of the released `14.0.3` commit. Add durable parity
coverage and verify the existing published implementation before counting this
finding as resolved. Do not add a duplicate production fix without a reproduced
remaining failure.
Do not broaden the interpreter's supported JavaScript subset or change unrelated
runtime, cancellation, or boundary policies.

## Verification

Use memfs, the real loader/interpreter/module factory, and injected fake agents.
Cover successful and rejected async chains, sync returns and throws, callable
helpers, record and Map module registries, and durable replay with fresh module
instances. Compare loader behavior with direct-interpreter controls and verify
call counts, results, journal cleanup, and usage where applicable.

Run the maintained build and normal commit/push hooks. Verify public released
behavior on Node 18/20/22/24 only after a release succeeds; a pushed source commit
or a passing test against an older package is not a released-fix receipt.
