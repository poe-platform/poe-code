# PPTX integration fixture input types

The maintained virtual-bash TypeScript check reported six fixture assignment
errors because Maps inferred `Uint8Array<ArrayBuffer>` from archive inspection,
while XML serialization returns the public `Uint8Array` type. Two subsequent
view-properties assertions also lacked explicit non-null evidence.

Use `Map<string, Uint8Array>` for the three original fixture part inventories in
the notes and modern-comments integration tests. Assert that print and view
properties exist before inspecting their contents. Preserve the exact fixture
bytes and existing content assertions; no product behavior changes.

Validation: execute both affected memfs test files and rerun the maintained
virtual-bash typecheck. Root coordinates the separate atomic commit. No push or
release is authorized.

Executed evidence: both affected original memfs test files passed all 15 tests
in 1.66 seconds. The maintained `npm run typecheck --workspace=virtual-bash`
then passed source/tests and all 26 current consumer groups, including the
expected negative compile cases. This is compile evidence, not runtime coverage
for those consumer groups.

The two affected test files passed all 15 original cases through
`node --import tsx --test` after these type-only changes. The maintained full
typecheck remains root-owned validation.
