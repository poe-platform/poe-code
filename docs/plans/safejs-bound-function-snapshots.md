---
title: Bound function snapshot restoration
---

# Validated bound-function snapshot gap

Three tests in function-bound-snapshot.test.ts fail with "Guest function
properties and prototype links cannot be serialized." Two dump around a host
effect after binding; one serializes the resulting bound function directly.
Receipt: /tmp/poe-safejs-bind-order-cohort.log (83 passes, 3 failures).

The bound closure has no AST origin, and captureGuestHeapNode currently excludes
closures without an intrinsic identity or origin. A read-only Node inspector
probe identified the failing dump member as the completed bound function at
bindings.f.<guest>.<guest>.<guest>. The original tests called pause() without
awaiting it inside a getter; they did not suspend that getter. The reproductions
now explicitly await the host effect after binding, with an async native oracle.
Preserve call/construct forwarding, bound receiver/arguments, custom descriptors,
prototype identity, cycles and captured scope in the eventual heap representation.
Do not replay metadata getters merely to rebuild a completed bound function.

The initial three reproductions, then eight expanded cases, failed before this
implementation. They were excluded from the earlier independent bind-order
correction's qualification, not counted as passes. This change includes them.

Bound creation now records private target/receiver/argument state. A dedicated
heap node preserves this state and the existing guest property descriptors and
prototype link. Restoration allocates identities before hydrating receivers and
arguments, preserving cycles through nested binds. It uses the same bound-call
and constructor forwarding implementation as ordinary execution, without running
metadata getters again. Non-callable targets, cyclic target chains, internal
scope references, unknown fields, invalid lengths and excessive argument lists
are rejected. A separate failing probe verified the need to bound target-chain
validation by the existing snapshot data-depth limit.

Manual qualification: focused invocation and snapshot tests, scoped ESLint and
TypeScript, the maintained SafeJS workspace unit route (excluding only the two
unresolved host-Promise property-policy cases), and the selected workspace build.
Run this actual paired harness with a unique temporary snapshot path and a low
explicit step budget to save a failure checkpoint after binding; successful
harness runs clean up their snapshots. Inspect the saved bound-function heap
nodes, then resume that checkpoint with an explicitly larger step budget. Inspect both
CLI screenshots. No agent spawns or external capabilities are required.

Intermediate receipts: 1,223 invocation/snapshot cohort cases passed across 62
files in 19.99 seconds. The final focused file passes 23 cases, including repeated
round trips and argument-data rejection. The budget assertion was corrected to
match the validator's "exceeds aggregate data limit" rejection; an early broad
run started with the incorrect expected wording was deliberately terminated and
is not a passing receipt. The restarted broad run includes all bound cases.

Read-only probes additionally restored a subclass of a bound constructor with
the correct new.target, instance prototype and bound argument, and a bound Map
constructor with its initial entries. Both returned the expected values.

The final maintained SafeJS workspace unit route passed 17,538 tests with 41
declared skips in 223.37 seconds (511 passing files and one skipped file).
Only the two unresolved host-Promise property-policy tests were excluded.
Scoped ESLint and TypeScript passed.

The selected build completed 23 dependency-closure builds plus four native ESM
import checks. The initial CLI screenshot route rebuilt all 70 tasks uncached
in 61.623 seconds and the harness passed. For the final checkpoint probe, the
harness keeps both bound functions reachable through a module-level checkpoint
binding. The explicit 200-step run failed at step 201 as intended; the saved
snapshot contained two bound-function heap nodes. Resuming that exact snapshot
with a 2,000-step budget passed. Both the budget-failure and successful-resume
screenshots were opened and inspected. The completed runner cleans up its saved
snapshot normally. No runtime or test source changed after the full-suite run.
