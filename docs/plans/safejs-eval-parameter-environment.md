# Eval in parameter environments

Five native-comparison tests fail before the repair, with three controls passing.
Eval-created values in default parameter expressions are incorrectly copied into
same-named body var declarations. Eval var declarations conflicting with current,
later or destructured parameters produce ReferenceError instead of SyntaxError.

[FunctionDeclarationInstantiation](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-functiondeclarationinstantiation)
requires a separate parameter environment for non-strict functions whose parameter
lists contain expressions. Eval-created vars reside outside it, while body vars
have their own environment inside it. Only parameter/arguments bindings are
eligible for initial value copying into same-named body vars.

Create the separate non-var-boundary scope for that case, using mutable lexical
parameter bindings. Keep strict and simple-parameter cases on their existing path.
The existing scope chain, eval lexical-conflict check, and own-binding copy logic
then distinguish parameter bindings from eval-created vars without extra snapshot
flags. Snapshot tests cover closures retaining both parameter-eval and body state.

Focused validation is in progress. This change is outside frozen full-suite
session 89782. No commit, push, release or complete conformance claim.

The first six-file function/arguments/deletion cohort passes 127 tests (65802).
The five-file eval/class-arguments/dynamic-recovery cohort passes 35 tests (86510),
including two new captured-scope recovery cases; eight parameter tests occur in
both runs, so these are not 162 distinct cases. Final package TypeScript and
focused repository-configured lint are running in session 10849.

Session 10849 subsequently completed with exit 0: TypeScript and focused lint
pass for the implementation and original runtime/recovery tests.

Six fresh body-eval/parameter-closure controls match native Node 22, including
new body var declarations that shadow parameter bindings and implicit arguments
copying into a body var. They are now included in the runtime matrix.

Node 22 accepts eval var/function declarations named arguments in a default
parameter and replaces its implicit arguments value. The normative algorithm
places that implicit binding in the separate parameter environment (function
instantiation steps 20 and 22), and eval instantiation step 3 rejects declarations
that cross such a non-catch declarative binding. SafeJS rejects with SyntaxError.
Two explicitly specification-based controls preserve that behavior rather than
silently copying the native deviation. An explicit parameter named arguments
also causes native rejection. No implementation change was made for this probe.

The expanded sixteen-case runtime matrix and two recovery cases all pass
(session 82797). Focused lint for the expanded runtime test file is running in
session 15869; the previously checked implementation is unchanged.

Session 15869 completed successfully. Nine further native controls cover ordinary,
async, generator, async-generator, arrow and constructor calls, including immediate
parameter-initialization failures. They and the selected generator/async-driver,
constructor and live-capture recovery regressions pass all 91 tests across eight
files (2200). No production changes were needed for this expanded coverage.
