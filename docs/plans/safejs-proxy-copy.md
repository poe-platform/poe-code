# Proxy object spread and rest

Twenty-two native comparisons failed on dc629246e (95344). Spread and rest
copied the empty carrier instead of invoking Proxy ownKeys and descriptor traps.

Dispatch through internal ownKeys and getOwnPropertyDescriptor operations, then
read only enumerable values. Retain source, key list and copied values during
guest calls. For rest, skip excluded string/symbol keys before descriptor queries.
Preserve getter effects, key order, public symbols and __proto__ data properties.
Keep ordinary/host paths and the existing pattern-context fallback conventions.

Verification: 72 tests across five files, TypeScript and scoped lint passed
(97787). Expanded revocation/retention cases and pattern/rest/spread/host
regressions passed 132 tests across six files plus final test lint (7689).
The full current internal guest-proxy filename selection passed 357 tests across
22 files (3964), excluding the still-unimplemented public Proxy global tests.
Public Proxy construction, callable identity, snapshots,
for-in and other remaining consumers are not covered by this change.
