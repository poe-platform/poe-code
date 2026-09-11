# Intrinsic execution contexts across budget reuse

Baseline `6337735cd`: after two runs sharing a Budget, borrowed eval returned
the first run's marker (1 instead of 2), and borrowed Function threw fatal
reentry. Both were reproduced before implementation.

Use the intrinsic function's stable prototype-table identity as the saved
execution-context key. Pass the intrinsic itself through the eval/dynamic
compilation callbacks instead of passing only the reusable Budget.

Same-realm calls retain the current execution context. Scope-object inequality
is not a realm test: the first implementation broke 12 restored direct-eval
cases. Comparing intrinsic realm identity with the caller budget's active
realm table preserves those restored lexical contexts.

Eight focused reuse/replay cases cover eval and Function, replacement of their
global bindings, and ordinary/bound/Proxy calls. Initial focused checks passed;
broader validation is recorded below when complete. Do not treat this as fixing
foreign intrinsic error prototypes or RegExp compilation ownership.
The corrected broader route passed 510 tests across 38 files, including the
restoration regressions. Scoped ESLint and TypeScript passed.
The full snapshot route passed 1,700 tests across 127 files. No new full-package
gate was run; the remaining deadline and host-Promise policy failures are not
claimed resolved by these checks.
The maintained build passed 23 workspace builds and four fresh-import checks.
Both original budget-reuse reproductions passed through the built SDK.

No push, release or issue closure.
