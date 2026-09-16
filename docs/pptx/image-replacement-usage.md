# Image replacement draft usage

`pptx images replace deck.pptx --slide 1 --image 1 --file art.gif --output changed.pptx`
replaces one occurrence. Other references to the same embedded resource remain
unchanged. Add `--shared` to replace every reference to that resource, including
references on masters and notes. The human and JSON results report affected
occurrences; JSON also reports affected slide positions.

The command accepts explicit `--scope` and opaque `--select` selectors, or `--all`
within the chosen scope. Opaque selectors cannot be combined with simple selectors.
Empty mutation selections require `--allow-empty`.

Crop, geometry and alternative text are preserved by default. Explicit
`--preserve-crop false` clears cropping. `--preserve-geometry false` resets to native
size at the origin without rotation/flips. `--preserve-alt-text false` clears both
description and title. `--alt-text TEXT` supplies a replacement description,
including an empty string; preserved titles remain unless preservation is disabled.

Replacement admits PNG/JPEG/GIF bytes whose declared MIME type matches their
format. `--content-type` is optional when the file extension identifies that type.
This bounded profile rejects external links, vector/fallback picture pairs, and
media parts that own relationships. Replacement does not yet accept the proposed
`--width`, `--height`, `--left`, `--top`, `--fit` or `--fallback` options; it supports
preserved geometry or an explicit reset to intrinsic size at the origin.
There is no implicit host filesystem access, image decoding, or network fetching.

Choose `--output PATH` or `--in-place`; existing output requires `--force`.
`--output -` emits binary package bytes and cannot accompany `--json` except in a
dry run. `--dry-run` validates and reports without publication. Cancellation before
publication leaves input and destination unchanged.

The byte SDK uses `await replaceImage(input, {slide: 1, image: 1}, imageBytes,
{contentType: "image/gif"}, context)`. Explicit bounded context is required.
Its result contains `bytes`, `affected`, `occurrences` and `affectedSlides`.
Options include `shared`, `all`, `allowEmpty`, `preserveCrop`, `preserveGeometry`,
`preserveAltText` and `altText`; all preservation switches default to true.
Live mutable picture-model APIs and additional image formats are separate coverage.
