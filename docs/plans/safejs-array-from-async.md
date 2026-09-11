---
title: Array.fromAsync validation
values: [2, 4, 6]
---

# Array.fromAsync

On September 7, the built SDK at string-iterator delivery returned `undefined`
for `typeof Array.fromAsync`; the installed native Node runtime returned
`function`. Add the missing generic promise-returning factory, not an eager
Promise.all substitution.

Primary algorithm reference read in full:
https://tc39.es/proposal-array-from-async/ . The current main ECMA multipage
endpoint timed out twice, so this reference is explicitly the proposal draft.
The current main `spec.html` was subsequently read directly from
https://github.com/tc39/ecma262/blob/main/spec.html through the raw GitHub
endpoint; its complete Array.fromAsync algorithm confirms the same close rules.
Acquire the async iterator (or async-from-sync adapter) before constructing the
output. Consume sequentially. Await sync/array-like values and mapping results,
but preserve async iterator value promises without a mapper. Close on mapper or
property-definition failure, not on next/done/value extraction failure. Return
rejections rather than synchronous throws. Preserve constructor, descriptor,
budget, SDK and snapshot behavior.

The regression file `interp/globals/array-from-async.test.ts` covers native
comparison cases and public replay. Run it red before implementing. Expand
coverage for constructor failures, invalid iterator result/methods, accessor
ordering, async close precedence, exhaustion length failures, budget accounting
and snapshot boundaries during implementation. Reuse maintained iterator and
guest Promise machinery; do not duplicate sync Array.from's different ordering.

Initial TDD run: all 13 regressions failed in 1.44 seconds, principally because
the method is missing. The native oracle exposed a separate discrepancy: Node
22 and Node 24 both call return after next rejects, whereas current ECMA-262
propagates that abrupt completion directly. That case now uses the explicit
specification expectation `["next"]` rather than copying the native deviation.
The corrected 13-case baseline was rerun and failed in 1.61 seconds.

Implementation shares Array.from's result-construction loop, with async iterator
acquisition before construction and explicit awaiting only at the specified
boundaries. The first implementation passed 86 focused cases but deadlocked in
async mapper cleanup. It now uses executeAsyncFunction for synchronous-prefix
ownership and suspendJob with budgeted await scopes; the same 87 tests then
passed in 2.62 seconds, without timeout changes.

Expanded tests cover descriptors, prefix/constructor/accessor ordering, invalid
inputs, close precedence and malformed iterator results. A native Node 22 probe
with a synchronous mapper throw and rejecting async return did not terminate,
even with a finite iterator. Its two test processes and separate native probe
were terminated after observing the live CPU-active processes. Cleanup failure
tests use explicit specification assertions, not this unusable native oracle.
The 33 new tests and focused sync/async iterator regressions passed together:
162 tests across six files in 4.33 seconds. Budget checks cover fatal array length,
retained mapped output across awaits, and fatal cleanup step exhaustion.

Pre-delivery checks passed: scoped ESLint, package production TypeScript,
maintained root `npm run lint:types`, and zero diagnostics in the new test file.
The normal `npm run build` completed all declared workspace builds and root
schema/type/bundle stages. The real paired harness passed through the built CLI;
its screenshot was inspected. It uses no agent spawns and is not model-behavior
evidence. Node 18 passed built-SDK async-generator collection/mapping and public
dump/replay assertions. The package-wide suite includes all new regressions;
only the separately tracked unresolved host-Promise import probe is excluded.

The maintained package-wide unit route passed in 325.55 seconds: 19,139 tests
across 599 files passed, 41 optional tests and one file skipped. The excluded
`promise-import-properties.test.ts` probe is not counted as passing. No matching
open GitHub issue exists. The separately validated deleted-iterator fallback
issue is recorded for a later atomic change, not included in this implementation.
