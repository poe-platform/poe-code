# Object own-key lists for Proxy objects

Six native-JavaScript comparisons failed on e7b9fda8f (session 74842):
Object.getOwnPropertyNames and Object.getOwnPropertySymbols inspected the empty
carrier instead of invoking ownKeys or forwarding to the target.

Route Proxy inputs through sandboxOwnKeys, then filter by key type. Preserve
trap order and symbol identity; do not query descriptors or values. Validate
the complete trap result before filtering. Keep ordinary reflection unchanged.

Reference: [ECMA-262 Object reflection](https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.getownpropertynames).

Verification: 41 tests in three files, TypeScript and scoped lint passed
(77293). An additional 41 tests in the ordinary object-array and symbol
descriptor suites passed (20508). Descriptor enumeration and other object enumeration
consumers remain separate integration work. No publication or full conformance
claim.
