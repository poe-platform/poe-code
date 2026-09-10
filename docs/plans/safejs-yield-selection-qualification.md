# Yield selection qualification and integration

## Pinned upstream selection

Test262 revision 72faf8ec1445c55149615e8b35187830783aba1a contains 63 top-level
fixtures under test/language/expressions/yield. The post-classic-for strict
probe recorded 57 runtime passes, three correct parse rejections, two noStrict
exclusions and one failure (b63f4e). The failed rhs-omitted.js drove the separate
conditional-yield repair and then passed on native and guest (a6aa1c).

The two noStrict sources are now independently inspected and qualified:
formal-parameters-after-reassignment-non-strict.js and from-with.js both pass
in matched native and guest Function wrappers (cf1d7a). The source tests mapped
arguments and with lookup; neither relies on top-level Script this or global
var properties. Wrapping is an explicit harness adaptation, not an official
Test262 Script-mode result. No runtime change is justified by these two cases.

Across these recorded probes the selection has 58 strict runtime passes,
three parse rejections and two adapted non-strict passes. This aggregate spans
the initial selection and repaired/adapted reruns, not one fresh 63-case run.
It does not establish all generator, async, recovery or resource semantics.

## Fresh integration run

Runtime dfa158292 includes the Error cause reflection, classic-for In grammar
and omitted conditional-yield operand repairs. A new maintained package run
is active in session 5721:

`npm test --workspace=@poe-code/safe-js -- --reporter=json --outputFile=/tmp/safejs-post-generator-grammar-integration-results.json`

It is a new integration run after terminal session 52427, not a restart of a
quiet process. Keep runtime/test sources fixed for its duration and poll the
same handle until terminal. Only documentation may change meanwhile; new
implementation experiments belong in isolated copies. No success is claimed.

The previous completed full run remains 28,379 passed, 14 failed, 47 skipped
across 1,252 files, before these three runtime fixes. No push or release is
authorized while publication remains on hold.
