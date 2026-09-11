# Strict directives with non-simple function parameters

Dynamic Function support requires correct function early errors. Native execution
rejects a use-strict directive in a function with defaults, destructuring, or rest
parameters, even when the surrounding context is already strict. SafeJS previously
enforced this only for setters. Thirteen fresh differential cases failed; nine
existing-behavior controls passed.

Move the existing token-aware directive check into the shared function-body block
parser. Cover declarations, expressions, arrows, async/generator variants, object
methods, class methods, and setters. Preserve the distinction between actual
directives and parenthesized strings, escaped spelling, expressions, or strings
after the directive prologue. Ordinary nested blocks are not function bodies.

Verify all parser tests and accessor regressions, focused lint, the maintained
SafeJS workspace build closure, and built public behavior on Node 18 and Node 24.
This is a prerequisite fix, not a claim that dynamic Function is implemented.

## Verification

All 22 differential regression cases pass after the fix. The broader parser and
accessor run passes 1,037 tests; the existing opt-in fuzz test is skipped. Focused
lint and the 23-workspace maintained build, including four fresh-import checks,
pass. Built Node 18.18.0 and Node 24.14.0 each pass 100 comparisons through both
the parser and public run API against native grammar acceptance. The public API
rejects parse errors before execution, rather than returning an execution result.
No matching open GitHub issue was found.
