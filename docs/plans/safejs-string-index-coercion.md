# String index search coercion

## Validation

Native-comparison tests in the unchanged runtime found 16 failures among 26
cases for indexOf and lastIndexOf (386b71). Symbol searches returned -1 instead
of throwing. Guest search/position conversion hooks were skipped or produced
unrelated errors; valid callable search objects and ignored extra arguments
were rejected.

## Repair

The existing string-search helper now also handles these two methods, sharing
guest ToString and numeric position conversion while deliberately skipping
IsRegExp and Symbol.match access. Native matching happens only after guest
conversion. Primitive-only direct calls remain synchronous. In particular,
lastIndexOf retains its distinct NaN/undefined position handling rather than
reusing indexOf's position normalization.

## Checks

The initial expanded selection passed 118 tests across the new index regression,
predicate search regression and existing string-method suite (e95d91).
RegExp search values are stringified, not rejected. Added direct-context-free
calls and pending/completed checkpoint tests check both index methods with NaN
positions. This is focused evidence, not full JavaScript conformance.
The final selection passed 122 tests in three files (58170e), including all
32 index regressions. Targeted lint and package TypeScript checks passed
(a3d1ee); the final expanded regression file was linted again.

No push or release was performed. The preceding full-package result predates
this repair, and its ISO/Temporal and Promise admission failures remain open.
