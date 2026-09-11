# Eval declaration conflict preflight

## Evidence

Eleven native Function/eval comparisons reproduce seven runtime mismatches:
wrong error class for function-scope lexical conflicts, missed intervening
lexical conflicts, execution before conflict rejection, destructuring-catch
conflicts, and function-declaration conflicts. Four controls pass, including
simple catch parameters, strict eval isolation, existing var bindings and with
object bindings. One initially malformed strict-eval fixture was corrected
using JSON.stringify before implementation; it is not a runtime defect.

## Implementation

Before non-strict eval hoists or executes anything, collect its hoisted var names
and top-level function declaration names, then validate declarative bindings
through the caller's variable environment. Conflicts throw SyntaxError. With
object properties are not declarative conflicts. Strict eval uses its own
environment and does not apply caller conflicts.

A simple catch parameter is explicitly identified on its own scope. Its
Annex B exception does not apply to destructuring parameters or a nested lexical
binding of the same name. Preserve this marker in scope snapshots and validate
its shape and binding association before restore.

## Verification

- RED: seven failures and four controls in eval-declaration-conflicts.test.ts.
- Initial runtime/exception selection: 50 passes.
- Six-file recovery and exception selection: 86 passes, including restoration
  of generators suspended within simple, object-pattern and array-pattern catch
  clauses, plus rejection of three malformed catch markers.
- The snapshot rejection test initially expected TypeError directly; it now
  expects the public SnapshotValidationError wrapper.
- TypeScript passes. The first lint run rejected a this alias in the scope walk;
  the walk now checks each scope and delegates the same readonly name set to its
  parent up to the variable environment. Final focused rerun: 14 passes;
  TypeScript, all eight changed-file lint checks and whitespace checks pass.

This is part of the unfinished, uncommitted eval implementation. Sloppy function
declaration leakage, indirect global declarations and Annex B block-function
instantiation still require work. Full integration and publication are not
established; no pushes or releases were performed.
