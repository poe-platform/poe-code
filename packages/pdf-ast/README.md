# @poe-code/pdf-ast

Unified first-party PDF AST, parser, lossless editor, extractor, and 2D PNG rasterizer for TypeScript.

`@poe-code/pdf-ast` provides a three-layer PDF Abstract Syntax Tree (`COS Object Graph` → `Content Stream & 2D Display List` → `Semantic & Layout Extraction AST`) so applications can parse, inspect, edit, redact, merge, extract tables/text, and render PDFs to PNG with zero native dependencies.

`renderDisplayListToBitmapSteps`, encoding `...Steps` functions, and
`extractDocumentImagesSteps` expose bounded work generators for responsive
page and pixel processing. Synchronous APIs remain available.

`PdfFileSource.open(fs, path, options)` provides retained random-access input
using the caller's safe-fs. `read(position, maxBytes)` returns owned bytes up to
`chunkBytes`, and `stream(position, length)` yields ranges under consumer
backpressure. Always close the source in `finally`. The default range cache is
256 KiB with 64 KiB chunks; `maxInputBytes` rejects oversized inputs before any
payload read. Sources require retained-read support and never reopen a pathname
or fall back to whole-file reads. The caller chooses and owns the backend;
memory-backed safe-fs still stores its files in RAM.

`new CosRangeLexer(source, options)` reads COS tokens asynchronously from a
retained source. Await `nextToken()` or `skipWhitespaceAndComments()`, and set
`offset` to seek between operations. It uses the buffered lexer's grammar,
including numeric and malformed-string recovery, with one input chunk plus the
source cache. Returned tokens own their bytes. The active token is additional
memory: set `maxTokenBytes` to bound decoded strings and encoded names/numbers.
`start`, `end`, `knownCommands`, and `signal` control scanning. The caller closes
the source after use; the lexer does not collect a document or own its handle.

`doc.fonts({ firstPage, lastPage })` lazily inspects fonts in the selected
one-based page range, inherited resources, forms, patterns, annotations and
AcroForm defaults. It reports font names, types, encoding, embedding, Unicode
mapping and indirect references without decoding font programs. Exact duplicate
tracking uses caller-backed storage; closing the document releases suspended
font traversals.

`doc.images({ firstPage, lastPage })` yields lazy image occurrences from page
content, forms, patterns, Type 3 glyphs, annotation appearances and unreferenced
page resources. Each exposes its dictionary, resources, transform, reference and
encoded byte length. Consume `image.contents({ native: true })` before advancing
the iterator to unwrap transport filters while preserving JPEG, JPX, JBIG2 or
CCITT bytes; the default applies the normal stream decoder. These are stream
bytes, not RGBA pixels. Image occurrences expire on advancement. Content and deep
graphics-state stacks use caller-backed staging, released on return or document
close. Supply external storage for large inputs.

`doc.attachments()` on a retained document visits embedded name trees,
catalog/page associated files, and file-attachment annotations in document order.
Each result exposes `index`, `name`, and `contents()`, which streams decoded
payload chunks only when requested. Listing leaves attachment payloads untouched.
Duplicate names and name-tree cycles use caller-backed indexes; filename equality
is exact, including Unicode code units. Returning early or closing the document
releases traversal staging. Keep the document open while reading contents.

`doc.structure({ includeText: true })` streams logical structure items. Element
items expose `depth`, `role` and optional `mappedRole`; text items expose `depth`
and UTF-8 `contents()` chunks that must be consumed before advancing the walk.
Text includes ActualText/Alt values and page MCID/MCR content. Page operators,
marked-content state and text segments use caller-backed staging, preserving
text-object grouping and nested-BT recovery without collecting a page AST or
all extracted text. Trimming scans stored segments without retaining whitespace
tails. Closing or returning the walk releases its staging; active-path cycles
are skipped while repeated sibling references remain visible. Individual COS
values remain subject to parser admission. Omit `includeText` to inspect roles
without decoding page contents.

`doc.destinations()` visits legacy and name-tree destinations in stored order.
Each entry has a `name` and, when valid, a `target` containing `pageNumber` and
`kind`. Page references use a caller-backed index; malformed named entries remain
visible without a target. `doc.urls({ firstPage, lastPage })` visits annotation
URI actions and their chains, yielding `pageNumber` and `url`. Cycles are tracked
in caller storage, with URL deduplication scoped to each annotation. Both walks
release their indexes on completion, return, error or document closure.

`doc.javaScripts()` visits document actions, JavaScript name trees, page and
annotation actions, and form fields in inspection order. Each result exposes a
`name` and lazy UTF-8 `contents()` chunks. It follows action chains with the
existing eight-level recovery policy; duplicate and cycle tracking use one
caller-backed index. Payloads stream/decrypt only when consumed. Returning early
or closing the document releases traversal staging, and closing cancels active
payload reads. Parser-owned dictionary/string values remain subject to parser
admission; streamed scripts and the full result list are never collected.

Image occurrences also accept `contents({ raw: true })` for malformed-filter
recovery. Raw reads preserve ownership and byte limits and still decrypt:
default stream encryption is removed, while explicit chains decode through the
last `Crypt` filter. Remaining image/transport filters stay encoded. The same
option is available on `PdfObjectReader.decodeStream()`.

`PdfRetainedDecodedImage.open(doc, occurrence, storage, options)` combines native
JPEG/JPX/JBIG2 decoders, CCITT and plain samples with color resolution, soft and
explicit masks, matte correction, color keys and stencil fills. Its `rows()`
iterator yields owned RGBA rows once; completion, errors, early return and
`close()` release staging. Consume the occurrence before advancing `doc.images()`.
Raw/decrypted input and intermediate samples/masks use caller-authorized storage;
no full RGBA plane is collected. `nativeContents()` streams the retained native
payload and `nativeContents("globals")` streams JBIG2 globals when
`globalsByteLength` is defined. Read these before rows complete or the owner
closes; `nativeByteLength` indicates native payload availability. Set `maxWorkingBytes`, `maxStagingBytes`,
`maxOutputBytes`, `maxDepth`, `chunkBytes` and `signal`. Admission combines codec,
color, mask and row state; native compressed/decoder state remains intrinsic.
Document/parser caches, decryption scratch, the caller's current input chunk and
backend-owned storage are additional. Use external storage for large images.
Malformed filters retain buffered recovery behavior; backend errors propagate.

`encodeRetainedTiff(width, height, rgbaChunks, storage, options)` writes TIFF
with uncompressed, PackBits, DEFLATE, LZW, or JPEG strips. It stages compressed
bytes in the caller's filesystem to determine the strip length, then emits a
header and bounded payload chunks. `maxStagingBytes`, `maxOutputBytes`,
`maxWorkingBytes`, `chunkBytes`, `dpi`, and `signal` control admission and
publication. Working admission covers conservative row/codec scratch; the
current caller input chunk and filesystem caches are additional. JPEG uses
YCbCr metadata matching its 1:1 component sampling. Staging is removed on
success, failure, cancellation, and consumer return.

`encodeJpegChunks(width, height, rgbaChunks, options)` writes sequential JPEG
chunks while retaining only eight RGBA rows and one MCU's entropy bytes.
It shares the buffered encoder's quality and pixel conversion, including
zero-filling truncated input. Set `chunkBytes`, `maxWorkingBytes`,
`maxOutputBytes`, and `signal` to control output ownership, admission and
cancellation. The caller's current input chunk and fixed codec tables are
additional memory; upstream retained image rows provide bounded input chunks.

`PdfRetainedJbig2.open(source, width, height, options)` admits encoded input,
optional retained `globals`, arithmetic contexts, symbol/region bitmaps and
custom Huffman state. It keeps page pixels packed and emits owned RGBA `rows()`;
standalone files use their embedded dimensions. `maxWorkingBytes` conservatively
counts cumulative decoder allocations plus one RGBA row; source caches and
fixed shared codec tables are additional. `maxOutputBytes` bounds decoded
output. Sources stay caller-owned and may close after opening; call `close()`
to release the packed bitmap. Intrinsic input and codec state remain resident.

`PdfRetainedJpx.open(source, options)` admits encoded JPEG 2000 input, tile
grids, codeblocks, tag trees and wavelet buffers before their allocations.
Its `rows()` iterator assembles owned RGBA rows with tile overlap precedence,
avoiding additional full sample/RGBA planes. Encoded input and decoded tiles
remain intrinsic resident state. `maxWorkingBytes` uses conservative cumulative
allocation charges (not measured heap); caller source caches and resolved color
state are additional. Set `maxOutputBytes` to bound output, supply `color` for
resolved PDF color spaces, and call `close()` to release tiles. The source stays
caller-owned and can close after opening the decoder.

`PdfRetainedJpeg.open(source, options)` admits encoded JPEG input and decoder
allocations before decoding. `rows()` yields owned RGBA rows without full RGB or
RGBA planes; `width`, `height` and `components` describe the decoded image.
`maxWorkingBytes` conservatively charges parse allocations, including metadata,
and reuses one row-scratch allowance; `maxOutputBytes` admits image dimensions.
Encoded input and DCT coefficient state remain intrinsic resident allocations.
The source stays caller-owned and can close after `open()`; call `jpeg.close()`
to release decoder references. PDF Decode and ColorTransform options are supported.

`resolveRetainedImageColor(document, colorNode, resources, storage, options)`
resolves only the selected color resource using the buffered engine's color rules.
ICC profiles supply component metadata without decoding their payload. Indexed
palettes keep at most 256 addressable entries while validating the complete
stream. Calibrated and tint-function state survives document closure; function
streams use caller-backed staging before admitted materialization.
`maxWorkingBytes`, `maxNodes`, `maxDepth` and `maxStagingBytes` bound that state;
object-reader/parser and I/O caches are additional memory.

`decodeRetainedSampleRows(source, width, height, bitsPerComponent, color, options)`
converts decoded sample planes to owned RGBA rows using the same color conversion
as buffered extraction. It preserves packed row padding, truncated sample rules,
Decode mappings, calibrated/tint colors and optional retained alpha samples.
`maxWorkingBytes` admits row buffers and tint-channel scratch before reading;
`maxOutputBytes` admits total RGBA output. Caller-owned source caches and resolved
color-space state are additional memory. Sources remain open and caller-owned.

`applyRetainedImageMask(rows, width, height, mask, options)` applies a retained
RGBA mask to exact RGBA input rows. Set `mode` to `soft` or `explicit`; soft masks
also accept an RGB byte-valued `matte`. Nearest-neighbor resampling keeps one mask
row resident and skips unused rows. Output rows own their bytes, and early return
or cancellation closes the row producer while leaving the mask source open.
`maxWorkingBytes` admits input/output rows, mask row and range scratch;
`maxOutputBytes` admits total output. The source cache is additional memory.

`parseContentRangeOperators(source, storage, options)` yields normalized content
operators without collecting a page AST. Its recovery rules are shared with
`parseContentStream` and `parseContentOperators`. Inline images carry a dictionary
and `start`/`end` ranges in the caller-owned source; stream their payload only when
needed. Excess operands use a 32-value resident tail and caller-backed immutable
runs, removed when iteration completes, fails, or returns early. Restored operands
omit formatting spans rather than exposing offsets into private recovery storage. `maxNodes`,
`maxDepth`, and `maxTokenBytes` bound active operands; `chunkBytes` and
`maxStagingBytes` control recovery storage, including simultaneous merge inputs
and output. Use external storage for large content streams and consume results
incrementally. For decoded retained pages:

```ts
const content = await PdfFileSource.fromStream(fs, scratch, page.streamContents());
try {
  for await (const op of parseContentRangeOperators(content, { fs, directory: scratch })) {
    // Process this operator before advancing; image bytes remain in content.
    if (op.inlineImage) {
      const { start, end } = op.inlineImage;
      for await (const bytes of content.stream(start, end - start)) await sink.write(bytes);
    }
  }
} finally {
  await content.close();
}
```

`parseCosRangeObject(source, offset, options)` parses one indirect object at a
known offset. Stream objects return their dictionary in `value` and a `stream`
byte span; consume the payload with `source.stream(start, end - start)`. Correct
`/Length` values let the parser seek over payloads, and a `resolveLength` callback
can use your object index for indirect lengths. Damaged lengths use bounded
range scanning. `maxNodes`, `maxTokenBytes`, and `maxRecursionDepth` bound the
active structural value; the source remains caller-owned. This low-level API
returns encoded object data, before document-level decryption or stream decoding.

`scanCosRangeObjects(source, options)` discovers object bodies and trailers in
damaged PDFs without collecting their payloads. Its candidate scanner is shared
with the buffered repair loader. Objects retain stream byte ranges; duplicate
bodies remain in file order. Consume events incrementally and keep the source
open. Structural budgets, I/O errors, and cancellation remain fatal during repair.

Pass `recovery: "repair"` to `openPdfObjectReader` or `PdfRetainedDocument.open`
to recover damaged xrefs into caller-backed indexes. Security trailers are
selected before authentication; compressed members are discovered only after
successful authentication. Direct bodies take precedence over recovered packed
members. Bad indexed object offsets can also be rescanned lazily, with at most
64 corrected offsets cached. Strict mode remains the default for retained APIs.

`readCosXrefRevision(source, offset, options)` yields classic or binary xref
rows on demand and returns the trailer as the generator's final value. It keeps
one decoded chunk and the bounded trailer structure, with `maxEntries` and
`maxDecodedBytes` budgets. Common filters use `decodePdfStreamChunks` by default;
a `decodeStream` callback can override decoding for other codecs. `maxRowBytes`
admits predictor row storage before allocation. Early return closes the decoder but leaves the source open. Rows retain file
order, including duplicates; callers must resolve within-revision precedence
before combining revisions. This primitive does not follow `/Prev` or hybrid
xref links or replace the buffered document loader.

`decodePdfStreamChunks(dict, input, options)` streams direct filter dictionaries
with Flate, LZW, ASCIIHex, ASCII85, run-length and CCITT decoding, including TIFF/PNG
predictors. `chunkBytes` bounds owned output chunks, `maxDecodedBytes` bounds
each decoded stage, `maxRowBytes` admits predictor rows, and `signal` cancels
pending input. Flate retains a 32 KiB history plus bounded Huffman tables and
preserves PDF.js/pypdf damaged-stream recovery. LZW uses a fixed 4096-entry
prefix dictionary; predictors retain at most two rows. Image-codec and Crypt
filters pass encoded bytes through as in the buffered decoder. For CCITT, supply
input as a factory such as `() => source.stream(start, length)`: if no rows decode,
the original-byte fallback replays the same retained bytes through earlier filter
stages. No encoded payload is buffered or privately spooled. CCITT retains two
packed rows and applies the same row and output budgets. `inflatePdfChunks`,
`decodePredictorChunks` and `decodeCcittFaxChunks` expose the individual stages
for callers that already manage filter parameters.

`PdfObjectIndex.build(entries, { fs, directory }, options)` sorts streamed
cross-reference entries into caller-backed retained storage. Supply revisions
newest first: the first entry for an object wins, including free entries. Set
`duplicate: "last"` when indexing the rows within one revision. Use
`get(objectNumber)` for binary lookup, `entries()` for ordered iteration, and
`close()` to remove owned staging. Compressed entries preserve their object-stream
number and index. Construction retains one `runEntries` batch and active merge
caches, with logarithmically many dormant run handles; it never retains every
entry in a Map. `chunkBytes` (a multiple of 32), `cacheBytes`, `maxEntries`,
`maxStagingBytes`, and `signal` control I/O and admission. The staging budget
includes merge inputs and output simultaneously. Choose external injected storage
for large indexes; a memory filesystem still stores those files in RAM.

`openPdfCrossReference(source, storage, options)` discovers the header and last
`startxref`, follows incremental `/Prev` links, and combines classic and hybrid
xref streams into a caller-backed `index`. Duplicate rows use last-row precedence
within a revision and newest-first precedence across revisions. It returns the
newest trailer plus inherited root, info, encryption and file-ID metadata. Close
`result.index` after use; the input source stays open. Cycle tracking uses another
external index, not an unbounded in-memory set. `maxRevisions` bounds traversal;
`index` options apply to each index construction (the combined index and a nested
builder can coexist). Trailer/value limits and the streaming decoder callback
are the same as `readCosXrefRevision`. This API requires valid xrefs; repair scanning,
object loading, decryption and the buffered document API remain separate.

For stdin or intermediate data, `new PdfObjectReader(source, index, storage, options)` resolves indexed COS
objects with `await reader.get(objectNumber, generationNumber)`. Stream payloads
remain retained source ranges. Compressed members are parsed individually from
caller-backed decoded streams and fixed-width header tapes; the default cache
holds two streams. `objectStreamCacheEntries`, `cacheBytes`, `chunkBytes`,
`maxStagingBytes`, and `maxObjectStreamMembers` control that storage. Header and
decoded bytes share the staging budget, admitted before writes. Parsing defaults
to 65,536 nodes, 1 MiB per token and depth 100; adjust those intrinsic-value limits
with `maxNodes`, `maxTokenBytes` and `maxRecursionDepth`. Returned ASTs belong to
the caller and are not cached. `close()` removes owned staging after accepted
reads finish, leaving the source and index open. `reader.decodeStream(number,
generation)` emits decoded payload chunks under consumer backpressure.

`openPdfObjectReader(source, storage, { password, ...options })` discovers the
xref index and authenticates encrypted documents before lazy loading. It returns
`{ crossReference, reader, encryption?, close }`; its `close()` owns both the
reader and index, while the input source stays open. Encryption dictionary
references share the configured node/depth admission limits. String and stream
crypt filters, attachment filters, explicit `/Crypt` positions, signature
contents and plaintext metadata/xref exclusions are preserved. Compressed
members are decrypted through their container once. The constructor also accepts
an already authenticated `encryption` state and `encryptionObjectNumber`.

`decryptPdfStreamChunks(state, number, generation, input, options)` uses the
stream cipher selected by `derivePdfEncryptionKey`, with fixed 512-byte cipher
input state and owned output chunks. `type` selects attachment semantics;
`cryptFilter` selects an explicit filter. `decodePdfEncryptedStreamChunks` also
applies a resolved stream dictionary's filter chain. Both honor cancellation and
decoded-byte limits; retained-input factories support decoder replay. Cipher
block scheduling preserves the buffered decoder's truncated AES recovery.

`PdfRetainedDocument.open(source, storage, options)` opens a read-oriented
retained document with authenticated `objects`, `crossReference`, and
`encryption` state. Iterate `doc.pages()` to visit pages under consumer
backpressure, including inline page dictionaries. Each page provides its
`index`, optional `reference`, `dict`, async `attributes()` (inherited boxes,
rotation and resources), and `streamContents()` (decoded content chunks with
the same array separators as `PdfPage.getRawContentStream`). `doc.lookup(node)`
resolves reference chains while retaining stream identity; `doc.info()` decodes
string/name metadata.

Page walks keep only their active path and use caller-backed indexes for global
cycle/duplicate tracking, with a 64-reference resident tail. `maxPages` is an
optional admission limit; `maxPageTreeDepth` defaults to 100 and
`maxTraversalStagingBytes` bounds aggregate live traversal staging per iterator.
The existing object/parser limits bound each active structural value. A walk
removes its indexes on completion, error or early return. `doc.close()` cancels
active work, closes suspended walks and releases its reader/xref; the caller
still owns the input source and any page values it retains. This read-oriented
API does not yet replace the editing, extraction or rendering engine used by
the commands.

`PdfFileSource.fromStream(fs, directory, chunks,
options)` writes bounded chunks into retained staging in the supplied directory.
It seals the file before reading, verifies its identity and content revision,
and removes its staging directory when the source closes. Writes apply
backpressure to the input iterator; failed or cancelled spooling cleans up
without replacing the original error. The injected backend must support retained
staging writes and cleanup. This primitive does not publish output destinations.

`encodeRetainedPng(width, height, rgbaChunks, storage, options)` preserves the
buffered PNG byte layout while staging pixels and compressed bytes through the
injected filesystem. It detects opaque input automatically; `alpha: "rgba"`
keeps the alpha channel. `maxStagingBytes` admits aggregate live staging and
`maxOutputBytes` bounds the final file. Chunks are owned and bounded by
`chunkBytes`; cancellation, failure and early consumer return remove staging.
The underlying scanline, compression and framing codecs are filesystem-independent.

`encodePortableBitmapChunks(format, width, height, rgbaChunks, options)` emits
PPM, PGM or PBM from incremental RGBA input, using a fixed output buffer rather
than a full image. It preserves grayscale rounding, monochrome row padding and
white padding for missing samples. `chunkBytes`, `maxOutputBytes` and `signal`
control chunk size, admission and cancellation; the codec is filesystem-independent.

`PdfStagedOutputs.create(storage, entries, options)` stages named chunk producers
without keeping their payloads in memory. `entries()` returns names, sizes and
streaming `contents()` readers after every producer succeeds. Repeated names keep
their first position and select the last payload. `maxStagingBytes` admits the
aggregate data and index storage before writes; `chunkBytes`, `maxNameChars` and
`signal` control bounded I/O and cancellation. Call `close()` to remove owned
staging. Publication remains the caller's responsibility.

`serializeCosNodeChunks(node, options)` emits owned, bounded output chunks for
COS values, including streams and escaped strings. Consumers control progress
by advancing the iterator; `signal`, `maxOutputBytes`, and `maxRecursionDepth`
limit the operation. `serializeCosNodeBytes` remains the buffering convenience
API over the same serializer. Input nodes and their existing raw stream bytes
remain caller-owned; this API does not make the document object graph lazy.

`doc.saveStream(options, storage)` yields owned PDF output chunks;
`doc.saveTo(sink, options, storage)` awaits each sink write. Both retain the
existing save options, including encryption, incremental revisions, object
streams, normalization, and linearization. Standard saves stream directly.
Linearization needs `{ fs, directory }` storage to replay the final length and
hint offsets; its retained staging is removed when iteration ends or fails.
`chunkBytes`, `maxOutputBytes`, and `signal` control output delivery. File
publication remains the caller's responsibility.

These APIs remove the complete serialized-output buffer. The document graph,
encrypted object copies, and object-stream compression inputs still reside in
memory; they are not yet a bounded-memory document engine.

This source is an I/O primitive. `PdfDocument.load`, editing, and rendering still
use the buffered document engine; they do not yet accept `PdfFileSource`.

## Feature Index

| Capability | Entry Point | Description |
| --- | --- | --- |
| Create & Load PDFs | `PdfDocument.create()`, `PdfDocument.load(bytes)` | Parse PDF 1.0–2.0 documents (`xref` tables, XRef streams, `/ObjStm`, `/Prev` revisions, damaged `startxref` repair, recoverable truncated Flate streams) |
| Page Drawing Canvas | `page.drawText()`, `page.drawRect()`, `page.drawPath()`, `page.drawImage()` | Draw styled text, vector graphics, and embedded RGB/PNG images |
| Content-Stream Redaction | `page.redact(regions, options)` | Physically strip glyphs and vector paths intersecting redaction boxes and paint replacement labels |
| Text & Table Extraction | `doc.extractText()`, `doc.extractTables()`, `doc.toSemanticAst()` | Spatial reading-order clustering (`logical`, `layout`, `raw`, `bbox`), table recovery, and semantic AST conversion |
| Page Merging & Forms | `doc.copyPagesFrom()`, `doc.getFormFields()`, `doc.setFormField()` | Deep-clone pages across PDFs and inspect or fill `AcroForm` fields |
| Form Data & Flattening | `parseFormDataBytes()`, `flattenDocumentFormFields()` | Parse FDF, XFDF, and `dump_data_fields` stanzas; bake widget appearances as resource-isolated Forms without rewriting their bytes |
| Image Extraction | `extractDocumentImages(doc.cos, options)` | Extract XObject, nested Form XObject, and inline images with CTM PPI, `/SMask` alpha, `/ImageMask` stencils, and PDF.js JPEG/JBIG2/JPEG 2000 decoding |
| Security & Encryption | `doc.save({ encrypt })`, `PdfDocument.load(bytes, { password })` | Read Standard Security Handler `R2`–`R6`; write fresh AES-256 `R6` encryption or explicit RC4 `R3` |
| Raster & Vector Export | `renderPdfPageToBitmap()`, `encodePng()`, `encodeJpeg()`, `encodePpm()`, `encodePgm()`, `encodePbm()`, `renderDisplayListToSvg()` | Paint text, images, and paths in PDF content order with curved/even-odd path clips and glyph clipping for text modes 4–7; export PNG, JPEG, PPM/PGM/PBM, and SVG with a pure-TypeScript rasterizer |

## Quick Start

```typescript
import { PdfDocument, rgb } from "@poe-code/pdf-ast";

// 1. Create a document and draw content
const doc = PdfDocument.create();
doc.setTitle("Architecture Report");

const page = doc.addPage([612, 792]);
page.drawRect({ x: 48, y: 720, width: 516, height: 36, fill: rgb(0.1, 0.2, 0.45) });
page.drawText("SYSTEM ARCHITECTURE", { x: 64, y: 732, size: 18, font: "Helvetica-Bold", color: rgb(1, 1, 1) });
page.drawText("Secret Token: 12345-ABCD", { x: 64, y: 680, size: 12, font: "Helvetica" });

// 2. Redact sensitive regions directly from the content stream AST
page.redact([[60, 670, 320, 700]], { replacementText: "[REDACTED]" });

// 3. Extract text, semantic AST, or render to PNG
const text = doc.extractText({ mode: "logical" });
const pngBytes = page.renderToPng({ scale: 1.5 });
const pdfBytes = doc.save({ normalizeContent: true });
```

Metadata and form strings use PDFDocEncoding where possible and UTF-16BE
otherwise, preserving Unicode characters through editing and saving.

After `page.redact()`, saving rewrites the file and removes unreachable objects,
including obsolete content streams and discarded image/Form resources. This also
applies when `incremental: true` is requested, since previous revisions would
retain the removed content. Content still used on other pages remains intact;
redact each occurrence that needs removal.

`page.evaluateDisplayList().operations` exposes paints in content-stream order,
including nested Forms and patterns. Isolated transparency Forms and Forms with
group opacity, blending, or soft masks appear as `group` operations; `softMask` preserves
Alpha/Luminosity mask content, backdrop, and transfer values. Standard-font glyph outlines are attached
to `glyph.outline`, keeping letters separate from page drawing paths. The `glyphs`, `paths`, and
`images` arrays remain available for inspection and extraction.

Text, paths, and stencil images preserve shading and tiling pattern fills in
bitmap and SVG output, including uncolored tiles and transformed Forms.
Text patterns follow glyph contours while preserving text clipping and strokes.
Stencil images' transformed alpha masks are available as `clipImages` on
display-list paints; source image extraction remains independent of painting.
ExtGState soft masks and Form group opacity apply to bitmap and SVG output;
SVG rasterizes soft masks at the export scale. Non-isolated Forms blend their
contents against the page backdrop, then apply group opacity and masks once.
Separate group alpha prevents the copied backdrop from being painted twice,
including on partially transparent pages. SVG uses a raster fallback for pages
whose non-isolated groups need this backdrop; other pages keep Forms as vectors.
The viewer background stays outside page blend calculations in bitmap and SVG.

All 14 standard PDF fonts use bundled PDFium/Foxit outlines and PDF.js metrics.
PNG and SVG preserve font styles without installed system fonts; SVG exports
glyph paths with accessible labels. Embedded Type1C and CIDFontType0C fonts use
PDF.js CFF decoding, including their encoding, CID selection, and font matrices.
Embedded Type 1 (`/FontFile`) programs use PDF.js decryption and conversion,
including PFB/hex containers, Differences, and composed accents. Embedded
TrueType CID fonts select outlines through `/CIDToGIDMap`, independently of
the Unicode labels used for extraction. TrueType subsets may omit `cmap`;
simple fonts recover glyph selection from PDF encodings and `post` names.
Embedded Type0 Encoding CMaps resolve
source character codes to CIDs before width and TrueType/CFF glyph selection.
OpenType CFF tables use the same PDF.js outline renderer. `doc.embedFont()`
preserves full OpenType CFF programs with their matching PDF font metadata,
including widths for every embedded glyph.
Word spacing follows encoded one-byte spaces, including remapped characters.
Explicit font width tables honor MissingWidth (zero when absent), preserving
Type 3 spacing and advances for codes outside the declared table.
ToUnicode maps decode mixed one- through four-byte character codes, including
ligatures and supplementary Unicode characters.
Bitmap, PNG, and SVG rendering honor page rotation; pixel crops use displayed
coordinates after rotation.
Pass `useCropBox: true` to render the visible page area in any bitmap, PNG, or
SVG entrypoint. CropBox coordinates are normalized and intersected with MediaBox;
an empty intersection falls back to MediaBox, which remains the default when
cropping is not requested. Display lists retain `cropBox` metadata without
changing content coordinates. `getDisplayListCropBox(list)` exposes the resolved
visible bounds for applications choosing their own output size.
Rendering also honors nonzero and negative MediaBox origins. Display-list
`origin` metadata positions the page without changing extracted or edited PDF
coordinates, including clipped artwork, shading, and soft masks.
Sampled PDF functions interpolate gradients, soft masks, and tint colors across
all input axes, including packed 1–32-bit samples and reversed encoding ranges.
Exponential and stitched functions preserve their input domains and output
ranges, with the same tint evaluation for paths and images.
Function-shading bounds clip in shading coordinates, independently of the
function-domain matrix and any page rotation or shear.
Triangle, lattice, Coons, and tensor mesh shadings use PDF.js's stream decoding
and tessellation, preserving curved control points and shared patch edges.
Calculator functions use PDF.js's JavaScript evaluator for arithmetic, bitwise
operations, conditionals, and stack operations, without dynamic code execution.
CMYK paths, gradients, and images use PDF.js's color conversion, including
indexed palettes and spot colors with a CMYK alternate space.
CalGray, CalRGB, and Lab use PDF.js's calibrated color conversion for paths,
gradients, images, indexed palettes, and spot-color alternate spaces.
Bitmap strokes preserve joins, miter limits, caps and dash continuity, and apply
opacity once across overlapping segments of the same stroke.
Zero-length dashes preserve round and square dots in bitmap and SVG output,
including patterns set through graphics-state dictionaries.
Bitmap and SVG strokes retain unequal scaling and shear. Evaluated paths keep
their segments in page coordinates; when `strokeMatrix` is present, stroke width
and dash values are in that matrix's user coordinates. Paths without it retain
the page-coordinate convention. Thin strokes retain at least one device pixel.
Glyph outlines render even when text has no usable Unicode mapping. Unicode fallback covers characters present
in the bundled standard, Symbol, and Dingbats fonts; embed a font for other scripts.
A damaged optional ToUnicode stream does not prevent rendering embedded glyphs;
text extraction may be unavailable for those glyphs.

JPEG decoding uses PDF.js for baseline/progressive, grayscale, RGB, CMYK, and
YCCK images, with PDF `/Decode` and `/ColorTransform` handling.
JBIG2 decoding supports shared `/JBIG2Globals` dictionaries, arithmetic coding,
and MMR regions. JPEG 2000 decoding handles JP2 containers, raw codestreams,
and multiple tiles; image dimensions come from the codestream. Decode failures
raise errors instead of producing placeholder pixels. Rendering and image extraction
share these decoders, including inline images; extraction retains original encoded
image bytes and JBIG2 globals for native-format export.

Short or damaged stream lengths are recovered without discarding trailing
drawing commands; correct lengths preserve delimiter-like bytes inside streams.

Circular indirect-reference chains raise a PDF parse error; long acyclic reference
chains resolve without recursive JavaScript calls.

Resource limits default to `Infinity`. Set `maxObjects`, `maxDecompressedBytes`,
or `maxRecursionDepth` when parsing to enforce explicit budgets. For serialization,
pass `maxObjects`, `maxOutputBytes`, or `maxRecursionDepth` to `serializeCosDocument`.
`maxObjects` also bounds cross-reference entries before object loading (with one
additional slot for the reserved free object zero).
The depth limit covers indirect-reference chains and nested COS arrays/dictionaries,
including repaired files and compressed object streams.
Writing and encryption dictionary traversal have no default depth ceiling.
Serialization budgets include generated object streams and linearization objects.
`maxDecompressedBytes` bounds each decoded stream and image RGBA buffer, including
masks and codec header dimensions. It is a per-buffer limit, not a total document
memory limit; codec working memory can exceed the final pixel buffer size.

For cooperative hosts, `PdfDocument.loadSteps`, `doc.saveSteps`, and `doc.copyPagesFromSteps` return generators that pause between bounded object/page batches. Yield to your host event loop between steps and check cancellation before resuming; the final generator value matches the synchronous method.
