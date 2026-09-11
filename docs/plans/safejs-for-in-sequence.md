# For-in right-hand comma expressions

Native Function accepts a full Expression after for-in, including unparenthesized
comma expressions. SafeJS stopped after the first assignment expression and
rejected the comma. Five native execution/parse cases failed before repair,
while five invalid-placement or parenthesized-for-of controls passed.

Enable the existing sequence-expression parser specifically for the for-in
right side. Keep the for-of AssignmentExpression grammar unchanged. Validate
side-effect ordering, final operand enumeration, conditional operands, and the
legacy initialized-var form.

All 41 focused tests across comma expressions, loop-variable conflicts and
legacy initializers passed. Broader parser/runtime and snapshot validation
passed 1,486 tests with one skip, including both suspended-generator comparisons.
TypeScript passed; final lint remains under verification.
The repair is local and outside the currently frozen full-integration candidate.
No publication is authorized while the release hold remains in effect.
