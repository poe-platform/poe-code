# Static imports in dynamic function grammar

## Validated issue

The guest dynamic parser accepted default, named and namespace static import
declarations in Function-family bodies and nested functions, arrows and classes.
Native constructors reject them. The regression suite reproduced 24 failures
and 16 controls across normal, async, generator and async-generator constructors.

## Change

Reject static import declarations when the parser is operating under explicit
dynamic-function grammar. Preserve dynamic import expressions and existing
ordinary SafeJS script behavior. This is independent of runtime constructors.

## Verification before delivery

- Run the 40 native comparisons and the full parser directory.
- Run focused lint and the maintained workspace build.
- Compare built parser behavior on supported Node 18 and Node 24.
- Stage this rule, its test and this plan separately from runtime metadata edits.

## Results

- The new native comparisons failed in 24 cases before the fix; all 40 pass now.
- Full parser coverage: 1,036 passing tests, with one existing opt-in fuzz skip.
- Focused ESLint and the maintained build passed (23 workspace tasks and four
  fresh-import checks).
- Built parser comparisons passed all 40 cases on both Node 18.18 and Node 24.14.
- The existing dynamic-import tests remain unchanged; the new cases live in a
  separate dynamic-static-import test file.
