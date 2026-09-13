# Inserting supplied images

The current `pptx` operation accepts explicit PNG, JPEG and GIF bytes and validates
their declared content type and bounded container metadata. It preserves compressed
and alpha bytes; it does not decode pixels or guarantee that an external decoder
can render every admitted compressed stream.

The source SDK export `addImage(input, options, context)` always returns
`Promise<Uint8Array>`. `input` uses the existing bounded bytes/stream/VFS contract.
Options are `slide` (one-based), `bytes` (`Uint8Array`), `contentType` (exact
`image/png`, `image/jpeg`, or `image/gif`), optional integer-EMU `left`, `top`,
`width`, `height`, `fit`, and `altText`. Defaults for position are zero.

With no dimensions, header pixels and DPI determine size (72 DPI fallback).
One dimension scales the other proportionally. Both dimensions require explicit
`contain`, `cover`, or `stretch`. Contain centers the image inside the requested
box; cover retains the box and crops equally on opposite edges. A JPEG container
with no supported intrinsic dimensions requires both dimensions and `stretch`.
An extreme crop that rounds to an empty source rectangle fails.

```javascript
const output = await addImage(input, {
  slide: 1,
  bytes: suppliedImageBytes,
  contentType: "image/png",
  width: 1828800,
  height: 914400,
  fit: "contain",
  altText: "Coastal observations"
}, context);
```

This is a source-level example, not a published-package installation promise.
Image insertion allocates a new media part and relationship for each occurrence;
it does not implicitly deduplicate or alter existing pictures. Caller bytes and
options are snapshotted before asynchronous input acquisition. Archive byte limits
can further restrict the 32 MiB encoded image ceiling. Header admission limits
pixel dimensions to 1,000,000 per axis and 100,000,000 pixels; animated GIF frames
also share a cumulative pixel budget. No pixel decompression is performed.

The operation does not complete the proposed live picture object model, arbitrary
image formats, replacement, extraction, or all public image API obligations. Exact
case dispositions and remaining API gaps are kept in the accompanying research
receipt. README and installed-consumer examples await their separate approvals
and verification.

The virtual command uses the same implementation:

```bash
pptx images add deck.pptx --slide 1 --file tile.png --width 2in --height 1in --fit contain --alt-text "Coastal observations" -o result.pptx
pptx images add deck.pptx --slide 1 --file image.data --content-type image/jpeg --dry-run --json
pptx schema images add --json
```

CLI filename extensions supply a declared MIME type if omitted; the SDK still
validates the bytes. Unknown extensions require `--content-type`. CLI lengths
require a unit suffix. Existing output, in-place, force, dry-run, JSON and binary
stdout rules apply. The image input is protected against output aliases.
