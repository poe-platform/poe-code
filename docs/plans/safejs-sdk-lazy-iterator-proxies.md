# SDK lazy iterator Proxy operations

Eighteen native-comparison cases failed across map, filter, take, drop, and
flatMap. Proxy receivers hid next, Proxy methods/callbacks lacked guest context,
and Proxy result fields caused wrong values or excess advancement. Bounded
iterators reject unexpected advancement rather than hanging the test.

Provide a guest property/invocation context at helper creation and at each
next/return call. Preserve supplied hooks and newTarget. Replace descriptor-only
reads for outer/inner methods and result fields; preserve helper state,
reentrancy guards, retention, and completion behavior.

Two additional native trace comparisons verify flatMap return before advancement
and after an inner iterator becomes active, including Proxy return methods and
inner-before-outer closing with original receivers. All 20 focused tests passed.
The broader iterator/iteration/generator selection passed 1,642 tests across
65 files. Scoped ESLint and package TypeScript passed. The maintained selected
workspace build passed 23 declared builds and four fresh-process import checks.
This is scoped verification, not a new full-package or conformance gate.

README updated. No CLI presentation changes. Pushes and releases remain paused.
