# @poe-code/pdf-ast

Unified first-party PDF AST, parser, lossless editor, extractor, and 2D PNG rasterizer for TypeScript.

`@poe-code/pdf-ast` provides a three-layer PDF Abstract Syntax Tree (`COS Object Graph` → `Content Stream & 2D Display List` → `Semantic & Layout Extraction AST`) so applications can parse, inspect, edit, redact, merge, extract tables/text, and render PDFs to PNG with zero native dependencies.

`renderDisplayListToBitmapSteps`, encoding `...Steps` functions, and
`extractDocumentImagesSteps` expose bounded work generators for responsive
page and pixel processing. Synchronous APIs remain available.
`renderDisplayListWindowSteps(list, {x, y, width, height}, options)` renders a
pixel window in the scaled, unrotated media-box grid. Page, group and mask
surfaces use that window, and image-mask caching is bounded. It preserves the
full renderer's pixel calculations. Evaluated paths/images and nested layer
state remain caller-owned or resident; this API alone is not a complete bounded
file renderer. Its driver handles cropping, rotation and anisotropic resampling.

`renderOperationStreamWindow(page, operations, window, options)` accepts a
replayable async operation source and paints each operation before advancing.
Opaque output first scans for compositing effects to preserve background colors;
transparent output needs one pass. Sources close on success, failure and
cancellation. This avoids collecting a page display list; individual evaluated
paths, decoded resources and nested captures still retain their existing memory
ownership.

Pass `imageStorage` to retained page evaluation to keep decoded image pixels in
caller-owned random-access backing. Parser and evaluated path segments also use
fixed-size blocks in that backing; fill, clipping and pattern bounds replay
without collecting segment arrays. `renderOperationStreamWindow` reads these
pixels with a fixed range cache and stages downsampling levels in that same
backing, preserving the buffered sampling math. Keep the backing alive until
painting finishes, then close it. Parsed stroke point lists and dash runs spill
to that backing with fixed caches for forward and reverse joins. Clip lists use
persistent fixed-size pages, preserving graphics-state snapshots and clip order;
text clipping streams glyph outlines into the same backing. Transparency-group
and soft-mask captures replay caller-backed operation records, retaining one
operation’s metadata at a time. Nested graphics and marked-content frames also
use linked caller-backed records, with only the active state resident. Individual
codec/color/font and operation metadata retain their own memory requirements. Stored geometry is
for the asynchronous raster driver; buffered display-list/SVG APIs retain their
existing synchronous representation.

`await renderRetainedPagePixels(page, storage, options)` returns
`{ width, height, pixels }` with row-major RGBA chunks. It replays retained page
operations into fixed-size windows, stages tiles on caller storage, and applies
crop boxes, quarter-turn rotation, output cropping and asymmetric DPI without a
full-page pixel allocation. Consume `pixels` directly or pass it to
`encodeRetainedPng`; stopping consumption cleans the temporary pixels. Use an
external backend for large pages. `tileSize` defaults to 128 and `chunkBytes` to
65536. `maxPixelWorkingBytes` admits driver scratch, excluding rasterizer window
surfaces and evaluator resources; individual decoded resources and metadata
still need bounded ownership. Rendering repeats page evaluation per
tile and uses seekable staging before yielding the first output chunk.

`PdfFileSource.open(fs, path, options)` provides retained random-access input
using the caller's safe-fs. `read(position, maxBytes)` returns owned bytes up to
`chunkBytes`, and `stream(position, length)` yields ranges under consumer
backpressure. Always close the source in `finally`. The default range cache is
256 KiB with 64 KiB chunks; `maxInputBytes` rejects oversized inputs before any
payload read. Sources require retained-read support and never reopen a pathname
or fall back to whole-file reads. `releaseCache()` drops cached ranges after
accepted reads while keeping the same retained identity, so inactive inputs need
not retain their range buffers. The caller chooses and owns the backend;
memory-backed safe-fs still stores its files in RAM.

`new PdfStagingStorage({ fs, directory }, maxBytes)` provides one aggregate
scratch-storage allowance. Pass that same storage instance to document/index,
content, font, image and output owners, and use `storage.fs` for input staging.
`liveBytes` includes pending writes and simultaneous merge inputs/outputs;
capacity returns after successful retained cleanup. Failed or uncertain cleanup
keeps its charge, so restart the operation only after reconciling backend state.
This view is for retained regular-file scratch staging, not publication. It does
not account for resident memory or make a RAM backend suitable for large spills.

`new CosRangeLexer(source, options)` reads COS tokens asynchronously from a
retained source. Await `nextToken()` or `skipWhitespaceAndComments()`, and set
`offset` to seek between operations. It uses the buffered lexer's grammar,
including numeric and malformed-string recovery, with one input chunk plus the
source cache. Returned tokens own their bytes. The active token is additional
memory: set `maxTokenBytes` to bound decoded strings and encoded names/numbers.
`start`, `end`, `knownCommands`, and `signal` control scanning. The caller closes
the source after use; the lexer does not collect a document or own its handle.

`iterateCMapCharacters(cmap, bytes)` and
`parseToUnicodeCMap(mapping).iterateBytes(bytes)` decode text characters lazily.
They avoid token-sized string copies and glyph arrays; returning early stops
reading the token. `readCMapCharacters` and `decodeBytes` remain buffered
convenience APIs. The shared page evaluator uses lazy glyph decoding.

`parseCharacterCMap(bytes, { maxWorkingBytes, onAllocation })` and
`parseToUnicodeCMap(bytes, { maxWorkingBytes, onAllocation })` admit conservative
lexer scratch and expanded mapping state before allocation. The callback lets a
containing owner account for the same allocations; its failures propagate even
when malformed optional mappings would otherwise be ignored. Input bytes remain
caller-owned. This accounting does not cover embedded font program parsers.

`page.evaluateSteps(storage, options)` pulls complete retained-page paint
operations, including annotation appearances and widget fallback text.
`hideAnnotations` matches the buffered page option. A resource prepass preserves
fonts and other resources supplied by later appearances; each prepass cursor
closes before the next annotation, then appearance events stream on demand.
The same staging allowance and conservative resource admission cover page
preparation and evaluation. Individual paths, composite captures and admitted
raster images still use the shared resident representation; this is not yet a
bounded page renderer. Use `page.annotations()` separately for link metadata.

`page.streamRawText(storage, options)` emits UTF-8 raw-mode page text from
retained evaluation. `streamRawTextChunks(glyphs, storage, options)` formats an
existing glyph stream the same way. It preserves ActualText, paragraph spacing,
clipping/diagonal filters and hyphen joining, while staging one line at a time
to determine its final geometry. Optional `crop: [x0, y0, x1, y1]` selects whole
words by bounding-box center in page coordinates, staging one word in addition
to the current line and preserving original paragraph boundaries. `chunkBytes` bounds output buffers;
`maxWorkingBytes` admits formatter scratch before input is pulled. Page resource
and rendering allocations still belong to the evaluator described above.

`page.indexRawText(storage, options)` retains raw-order blocks, lines, words and
geometry on caller storage. `PdfRawTextIndex.create(glyphs, storage, options)`
accepts an existing glyph stream. Traverse `blocks()`, `lines()`, `words()` and
chunked `word.text()` without collecting arrays; close the index after all
borrowed iterators finish. The index uses four 16 KiB cache pages and admits
80 KiB of fixed byte buffers with `maxWorkingBytes`; caller glyph strings and
evaluator resources are separate. `maxStorageBytes` bounds page-rounded backing
allocation, with optional word, line and block limits. Traversals and large
individual strings yield to cancellation. Logical/layout ordering is not provided.

`page.annotations()` pulls link rectangles, contents, and external or internal
URIs from a retained page. Named and legacy destinations share the buffered
page API's interpretation. Destination page traversal uses caller-backed
storage, closes before yielding a result, and stops when the target is found.
Annotations are returned individually; callers own any results they collect.
Individual COS arrays/dictionaries still use the object reader's admitted
representation.

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

`evaluateRetainedContentSteps(document, content, parameters, storage, options)`
pulls paint operations from decoded content chunks and retained resources. Pass
`page.streamContents()` as content and the page geometry/resources as parameters.
Forms, Type3 glyphs, fonts, images, masks and shading share caller-backed staging;
returning or failing closes every content cursor. `maxStagingBytes` covers their
combined live scratch files, and `maxResourceBytes` conservatively admits
resource allocations across the traversal. The font cache retains at most
`maxCachedFonts` entries (16 by default). With `imageStorage`, paths, captures,
and CID-to-glyph tables use the caller-owned backing. CID lookup reads only the
selected byte pair, including odd trailing bytes. Font programs and individual
resource metadata still have separate resident ownership. Unicode and encoding
CMap sources parse incrementally from retained tokens; skipped comments do not
become resident source buffers. Mapping tables and individual tokens remain
separately admitted state.

`renderRetainedShading(document, node, settings, storage, options)` renders a
selected shading through retained reads. It shares the buffered renderer for
all seven PDF shading types, skips ICC profile payloads and unrelated resources,
and stages only addressable indexed palette entries. `maxWorkingBytes` and
`onAllocation` cover selected resource snapshots, mesh geometry and the result
surface together. Mesh records and sampled function tables use caller-authorized
backing with fixed caches. Sample interpolation visits vertices incrementally;
PostScript source, instructions and nested parser frames also use caller backing;
execution uses the native calculator arithmetic with a separate fixed stack per
evaluation. Selected resource metadata remains resident.

`doc.formFields()` streams field summaries containing `name`, `type` and `value`.
It preserves hierarchical names, inherited values, widget grouping and repeated
fields while keeping traversal state on caller storage. Returning early or
closing the document releases its field traversal.

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

`PdfRetainedJbig2.open(source, width, height, options)` reads encoded input and
optional retained `globals` through fixed range caches, skipping unused extension
payloads. With `bitmapStorage`, packed page, text/halftone-region pixels, halftone
gray-code planes, shared pattern pixels, arithmetic/refined symbols and Huffman
collective symbol bitmaps, symbol descriptors, width tables, export flags, custom Huffman and symbol-ID tables, and dictionary indexes
use caller backing and two fixed
read/write caches. Generic regions stream through a bounded
template-row window, and sequential/random-access segment headers use bounded
passes, with extended reference lists read on demand from the source. The retained PDF adapter supplies safe-fs backing and shares its
staging/cleanup budgets. It emits owned RGBA `rows()`; standalone files use their
embedded dimensions. `maxWorkingBytes` conservatively counts persistent decoder
allocations, peak released dictionary/region/header scratch and one RGBA row;
source caches and fixed shared codec tables are additional. `maxOutputBytes`
bounds decoded output. Sources stay caller-owned and may close after opening;
call `close()` to cancel pending row reads and release decoder references.
Without backing, the convenience decoder retains its packed page bitmap.
Fixed arithmetic context tables and bounded template-row windows remain resident.

`PdfRetainedJpx.open(source, options)` reads encoded JPEG 2000 ranges through a
fixed cache and skips unused container boxes without copying their payloads.
It admits tile grids, codeblocks, tag trees and wavelet buffers before allocation.
Its `rows()` iterator assembles owned RGBA rows with tile overlap precedence,
avoiding additional full sample/RGBA planes. With `coefficientStorage`, coefficient
planes, arithmetic bit-model arrays, wavelet scratch, converted tile samples,
precinct trees, packet/codeblock records, and resolution/subband descriptors use caller backing.
Fixed page, component and four-resolution caches bound active metadata; component descriptors and iterator bounds use backing. Wavelet levels and independent color components are consumed incrementally. Tile-part indexes preserve interleaved input while decoding one tile at a time. The retained PDF image adapter supplies this backing
through the caller's safe-fs and includes it in shared staging and cleanup budgets.
Compressed codeblocks read their encoded segments without concatenation. Coding-parameter metadata remains resident for the current tile; without backing, the convenience decoder also retains its sample/wavelet planes. `maxWorkingBytes` uses conservative cumulative
allocation charges (not measured heap); caller source caches and resolved color
state are additional. Set `maxOutputBytes` to bound output, supply `color` for
resolved PDF color spaces, and call `close()` to release tiles. The source stays
caller-owned and can close after opening the decoder.

`PdfRetainedJpeg.open(source, options)` reads encoded JPEG ranges through a fixed
cache and admits decoder allocations before decoding. `rows()` yields owned RGBA rows without full RGB or
RGBA planes; `width`, `height` and `components` describe the decoded image.
`maxWorkingBytes` conservatively charges parse allocations, including metadata,
and reuses one row-scratch allowance; `maxOutputBytes` admits image dimensions.
Supply caller-owned `coefficientStorage` to keep DCT blocks and converted samples
in backing storage with fixed block scratch. Retained PDF image decoding supplies
this storage through the injected filesystem, shares its staging budget with
image/mask streams, and cleans it on every exit. Without it, the standalone
convenience decoder retains coefficient planes.
The source stays caller-owned and can close after `open()`; call `jpeg.close()`
to release decoder references. PDF Decode and ColorTransform options are supported.

JPEG, JPEG 2000 and JBIG2 options also accept `onDecoderAllocation(bytes)`
to admit input scratch and intrinsic decoder state to a containing owner before
allocation. Their `decoderBytes` total matches these admissions. Row scratch is
separate, and the containing owner controls release of its reservations. Retained
image decoding uses this hook for its shared image/mask working allowance.

`resolveRetainedImageColor(document, colorNode, resources, storage, options)`
resolves only the selected color resource using the buffered engine's color rules.
ICC profiles supply component metadata without decoding their payload. Indexed
palettes keep at most 256 addressable entries while validating the complete
stream. Calibrated and tint-function state survives document closure; function
streams use caller-backed staging before admitted materialization.
`maxWorkingBytes`, `maxNodes`, `maxDepth` and `maxStagingBytes` bound that state;
object-reader/parser and I/O caches are additional memory.
The retained image decoder instead uses `openRetainedImageColor`: sampled tint
tables stay in caller storage until the image closes. Row conversion and indexed
palettes share asynchronous sample evaluation, including JPEG 2000 tint rows.

`convertRetainedContentColor(document, colorNode, name, components, resources,
storage, options)` converts vector paint colors with the same calculations as
buffered evaluation. It resolves selected resources asynchronously, reads ICC
metadata without loading profiles, and retains only the selected Indexed palette
entry while validating the remaining decoded stream. Calibrated and tint-function
state uses the same admission options as retained image colors. The RGB result
has no borrowed-source lifetime.

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

`parseContentRangeEvents(source, storage, options)` applies the shared content
grammar to a retained source, yielding text, paths and group boundaries without
collecting a group tree. Inline images borrow `{ source, start, end }` ranges.
For decoded chunks, `parseContentStreamEvents(page.streamContents(), storage,
options)` owns the staging source and cleans it on completion, early return,
cancellation or failure. Consume borrowed image ranges before closing the
iterator. This seek-dependent parser stages all decoded content before its first
event; `maxStagingBytes` covers both that content and live operand recovery runs.
Concurrent cursors and intrinsic path/operand memory require enclosing admission.

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
`evaluateContentStreamSteps(options)` accepts an iterable of content nodes and
yields one evaluated operation at a time, including capture/mask membership.
Returning from its iterator closes the input.
`evaluateContentSteps(options)` exposes the underlying suspension protocol:
answer `{ kind: "node" }` with `.next(node)` (or `undefined` at EOF), and consume
`{ kind: "paint", ... }` before resuming. A driver can await input between steps. A `{ kind: "font", name, resources }`
request asks only for the font the current text uses; answer it with a resolved
font (for example from `resolveRetainedFont`) or `undefined`. The synchronous
driver caches selected fonts, while retained callers control their own cache.
`parseContentSteps()` shares the buffered parser’s grammar, requesting normalized
operators and inline-image bytes and emitting content events. Group boundaries
and incremental text fragments feed the evaluator without building a group tree;
individual path geometry, operands and inline-image bytes still need admission. It avoids a page-wide output list;
composite captures use caller backing when `imageStorage` is supplied.
Retained mesh shading streams free-form triangles and stores lattice vertices
and patch control points in the caller's filesystem. Fixed caches and one-patch
tessellation preserve global subdivision density without retaining a whole mesh.
Fill and clip rasterization replay projected edges and cubic points with
row-sized crossing scratch; scratch is local to each render. Stroke outlines
and their projected raster edges also stream. Retained parser paths, stroke
points, dash expansion and geometric clip lists use caller backing. Sampled
functions for vector colors, masks and shading use range reads from caller storage.
Image tint rows also read sampled tables from caller storage. PostScript
instructions replay from storage without collecting a syntax tree. Individual
operation and font metadata still have separate memory ownership.

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

`resolveRetainedFont(document, storage, resources, name, options)` resolves one
font through retained object reads. With `resourceStorage`, TrueType programs,
name offsets and glyph point scratch use caller backing. Table and character
lookups read bounded ranges; simple and compound glyph segments stream into
caller-backed paths, including patterned fills and text clips. Glyph scratch is
reused after iteration, and cancellation and backend errors retain their identity.
CFF and Type 1 programs still admit their intrinsic parser buffers before allocation. `maxWorkingBytes`,
`maxStagingBytes`, `onAllocation` and cancellation apply to this font operation.
The returned font belongs to the caller; this does not account for the document's
separate parser/decoder state or qualify aggregate Worker memory usage.

All 14 standard PDF fonts use bundled PDFium/Foxit outlines and PDF.js metrics.
Standard-font decoding, mapping and outline allocations are admitted to the
containing font owner; owned renderers do not share another request’s budget.
PNG and SVG preserve font styles without installed system fonts; SVG exports
glyph paths with accessible labels. Embedded Type1C and CIDFontType0C fonts use
PDF.js CFF decoding, including their encoding, CID selection, and font matrices.
Embedded Type 1 (`/FontFile`) programs use PDF.js decryption and conversion,
including PFB/hex containers, Differences, and composed accents. Embedded
TrueType CID fonts select outlines through `/CIDToGIDMap`, independently of
the Unicode labels used for extraction. TrueType subsets may omit `cmap`;
simple fonts recover glyph selection from PDF encodings and `post` names.
`parseTrueTypeFont(bytes, { onAllocation })` reports metadata, name/width tables,
TrueType point/contour scratch and compound outline allocations before creating
them. Input remains caller-owned. Embedded CFF copies, indices, dictionaries,
charset/FDSelect expansion and charstring parser scratch also report admission;
Type1 token growth, decryption, CID tables and recursive charstring conversion
also report admission; skipped comments use constant lexer scratch. TrueType character maps use direct range lookups over the font bytes without
expanding ranges into per-character Maps. Ordered ranges use binary search;
overlapping ranges retain their existing last-match behavior.
Embedded Type0 Encoding CMaps resolve
source character codes to CIDs before width and TrueType/CFF glyph selection.
Retained evaluation with caller resource storage keeps Unicode and Encoding CMap
ranges in fixed-depth backed trees and streams destination arrays into that same
storage. Mapping overrides, variable-width codes, and Unicode recovery match the
buffered APIs; range size does not expand resident mapping tables.
OpenType CFF tables use the same PDF.js outline renderer. Its path cache retains
at most 256 KiB of conservatively sized outlines; evicted outlines are rebuilt
on demand. Outline compilation and conversion report allocations to the
containing font owner before growing state, including subroutine expansion.
CID CFF matrices normalize directly without recompiling a duplicate font.
Type1 outlines consume converted glyphs directly, without compiling and reparsing
a whole CFF stream; compiled bytes remain a lazy convenience. Conversion copies
and mapping state report allocations to the containing owner.
CFF font-program parsing reports its intrinsic allocations to the same owner;
Type1 token growth, decryption, CID tables and recursive charstring conversion
also report admission; skipped comments use constant lexer scratch. `doc.embedFont()`
preserves full OpenType CFF programs with their matching PDF font metadata,
including widths for every embedded glyph.
Word spacing follows encoded one-byte spaces, including remapped characters.
CID width ranges remain compact and preserve later array/range overrides; they
do not allocate one entry per CID. Explicit font width tables honor MissingWidth (zero when absent), preserving
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

`serializeRetainedCosDocumentChunks(options, storage)` writes ordinary PDFs from
objects in increasing object-number order. Supply `{ value: dictionary, stream:
{ length, chunks } }` to emit encoded stream bytes without buffering the payload.
Already serialized bodies may instead supply `{ body: { length, chunks } }`;
these exclude `obj`/`endobj`. Their producer owns COS syntax and stream encoding,
while the writer checks exact length, output admission and cancellation.
Cross-reference offsets use a 64 KiB cache backed by the supplied safe-fs; use an
external backend for large indexes. The caller owns stream encoding/encryption
and atomic publication. `maxIndexBytes`, `maxObjects` and `maxOutputBytes` admit
backing slots and output before use. Object-stream generation and linearization
remain available through the existing serializer.

`retainedCosObjects(document, storage, options)` supplies every live indirect
object, including unreachable objects, in identity order for rewriting or editing.
Pass it to `serializeRetainedCosDocumentChunks` with the document's root, info,
ID and version fields. Encoded payloads stream directly; decrypted payloads use
caller backing to establish their output length. Consume each object's stream
before advancing and keep the source/document open until iteration ends.
`maxObjects`, `maxStreamBytes` and `signal` govern admission and cancellation.
This low-level COS path preserves the graph; it does not flatten page trees or
encrypt output. `findPdfStartXref(source, options)` locates the latest cross-reference
revision with bounded reverse reads; pass the offset to `readCosXrefRevision`
to inspect its rows without collecting the document.

`PdfMutableObjectStore` holds edited objects and encoded stream chunks on the
caller filesystem. Reserve references with `allocate()`, replace values with
`set()`, resolve owned snapshots with `get()`, and pass ordered `outputObjects()`
to the retained writer. Output bodies replay staged syntax in 16 KiB chunks
without reconstructing arrays, dictionaries or strings. Stream dictionaries
have a separate staged output form with the corrected length; `get()` preserves
the accepted value. Use `objects()` only when parsed values are needed. A replacement becomes visible after all payload bytes arrive;
older snapshots remain valid until `close()`. The 64 KiB byte cache and bounded
index caches do not grow with object count. Backing is append-only until close,
so `maxStagingBytes` includes superseded values; parser limits govern individual
COS values. Close the store on every outcome.

`saveRetainedDocumentChunks(document, storage, options)` saves the complete
object graph with the ordinary document-save page-tree behavior: inherited page
attributes become explicit, page parents point to the root, and the root's
`Kids` array streams from caller-backed reference records. Object snapshots and
encoded payloads remain on caller storage. Authenticated input saves without
output encryption. Use `maxPages`, `maxObjects`, `maxOutputBytes`,
`maxRecursionDepth`, `chunkBytes` and `signal` to control the operation; keep the
source/document open while consuming it and stage bytes before publication.
Use `version` to override the output PDF version and `omitId: true` to omit the
original trailer identifier; both are preserved by default. Existing linearization
dictionaries retain the ordinary writer layout; `linearize: true` also enables
that layout for ordinary inputs. Linearized output stages on caller storage so
its fixed-width offsets can be patched before any output is yielded.
Use `objectStreams: "generate"` to pack eligible objects and emit compressed
cross-reference entries. Membership, payloads and indexes use caller storage;
compression runs incrementally and upgrades older output versions to PDF 1.5.
`normalizeContent: true` suppresses object-stream packing, as in the ordinary
writer. Retained objects preserve encoded stream snapshots; this option does
not force decoding streams that have not been edited.
`removeInfo` keeps an
existing modification date and removes the catalog metadata link;
`removeMetadata`, `removeStructure`, `removeAcroform` and `removePageLabels`
remove the corresponding document entries while preserving other objects.
Pass `rotations` as an iterable or async iterable of `{ pageIndex, degrees,
relative? }` edits. Indices are zero-based, angles are multiples of 90, and
ordered relative edits accumulate without collecting the selection.

`editRetainedDocument(document, storage, options)` applies ordered rotations and
information/metadata/structure/form/label removals to a caller-backed editable
graph. Use its `document` for subsequent copies and close the result when done.
It preserves unsaved stream dictionaries, trailer identifiers and logical page
identities across edits. Set `linearize: true` to append a linearization marker
for subsequent saving; this preserves existing markers and is also the behavior
of qpdf `--linearize`. Pass `pageLabels` as an iterable or async iterable of
`{ index, style?, start?, prefix? }` entries to replace page labels. Indices are
zero-based; entry order and duplicates are preserved, and an empty iterable
creates an empty label tree. Labels take precedence over `removePageLabels`.
`PdfRetainedDocument.openStore(store, storage, { rootRef, infoRef })` reads an
existing `PdfMutableObjectStore`; the caller keeps ownership of that store.

`createRetainedPageCopy(document, indices, storage, options)` owns a copied graph
on caller storage. Use `openDocument()` to compose more retained operations or
`chunks()` for PDF output, then `close()` to release its backing. Stream length
references survive composition until the final save.

`copyRetainedPagesChunks(document, indices, storage, options)` emits a standalone
PDF for a synchronous or asynchronous iterable of zero-based page indices.
Use `pageRotation(document, index)` to override a source rotation before
indirect values are cloned. A selection can carry caller-backed `resourceState`
membership to preserve resource materialization across repeated batches.
Order and repeated pages are preserved, along with shared resources, forms,
optional content and document metadata. The single-page spelling
`copyRetainedPageChunks(document, pageIndex, storage, options)` remains available.
Selection records, source identity maps and target object bodies use caller
backing; the flat output page tree and encoded stream payloads stream in chunks.
To combine sources, pass a synchronous or asynchronous iterable of
`{ document, indices }` as `copyRetainedPagesChunks(sources, storage, options)`.
Each source is fully copied before the iterable resumes, so a source generator
can close that document and its input before opening the next. Metadata comes
from the first source unless `metadata` supplies an override; pass `{}` to keep
only the default producer. Forms accumulate with the ordinary page-copy behavior.
With `includeOutlines: true`, full-document selections flatten source outlines,
preserving titles and destinations with source offsets and first-page fallbacks.
Traversal frames, outline records and page-reference indexes use caller storage.

With `includePageLabels: true`, full-document selections retain source page labels
offset by the preceding copied pages. Label records and the final number tree use
caller storage and streamed output.

With `includeAttachments: true`, all source embedded files are merged; the first
occurrence of each filename wins. Attachment payloads are recompressed in bounded
chunks and staged before their source closes; the destination name tree streams
from caller-backed records.
Page and form reference lists remain on caller storage. Source-specific indexes
close after each source, and `maxPages` applies across the whole operation.
Page copying scans each source page tree once; outline destination resolution
may build an additional caller-backed page index. Supply `maxPages`, `maxObjects`,
`maxOutputBytes`, `maxRecursionDepth`, `chunkBytes` and `signal` as needed.
Individual COS arrays and dictionaries still materialize under parser limits.
Consume or return the iterator to release scratch storage, and stage output
before publishing it atomically.
