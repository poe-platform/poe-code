# Delete value expressions

Validate non-reference operands against native strict JavaScript, including
side effects, throwing getters, await and generator suspension. JavaScript
evaluates these operands and returns true; it does not delete a property reached
only as the value of a sequence expression.

Keep identifier-reference rules and actual member deletion separate. Preserve
abrupt completion and suspension from operand evaluation. Run the native
comparison tests, relevant unary/member regressions, lint and maintained build
before committing this improvement independently.

The 12 native value-expression cases all failed before implementation. They pass
after evaluating non-identifier/non-member operands and preserving abrupt
completion. Two controls verify that member deletion does not invoke a getter
and that nullish optional deletion returns true. Together with member-key and
primitive-symbol checks, 80 tests pass. The separate dynamic-assignment and
strict-delete grammar run passed 78 tests before adding the two controls.
Focused ESLint passes. The maintained build passes all 23 workspace builds and
four fresh-import checks. Built comparisons pass all 14 cases on Node 18.18 and
Node 24.14. No matching open GitHub issue was found for this gap.
