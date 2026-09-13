# PPTX batch CLI preflight regression

## Scope and ownership

Adapter worker owns the new `packages/safe-bash/tests/commands/pptx/batch-preflight.test.ts`
and this procedure. Root owns domain validation, integration registration and commits.
No README, fixture downloads, whole pipeline, push or release is part of this work.

## Contract and research

Apply `docs/specs/pptx.md` sections 7–8, `docs/specs/office-cli.md` sections 6–8
and `docs/specs/office-sdk.md`. All syntax must fail before document admission;
semantic validation proceeds in order without publication on failure.

Consulted `docs/pptx/upstream-test-audit.md`, `upstream-test-inventory.json`,
`upstream-api-audit.md`, `upstream-api-inventory.json` and `corpus-manifest.json`.
These cases supplement the original command/capability contract, not source
public API parity. The source inventory has three video-timing insertion cases;
they concern movie shape creation and are not equivalent to transaction preflight.
No source parameter case or BDD scenario is claimed adapted by this change.
No source implementation, external fixture or derived substantial material is copied.
Existing standalone notices remain unchanged. Whole API and test accounting remain
separate outstanding obligations; this bounded regression adds no model API.

## Original cases and manual procedure

1. Execute a batch containing a valid add followed by a malformed target string
   against a missing input. Assert usage exit 2, failed JSON with zero affected
   objects, zero document reads and no created files.
2. Stage a valid add before a later missing selection. Check in-place and forced
   existing destinations both retain their exact bytes with zero conditional writes.
3. Use a location from a differently authored snapshot in the second operation.
   Assert stale-selection and no publication.
4. Cancel an admitted input stream after its first chunk. The host Shell API
   rejects with the caller's exact reason; neither source nor destination changes.
5. Run the same two-operation dry-run twice. Compare exact JSON, ordered add/set
   effects and empty outputs. Publish twice to distinct paths, compare archive
   bytes, and independently inspect the final animation target and diagnostics.

All assets are original, authored in memory using memfs. Existing timer mocking
replaces zero-delay cooperative waits only, preserving yield boundaries.

## Evidence

Initial focused run: `node --import tsx --test packages/safe-bash/tests/commands/pptx/batch-preflight.test.ts`.
The malformed later target returned exit 3 / io-failure from the missing document
instead of exit 2, validating the preflight defect before the domain fix. The other
three then-present cases passed. Cancellation was added afterward.

After root rebuilt the selected `pptx` workspace, the same public-import command
passed all five tests (zero failures/skips, approximately 0.93 seconds of test
bodies and 1.97 seconds including startup). The root coordinates maintained lint
and domain checks separately. This test-only adapter change does not alter visual
CLI output.

The maintained safe-bash `discoverTests` function automatically includes the new
file through `tests/**/*.test.ts`. Its scoped policy additionally requires an
exact literal assertion in `scripts/integration-inputs.test.mjs`; root owns that
narrow registration because the file contains unrelated existing work.
