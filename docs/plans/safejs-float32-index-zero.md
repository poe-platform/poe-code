# Float32 indexOf positive-zero results

While validating lastIndexOf, a native/built-SDK probe showed indexOf returning
negative zero for a match at index zero when fromIndex was -0.5. Native returned
positive zero. Three regression tests (-0, -0.5, -Number.MIN_VALUE) failed before
the fix; the existing 17 indexOf tests passed. RED evidence:
`/tmp/poe-safejs-float32-index-zero-red.log` (1.64 seconds).

Canonicalize the returned index by adding zero. Search behavior and argument
conversion remain unchanged. Keep this correction separate from the pending
lastIndexOf implementation. Add a negative-zero assertion to the existing
indexOf harness and rerun its screenshot check.

All 37 indexOf/includes tests pass (1.61 seconds), including the three new
regressions. TypeScript and scoped ESLint pass. This is a targeted search-method
check, not a full-suite claim; the newly validated lastIndexOf tests remain RED
until that separate feature is implemented. No matching open issue was found.

The updated real harness passed after 70 uncached build tasks (61.204 seconds),
and its screenshot was inspected. The built SDK also passed all three
positive-zero result checks on Node 18.18.0.
