# Authorized single-case precedence correction

Only `builtin-function-registry-shadow` in
`tests/shell-stress/script-entrypoint/cases.ts` changes. The other sixteen
definitions and all original 72/132/57 and new 34 expectations remain unchanged.

The original fresh prior-file run is **57/58**, with exactly that case red.
`post-ready-previous-original.json` retains the full failure, source hashes and
173/173 separately selected regression results. `precedence-native.json` retains
the exact old definition and expected stdout, not a retrospectively green run.

Official GNU Command Search and Execution and Bash Builtins manuals establish
function-before-builtin lookup and `command` function bypass. Both are linked
in the JSON, along with the inspected GNU5.3 `execute_cmd.c` hash. The independent
bounded **two-source whole cohort × both actual profiles = 4/4** confirms the
original source emits `unexpected-function` before its existing status output.
The obsolete expectation omitted that effect. This is not a source defect.

The revised case additionally asserts function status7, `command true` status0
without calling registry-true, function bash status13, `command bash` registry
status12, and isolated script registry dispatch. It retains stderr and exact
registry-call assertions and adds exit-status validation. No assertion is waived.
Native fallback scripts model the registry roles; native Bash has no virtual
plugin registry. All script headers use the actual profile executable, and
exact rendered fixtures, helper mappings, args, bytes and statuses are captured.

The revised prior-file cohort is **58/58**, stable actual TS imports, in
`post-ready-previous-revised.json`. `precedence-review.json` proves that removing
only the authorized definition yields identical old/current source hashes.
This correction does not change the new closure **31/34** result or raw losses.

Reproduce the isolated native evidence with a new evidence name in a copied
runner, or inspect the immutable capture; `precedence-native.ts` intentionally
refuses to overwrite it. Runtime commands are recorded verbatim in both JSONs.
