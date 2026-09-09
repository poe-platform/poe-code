# SDK eager iterator consumers

Twenty-three native-comparison tests failed before changes across toArray,
reduce, forEach, some, every, and find. Proxy receivers hid next; Proxy methods
and callbacks lacked guest context; Proxy result fields were missed, producing
wrong results or extra next calls. Bounded test iterators throw on unexpected
extra advancement so a missed done field cannot produce an unbounded test.

Install a fallback guest-property/invocation context for each consumer call,
preserve caller hooks/newTarget, and replace descriptor-only reads. Keep existing
iteration, callback, accumulator, retention, and closing behavior.

Five additional native trace comparisons cover early return for some/every/find
and callback errors for forEach/reduce. Their return methods are Proxies and
assert original iterator receiver identity. All 28 focused cases passed. The
broader iterator/iteration/generator selection passed 1,622 tests across 64 files.
Scoped ESLint and package TypeScript passed. The maintained selected-workspace
build passed all 23 declared builds and four fresh-process import checks. This
is scoped verification, not a new full-package or JavaScript conformance gate.

README updated. No CLI presentation changes. No push or release during the hold.
