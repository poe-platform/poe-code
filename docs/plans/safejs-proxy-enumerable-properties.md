# Proxy enumerable own properties

Twenty-one native comparisons failed before implementation (42736): Object.keys,
values and entries inspect the carrier rather than invoking Proxy operations.
The ordinary enumerability-mutation bug discovered alongside this is already
fixed separately in a822ca7ef.

Use a common enumerable-own-properties operation with key/value/key+value modes.
Capture ownKeys once, skip symbols before descriptor queries, check each current
descriptor, and read values only for enumerable entries in the value modes.
Preserve key order, target forwarding, getter effects and abrupt completion.
Retain source, keys and accumulated results across guest calls, with cleanup on
all exits. Preserve the ordinary and host-capability paths.

Reference: [ECMA-262 EnumerableOwnProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-enumerableownproperties).

Verification: 124 tests across five files, TypeScript and scoped lint passed
(33467). Expanded revocation and partial-result retention tests passed with
reflection/symbol regressions: 67 tests across four files and final test lint
(62572). The complete current internal guest-proxy filename selection passed
317 tests across 20 files (77299); this excludes the still-unimplemented public
Proxy global tests. Public construction, other enumeration consumers and
snapshot integration remain incomplete; no release or full conformance claim.
