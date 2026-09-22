# Tesseract TSV output increment

## Scope and acceptance matrix

Pinned semantics: Tesseract `8ae68101439b3f7df123499a784e8896c805179d`,
`src/api/baseapi.cpp:GetTSVText`. Original pinned bitmap/model controls supplied
with this task provide HELLO word coordinates and confidence. The original
expected document in the test is independent of the implementation. This is
serialization of supplied layout, not recognition or an approved model asset.

| Cell | Status | Evidence or missing requirement |
| --- | --- | --- |
| TSV header, hierarchy levels 1–5, top-origin coordinates | Implemented, focused checks pass | Original HELLO layout, hierarchy-negative controls |
| TSV API confidence serialization | Implemented, focused checks pass | Supplied 94.235031 value serialized to six decimal places; nonword -1 |
| Blank pages, incremented page numbers, one header | Implemented, focused checks pass | Explicit second blank page |
| Unicode TSV word text | Implemented, focused checks pass | Independent TextEncoder oracle, seed 0x715, boundary scalars and BOM |
| TSV cancellation, limits and owned-byte cleanup | Implemented, focused checks pass | Every resource gate, output-phase cancellation, close/dispose controls |
| Native certainty-to-confidence computation | Open | Recognizer certainty/word acceptance pipeline absent |
| Script/language recognition profiles | Open | No admitted network interpreter, recoder/DAWG beam implementation or quality corpus |
| Each PSM/OEM variant, segmentation and OSD | Open | Missing separately qualified segmentation and classifier resources |
| Image codecs and PDF rasterization | Open | Separately qualified first-party engines absent |
| txt, box, hOCR, PAGE, ALTO, searchable PDF | Open | Renderer-specific qualification; PDF font/image/crypto writer and placement gates |
| CLI/SDK OCR parity | Open | No OCR command or recognize SDK is registered; shared TSV API available on public subpath |
| Original/checkpoint/replay OCR execution | Unverified | No invocation handler or OCR state machine exists |
| Installed/public artifact TSV runtime and declarations | Focused check passes | memfs artifact, source/private workspace removed, strict NodeNext consumer |

Capabilities remain false for recognition, segmentation, normalization and PDF
rasterization. This increment does not complete behavior-tesseract. No native,
WASM, host-file, network or LLM capability is introduced. No model is shipped.

## Safe profile and accounting

`renderTesseractTsv(rows, budget, signal)` accepts a flat, ordered layout. Each
page starts at level 1, indexes are contiguous and 1-based at their level, and
unused indexes are zero. A parent must precede each child; rectangles must be
contained in their parent. Page origins are (0,0) with positive dimensions.
Word confidence is already converted API confidence in [0,100]. Nonwords have
confidence -1 and empty text. Word rectangles and text are nonempty.

Deliberate safe deviations: reject ASCII controls/DEL, malformed surrogate
pairs, orphan or noncontiguous hierarchy, and out-of-parent rectangles rather
than emit ambiguous TSV. These rules are a declared accepted serialization
profile, not acceptance of every native layout. Numeric six-decimal formatting
uses ECMAScript binary64/toFixed; native float32 confidence calculation and
locale-specific formatting are not independently qualified by this renderer.

The caller retains layout ownership and must keep ordinary data rows stable
throughout the synchronous call. No untrusted getter/proxy sandbox is provided.
`inputBytes` charges 88 bytes per numeric row payload plus two bytes per UTF16
text code unit; object/array heap overhead is not a JS engine memory measurement.
There is no decoded image input, pixel allocation, model, tensor or recursion.
A 4096-byte scratch reservation covers bounded numeric prefixes and the fixed
five-level hierarchy. Output is measured in exact UTF8 bytes before allocation.
`retainedBytes` reserves scratch plus the exact output plane; `outputBytes`
reserves that plane. All owned reservations roll back on failure; dispose is
idempotent and safe after budget close. Disposing relinquishes ownership: callers
must not retain/use the plane after releasing its reservation. Work charges 12
steps/row, each validated UTF16 code unit, and each output byte before emission.
Work and admitted input payload are cumulative, never refunded. Text traversals
check the supplied signal at most 65,536 code units apart; row boundaries and
allocation/emission boundaries also check. As with existing synchronous
primitives, cancellation does not imply event-loop scheduling or a wall-clock
bound. No output sink or filesystem is touched and no partial document escapes.

## Manual QA procedure and receipt

1. Run the maintained command workspace unit route. Inspect the literal HELLO
   document against the source-derived header and native bitmap word row.
2. Inspect blank-page output: one header and page 2 even without words.
3. Compare generated Unicode bytes with the independent built-in TextEncoder;
   preserve the seed 0x715. Verify injection and malformed-surrogate rejection.
4. Inspect ownership accounting after each limit, structured runtime error and
   output-phase cancellation; live reservations must be zero after failure.
5. Run the isolated tesseract artifact control in `scripts/package-safe.test.ts`:
   private source workspace is removed before consumer evaluation; public
   runtime and strict declarations must resolve with no unpublished dependency.
6. Run workspace lint and maintained selected safe-bash build closure.

Executed steps 1–5: 42 workspace unit tests pass, no skips; isolated artifact
control passes, 155 unrelated file tests explicitly skipped by the selector.
Initial missing-export test failed before implementation. A later independent
null-row negative control exposed an unstructured TypeError; it failed before
adding explicit row admission and now passes. The artifact control also timed out at 6241 ms against a 5000 ms deadline while
workspace build and lint processes competed for CPU. The initial isolated run
was 857 ms; final-candidate isolated execution was 729 ms and passed. Verification
was serialized to remove this contention; the failed concurrent run remains a
failed run and is not counted as a pass. Workspace ESLint and production/test
TypeScript checks pass, as does ESLint on the changed artifact test. The
maintained selected safe-bash build closure receipt is recorded below.
Screenshots are inapplicable because no visual CLI behavior or command registration
changed. Broad repository gates and native OCR quality/performance controls were
not executed; they are not represented by the focused runs. No commit, push,
release or publication is performed by this increment.

Final-candidate selected build closure passes via
`npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: 23 declared
build tasks, shared cache with 6 hits/1 miss, maintained guarded safe-bash build
and optional postbuild complete. This is a selected closure, not a repository-wide
`npm run build` gate. Final focused artifact check passes in isolation at 729 ms.
