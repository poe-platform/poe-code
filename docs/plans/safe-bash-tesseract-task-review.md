# Tesseract engine contract review

Reviewed the command workspace's parser, contracts, budget, byte admission,
traineddata inspector, safe-bash re-export and isolated artifact consumer test.
The package remains private, TypeScript ESM and free of runtime dependencies.
Safe-bash exports the implementation without introducing engine logic.
No proxy-only functions, duplicate OCR engines or host I/O were found in the
reviewed implementation. No simplification was justified by the current tests.

## Validated correction

`createTesseractBudget.release('work', amount)` previously refunded consumed
algorithm work. Repeated charge/release cycles could exceed an invocation's CPU
work ceiling. An original memory-only regression test failed with “Missing
expected exception” before the fix. Work releases now fail with a structured
`limit` error for `work`, leaving its count intact. Memory release and `close()`
cleanup retain their existing behavior. The package README records this policy.

## Verification

- All 13 command workspace unit tests pass, including the failing-first control.
- Workspace lint and production/test TypeScript checks pass.
- The focused `scripts/package-safe.test.ts` tesseract consumer control passes:
  actual implementation is bundled, `/repo` is removed from memory VFS, runtime
  parser/error identity works, and strict NodeNext declarations resolve.
- No visual CLI behavior changed; no command handler is registered.
- No snapshot serialization or persisted model/version format changed.
- Unrelated contributor edits were preserved. No commit, push, release or
  publication was performed.

## Unresolved completion blocker

The exposed APIs are admission contracts and container inspection, not a working
OCR engine. Normalization, deskew, segmentation, recognition and PDF rasterization
remain explicitly unavailable. Model digest/notices admission, network loading,
native-compatible tensor math and recoded dictionary beam recognition remain
unimplemented and unqualified; source and tiny bitmap controls establish no
language-wide JS accuracy or measured CPU throughput. See
[engine design and evidence](safe-bash-tesseract-engine-contract.md).

The existing hey-boss alternative request
`remote-01789956614884358000-20090-00000000000000000000` was checked during this
review and remains `pending`. That status establishes neither confirmed delivery
nor approval. No duplicate request or dependency/WASM alternative was adopted.
An explicit decision and the relevant implementation/qualification are required
before claiming complete OCR delivery. Pending external I/O also requires the
supplied source capability to honor cancellation; checkpoints cannot cancel an
uncooperative iterator. The byte-admission API documents that obligation.
