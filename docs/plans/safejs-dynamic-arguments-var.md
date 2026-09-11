# Dynamic function arguments var declarations

A native/source comparison validated a mismatch: a non-strict dynamic function
containing `var arguments` throws a redeclaration Error locally instead of
retaining its implicit arguments object. The initial six-case regression run
failed the plain declaration, repeated declaration and initialized declaration;
parameter shadowing, default parameters and the strict syntax-error control
passed. A rest-parameter control was subsequently added.

The implicit non-strict arguments binding was declared as let, so var hoisting
rejected it. Declare that binding as var for both mapped and unmapped non-strict
functions; retain existing strict-function handling. No general lexical
redeclaration checks are relaxed. Focused runtime regressions and lint are
running. This follow-up is local, depends on the uncommitted dynamic runtime,
and is not included in the frozen full-validation candidate.

The focused dynamic-function, mapped-arguments and declaration suites passed
81 tests. Two checkpoint/restore cases were added for mapped and rest-parameter
arguments and require a fresh run, followed by package TypeScript. Lint is
still running. Do not treat the 81-test result as proof of the later additions.

The nine-case declaration/restore run and package TypeScript subsequently
passed, as did focused lint. Further native probes then validated three
lexical arguments mismatches (let, const, and let with a simple parameter).
The expanded regression was red with three failures and eleven passes.

FunctionDeclarationInstantiation steps 15–18 suppress the arguments object
when a body lexical/function declaration provides that name and there are no
parameter expressions. The implementation now computes this before choosing
mapped/unmapped arguments. Parameter-expression bodies retain the arguments
object in their separate parameter environment. General lexical redeclaration
checks remain unchanged. The expanded focused run passed 88 tests and package
TypeScript passed. Focused lint also passed. These changes have not been
folded into the frozen full-validation candidate or committed.

Eight subsequent native/source probes all matched: arrow var/let bindings,
nested-block lexical shadowing, typeof in the lexical temporal dead zone,
parameter-default closures observing the parameter arguments object while the
body declares a function of the same name, and block/if legacy functions named
arguments. No additional runtime change was justified by these probes.

Three additional recovery regressions suspend generators after initializing
let/const arguments bindings, then checkpoint at the outer await. They verify
original and restored execution, including a parameter-default closure that
retains its separate arguments object. The complete declaration/recovery file
passed 17 tests. Lint for the expanded test file also passed; the earlier
88-test/lint results predate these three added cases.

Reference: https://tc39.es/ecma262/multipage/ordinary-and-exotic-objects-behaviours.html#sec-functiondeclarationinstantiation

Releases and pushes remain on hold at the user's request.
