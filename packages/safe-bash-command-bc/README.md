# safe-bash-command-bc

Evaluate decimal arithmetic with `bc` inside `@poe-platform/safe-bash`.
Input, output, work, scale, exponent, recursion and output-base limits default to `Infinity`. Configure finite
`maxInputBytes`, `maxOutputBytes`, `maxSteps`, `maxScale`, `maxExponent`,
`maxRecursionDepth` or `maxObase` values when needed, either directly in command options or under `limits`;
explicit `Infinity` disables an individual quota. `maxExponent` bounds the absolute integer exponent; `maxRecursionDepth` bounds active user-function calls. Output bases above 16 use space-separated decimal digits; `maxObase` bounds assigned output bases.

`maxOutputBytes` counts UTF-8 bytes across all standard output, including strings, `print`, numeric results, and line continuations. Exceeding it stops evaluation before adding the overflowing text to the output buffer; the command returns an error and emits the output already admitted within the limit. Output from earlier statements is also preserved when a later statement fails.

Cancellation rejects with the original abort reason instead of returning an error exit code or writing a diagnostic.

Use `bc -l` for decimal sine, cosine, arctangent, logarithm, exponential and integer-order Bessel functions. Results truncate to `scale` (20 by default with `-l`), using BigInt series with work-budget accounting and cooperative cancellation.

Numeric output wraps at 70 columns by default (69 characters followed by `\` and a newline). Set the command environment variable `BC_LINE_LENGTH` to another width, or `0` to disable wrapping. Strings remain unwrapped; numbers printed after strings continue at the current column.
