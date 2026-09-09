# Recheck enumerability during Object values and entries

Two native comparisons failed on c74a46c78 (14829): a getter made a later,
existing non-enumerable property enumerable, but Object.values and Object.entries
omitted it. The iterator prematurely filtered its initial key list.

Capture all own string keys before reading values, then check each property's
current enumerability. Keep newly added keys excluded. Add controls for hiding,
deleting, and adding keys, including symbols.

Reference: [ECMA-262 EnumerableOwnProperties](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-enumerableownproperties).

The isolated regression file reproduced two failures with eight passing controls
(82222). After the fix, 66 tests across four files, TypeScript and scoped lint
passed (20253). A further 78 named/indexed host-object tests passed (27744);
the host-capability key path is preserved. The 15 separately reproduced Proxy enumeration failures
remain follow-up work; they are not resolved by this ordinary-object correction.
