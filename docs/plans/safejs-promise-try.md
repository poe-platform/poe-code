---
title: Promise.try
---

## Validated scope

Eight initial tests fail because Promise.try is absent. Implement the published
[ECMAScript 2026 algorithm](https://raw.githubusercontent.com/tc39/ecma262/es2026/spec.html):
create the promise capability before invoking the callback, then route its
completion to the captured resolve or reject function. Preserve arguments,
undefined callback receiver, subclass/generic constructor behavior, and method
metadata. A returned intrinsic promise must still be wrapped in a fresh promise.

The current development draft changes capability/callback ordering and identity;
do not accidentally implement that draft instead of the published standard.
The local Node 22 runtime has no Promise.try, so the primary published algorithm,
not a nonexistent native implementation, is the reference for these cases.

## Implementation and validation

Reuse existing capability creation and guest callback invocation. Do not turn
fatal budget/reentry errors into catchable guest rejections. Invoke resolving
functions outside the callback catch block so their failures propagate correctly.
Keep raw guest callback results for custom resolvers, rather than eagerly
assimilating them.

Cover callback order, arguments, rejection identity, noncallable callbacks,
subclasses, custom constructors, metadata, returned promises/thenables, async
callbacks, resolver exceptions, fatal budgets, and pending/completed replay.
Run scoped Promise regressions, lint/types, selected workspace build, and this
real CLI harness with screenshot inspection. Commit and push independently;
monitor publication while validating another compatibility gap.

Local checks: 284 Promise regression tests passed across ten files; the final
queued-job ordering case was added afterward and all sixteen focused cases pass.
Scoped lint and type checking passed. The separate newly validated Date subclass
failure and pending native-Promise import policy tests are not in this commit.
