# Execute hoisted eval functions without rebinding

## Validated mismatch

Fourteen of sixteen native comparisons failed: direct and indirect sloppy eval
created a second const binding when reaching a top-level function declaration.
This broke assignment, var initializers, function identity before/after the
declaration, assignment before the declaration, and duplicate declaration
precedence. Two block-function controls passed.

## Repair

Record eval-root function declarations as weak AST metadata during parsing.
During eval execution, these declarations return empty completion because their
functions were already instantiated. They still pass through evaluateNode, so
budget visits and normal node instrumentation are retained. Nested block
declarations and non-eval interpretation retain their existing paths. Parsing
restored eval source reconstructs the metadata; it is not serialized separately.

## Validation

- Initial runtime/parser/source-recovery selection: 113 passes.
- Additional suspended eval-call/catch recovery, source-budget and dynamic
  Function selection: 80 passes.
- Added strict eval controls to each of the eight source shapes; final rerun
  passes all 121 tests. TypeScript, focused lint and whitespace checks pass.

This remains local within the uncommitted eval implementation. Global Annex B
edge cases, class-initializer contexts and broad integration still need work.
No push, release, or full JavaScript-conformance claim.
