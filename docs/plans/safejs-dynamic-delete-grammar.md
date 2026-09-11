# Strict dynamic-function delete grammar

## Validated issue

The guest dynamic parser accepted `delete identifier` in strict function bodies.
Native Function, AsyncFunction, GeneratorFunction and AsyncGeneratorFunction
constructors reject that syntax before execution. Twenty native-comparison cases
failed before the change; twenty accepted-syntax controls passed.

## Atomic change

Reject an identifier operand of `delete` when explicit dynamic-source grammar
is strict. Parenthesized identifiers and inherited strictness in nested functions,
arrows and classes are covered. Keep member deletion, comma-expression operands,
typeof and non-strict identifier deletion valid.

This parser change does not enable runtime Function constructors or change the
ordinary SafeJS script grammar. Runtime constructor work is separate and remains
uncommitted until its checks are complete.

## Verification

- Run the native-comparison tests and the full parser test directory.
- Run focused lint and maintained workspace build checks.
- Compare the built parser with native constructors on Node 18 and Node 24.
- Stage only this parser rule, its tests and this plan; preserve other parser edits
  and user-staged safe-bash changes.

## Results

All 40 native-comparison cases pass after the change. The full parser directory
passes 996 tests, with its existing opt-in fuzz test skipped. Focused lint passes.
The maintained workspace closure builds 23 packages and passes all four fresh
process import checks. Built Node 18.18 and Node 24.14 each match all 40 native
constructor cases. No matching open GitHub issue was found.
