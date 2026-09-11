# Legacy String HTML methods

Validate the thirteen missing Annex B String HTML methods against native Node
and the [CreateHTML specification](https://tc39.es/ecma262/multipage/additional-ecmascript-features-for-web-browsers.html#sec-createhtml).
Cover exact tags and quote-only attribute escaping, generic receiver conversion,
receiver-before-argument order, ignored arguments, descriptors, symbol rejection,
fatal resource budgets, intermediate retention, and checkpoint replay.

Implement through the existing guest String method registration and coercion
paths. These methods produce strings only; they do not introduce browser or DOM
capabilities. Run focused String regressions, lint, the maintained SafeJS build,
and built Node 18/24 differential checks before an atomic commit and main push.
Weak-collection work remains separate and must not be included in this commit.

## Validation

Before implementation, 25 of 29 new tests failed because the methods were
absent. The guest implementation uses one declarative tag/attribute table,
existing receiver coercion, retained receiver text during attribute coercion,
quote-only escaping without regexes, and work/output limits.

All 444 tests in eight focused String files pass. The maintained workspace build
passes all 23 selected builds and four fresh-process import checks. Built-output
differential probes pass 325 exact results each on Node 18.18.0 and Node 24.14.0,
covering all thirteen methods, empty strings, markup characters, quotes, NUL,
astral characters, and lone surrogates. A lint-reported unnecessary escape in
the test source builder was replaced with JSON string serialization; all 29
new tests pass again. Final focused lint passes. No matching open GitHub issue
was found for this feature. These checks do not claim full JavaScript conformance.
