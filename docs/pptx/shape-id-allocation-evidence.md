# Drawing identity behavior

`ShapeIdAllocator` is internal format-package machinery, not a new model API.
Drawing creation uses the maximum existing presentation nonvisual ID plus one;
when the maximum uint32 ID is occupied, allocation starts at the lowest free
positive ID. IDs include the drawing root and nested group descendants. Other
namespaces do not consume IDs. Separate slides have separate identity spaces.
Existing IDs must contain decimal digits, be uint32 and be numerically unique;
malformed or duplicate input fails with `OfficeError/invalid-opc` before mutation.
Leading zero spellings compare numerically. New IDs start at one.

`SlideShapes.turbo_add_enabled` retains its documented boolean spelling, defaults
to false and rejects nonbooleans with `TypeError/invalid-type`. The cache retains
reservations while its immutable owner XML is current. Any changed owner snapshot
forces revalidation, preventing an old handle from issuing an already-present ID.
This safety mapping intentionally avoids the documented multiple-wrapper collision
hazard. Owned appends validate only the new subtree and retain the resulting snapshot
cache; external edits force a full rescan. A performance guarantee is not asserted
by these correctness tests.

Original evidence: `shape-id.test.ts` tests every allocator property/method,
strict/transitional namespaces, nested IDs, sparse and exhausted ranges, duplicate
IDs, toggle/reset, independent handles and immutable input. `shape-id-insertion.test.ts`
uses memfs and the existing SDK engines to reproduce then fix image/table/chart/
connector gap reuse. Existing shape/path insertion follows the same policy.

Research mapping: the 14 retained `Describe_BaseShapes` turbo/next-ID variants in
`upstream-test-inventory.json` are covered by toggle/default/reservation and
maximum/fallback tests, with explicit validation added for sandbox-safe input.
[Exact case mapping](shape-id-case-map.json) distinguishes malformed/duplicate
ID tolerance as a deliberate security mapping. Pinned test-shapetree fixture
parameters at source lines 213–229 and 253–276 were explicitly reviewed.
Public inherited turbo obligations on notes/master/layout placeholder collections
remain visible in the global API inventory; this receipt does not mark absent
collection interfaces implemented. It does not claim whole-public-API coverage.
