# safe-bash-command-bc

Evaluate decimal arithmetic with `bc` inside `@poe-platform/safe-bash`.
Input, output, work, scale, exponent, recursion and output-base limits default to `Infinity`. Configure finite
`maxInputBytes`, `maxOutputBytes`, `maxSteps`, `maxScale`, `maxExponent`,
`maxRecursionDepth` or `maxObase` values when needed, either directly in command options or under `limits`;
explicit `Infinity` disables an individual quota. `maxExponent` bounds the absolute integer exponent; `maxRecursionDepth` bounds active user-function calls. Output bases above 16 use space-separated decimal digits; `maxObase` bounds assigned output bases.

`maxOutputBytes` counts UTF-8 bytes across all standard output, including strings, `print`, and numeric results. Exceeding it stops evaluation before adding the overflowing text to the output buffer; the command returns an error without emitting buffered output.

Use `bc -l` for decimal sine, cosine, arctangent, logarithm, exponential and integer-order Bessel functions. Results truncate to `scale` (20 by default with `-l`), retaining decimal precision beyond JavaScript floating-point numbers.
