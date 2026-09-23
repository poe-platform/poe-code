# Deferred DOCX acceptance work

This is a backlog, not an executable pipeline. The user deferred the broad audit.
The [specification](../specs/docx.md) remains proposed, and focused passing tests
do not establish complete feature-family acceptance.

- Review, controls, properties, settings, and signatures: finish the remaining
  native variants, ownership boundaries, and cross-family interactions.
- Images, graphics, and embedded resources: qualify remaining required variants;
  floating-image insertion remains an explicitly unsupported operation.
- Removal, sanitization, comparison, validation, extraction, and packing: complete
  the outstanding preservation, admission, and publication cases.
- OPC/XML, text/styles, and tables: reconcile remaining public behavior with the
  contract and encode individual cases in original in-memory unit tests.
- Public API and SDK/CLI parity: verify the remaining types, operation arguments,
  returned identities, and error behavior using maintained consumer tests.
- Lifecycle and limits: qualify malformed input, cancellation, resource bounds,
  rollback, and unchanged destinations across the remaining operation families.
- Interoperability: perform separately scheduled schema and repair-free rendering
  checks, including large, dense, and multilingual documents.
- Packaging and release: verify explicit opt-in, packed consumers, and required
  CI checks before making any claim of complete DOCX availability or acceptance.

For each new task, select a concrete behavior, reproduce a defect before changing
code, and retain the smallest useful regression in the unit suite. Keep this list
short. Do not restore campaign ledgers, test-result dumps, or per-run documents.
See the [test index](../docx/acceptance-matrix.md) for maintained regression entrypoints.
