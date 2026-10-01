# safe-bash-command-bc

Evaluate decimal arithmetic with `bc` inside `@poe-platform/safe-bash`.
Input, output, work, scale, exponent and recursion limits default to `Infinity`. Configure finite
`maxInputBytes`, `maxOutputBytes`, `maxSteps`, `maxScale`, `maxExponent` or
`maxRecursionDepth` values when needed, either directly in command options or under `limits`;
explicit `Infinity` disables an individual quota. `maxExponent` bounds the absolute integer exponent; `maxRecursionDepth` bounds active user-function calls.
