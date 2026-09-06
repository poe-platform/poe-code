---
title: Promise prototype graph
---

## Validated gap

Promise instances did not expose their default Promise.prototype ancestry.
Five tests failed before implementation: reflection, inherited enumeration,
accessors, ancestry-based instanceof, and Object.prototype inheritance. The
existing Promise string tag already worked and was not changed.

## Implementation

Install the intrinsic Promise prototype in the budget-scoped object model and
release it with other intrinsic prototype state. Use ordinary prototype
ancestry for instanceof, independently of the internal Promise brand required
by methods. Preserve intrinsic then resolution by exact method identity rather
than assuming the absence of a descriptor means an unmodified promise. When an
own intrinsic then shadows an overridden prototype method, invoke the own method.

Custom Promise instance prototype mutation and Promise subclass construction
remain separate compatibility work; this change establishes the default graph.

## Validation and delivery

Nine focused cases cover the above, original own-then identity, and two replay
checkpoint states. Run promise ordering, species, fatal-error, and replay tests,
then the maintained SafeJS workspace unit route. Exclude only the uncommitted
host-promise property-import policy tests; those are not counted as passes.
Run scoped lint and types, the selected workspace build, and this harness pair
through the actual CLI. Inspect its screenshot, commit and push independently,
and monitor publication alongside the next validated issue.

Local results: nine focused cases passed; the broader workspace run passed
16,739 tests with 41 skips. It started before the separate custom-prototype
mutation regression was added; that new failing test is not part of this commit
or the green count. Lint and type checking passed for the changed TypeScript.
