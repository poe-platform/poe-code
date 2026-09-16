# Image utility reconciliation

This receipt supersedes stale image-model and BMP/TIFF/WMF absence statements in
older image receipts only for the tested surface. The current immutable `Image`
value exists. BMP, GIF, JPEG, PNG, TIFF and placeable WMF admission exists.
Enhanced metafile insertion remains an explicit format gap; opaque existing EMF
bytes are preserved and extracted unchanged. Native decoding is not implemented.
The exact imported `image/jpg` scenario is now proved by actual `Picture.image`
access in `image-mime-alias.test.ts`, not inventory inspection alone. The returned
value canonicalizes that one known alias, validates JPEG bytes, and preserves the
package declaration. CLI extraction retains its existing safe `.bin` naming.
See [the validated correction](../plans/pptx-image-mime-alias.md).

The [case ledger](image-codec-reconciliation-case-map.json) retains 138 shared
image-codec rows, 32 presentation image utility rows and 16 directly relevant BDD
rows. Source identities and parameter tables remain research metadata only.
Pinned research sources are `/tmp/pptx-upstream-review` at
`278b47b1dedd5b46ee84c286e77cdfb0bf4594be` and
`/tmp/docx-upstream-review` at `e45454602b53e8e572b179ccf1c91093ec9f4ed7`.
Rows explain observable mappings, deliberate validation differences, and the two
EMF insertion scenarios. They do not claim literal decoder-class parity.
Cropping, drawing styling and placeholder insertion remain in their existing
image-formatting and image-insertion ledgers rather than this codec receipt.

Original assertions in `image-codec-reconciliation.test.ts` cover nine concrete
format/dimension/density variants, all density-unit parameter branches, all 13
JPEG frame markers, malformed marker search offsets, TIFF endian/scalar fields,
inert typed/text metadata, byte ownership and filename behavior. Six formats
also pass through CLI `images add` with explicit memfs input/output capabilities;
independent ZIP entries assert the original media bytes and canonical extension.
Four square and four tall sizing parameter pairs run through both SDK and CLI,
with independent Saxes XML parsing asserting exact EMU dimensions. A separate
150x75 image at 72/200 DPI asserts 1905000x342900 natural EMU dimensions.
The tall 2x4 image at 1829 DPI rounds naturally to 1000x2000 EMU, replacing mocked
native dimensions without adding any production test hook.

## Exact public API mapping

All nine direct image API inventory records remain public and map as follows.
The type and constructor records share one actual constructor; no alias is added.

| Research source suffix    | TypeScript signature                                                                 | Behavior and error boundary                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `Image`, `Image.__init__` | `new Image(blob: Uint8Array, filename: string \| null = null, contentType?: string)` | Synchronous bounded admission, copied bytes, frozen value; invalid type/name/MIME or malformed input gives typed `OfficeError`; no host lookup |
| `Image.blob`              | `get blob(): Uint8Array`                                                             | Fresh isolated copy on every access                                                                                                            |
| `Image.content_type`      | `readonly content_type: string`                                                      | Detected MIME, or explicitly supplied MIME checked against bytes                                                                               |
| `Image.dpi`               | `get dpi(): readonly [number, number]`                                               | Fresh frozen pair; ties to even, independent 1..2048 bounds and 72 fallback                                                                    |
| `Image.ext`               | `get ext(): string`                                                                  | Canonical `bmp`, `gif`, `jpg`, `png`, `tiff`, `wmf`                                                                                            |
| `Image.filename`          | `readonly filename: string \| null`                                                  | Supplied text preserved, absent value stays null                                                                                               |
| `Image.sha1`              | `get sha1(): string`                                                                 | Lowercase compatibility metadata hash; integrity identity remains SHA-256                                                                      |
| `Image.size`              | `get size(): readonly [number, number]`                                              | Frozen pixel pair; missing bounded frame dimensions throws `invalid-value`                                                                     |

`Picture.image` returns an isolated immutable image snapshot, proved separately
by `media-public-model.test.ts`. Source `ImagePart` dependency construction and
private decoder/marker/chunk/directory objects map to emitted parts, byte
preservation and observable metadata. No public API is hidden because its name
starts with an underscore. The nine documented public image records are all
represented; source helper descriptors alone do not create new public classes.

## Deliberate language and validation mappings

- Python bytes/file-like/path admission maps to explicit `Uint8Array` and CLI
  capability reads. Passing a path or stream object to `Image` rejects before
  any stream callback executes. No ambient host filesystem access is introduced.
- Counterpart missing bitmap density historically defaults to 96. Presentation
  specification section 6.5 requires 72; the authored 26x43 bitmap explicitly proves
  x=200 and zero-y=72. No shared cross-format equivalence is claimed for that axis.
- Null uint32 PNG fields cannot be encoded. Their mocked cases map to bounded
  truncated chunk metadata fallback and typed complete-container rejection.
  Unitless and absent physical metadata, and zero axes, independently yield 72.
- An isolated source JPEG marker scanner accepts byte patterns with segment
  length 1. All seven supplied start offsets are represented by explicit original
  rejection cases because whole-image admission requires a valid length. Missing
  APP density is permitted with 72 fallback; missing frame dimensions stay unknown
  and `Image.size` throws. Unknown APP1 bytes remain inert.
- TIFF text/custom fields remain byte-preserved, not exposed as decoder objects.
  Rational density uses the presentation numeric normalization policy; zero
  denominators and pointers are bounded. Native metadata APIs and abstract header
  objects are not introduced just to mirror mocked class dispatch.
- Source counterpart absent filenames can synthesize a name. Presentation Image
  follows its documented nullable name instead; original null/name assertions
  prove this divergence. Existing source filename extensions do not override
  content-derived canonical extensions.

All fixture byte arrays and wording are original. No reference artwork was
reproduced: these are synthetic container headers for parser assertions, not
illustrations. No corpus download or upstream binary is used by unit tests.
Existing standalone MIT notices remain required and unchanged. No product source,
network, native runtime, README or pipeline change is included. Check procedures
and actual results belong in [the plan](../plans/pptx-image-codec-reconciliation.md).
