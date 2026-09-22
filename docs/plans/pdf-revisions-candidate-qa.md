# PDF revision candidate manual QA

Scope: the private byte/object SDK only; no dependent command or extraction gate.
Use original in-memory PDF bytes. Do not use a native oracle or acquire PDF files.

1. Run `npm test --workspace=pdf-parser`,
   `npm run lint --workspace=pdf-parser` and
   `npm run build:workspaces -- --workspace=pdf-parser`.
2. Load the built `index.js`, `syntax.js` and `revisions.js` in a fresh Node VM
   module realm. The QA loader may explicitly read these first-party sources;
   refuse every other module import. Give the parser no filesystem, network,
   process, Buffer, require or fetch capability. This is a Node-hosted realm
   check, not actual browser/workerd qualification.
3. Pass an original classic-xref byte fixture across the realm boundary. Check
   the raw string object, repeat from two byte chunks, and mutate returned bytes
   to verify subsequent reads retain the original bytes.
4. Reject a non-byte view and an out-of-range reference. Check a one-unit work
   budget remains fatal with recovery requested. Abort with an explicit falsey
   reason and require exact reason propagation.
5. Review the unit cases for revision-local indirect xref lengths: newer length
   replacement, mismatch, reference cycle, generation mismatch, huge Size,
   zero-width layout, all chunk splits and quota failures. Review independent
   object-stream negative cases, including index mismatch and overlap.
6. Inspect built imports and the manifest: all runtime imports must be relative
   first-party modules and runtime dependencies must remain empty. Record the
   SHA-256 of the three runtime source files for the candidate receipt.

CLI/SDK parity and screenshots: no CLI option, command export, registration or
visible behavior changes. Dependent command installed-artifact integration,
original/checkpoint/replay execution, actual browser/workerd runtimes,
linearization hints and full PDF 2.0 structures remain unverified. No broad gate
is inferred from focused package checks. Keep the qualification receipt draft.
