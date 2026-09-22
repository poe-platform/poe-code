# Tesseract parser and engine admission contracts

## Delivered boundary

The private `safe-bash-command-tesseract` workspace owns argument parsing,
structured errors, resource accounting, byte-stream admission and traineddata
container inspection. Safe-bash re-exports it at `commands/tesseract`; maintained
private-workspace artifact traversal bundles its runtime and declarations.
No OCR handler, output renderer or model-interpreter capability is advertised.
This engine task does not implement the subsequent CLI/recognition tasks.

Original memory-only tests preceded implementation. No host executables or model
assets are used in unit tests. Public APIs do no file I/O; subsequent command
composition must use canonical byte argv and explicit VFS capabilities. An image
name never grants access to sidecars. No model or command package is published.

## Pinned source and model evidence

Tesseract `8ae68101439b3f7df123499a784e8896c805179d` (5.5.3), Apache-2.0:
`src/tesseract.cpp` owns argument/config order and mode names;
`src/ccutil/tessdatamanager.cpp` owns the uint32 count/int64 offsets and
endianness heuristic (count > 1000); `tessdatamanager.h` enumerates 24 known
components, including version at index 23. These files were freshly read from
pinned upstream source during implementation. The safe inspector admits only
1–24 components, nonempty, ordered extents after the header, and -1 missing
entries. This intentionally rejects overlapping/zero-length/header-pointing and
future containers that native framing may accept. A missing version does not
establish a network version or support; no native Pre-4.0.0 inference is promised.

Model and deeper independent primitive/native controls remain recorded in
[safe-bash-tesseract-research.md](safe-bash-tesseract-research.md) and
[compatibility-tesseract.md](compatibility-tesseract.md), supplied with this task.
Research-only `tessdata_fast` pin
`87416418657359cb625c412a48b6e1d6d41c29bd`, English asset: 4,113,088 bytes
(3.92 MiB), SHA256
`7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2`,
Apache-2.0 with separate retained license/notices. This is not shipping approval.
No other language's size, license or quality is inferred from that model.

## First-party pipeline design and gates

1. Explicit VFS stream admission and separately qualified image decoding/PDF
   rasterization produce owned gray8/binary rasters with dimension/pixel/PPI caps.
   Text extraction cannot substitute for raster OCR.
2. Normalize with independently qualified Leptonica-compatible rounding,
   boundary polarity, Sauvola/Otsu and morphology. Deskew needs pinned resampling
   and skew-search work limits. Native rule removal, masks, zones and script
   splitting require the independently enumerated controls; projections alone
   cannot qualify native layout.
3. Segment with mode-dependent line/word crops, clipping, padding, orthogonal
   rotations and explicit sidecar capabilities. Empty pages are successful.
   OSD needs separate legacy resources; LSTM-only English cannot supply OSD.
4. Verify admitted model manifest/digest/notices before loading traineddata,
   network topology, weight matrices, unicharset, recoder and DAWGs. Reject
   unsupported TensorFlow layers explicitly. Implement float32 scalar
   accumulation/activation and int8 scaling with original tensor controls;
   binary64 or scalar results do not qualify native SIMD scores.
5. Recognize with recoded multi-code CTC, bounded dictionary/non-dictionary beams,
   duplicate/null handling and pruning. Greedy argmax is insufficient.
6. Convert native certainty to API confidence and retain layout hierarchy.
   Independent txt/TSV/hOCR/PDF writers remain separate admission gates; PDF
   requires qualified font/image/crypto writing. Streaming partial output is an
   error with an explicit prefix; named atomic outputs require VFS preflight.

Each stage must charge before allocation/traversal, have bounded cancellation
checkpoints and release only invocation-owned resources in `finally`. Pending
stream I/O must observe the supplied signal in the source; checkpointing cannot
cancel an uncooperative external capability. Shared caller assets are not disposed.

## Quantified resource proposal and accuracy limits

These are reviewable admission ceilings, not measured production defaults:
8 MiB/model, 32 MiB total model bytes, 4096 pixels/axis, 16,777,216 pixels/page,
16 pages/invocation, 16,777,216 live tensor elements, 256 MiB total retained bytes,
128 active beam candidates, 256 emitted codes/line, 1,000,000 dictionary nodes,
100,000,000 charged algorithm operations and 8 MiB output. Callers must explicitly
supply all limits; the engine budget has no automatic OCR defaults.

Memory derivation: 4096² gray8 pixels consume 16 MiB; a float32 tensor at the
proposed element ceiling consumes 64 MiB. Copies/temporaries/models must also
fit the retained ceiling; these independent caps do not authorize their summed
maximum simultaneously. A 128-by-256 beam/code frontier permits 32,768 entries
before dictionary branches; branch attempts require separate work charging.
For matrix inference, charge each multiply/add, activation and beam/dictionary
transition; a layer with T steps, I inputs and O outputs requires at least
T*I*O multiply-accumulates plus bias/activation. Four-gate recurrent layers also
require T*4*H*(I+H) multiply-accumulates. Check products before allocation or loops.
No trustworthy wall-clock CPU or expected CER/WER can be calculated without a
working interpreter and corpus; the work ceiling is a rejection policy, not a
throughput or accuracy claim. Byte admission reserves maxBytes once, copies at
most 65,536 bytes per checkpoint, permits at most maxChunks (default 4096), and
returns a view retaining that capacity. Model-table inspection reads at most 24
offsets and allocates at most 24 descriptors, never model-sized component copies.

Native supplied controls recognize HELLO in enumerated modes and measure
94.235031 confidence for one bitmap/build/model only. Language-wide expected
accuracy is unknown. Existing proposed gates require ≥100 held-out pages and
≥10,000 characters per admitted cell, CER ≤1%, WER ≤5%, and bounded degradation
versus pinned native; none has been measured for JS. No synthetic classifier can
meet the requested mature-engine equivalence by assertion.

## Alternative decision

There is no existing first-party JS inference/rasterization engine in the inspected
workspace. Network deserialization/tensor math, recoder/dictionary beams, image
codecs and native layout qualification are independently missing. Source audit
and the container parser cannot establish that a mature equivalent JS engine is
attainable within this implementation increment. Continue a staged first-party
program, or explicitly authorize a revised dependency/WASM constraint, or defer
recognition. This decision is requested through hey-boss before adopting any
alternative. Until an explicit answer, all dependencies/fallbacks remain denied.


## Verification receipt

- 12 original, memory-only engine tests pass; initial absence, byte admission,
  success cleanup, version/OSD and config-PSM tests were observed failing before
  their implementations.
- Workspace ESLint and both production/test TypeScript checks pass. Modified
  packaging test, test configuration and safe-bash re-export pass ESLint.
- 165 artifact/build-contract tests pass. The tesseract control bundles actual
  source, removes `/repo` from memfs, resolves the public subpath, runs its parser,
  checks URL-denial error identity and resolves strict NodeNext declarations.
- The maintained selected safe-bash build closure passes (23 builds), including
  guarded compilation and optional postbuild stages.
- Fresh research-only model fetch in memory verified exact 4,113,088-byte size
  and SHA256. Inspector found offsets 196, 401832, 406154, 4100948, 4105686,
  4112046 and 4113058 for components 17–23, with lengths 401636, 4322,
  3694794, 4738, 6360, 1012 and 30. No bytes were retained on disk or shipped.
- No visual CLI changed or handler was registered, so screenshots are not
  applicable. No host/native/network capability is used in implementation or
  unit tests. The source/model fetches above were explicit development research.
- Hey-boss request `remote-01789956614884358000-20090-00000000000000000000`
  is pending; pending does not establish delivery or approval. No alternative
  dependency/WASM runtime or shipping model was adopted.
- No local commit, remote-main delivery, release or publication was performed.
