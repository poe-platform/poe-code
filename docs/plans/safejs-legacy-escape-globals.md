# Legacy escape and unescape globals

The current global binding construction omits both Annex B string conversion
functions. Extending the existing URI conversion suite before implementation
produced 37 failures and 76 passes, confirming missing calls, coercion, metadata,
checkpoint identity, work accounting and expansion checks.

Reuse the existing guest string-coercion and budget wrapper with captured host
escape/unescape functions. Native code receives only converted primitive text,
never guest objects. These are legacy code-unit conversions, not UTF-8 URI
encoding: preserve Latin-1 escapes, UTF-16 surrogate units, lowercase hexadecimal
input, malformed escape text, and single-pass decoding.

Source: ECMAScript Annex B.2.1
https://tc39.es/ecma262/multipage/additional-ecmascript-features-for-web-browsers.html#sec-escape-string

The original URI tests remain enabled. Two historical checkpoint comparisons
then failed only because their explicitly enumerated intrinsic additions lacked
escape/unescape; add those exact entries without modifying the historical
fixtures or graph comparison helper. Validate focused tests, lint, maintained
build and built Node 18/24 behavior before a separate commit and push to main.
The camera timeout and other JavaScript gaps remain open work.

Verification completed: 157 tests pass with one existing skip; focused lint
passes. The maintained build passes its 23-workspace closure and four fresh
imports. Built Node 18.18.0 and Node 24.14.0 each compare encoding and round-trip
decoding for every one of the 65,536 UTF-16 code units in 1,024-unit chunks.
All comparisons pass, including lone surrogates. No matching open GitHub issue
was found. User staged changes retain their original zero-context patch ID.
