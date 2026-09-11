# Logical-assignment qualification

## Scope

At 9ef64d82f, inspect all top-level JavaScript fixtures in
[Test262 logical-assignment](https://github.com/tc39/test262/tree/72faf8ec1445c55149615e8b35187830783aba1a/test/language/expressions/logical-assignment).
The pin is `72faf8ec1445c55149615e8b35187830783aba1a`.
Read-only probes fetch original sources, metadata, sta/assert and declared
includes in memory. Runtime fixtures are qualified in a native VM before guest
execution; parse-negative fixtures must be rejected by native parsing first.
Guest runtime execution is bounded to two million steps. No fixtures are rewritten.

## Results

All 78 fixtures are accounted for (732f0e):

- 66 runtime passes, zero runtime failures.
- 12 parse rejections, zero unexpected accepts.
- Zero excluded or native-unqualified fixtures.

The cases cover private data/accessors/methods, readonly targets, short-circuiting,
BigInt values, identifier naming, unresolved bindings, and read/write ordering.
This is a bounded probe rather than an official Test262 runner or complete
logical-assignment conformance. Parse rejection does not prove exact error branding.

An independent native-function comparison passes 27 combinations of operator,
initial value and member/private/super target across generator suspension (a502ff).
The member cases reassign the variable naming the target object after the first
next call, checking that the pending assignment still writes its captured receiver.

## Checkpoint regression coverage

Add 18 tests crossing three operators, three reference types and synchronous/
asynchronous generators. Each exports a suspended iterator, serializes it to JSON,
restores it, resumes in a new interpreter, and compares against native execution.
Member tests reassign the target variable on the RHS before yielding. Getter/setter
logs check that the getter is not repeated and the setter retains its receiver.
All 18 pass without runtime changes (cc07d7).

Existing computed-key tests intentionally follow the newer ECMAScript rule that
GetValue retains its converted key for PutValue. These probes do not replace that
rule with Node 22's older repeated-coercion behavior: the new native comparisons
use primitive property names only.

## Delivery

Keep runtime code unchanged: no logical-assignment defect was reproduced.
Scoped ESLint passed (9b822c). The related three-file generator-assignment
selection passed all 66 tests (0c9009), including the 18 new checkpoint cases.
No visual CLI changes, screenshots, release, push or issue closure.
The broad JavaScript-completeness objective and previously recorded full-suite
failures remain open; this qualification does not supersede the full-package gate.
