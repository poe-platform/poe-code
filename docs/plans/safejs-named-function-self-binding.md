# Named function self-binding writes

Native execution confirmed that writes to a named function expression's
immutable self-binding silently fail in non-strict code, while strict callers
and ordinary const bindings still throw. Seven assignment/update/destructuring/
iteration regressions failed before repair; five strict/shadowing controls passed.

Preserve the binding's non-strict immutable-write behavior separately from
ordinary const. Pass the actual assignment context's strictness through binding
writes, including destructuring and updates, rather than inferring it from the
function that originally created the binding.

Capture the marker in scope cells and restore it. Validate that marked cells
are initialized const cells in a single-cell named-function wrapper scope,
referencing a guest closure that captures the same scope. Do not add the marker
to existing strict-only bindings or change historical checkpoint fixtures.

The initial runtime and scope tests passed 16 cases and TypeScript passed.
Runtime plus normal/async/generator recovery, strict nested callers and malformed
snapshot checks passed 21 tests. The first malformed-snapshot tests captured a
completed run that no longer retained the closure; they were corrected to
capture it at an actual suspension and now validate the marked cells.

A broader seven-file run passed 660 tests and failed two: an existing
destructuring error-message assertion and a large-array spread timeout.
The original message has been restored without weakening its assertion; the
spread deadline remains unchanged. Its isolated rerun also timed out at 5,000ms
(10.62 seconds reported test time); this is a reproduced remaining performance
failure, not a passing or dismissed check. Final self-binding/pattern tests
passed all 31 cases and TypeScript passed. Eight-file focused lint passed;
the two files touched by the final error-message correction are being rechecked.
These changes
remain outside the frozen full-integration candidate and are not committed or
published. Pushes and releases remain held.
