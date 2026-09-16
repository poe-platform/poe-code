# Media public interface integration receipt

This receipt supplements historical API/test audit snapshots. It does not claim
complete PPTX API coverage or exact runtime compatibility.

- [Image values and six-format mapping](image-public-values-evidence.md)
- [OLE inert byte insertion](ole-byte-insertion-evidence.md)
- [Live returned model interfaces](media-public-model-evidence.md)
- [Exact 61-member scoped API and source-case ledger](media-public-api-map.json)

The shared CLI retains plural images/objects resources and existing text replace,
properties, selection and JSON contracts. `objects add` takes `--file`, `--icon`,
`--program-id` (or registered `--program DOCX|PPTX|XLSX`), an owning one-based `--slide`, optional explicit geometry and
common publication flags. Its SDK domain operation is `addOleObject`, with
`progId` representing the model's neutral `prog_id`; command schema uses
`programId` matching the CLI spelling. Geometry command objects use shared Length
JSON and convert once to bounded EMUs. Payload and icon paths are explicit
capability reads, protected against output replacement. No byte contents execute.

`Image` uses synchronous immutable getters. Model insertion always returns a
Promise and uses shared domain operations; save/reopen preserves embedded bytes.
CLI images list/extract exposes metadata and original encoded bytes. New bounded
BMP/TIFF/placeable-WMF admission is available through images add and
explicit media/OLE posters, including MIME and extension discovery. SHA-1 never
replaces SHA-256 for identity or package publication.

The historical inventory statuses remain baseline research labels; these linked
member receipts identify newly passing behavior. `_MediaFormat` and `_OleFormat`
are included through public returned interfaces under neutral JS class names,
not hidden because of underscore spelling. Guide/source return annotation drift
is resolved to Movie and GraphicFrame. Explicit caller icons/posters replace
implicit bundled artwork lookup; no ambient path, decoder, native runtime or
network capability is introduced. See each member receipt for remaining bounds.

Original command tests first failed with unsupported objects.add and unsupported
BMP extension, then passed after implementation. A separate review caught the
initial incorrect program-ID flag spelling and permissive width/MIME schema;
the command now follows the documented --program-id and positive dimensions.
Validation and local delivery results are recorded in the integration plan.

Validation: maintained PPTX suite passed 6,347 cases across 242 files; final focused
objects-add schema/publication tests and package lint passed. The selected build
closure passed. Exact staged-source TypeScript and compiled public SDK/CLI memfs
roundtrip additionally passed; original bytes and program ID survived reopen.
Help screenshot inspected without clipping. No publisher assets were acquired,
no existing QA assets were deleted, and no native playback/rendering was used.
See the [integration plan](../plans/pptx-media-public-integration.md) for ownership,
archive identity and local commit receipts.
