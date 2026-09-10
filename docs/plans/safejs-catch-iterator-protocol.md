# Catch binding iterator protocol

## Validated defect

At runtime d4891dd09, public guest execution of array catch patterns only accepts
arrays and reads their indexed elements directly. It rejects strings, Sets,
generators and custom iterables, and ignores an array's overridden iterator.
`exceptions.ts` has a separate `bindArrayPattern` with an `Array.isArray` guard;
the general `patterns.ts` implementation already uses the iterator protocol.

A read-only comparison of 72 combinations found 12 differences, all in catch
bindings (6d427d). Declaration, assignment, parameter, elision and rest controls
matched native execution. The cases vary failure in `next`, `done`, or `value`,
and close returning an object, returning a primitive, or throwing. Effects are
compared as well as final results, so an incidental matching TypeError does not
count as correct cleanup behavior.

## Isolated red regression

An unchanged source copy is at `/tmp/safejs-catch-iterator.JFY5Sw`, with root
dependencies linked to the main checkout. Its new
`packages/safe-js/src/interp/catch-iterator-protocol.test.ts` has 18 cases.
The initial run reports **17 failures and one array control pass** (c5d2ba).
Besides the 12 failure/close cases, it checks Set, Unicode string iteration,
overridden array iteration, generator closing, and an empty catch pattern.
No runtime fix has been applied yet.

## Repair requirements

Prefer sharing the maintained binding/iterator implementation over perpetuating
the array-only catch path. Preserve catch lexical scope, TDZ, inferred default
names, error completions, iterator close precedence, resource accounting and
generator/async recovery. Inspect the standalone exception evaluator contracts
before changing its interface. Add tests for defaults, elisions and checkpoint
recovery, not just successful Set binding.

Main full gate session 69114 is still running and main runtime/test sources must
remain stable until it terminates. Develop the candidate in the isolated copy,
then revalidate and integrate as a separate atomic improvement. No push/release
or issue closure during the release hold. This language-only change has no CLI
visual impact; update README on integration.
