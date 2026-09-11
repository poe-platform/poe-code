# Post-catch/import integration qualification

## Full package run

Runtime 8cab804a9 includes the catch binding and import-attribute reflection
repairs. The maintained full package test in session 52427 is terminal
(be7bc0), report `/tmp/safejs-post-catch-import-integration-results.json`.
All 100 filesystem contracts passed (520959). Unit results: 28,379 passed,
14 failed, 47 skipped across 1,252 files (b17ffc). The failures are two host
Promise-property cases and twelve ISO locale cases, matching the previous
gate. No new failing tests appeared. This is not a passing full gate.
Runtime and test sources remained unchanged during this run; the error-cause
repair is subsequent work and is not covered by these totals.

## Enumeration audit

A 40-case probe covers functions, generators, Promises, regexes, Maps, Sets,
Dates and typed arrays, using Object.values/entries/assign, spread and rest.
Each has an earlier getter make a later non-enumerable property enumerable.
Thirty-seven native comparisons match. Three Promise-copy cases differ in
non-JSON symbol properties (6d93f8), not in the visible values or getter effects.

This is native-oracle contamination, not a validated guest defect. After a
SafeJS run, Node 22 native promises carry enumerable async-hook and
AsyncLocalStorage symbols; native assign copies those symbols. A fresh native
Node process and guest execution expose only the explicitly created string
keys (c4e9c7). The diagnostic printed key identities/descriptions, not private
store contents. Do not add host metadata to guest promises to match that oracle.
Three positive guest controls preserve an explicitly created enumerable
`Symbol("kResourceStore")` and its value through assign, spread and rest
(fec111). Symbol-description filtering would therefore reject valid guest data.

The separate host Promise property-admission policy remains unresolved; see
[its findings](safejs-host-promise-import-policy.md). These comparisons do not
justify changing the isolation boundary. No push or release is authorized.

## Error-order audit

Twenty-one public native comparisons for `in` and `instanceof` match (bb9edb),
covering invalid right operands, property-key conversion, Proxy has effects,
custom Symbol.hasInstance, primitive left operands and non-constructor arrows.

Eight WeakMap/WeakSet constructor cases with primitive iterator results also
match native TypeError/cleanup order (db5087). Although the collection loop
itself delegates result-property reads, `guestIterator` validates the result
object before returning it (0f085c). No additional close or validation patch is
justified by that source-level suspicion. Main integration remains running.

## Array length and Proxy order audit

Twenty-three public native comparisons match for object-valued array-like
length conversion and Proxy get/has/set/delete order (7faacc). The selection
covers at/includes/indexOf/lastIndexOf/slice/join, callback traversal and
reduction, concat, copyWithin/fill/reverse/sort/splice and push/pop/shift/unshift.
Return values were JSON-normalized and effects compared directly. This is a
bounded effects probe, not proof of complete array semantics or object identity.
No runtime change follows from this audit.
