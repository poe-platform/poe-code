# Image extraction receipt

This receipt concerns the bounded F35 operation only. Read it with the
[case ledger](image-extraction-case-map.json), [draft usage](image-extraction-usage.md)
and [manual verification plan](../plans/pptx-image-extraction.md).

## Language and security mappings

- Admission uses explicit `BinaryInput` and supplied context capabilities. There
  is no implicit host path, native decoder, runtime import, resource download or
  external relationship fetch. Extracted bytes are opaque; SVG and animated or
  vector formats are never rendered or activated.
- Operation JSON uses camelCase. CLI selectors are one-based owner positions;
  opaque tokens retain identity and stale checks. Explicit notes/layout/master
  selection is a noncreating read. Model snake_case members remain a separate
  public contract, including inherited members and underscore-prefixed types.
- Generated names are `part-NNNNNN.EXT` in emitted order. Extension comes from
  admitted content type or `bin`, not a relationship target, embedded filename,
  source suffix or directory. Source names belong in manifest provenance only.
- Exact-byte integrity uses SHA-256. Documented model `sha1` remains compatibility
  metadata and is not silently renamed to SHA-256. Inventory metadata evidence
  does not implement the live `Image` model.
- Bytes remain `Uint8Array`; string coercion is not an admission mechanism.
  Default extraction emits each occurrence separately even for shared part names
  or byte-identical distinct parts. Only explicit unique mode groups resources;
  grouping retains every contributing source occurrence.
- Output byte/count limits must apply to actual emitted duplicates, before any
  publication. Directory publication uses an adapter transaction or explicit
  partial authorization with a precise manifest. A failed transaction cannot
  claim partial success. Force does not bypass validation or byte limits.

## Public API accounting and drift

The ledger retains the image/picture family from the prior 121-case audit and
additional relationship and URI boundary rows; it does not mistake insertion,
geometry, crop, DPI or live-object tests for extraction parity. Individual
parameter bindings are retained rather than replacing each parameterized family
with one counter. The API family remains visible through
[image inventory API mapping](image-inventory-api-map.json), which records
constructors, inherited members, returned types and members without source tests.

`Image.blob`, `content_type`, `ext` and `filename` have detached operation
counterparts, but direct model property access remains an outstanding obligation.
`Image.dpi`, `size`, `sha1`, `Picture.image`, `PlaceholderPicture.image` and
`Movie.poster_frame` likewise are not implemented by an extraction manifest.
No type is hidden because its name starts with an underscore. Host pathname
constructors map to explicit VFS capabilities, streams to bounded async admission,
and byte constructors to owned byte values; no unrestricted file object is exposed.

The historical test audit's “adaptation not started” and API audit's final
“no JavaScript API” paragraphs describe the original checkpoint. Existing bounded
inventory/insertion/formatting receipts supersede those statements for their own
subsets. This extraction receipt does not update or claim completion of the
whole API inventory. Source invalid `image/jpg` compatibility is separately
accounted; preserving opaque bytes is not image format characterization.

F35 requires occurrence/hash extraction and explicit deduplication, although its
Appendix A row omits hash/unique flags. The executable schema and usage document
resolve that omission with `--sha256`/`sha256` and `--unique`/`unique`.
`--dry-run` follows the shared contract; `--limit maxOutputs=N` lowers the
adapter's trusted archive-member ceiling. The format appendix remains proposed,
not an assertion that its abbreviated option row is exhaustive.

All behavioral assets and TypeScript case wording are original. Research source
identities stay only in the ledger and existing research inventories. Existing
standalone MIT notices are retained; no source fixture or implementation is copied.

## Executed validation

Root executed disposable corpus QA against the manifest-listed
`IXPE-Presentation-Template.pptx` with verified input SHA-256
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
Slides and notes each yielded zero occurrences. Layouts yielded one
`part-000001.jpg` of 718,094 bytes; masters yielded one `part-000001.png` of
438,588 bytes; shared yielded both, totaling 1,156,682 bytes. Every source part,
size and output digest was checked against independent corpus manifest media
records and Node crypto over exact extracted bytes. No outputs were written,
rendered, activated or fetched. The notes-empty result is not notes-image coverage;
original in-memory notes-image regression cases provide that obligation.

Maintained `npm test --workspace=pptx` passed all 3,246 tests in 114 files.
`npm run lint --workspace=pptx` and the explicit maintained build closure
`npm run build:workspaces -- --workspace=pptx` passed. The closure built the
declared dependencies and pptx, without executing the whole pipeline.

The extraction suite contains 36 original SDK cases and eight command cases.
Review reproduced and fixed invalid SDK selection consuming input before
validation (seven counter cases) and empty dry-run calling a transaction callback.
Command cases cover exact hashes, explicit unique mode, output limits,
transaction preflight, cancellation and precise partial manifests. Existing
split command cases also passed after the shared publication guard change.

The actual safe-bash PPTX family passed 113 tests, including four new memfs
extraction cases. Its maintained integration-discovery check passed 107 tests,
and `npm run typecheck --workspace=virtual-bash` passed source/tests and all
26 declared consumer groups. Exact capabilities now include extraction and the
already implemented image setters. The existing adapter remains unchanged:
it uses conditional per-file writes and therefore requires explicit partial mode.
All output collisions are preflighted; force still rejects aliases of the input.

An extraction-only staging candidate also passed TypeScript compilation with
the pre-existing uncommitted replacement changes excluded. Only owned extraction
changes and this task's records are committed; unrelated working files remain.

The maintained generic screenshot route captured the injected command's help at
`.cache/pptx-image-extraction-help.png`. Root inspected the PNG: selectors,
scopes, limits and transaction/partial-output guidance are readable and complete.
The utility is injected into safe-bash, not registered as a root CLI subcommand.
No image payload was rendered and the PNG is not a committed artifact.

Root also verified the manifest-listed `CERN-job-opp-250925.pptx` input SHA-256.
Shared occurrence extraction produced two PNG outputs of 22,168 total bytes,
each carrying one occurrence. Explicit unique mode produced one PNG of 11,084
bytes with both occurrences. Output hashes, source sizes and source parts matched
manifest media records and independent Node crypto. No meaningful corpus QA
failure was found; no new corpus-derived regression was necessary.
