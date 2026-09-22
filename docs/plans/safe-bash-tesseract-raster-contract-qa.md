# Tesseract raster contract QA

This increment validates supplied pixel planes; it does not implement OCR or
claim native rasterization, normalization, segmentation or recognition parity.
The existing parser, budgets, traineddata inspector and researched engine design
were preserved. The package-pattern instructions were read from their current
archived location; the deleted original was not restored.

## Manual steps

1. Run the command workspace's maintained unit route. Check tiny, blank and
   exact-limit planes; gray8 extremes; offset subarray storage; invalid binary
   pixels; truncated and oversized planes; unsafe dimensions; fractional and
   out-of-range DPI; each independent resource ceiling; and pre-cancellation.
2. Run workspace lint, production and test typechecks, and its selected maintained
   workspace build. No host executable, model, ambient file or external runtime
   is needed by this API or its tests.
3. Run the existing isolated tesseract artifact consumer control. It bundles
   actual source in memory, removes the source workspaces, imports the public
   safe-bash subpath and resolves strict NodeNext declarations.
4. Read the existing hey-boss decision status. Pending is neither delivery
   confirmation nor authorization. Do not adopt a dependency/WASM engine or ship
   research model assets without an explicit answer.

## Ownership and limits

Inspection borrows the caller's plane synchronously, copies no pixels and owns no
VFS, iterators or retained buffers requiring cleanup. The caller retains ownership
and must account the buffer capacity (including a larger subarray backing store)
within invocation retained-memory limits. Inspection is not model admission.
Work limits are per inspection, not a replacement for the cumulative invocation
budget; composition must charge `pixelCount` before invoking inspection.
Cancellation uses the explicit signal and checkpoints separated by at most
65,536 pixel-validation steps. Synchronous execution cannot receive an ordinary
event-loop abort mid-call; callers need stage boundaries for asynchronous aborts.

No CLI handler or visible CLI behavior changed, so screenshots and CLI/SDK
recognition equivalence are unsupported rather than passed. Native scalar/SIMD,
bitmap accuracy, raster/PDF decoding, model digest admission, tensor/beam/dictionary
execution and checkpoint/replay recognition remain unqualified. Research pins,
model size, proposed CPU/work budgets and unknown CER/WER remain in the existing
engine contract and research documents.

## Verification receipt

- Failing-first: the original raster test file failed because the public API did
  not exist; all 13 existing engine tests passed in that run.
- Final workspace unit route: 19 passed, zero failed or skipped. The additional
  independent negative control checks a bad final pixel beyond 65,536 steps and
  rejects array-shaped storage; valid offset views and gray8 extremes pass.
- Workspace ESLint and production/test TypeScript checks passed.
- Maintained selected command workspace build passed with a shared-cache miss
  and actual guarded compiler execution. No shared infrastructure changed.
- Isolated artifact consumer control passed; 155 other packaging tests were
  filtered out, not executed. No broad-suite completion is claimed.
- Existing hey-boss request
  `remote-01789956614884358000-20090-00000000000000000000` remains pending.
- No local commit, verified remote-main delivery, release or publication occurred.
  Unrelated edits were preserved; no generated evidence files were retained.
