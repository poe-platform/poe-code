# Tesseract binary morphology increment

The task remains incomplete. This reviewed increment adds rectangular binary
dilation and erosion, not recognition. The package pattern was read at
`docs/plans/archive/safe-bash-command-package-pattern.md`; its deleted original
was not restored. All pre-existing contributor changes are preserved.

## Acceptance cells

| Cell | State | Evidence |
| --- | --- | --- |
| 9×7 point, dilation bricks 1×1/2×1/3×3/6×1 | Implemented and locally reviewed | Fixed pixel coordinates, including reflected even anchor |
| 9×7 all-on, erosion with the same bricks | Implemented and locally reviewed | Fixed interior bounds, outside-off boundary |
| Left-edge line dilation 2×1; gap-row erosion 2×1 | Implemented and locally reviewed | Explicit expected foreground indices |
| Empty planes; 1×1 planes with 3×3 bricks | Implemented and locally reviewed | Blank success, clipped dilation, outside-off erosion |
| Unsafe kernel products, invalid planes/operations/bricks | Implemented and locally reviewed | Memory-only rejection controls |
| Exact work limit, reservation failures, cancellation, cleanup | Implemented and locally reviewed | Cumulative work, prior reservations preserved, idempotent disposal |
| Full enumerated 80 native morphology controls | Open | This increment does not reproduce all native output controls |
| Opening/ordinary closing/safe closing | Open | Separate border and composition qualification required |
| Sauvola/adaptive Otsu/rule removal | Open | No normalization or layout parity claimed |
| Approved model assets/network loader/tensors/CTC/dictionary/confidence | Open; completion blocker | Existing traineddata inspector is not inference |
| Each language/script and PSM/OEM profile | Open; completion blocker | No working OCR CLI or SDK recognition pipeline |
| Codecs/PDF rasterization/searchable PDF | Open; completion blocker | Independent first-party engines/writer qualification required |

## Accounting and review

Inputs are synchronously borrowed binary planes. Callers own and account their
entire input backing store, including unused subarray capacity. No encoded input,
codec allocation, VFS access or sidecar reads occur in this primitive. For N pixels,
output reservations are N pixels, N retained bytes and N output bytes. There is
one output Uint8Array and no allocated kernel, queue, tensor or recursive state.
Input inspection consumes N work; sampling consumes N × brick width × brick
height. Safe products and the invocation work ceiling are checked before output
allocation. Sampling is charged conservatively in full even when cancelled.
Each kernel sample checks the invocation and supplied signal. Input inspection
uses its existing maximum 65,536-step cancellation interval. Synchronous work
cannot observe an event-loop abort until control yields.

Brick dimensions must be positive safe integers and fit the explicitly supplied
raster width/height ceilings. Bricks may exceed the actual image dimensions.
Dilation reflects the floor(size/2) origin; erosion uses it directly. Outside
pixels are off for both operations. No early-exit optimization obscures accounting.
Partial reservation failures roll back only this call's reservations. Disposal
releases successful output reservations; invocation close also clears them.
Disposal relinquishes use of the plane, without erasing it.

Review found no host access, runtime dependency, proxy-only function, duplicate
engine, recursion, model-format change or altered CLI behavior in this increment.
Safe-bash still only re-exports the private implementation. Error constructor
identity and strict declarations are exercised in the isolated artifact control.
No screenshot applies because there is no registered command or visual change.
No recognition asset was admitted or shipped; no native/WASM/LLM/remote fallback
was introduced. Tests use memory planes and the existing memfs packaging fixture.

## Verification

The first workspace run failed on the missing `morphTesseractBinary` export while
all 26 existing tests passed. After implementation, workspace unit, lint and
production/test TypeScript routes pass. The maintained selected workspace build
passes. The focused packaging control bundles actual sources, removes `/repo`
from memory VFS, executes both seed fill and morphology through
`@poe-platform/safe-bash/commands/tesseract`, and resolves strict NodeNext types.
Its unrelated skipped tests are not counted as passes. No full repository,
installed real-browser/workerd, recognition-quality or release gate is claimed.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private command publication was performed.
