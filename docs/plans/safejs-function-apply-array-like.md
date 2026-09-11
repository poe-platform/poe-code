---
title: Function.apply array-like arguments
---

# Validated Function.apply array-like gap

Native Node probes accept ordinary indexed objects as Function.apply's argument
list. SafeJS currently throws its array-only TypeError. Three probes cover basic
receiver/argument forwarding, length-before-index getter order without consulting
Symbol.iterator, and object-to-number/fractional length conversion. They were
revalidated while the bound-function snapshot fix was in its full test run;
the red tests were added only after that fix's qualification and push.

Implement CreateListFromArrayLike semantics: null/undefined mean no arguments;
reject other primitives; read length once and apply ToLength; read every index
in order including inherited entries and holes; do not use the iterator protocol.
Preserve abrupt completions, argument retention through reentrant getters and
the existing array-length/step/data budgets. Qualify the low-level invocation
route as well as ordinary guest calls, snapshot replay and the real CLI harness.
Existing low-level tests explicitly expecting rejection for an empty object
will need their expectation corrected alongside the validated implementation.

The maintained array methods already use sandboxNumber and context property
access for array-like lengths. FunctionMethodOptions currently permits omitted
budgets and the low-level array fast path is synchronous; inspect these contracts
before choosing how to share conversion behavior without changing unrelated APIs.

The expanded red run had 17 failures and two passing rejection controls. The
implementation now accepts objects, reads length once with the existing numeric
coercion machinery, checks the allocation limit, then reads indexed properties
in order. It retains the input and collected arguments through getter evaluation
and target invocation, with finally cleanup. The legacy synchronous low-level
array route remains unchanged; the new low-level object route can invoke guest
getters using the supplied callback and uses a local Budget when none was given.

The focused invocation/snapshot cohort passes 79 cases, including 21 new cases.
Coverage includes inherited entries and holes, length/index mutations, boxed
strings, Float32Array and callable array-like objects, numeric conversion hooks,
throwing getters, primitive rejection, allocation ordering, retention cleanup,
low-level guest getters and replay of an applied async function across a pending
effect. Qualify with scoped lint/typecheck, the maintained full SafeJS workspace
unit route excluding only the two unresolved host-Promise policy cases, the
selected build closure and this actual paired CLI harness with screenshot review.

Qualification receipt: scoped ESLint and TypeScript passed. The maintained full
SafeJS workspace unit route passed 17,559 tests with 41 declared skips in 235.47
seconds (512 passing files, one skipped). Only the two unresolved host-Promise
property-policy cases were excluded; all 21 new array-like apply cases ran.
The selected build completed 23 dependency-closure builds and four native ESM
import checks. The actual paired CLI harness passed and its screenshot was
opened and inspected. The screenshot route rebuilt 70 tasks uncached in 58.92
seconds before running the harness.
