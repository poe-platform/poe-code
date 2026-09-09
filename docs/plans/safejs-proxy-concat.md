# Concat spreading through wrapped arrays

At 7ff717587, six of ten native comparisons failed (10029). Concat tested
native Array.isArray on a Proxy carrier after reading isConcatSpreadable, so
wrapped arrays defaulted to single result entries instead of spreading.

Use sandboxIsArray only when the spreadability override is undefined. Preserve
flag reads before identity checks and length/has/get operations. Existing species
selection and result-definition paths remain in use.

Coverage includes receiver and argument positions, holes, nested wrappers,
subclasses, generic objects, explicit true/false overrides, complete trap traces,
mutation during flag reads, and throwing getters. Additional revocation cases
verify that undefined triggers the revoked-array error while false bypasses the
array-identity operation and keeps the Proxy as a single entry.

Verification: 342 tests across five Proxy/species/receiver files passed (38358).
Expanded twelve concat cases plus the ordinary array suite passed 32 tests
(23119). TypeScript and scoped lint passed; both command chains completed
successfully.

Wrapped-array flattening, public/callable Proxy construction and Proxy checkpoint
graphs remain pending. No full-package, remote-delivery or release claim.
