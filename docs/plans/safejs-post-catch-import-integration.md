# Post-catch/import integration qualification

## Full package run

Runtime 8cab804a9 includes the catch binding and import-attribute reflection
repairs. The maintained full package test runs in session 52427, report
`/tmp/safejs-post-catch-import-integration-results.json`. All 100 filesystem
contracts passed (520959); unit tests are still running. Keep runtime and test
sources unchanged and poll this same handle until terminal. Do not infer
success from the earlier focused suites.

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
