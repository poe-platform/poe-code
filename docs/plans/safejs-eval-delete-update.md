# Eval binding deletion during update conversion

Eight native-comparison regressions fail for prefix/postfix increment/decrement
when valueOf deletes an eval-created binding during Number or BigInt conversion.
The strict-update control passes. Two JSON-checkpoint tests independently fail
after restoring the closure and its deleting valueOf method.

The update evaluator retains its original BindingReference but wrote through
Scope.assign, which searches scopes again. Route the declarative write through
the same assignOwnBinding operation used by ordinary and destructuring assignment.
Keep numeric conversion, prefix/postfix results, object references and strict
reference handling unchanged.

This follows the prior eval-deletion repair and is outside the frozen full-package
snapshot in session 89782. That snapshot's 23-build closure and all four fresh
import checks passed; its unit suite is still running. Do not attribute that
run to this later update repair. Focused validation is underway; no commit, push
or release yet.

The repaired update/deletion/scope/reference cohort passes 99 tests across nine
files (session 83593). All 84 numeric/BigInt regression checks pass across four
files (session 90857), and final TypeScript/focused lint are running in session 77258. Whitespace
checks pass. The frozen full-package process remains 89782.

Session 77258 subsequently completed with exit 0: TypeScript and focused lint
pass for the update repair. The later parameter-environment change is a separate
follow-up and was not part of these checks.
