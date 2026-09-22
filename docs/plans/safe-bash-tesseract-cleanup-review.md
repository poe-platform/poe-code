# Tesseract invocation cleanup review

Reviewed the existing private command workspace, CLI/SDK execution path, byte
admission, model container inspection, budget contracts, safe-bash composition
export and isolated artifact consumer test on September 20, 2026. The requested
package-pattern document has been moved to
`archive/safe-bash-command-package-pattern.md`; that existing move was preserved.

## Validated correction

Byte admission previously returned success if cancellation arrived while awaiting
the owned iterator's `return()`. A memory-only regression test failed with
“Missing expected rejection.” Admission now checks cancellation after successful
cleanup, before returning bytes. Cleanup still runs once, and existing read and
cleanup failures retain their original precedence and aggregation.

## Verification

- All 50 command workspace unit tests pass.
- Workspace ESLint and production/test TypeScript checks pass.
- The focused `scripts/package-safe.test.ts` tesseract artifact control passes:
  bundled implementation and strict declarations work without its private
  workspace; command/SDK help/version execution and runtime identity work.
- This correction changes no visual CLI output, persisted format or default
  registration. No screenshot was needed for the internal admission change.
- No commit, push, release or package publication was performed.

## Unresolved completion blocker

The actual command and SDK exist, but recognition returns status 1 with an
explicit unavailable-engine diagnostic. Raster decoding/normalization, deskew,
segmentation, approved model admission/loading, tensor inference, recoded
dictionary beams and image-backed renderers remain unavailable. Native image
failure status 2, image-list/TIFF processing and renderer partial-output semantics
therefore remain unimplemented. Existing primitive and container tests cannot
qualify those features. This blocks completion of the full requested task.

No host executable, network access, native/WASM runtime or model download was
introduced. Unrelated contributor edits were preserved. Pending source I/O still
requires a cooperative source honoring the supplied signal, as documented by the
byte admission API.
