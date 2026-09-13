# Connector and group model work

Own connector model and original tests; coordinate live collection/group integration with slide graph owner.

1. Reproduce disconnected connector mutations using an in-memory XML owner.
2. Add synchronous owner-backed connector reads/writes and binding safety tests.
3. Implement group child view integration with the shared slide collection.
4. Run focused tests and maintained package checks; commit explicitly owned files locally.

QA uses original in-memory drawings. No downloaded inputs, host I/O, native runtime, or network capabilities are needed.

Implemented shared Shape/Connector owners and generic GroupShape child collection injection. Original owner regression failed before changes; focused connector/public-group tests pass (18 tests). The parent owns final maintained package lint/test execution and serialized commit staging because shared Shape integration also adds adjustments. Early concurrent package checks observed in-progress sibling changes and are not counted as green verification.

Follow-on CLI work adds explicit `--slide N --placeholder IDX` to images/tables/charts add. Use the model insertion methods through a typed domain helper, validate closed options before opening input, reject geometry overrides, preserve sparse idx and shape ID, and retain existing publication/JSON contracts. Original memfs tests cover all three insertions plus schema acceptance/rejection. Full suite and visual help QA remain parent-owned.

Independent review reproduced live connector subtree identity rejection, table placeholder row-height drift, missing ancestor group bounds, and discarded group rotation. Added original synchronous regression tests. Connector fix uses an internal trusted owner-token map; slide model owner implements table/group fixes. Parent reruns maintained checks after these repairs.
