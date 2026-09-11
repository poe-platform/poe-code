# Ignored string-method arguments

## Validation

The unchanged runtime failed 14 of 28 native-comparison cases (827b61).
toLowerCase, toUpperCase, trim, trimStart, trimEnd and the trimLeft/trimRight
aliases rejected otherwise ignored function arguments. Fourteen controls with
Symbol or throwing-conversion objects already passed. Evaluated argument
expressions correctly preceded receiver conversion even in the failing cases.

## Repair

Removed the blanket closure-argument rejection before the remaining string
method switch. No-argument methods now ignore supplied values without coercing
them. Caller-side argument evaluation is unchanged. Concat object and guest
closure arguments already take the separate guest-conversion path before this
switch; its focused suite is included to check this boundary.

The new regressions plus existing string, concat and receiver tests passed
348 tests in four files (fce8b3). Targeted ESLint and package TypeScript checks
passed (c4e514).

No snapshot format, Unicode case-conversion algorithm, trim algorithm or CLI
visual behavior changed. No push or release was performed. The previous
full-package result predates this repair and its 14 failures remain unresolved.
