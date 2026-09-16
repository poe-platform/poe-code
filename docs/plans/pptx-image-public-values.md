# PPTX image public values

Owner: image metadata delegate. Scope: image-admission.ts, image-metadata.ts,
image-value.ts and original focused tests; evidence in docs/pptx.

1. Read root/scoped instructions and shared SDK/CLI/format specifications; inspect
   pinned public API and original source-test inventory entries for Image.
2. Demonstrate the missing public value with a failing original byte-only test.
3. Implement immutable byte metadata and bounded BMP/TIFF/placeable WMF admission.
4. Run focused image tests and maintained package lint; send signatures to the
   owner of Picture.image and Movie.poster_frame and export integration.
5. Root performs integration, package checks and explicit owned-file commits.

## Agent QA procedure

Use only original small in-memory byte arrays. Read Image metadata for each
supported format, check returned tuple and byte ownership, MIME mismatch, malformed
headers and offsets, TIFF cycles, WMF record termination and SHA-1 compatibility.
No renderer, downloaded fixture, native decoder, executable media, filesystem,
network capability or README modification is needed for this value-only change.
Verify returned model Image interfaces in the integration owner's memfs suite.

## Execution

The new suite initially failed because image-value.ts did not exist. After
implementation, image-value, image-admission and image-metadata suites passed.
The initial package lint found one new incorrect error phase, corrected to admit;
concurrent command integration type errors were reported to its owner.
Final maintained package lint and owned-file diff whitespace checks passed.
