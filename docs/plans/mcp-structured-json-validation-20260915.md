# Validate structured MCP results before serialization

The audit reproduced six unsafe structured-result cases: legacy envelopes accepted nested NaN, Infinity, BigInt, and undefined; both eras accepted hidden toJSON hooks that could change the wire value after validation. BigInt/cycles can break framing, and coercions or hooks can invalidate the declared output schema.

Use a shared JSON-value guard for structured content, preserving legacy object-root envelopes. Reject nonfinite/non-JSON values, cycles, accessors, custom prototypes, and hidden serialization hooks without executing them. Bound traversal to 64 levels and 10,000 nodes. Shared references remain valid; each occurrence counts toward the traversal budget. No new public config, dependencies, or README additions are introduced.

All six regressions failed before the fix. The legacy coverage now lives in structured-content-validation.test.ts so this correction is independently commit-ready; the modern hook case stays with the unfinished modern result migration. The legacy positive case verifies nested null/fractional/array values and shared references. The focused legacy/modern/protocol-feature suites pass 67 tests. The broader MRTR/modern-results/protocol-feature suites passed 114 cases before splitting coverage. Focused ESLint and the maintained seven-build HTTP closure pass.

Stage only the shared guard, legacy test, legacy server guard hunks, and this plan. The modern discriminator, result type widening, output schema changes, and lifecycle changes remain in the worktree. This is an atomic serialization correctness fix, not a completed protocol migration. No push or release is performed.
