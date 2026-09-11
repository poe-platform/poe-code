# Eval block function assignment after binding deletion

Native probes (39507) exposed three ReferenceErrors after deleting an
eval-created binding before its legacy block-function declaration executes.
A same-named global also receives the function incorrectly. Node 22 itself
creates/replaces a global in these cases, so its complete result is not the
correct oracle for the required variable-environment behavior.

ECMA-262 2026 EvalDeclarationInstantiation step 13.b.ii.7.b assigns the function
using the running context's VariableEnvironment.SetMutableBinding with strict
false. Declarative Environment Record SetMutableBinding recreates a missing
binding in that environment; it does not resolve into a parent environment.

- https://tc39.es/ecma262/2026/multipage/global-object.html#sec-evaldeclarationinstantiation
- https://tc39.es/ecma262/2026/multipage/executable-code-and-execution-contexts.html#sec-declarative-environment-records-setmutablebinding-n-v-s

Seven regression cases produced six failures and one passing unexecuted-block
control before the fix (95231). The failures include retained closure recovery
with and without an outer global. At Scope.assignVar's already-selected function
boundary, use assignOwnBinding with strict false. The global-environment branch
and its setter behavior remain unchanged. No parser or snapshot format changes
are needed; recreated bindings retain their deletable metadata.

All 61 focused runtime/recovery regression checks pass across seven files
(7401). TypeScript and focused lint also pass (41288, exit 0). This one-line fix and its two
new test files are outside the
frozen 1,163-file full-suite snapshot (11849), and depend on the uncommitted
eval/binding-deletion implementation. Do not stage scope.ts wholesale as an
independent repair against the committed baseline. No push or release.
