# safe-bash-command-bc

Evaluate decimal arithmetic with `bc` inside `@poe-platform/safe-bash`.
Input, output, work and scale limits default to `Infinity`. Configure finite
`maxInputBytes`, `maxOutputBytes`, `maxSteps` or `maxScale` values when needed;
explicit `Infinity` disables an individual quota.
