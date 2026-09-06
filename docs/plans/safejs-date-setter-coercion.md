---
title: Date setter coercion
---

## Validated failures and standard

All fifteen supported Date setters reject object arguments. Thirty-one initial
regressions cover this and mutation during conversion. Follow the published
[ECMAScript 2026 algorithms](https://raw.githubusercontent.com/tc39/ecma262/es2026/spec.html),
not incidental Node 22 behavior: setters capture the initial Date time before
converting arguments. All provided component arguments are converted before an
invalid-time early return. That return does not overwrite conversion side effects.
setTime and the two full-year setters can recover an invalid Date.

Node 22 differs on mutation-during-conversion and on converting trailing arguments
for initially invalid Dates. Those edge tests use the published algorithm as their
oracle; ordinary cases compare with native execution. The initial native-oracle
cohort exposed the latter difference and was corrected against the specification,
without changing the specification-conforming implementation.

## Implementation and verification

Validate the Date receiver before invoking guest hooks. Coerce only the arguments
accepted by the setter's maintained arity, serially, with the numeric hint.
Evaluate the native numeric operation against a temporary Date holding the
captured initial time, then commit the result through the captured intrinsic
setTime implementation. Exceptions and invalid-time early returns leave hook
side effects intact. Do not read a guest-overridden setTime property.

Cover all setters, initial-time semantics, ignored extra arguments, ordering,
exception identity, receiver checks, frozen Dates, BigInt/Symbol rejection,
Date-valued arguments, subclasses/null prototypes, invalid-Date recovery,
pending/completed replay and fatal budgets. Run focused Date regressions, lint,
types, selected workspace build, and this actual CLI harness with screenshot
inspection. Commit and push independently; monitor publication while continuing
the next validated gap. The native Promise import-policy tests remain separate.

Validation passed: 162 focused tests across six files, scoped ESLint and package
type checking, 23 selected dependency-closure build tasks and four native import
smoke tests. The screenshot runner completed 70 uncached build tasks in 20.603
seconds; its actual harness passed and the PNG was visually inspected. Four
new Date structured-clone regressions were reproduced separately afterward and
are not included in this passing test count.
