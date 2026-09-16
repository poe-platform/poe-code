# Image metadata and explicit inert byte admission

This receipt supplements the historical image-insertion audit. It does not claim
whole public API or full format decoding parity. Source references remain research
only: `upstream-api-inventory.json` Image entries and
`upstream-test-inventory.json` `tests/parts/test_image.py` cases were reviewed.
The latter includes six canonical-extension and five DPI variants; absent fixture
payloads are not claimed as independently replayed test inputs.

## Public member mapping

`Image(blob: Uint8Array, filename: string | null = null, contentType?: string)`
constructs a synchronous immutable in-memory value. Admission methods on models
remain asynchronous. An optional explicit MIME is checked against structure;
otherwise a bounded signature selects the format. Filename is inert caller metadata,
never a path to open, and does not control extension or type. Unnamed bytes return
null. The class holds a byte copy and returns copies from `blob`.

| Member | Exact JS mapping | Original acceptance |
| --- | --- | --- |
| blob | Uint8Array copy | image-value: owns bytes |
| content_type | canonical MIME string | image-value: format matrix and GIF |
| dpi | frozen readonly [number, number] | image-value matrix; image-metadata density cases |
| ext | canonical extension without dot | image-value matrix; image-admission PNG/JPEG/GIF cases |
| filename | readonly string or null | image-value matrix and ownership case |
| sha1 | lowercase 40-character SHA-1 compatibility metadata | image-value fixed four-byte digest |
| size | frozen readonly [width, height] | image-value format matrix and GIF |

SHA-1 does not participate in package integrity, resource identity, deduplication,
selection or publication. Existing SHA-256 identities are unchanged. A container
with unavailable dimensions (the existing bounded JPEG acceptance) throws a typed
`OfficeError` with `invalid-value` when `size` is read. Invalid byte/name/MIME types
use `invalid-type`; malformed supported containers use `invalid-value`; unknown
formats use `unsupported-profile`; byte/pixel budget excess uses `resource-limit`.
This replaces source exception/runtime mechanics explicitly.

## Format and security mapping

| Format | MIME / extension | Characterization and admission |
| --- | --- | --- |
| PNG | image/png / png | IHDR dimensions, pHYs DPI, bounded chunk order/CRC; no inflation |
| JPEG | image/jpeg / jpg | frame dimensions, JFIF and EXIF TIFF DPI, bounded segments; no entropy decoding |
| GIF | image/gif / gif | logical canvas, 72 DPI, bounded frames/subblocks and aggregate pixel budget; animation bytes retained |
| BMP | image/bmp / bmp | core/information headers, signed height, pixels/meter DPI, bounded pixel offset and uncompressed storage length |
| TIFF | image/tiff / tiff | classic little/big-endian directories, scalar dimensions, rational DPI and units, bounded directory/field offsets and cycle rejection |
| WMF | image/x-wmf / wmf | placeable header checksum, bounds/units, bounded records and EOF; logical size at 72 DPI (floor, minimum one) |

DPI normalizes each axis independently with ties-to-even rounding and a 72 fallback
outside 1..2048. PNG/JPEG/GIF behavior is reused. All formats retain exact encoded
bytes and enforce the existing 32 MiB admission and 100-million-pixel bounds.
BMP compressed payloads and TIFF strip/tile contents remain inert; acceptance is
bounded container metadata characterization, not proof of pixel decoding. TIFF
uses the first image directory for size/DPI and bounds all directory field payloads.
BigTIFF and non-placeable WMF have no admitted metadata path and remain unsupported
for creation. These are visible capability limits, not full format-family parity.
EMF, WDP and SVG are not among the six documented Image extensions and keep their
separate format-spec preservation/fallback obligations. No default transcoder,
external lookup, native runtime, file-open operation or execution is introduced.

## Verification

TDD red: new original suite failed on missing image-value module. Green: focused
image-value, image-admission and image-metadata tests passed (89 cases after added
adversarial and immutability cases). Tests build tiny inert headers directly in
memory; no files or disposable upstream fixtures are used. Integration evidence
for returned Picture/Movie images belongs to the model owner; this receipt alone
does not establish exported consumer or command coverage.

Maintained `npm run lint --workspace=pptx` passed after concurrent command fixes;
`git diff --check` passed for the owned files.
