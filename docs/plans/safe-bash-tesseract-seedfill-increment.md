# Tesseract binary seed-fill increment

This increment implements complete binary reconstruction in the private command
workspace and exposes it through the existing safe-bash composition export.
The package pattern was read at its current archived path; the deleted original
was not restored. No runtime dependency, recognition asset or fallback was added.

## Acceptance matrix

| Cell | State | Evidence |
| --- | --- | --- |
| 9×9 diagonal, seed (0,0), connectivity 4/8 | Implemented; review pending | Original memory controls expect one/nine pixels |
| Serpentine widths 9/33/65/129, heights 21/81/161/321, both connectivities | Implemented; intentional native correction, review pending | Every connected mask pixel reconstructed; native partial-fill cases remain documented in supplied research |
| Empty seed / seed outside mask | Implemented; review pending | Empty result, clipping controls |
| Budget exhaustion / cancellation / cleanup | Implemented; review pending | Owned reservations rolled back; no partial result |
| Other morphology, Sauvola, adaptive Otsu, rule removal | Open | No implementation qualification claimed |
| Model loading/tensors/CTC/dictionaries/recognition/confidence | Open | Existing model inspector is container inspection only |
| Script/language and individual PSM profiles | Open | No OCR command or CLI/SDK recognition equivalence claimed |
| Image codecs / PDF rasterization / searchable PDF | Open | Separately qualified engines and writer required |

## Resource and ownership review

Inputs are synchronously borrowed decoded binary planes, never host paths or
streams. Caller retains and accounts both input backing stores, including unused
subarray capacity; this function does not allocate encoded input or decode images.
It reserves N output pixels, N output bytes and 5N retained bytes before allocation:
N bytes for output and 4N for a Uint32 queue. Queue capacity is N because every
pixel is marked before enqueue and enqueued at most once. Maximum N is checked
below the Uint32 index limit. There is no recursion or dynamic graph allocation.

Two validation traversals charge 2N work before inspection; initialization charges
N; each reconstructed pixel charges nine neighbor attempts, including skipped
or out-of-bounds attempts. Worst-case work is 12N, with inspection limits checked
independently. Budget and explicit-signal cancellation checks run on initialization
and every neighbor attempt; raster validation has its existing 65,536-step bound.
Synchronous code cannot receive event-loop aborts during a call. Stage boundaries
remain necessary for asynchronous cancellation.

The queue reservation is released before returning. Output reservations remain
until idempotent dispose or invocation close; disposing relinquishes caller use
of the plane, it does not erase bytes. Errors release only this call's reservations,
leaving cumulative work charged. Shared input planes are neither modified nor
disposed. No sidecars, VFS writes, network, native/WASM execution or LLM calls occur.

## Verification receipt

The initial memory test failed on the missing public export; existing 19 tests
passed. Final maintained workspace unit route passes 26 tests. Workspace lint,
production/test typechecks and selected maintained workspace build pass.
The isolated artifact control removes the source workspace then exercises the
public seed-fill export and resolves its strict NodeNext declaration. No command
handler or visible CLI output changed, so screenshots are not applicable.
No commit, remote-main delivery, release or package publication was performed.
