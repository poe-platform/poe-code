---
title: Promise callable reference validation
---

# Promise callable reference validation

Next atomic improvement after capability-executor delivery. The executor full
package run is active; do not modify runtime code or add collected red tests
until that verification and commit are complete.

A read-only native built-code probe validated three cases on September 7:

- an escaped Promise.all fulfillment callback used as an object setter;
- the same callback used as an object getter;
- the same callback used as a Function.prototype.bind target.

All unsnapshotted controls produced their expected aggregate results. Every
snapshot was captured, but restoration failed with `Wrong guest heap reference
kind` in the callable-reference validator. Probe duration was under one second;
it did not edit the runtime under test or run a competing build/lint workload.

The source validator recognizes aggregate-handler heap nodes but omits that
kind from its callable reference allowlist. Property descriptors and bound
function targets both use this allowlist. Turn the three probes into regression
tests, retain their normal-execution controls, then add only the validated
callable kind. Validate that non-callable heap references still fail. This is
not permission to accept arbitrary heap nodes as callable.

Adoption-resolver is another represented function kind absent from the list,
but reachable guest accessor/bind use has not yet been reproduced. Investigate
that independently before expanding the fix or claiming it is covered.

## Implementation evidence

Executor delivery is verified on remote main as 6f4ee6d8b. The three new regression
tests reproduced the exact restoration error before the one-line allowlist fix,
then passed. Three negative tests continue rejecting non-callable aggregate,
entry and pending-promise records used as getters. All 1,313 snapshot tests across
74 files pass with no snapshot exclusions. This focused suite covers the changed
validation boundary; a full-package rerun is not substituted for scope selection.

The real CLI harness pair is prepared with setter, getter and bound aggregate
callbacks. Build, execution/screenshots and checkpoint verification remain
pending; the pair itself is not execution evidence.

## Delivery verification

The three positive regressions and three negative cases pass. All 1,313 snapshot
tests passed across 74 files in 32.38 seconds, without exclusions. Changed-file
types and scoped lint passed. The maintained build passed 70 declared workspace
builds, root stages and all four SafeJS built-import checks.

The real CLI pair passed checkpoint save and resume using
/tmp/safejs-callable-replay.mfKCKi/checkpoint.json. Both screenshots were opened
and inspected. These runs used no agents and establish runner/replay behavior,
not model behavior. Remote delivery and publication are tracked separately.
