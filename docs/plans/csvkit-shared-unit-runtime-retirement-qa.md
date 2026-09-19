# Shared unit runtime retirement QA

Investigate runtime retirement when the maintained root unit route reports
timeouts in codec or session tests. Preserve every frozen oracle and assertion; do not raise the
timeout, quarantine cases, reuse interpreter state, or count an unmeasured
runtime as passing.

1. Run the four affected test files uncached under the root Vitest configuration.
   Avoid running competing interpreter, lint, build, or broad test tasks.
2. Inspect `RuntimeNativeClassSlots`: each registry owns native-class descendant
   WeakRefs whose targets remain alive through the current event-loop job.
   Assess ownership and event-loop lifetimes before proposing a change.
3. Rerun affected files after any validated ownership or speed change.
   Require all exact outputs, error fields, opaque state, and guest
   behavior assertions unchanged. Keep each fixture interpreter independent.
4. Run scoped ESLint, then let the integration owner rerun the maintained root
   unit task. Only the complete maintained rerun can verify timeout clearance.

Record source findings and measurement results in
`docs/csvkit/shared-unit-runtime-retirement-validation.md`; keep this document
limited to the investigation procedure.
