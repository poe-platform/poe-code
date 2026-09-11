---
title: Iterator consumer validation
---

# Standard Iterator helpers

A built-SDK probe after the local Iterator.from implementation returned
undefined for every method below on Iterator.prototype:

- Lazy: map, filter, take, drop, flatMap.
- Consuming: reduce, toArray, forEach, some, every, find.

Specification: https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html#sec-iterator.prototype

Follow Iterator.from delivery with failing native/spec comparisons before
implementation. Preserve direct next lookup order, callback receiver/index,
abrupt-completion precedence and required iterator closing. Lazy helpers must
not pull values at construction; verify reentrancy, return before first next,
partial consumption, flattening inner/outer cleanup, exhaustion and snapshots.
Budget retained sources, cached methods and callback captures, and reject
malformed serialized state. Use the existing shared Iterator prototype.

Consuming helpers need bounded-memory accumulation and accurate suspension
ownership for guest callbacks. Do not substitute Array.from eager materialization
for lazy operations or short-circuiting consumers. Snapshot tests must execute
restored state, not merely check object identity. Validate the real CLI harness
and inspect screenshots before each independently deliverable commit/push.

After Iterator.from delivery at 9d2157476, an isolated native-comparison baseline
for the consuming helpers failed all nine cases in 1.41 seconds. It covers
toArray, reduce with/without initial value, some/every/find, forEach callback
receiver/index, short-circuit closing and callback-error precedence over a
throwing return method. No consumer implementation has been changed yet.

The consuming methods now share a direct-iterator loop with retained roots,
budgeted accumulation, callback index/receiver handling and existing iterator
closing. The initial nine cases passed in 1.55 seconds. Expanded cases cover
empty reduce, promised predicates without implicit awaiting, cached next,
done/value/next errors, malformed close results and public replay.

Five invalid-callback comparisons exposed a Node 22 oracle discrepancy: native
returns TypeError without closing, while ECMA-262 2025 sections 27.1.4.3,
27.1.4.5, 27.1.4.7, 27.1.4.9 and 27.1.4.10 require IteratorClose before throwing.
Those cases now assert the specification's explicit TypeError and return-call
trace, without changing the compliant implementation to match the native gap.
Source: https://tc39.es/ecma262/2025/multipage/control-abstraction-objects.html

Expanded consumer/Iterator integration passed 69 tests in three files in 2.44
seconds. Added bounded-accumulation, endless-iterator step-budget and persistent
realm root-release checks passed with the existing budget coverage: 53 tests in
three files in 2.47 seconds. Production TypeScript passed. Lazy helpers remain
unimplemented; this delivery is scoped to the six consuming methods.

Initial normal build stopped in scripts/build-workspaces.mjs process-group
cleanup with kill EPERM (signal-zero existence probe), not a TypeScript error.
The build session was terminal and no matching compiler remained live. A normal
build retry is being used to distinguish a transient environment failure from
a reproducible runner issue; no process-control changes have been inferred.

The normal build retry passed without changes to the runner, including all four
built-import checks. The test file has zero TypeScript diagnostics. The real
consumer harness passed and its screenshot was inspected; it has zero spawns
and proves no model behavior. Node 18 built consumer execution, generator
short-circuit cleanup and public replay passed. Package-wide checks are running
with only the documented unresolved host-Promise probe excluded.

The final package run passed 19,342 tests across 606 files in 333.22 seconds,
with 41 skipped tests and one skipped file. The host-Promise exclusion is not a
pass. This commit delivers the six consumers; the five lazy helpers remain
tracked separately in safejs-lazy-iterator-helpers.md.
