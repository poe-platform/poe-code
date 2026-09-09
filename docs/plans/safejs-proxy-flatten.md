# Flatten wrapped nested arrays

At 79e4571c7, ten of twelve native comparisons failed (28899). Flat/flatMap
tested native Array.isArray on internal Proxy carriers and returned wrapped
arrays as individual elements, skipping required reads and failures.

Use sandboxIsArray for flattening decisions. Ordinary arrays keep their existing
path; wrapped arrays use the array-like view to snapshot length and dispatch
has/get operations. Flat checks identity only at positive depth. FlatMap flattens
one level. Neither method consults Symbol.isConcatSpreadable.

Retain mapped values and recursive source/entry values across length reads,
element access and result definitions, releasing roots in finally blocks.

Native comparisons cover holes, nested wrappers, depth zero/one/two/Infinity,
generic non-arrays, ignored spreadability flags, trap order, length mutation,
and errors. Additional tests check retained receivers during failing traps,
cleanup, and revoked arrays at zero versus positive depth.

Verification: 269 tests across Proxy flattening, species and nested-read suites
passed, with package TypeScript and scoped lint (23724). The expanded 16-case
flattening file and maintained array suites passed 742 tests across 11 files
(47214); final test-file lint and diff checks also passed.

Public/callable Proxy construction, Proxy checkpoint graphs, other intrinsic
consumers and a fresh integrated package gate remain pending. This is not a
full-conformance or delivery claim. No push or release.
