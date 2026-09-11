# Classic for initializer grammar

## Evidence

Pinned Test262 72faf8ec1445c55149615e8b35187830783aba1a, top-level
`test/language/expressions/yield/star-*`: 40 runnable strict-source fixtures
pass both native and guest (0e2ed1). The one parse-negative fixture,
star-in-iteration-stmt.js, is not a pass: native rejects
`function* g(){for(yield * '' in {};;);}` but parseModule accepts it (fd74a8).
The maintained generator delegation/nested-yield checkpoint selection passes
40 tests (97e509); those tests do not cover this grammar constraint.

The [grammar](https://tc39.es/ecma262/multipage/grammar-summary.html)
restricts classic for initializers to Expression[~In] and likewise restricts
declaration initializers. Yield operands, assignment right sides, arrow concise
bodies and conditional alternate arms propagate the In parameter. Parentheses,
array/object elements, call arguments and conditional consequent arms can
permit it again. This is a parser defect, not an iterator execution defect.

A 14-case native/guest comparison (128bb6) validates nine invalid forms wrongly
accepted and five valid controls. The new for-initializer-no-in.test.ts captures
these distinctions before implementation.

## Implementation and verification requirements

Main red: nine failures, five valid controls (b2dea1). The implementation adds
a scoped In grammar parameter to expression parsing, restoring it in finally.
Classic loop initializer expressions/declarations select ~In; assignment/yield
operands and arrow concise bodies inherit it. Nested expression productions
restore +In, including assignment-pattern defaults. Private brands obey the
same restriction. A first candidate exposed two valid pattern-default cases;
their failing controls (4de564) led to explicitly selecting +In there.

All 32 maintained regressions now pass within the full parser selection:
1,591 passed, one opt-in skip across 64 files (daec07). They include private
brands and execution proving state restoration for loop conditions, updates,
bodies and later statements. Public eval/Function rejection probes also pass
(92c7e5). No AST fields or checkpoint data formats changed.
Scoped ESLint and package TypeScript pass (4f2d65). README and the current gap
inventory are updated. The most recent full-package gate predates this repair;
its 14 Promise/locale failures are not resolved by these parser checks.
The opt-in 3,100-input fuzz corpus also passes with this parser change in
502 ms (dce7e6). Whitespace checks pass (5549fe).

Thread the grammar's In state through expression parsing and classic for
declarations. Do not globally reject in tokens, reject permitted nested
expressions, or change for-in/of header interpretation. Cover nested function
bodies, arrow concise bodies, pattern defaults and private-brand in expressions
where their productions differ. Keep parameter scope and parse-state restoration
correct after exceptions and speculative parses.

Run the red tests, implement the contextual constraint, then validate focused
loop/parser cases, lint and typechecking; audit all parser tests in proportion
to the shared parsing change. README updates are authorized. This parser-only
behavior has no visual CLI change and needs no screenshot. Commit atomically
on local main; push and release remain on hold.
