# Object.assign Proxy sources

Seven native comparisons failed on c156b9edf (29835). Object.assign enumerated
the empty Proxy carrier, ignoring source keys, descriptors and values.

Capture each source's ownKeys once; for every string or symbol key, read its
current descriptor, get the value if enumerable, and finish the target set before
moving to the next key. Preserve identity, source order, setter effects, abrupt
completion and strict assignment failure. Retain key lists and the current value
across guest calls. Keep ordinary host-capability behavior unchanged. Route direct
internal calls involving Proxy objects through the asynchronous operation too.

Reference: [ECMA-262 Object.assign](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.assign).

Verification: 47 tests across four files, TypeScript and scoped lint passed
(73273). Expanded direct revocation and retention/failure tests plus named/indexed
host-object regressions passed 87 tests across three files and final test lint
(37453). Spread/rest and other Proxy consumers remain follow-up
work; no full conformance or publication claim.
