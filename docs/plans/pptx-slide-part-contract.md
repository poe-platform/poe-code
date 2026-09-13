# Slide part ownership contract

Scope: inherited public `Slide.part`, shared SDK bounded package-view contract.

1. Reproduce absent `Slide.part` with original public-export tests.
2. Return the existing owned `PartView`, validating owner liveness first; reject
   detached access with the existing neutral property error.
3. Verify synchronous identity, live renamed slide bytes, copied byte ownership,
   save/reopen, and memfs-backed `xml get --scope slides --part URI --json` parity.
4. Run focused regressions and maintained package lint; report evidence separately
   from full API coverage. No runtime host I/O, network, external binaries or README edits.

Agent QA: inspect the source-level getter and original fixture ownership; execute
focused tests and the maintained package lint command. No CLI presentation change
is introduced, so this read-only JSON route does not require a visual CLI change.

Progress: original tests failed before implementation because `.part` was
undefined; after implementation both tests pass. Focused tests (2), scoped ESLint and production TypeScript checks pass.
The package-wide lint baseline passed before new parallel tests; final combined
verification is tracked in pptx-public-closure-verification.md.
