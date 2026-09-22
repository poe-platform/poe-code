# PDF parser research and qualification design

Research date: 2026-09-21. Task: `parser-research` in
[safe-bash-pdf-parser.md](safe-bash-pdf-parser.md). Research deliverable only:
`packages/pdf-parser` remains proposed, private, first-party and zero external
runtime dependencies. No parser implementation, command integration, dependency
adoption, native/WASM execution or compatibility gate is admitted by this document.
The target remains mature PDF 1.0–2.0 behavior; increments do not reduce that target.

## Specification pins and evidence boundary

- Adobe **PDF Reference, sixth edition, version 1.7, November 2006**, including
  historical version annotations: [retrieved PDF](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf).
  Retrieved 32,453,129 bytes; SHA256
  `4aa598e7e2cc88867565fae793db38c140a10ca2b5551dccdb45e2124282ce29`.
  Qualification references: §3.1 lexical conventions, §3.2 objects, §3.3 filters,
  §3.4 file structure, §3.5 encryption, §3.8 common data structures, §5 fonts,
  §9.10 extraction, Appendix D encodings and Appendix F linearization.
  Download identity is verified; this run did not execute a specification PDF
  extraction or claim a complete normative review of every clause.
- ISO **32000-1:2008** and **32000-2:2020** are the normative edition targets.
  The full ISO texts were not retrieved in this task. PDF 2.0 semantics cannot
  be inferred solely from a version header or open-source feature list.
- PDF Association [32000-2:2020 errata index](https://pdf-issues.pdfa.org/32000-2-2020/),
  retrieved HTML snapshot SHA256
  `7ee4e906ba24c6e55aea72fd3d176a64360800545e6ac58797e3a1e2f9e823fd`.
  [Clause 7](https://pdf-issues.pdfa.org/32000-2-2020/clause07.html):
  `4241412791de5d3affaaab3c5bbdb1384a99c290bd97165d8a787b5f15c32f82`;
  [clause 9](https://pdf-issues.pdfa.org/32000-2-2020/clause09.html):
  `71dc5800cf1806c8719ef0d9a7f646c70cf46af895b07dcf7b0f8941d69400f2`.
  These mutable pages are pinned by retrieval date/hash, not a source commit.
  Clause 7 confirms direct Prev, xref dictionary direct-entry constraints,
  historical introduction of object/xref streams in PDF 1.5 and text-string
  encoding roles. Clause 9 clarifies supplementary-plane ToUnicode examples
  and ToUnicode dictionary requirements. Errata is not a replacement for the
  complete specification. UTF-16LE observed in implementations is a separate
  recovery cell; do not equate it with normative UTF-16BE text strings.

The attempted `clause7.html` URL returned 404; the correct `clause07.html` was
retrieved. Source research used HTTPS into task-owned temporary storage and does
not authorize network access in the shipped engine. `/out` is read-only on this
host; temporary sources used ignored `out/pdf-parser-research`, purged after audit.

## Pinned source comparison

All revisions below were retrieved directly without installing packages or running
upstream parsers. URLs identify the precise source family; source hashes in the
provenance table identify representative inspected files.

| Project / revision | Object loading and ownership | Filters, encryption and recovery | Applicability |
| --- | --- | --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js/tree/579c4b700f23f7782234f03358b5e9eaa3f58889) `579c4b700f23f7782234f03358b5e9eaa3f58889` | `src/core/parser.js` Lexer/Parser constructs primitives; `xref.js` lazily fetches referenced objects and caches them; document/catalog/page logic is above syntax | Parser constructs filter stream chains; crypto owns security handlers and object transforms. Xref traverses latest sections first and fills unset entries, tracks visited offsets, queues XRefStm/Prev; repair can rebuild indices. Evaluator owns font/CMap/text interpretation | Most relevant JS architectural reference; rendering/worker/asset machinery and permissive repair are not the desired API contract |
| [pdf-lib](https://github.com/Hopding/pdf-lib/tree/93dd36e85aa659a3bca09867d2d8fac172501fbe) `93dd36e85aa659a3bca09867d2d8fac172501fbe` | `PDFObjectParser` creates typed context objects; `PDFParser.parseDocument` scans document sections into a mutable PDFContext, rather than relying on an authoritative lazy revision index; object streams are eagerly parsed into context | `streams/decode.ts` owns Flate/LZW/ASCII85/ASCIIHex/RunLength chains; object parser checks direct Length then scans fallback markers. Root recovery enumerates Catalog dictionaries. This inspected parser is not evidence of supported encrypted extraction | Useful object/writer comparison; mutable normalized objects do not supply lossless revision provenance by themselves |
| [qpdf](https://github.com/qpdf/qpdf/tree/54d6053af283bbeb8b325f4886c0f65cc51f2b80) `54d6053af283bbeb8b325f4886c0f65cc51f2b80` | `QPDFParser.cc` parses objects; `QPDF_objects.cc` Objects owns xref traversal, object resolution/cache and reconstruction; `QPDFObjectHandle` represents graph objects | `QPDF_Stream.cc` owns raw/decoded pipeline choices and filter registry; `QPDF_encryption.cc` owns security. Recovery can be suppressed, reconstruction guarded against repeats. QPDF.cc supports explicit memory/InputSource as well as filename entry points | Structural and graph-aware rewrite reference; does not provide a font/layout reading-order engine. Native C++ implementation is not authorized runtime code |
| [MuPDF](https://github.com/ArtifexSoftware/mupdf/tree/89c1d183a7fb724898b2017d6ecd402a61886d4f) `89c1d183a7fb724898b2017d6ecd402a61886d4f` | `pdf-parse.c` parses refcounted pdf_obj values; `pdf-xref.c` owns section state, lazy cache, object streams and repair | `pdf-stream.c` composes fz_stream filters, raw/decrypted paths and explicit Crypt handling; `pdf-crypt.c` owns authentication. Xref loading may repair document state on failure | Independent structural comparison; no AGPL source adaptation or native engine adoption authorized |
| [Poppler](https://github.com/tsdgeos/poppler_mirror/tree/0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46) `0595ca8e76f575e5f16ccc5ee6d4b552d31b0a46` | Supplementary source trace only: `Lexer.cc` string token handling and `UTF.cc` conversion helpers | Literal and hex paths call utf8ToUtf16WithBom before TextStringToUCS4; inspecting only UTF.cc would miss UTF8 BOM support | GPL behavioral reference; no copied source, native execution or text-order oracle in this task |

The older 75 PDF.js lexical controls described in the parent plan are inherited
observations, not fresh execution receipts here. Its xref-stream overflow and
compressed-object repair observations are acceptance requirements, not defects
reported against an implemented first-party parser.

### Concrete differences to preserve in acceptance

PDF.js `readXRefStream` defaults zero-width type to 1, absent Index to [0,Size],
and distinguishes free/uncompressed/compressed entries. Its bitwise accumulator
can truncate offsets to signed 32 bits: first-party offsets require checked
unsigned arithmetic or bigint and validation against source length before number
conversion. Use bounded Maps/range tables, never sparse arrays indexed by untrusted
Size/object ids. Validate Index cardinality, overlaps, widths, entry byte products
and fields before retention. Latest revisions, hybrid precedence, free/reused
objects and generations must be explicit; a cache key includes document identity,
revision resolution and generation, not object number alone.

Validate ObjStm N/First, header containment, unique positive object numbers,
nonnegative ordered payload offsets, index bounds, zero compressed generations
and forbidden embedded streams before allocating N-sized structures. PDF.js can
repair an index mismatch and retain other objects decoded from the same stream;
our recovery and live-cache accounting must name both choices.

Indirect Length resolution and aligned endstream checks precede bounded scanning.
Binary payload can contain `endstream`; ambiguity produces a diagnostic rather
than an invented boundary. BI/ID/EI content parsing needs image geometry/codec
rules (JPEG markers, ASCII85/ASCIIHex EOD, unfiltered sample count); substring EI
is insufficient. Abbreviations allowed for inline images and tolerance of them
in ordinary streams are independent syntax/recovery policies. Long/short filter
and DecodeParms keys, refs/null params and array pairing require explicit context.
Decode filters in array order; only the first sees raw encoded length. LZW
EarlyChange defaults 1. Predictors require checked row/sample products.

PDF.js unsupported-filter passthrough, NullStream fallback and ASCIIHex invalid
character skipping are recovery behavior, not successful strict interpretation.
Lexical odd hex at EOF and ASCIIHex stream EOF differ in the pinned source.
BrotliDecode is an extension cell; its presence does not qualify all PDF 2.0.
Quota exhaustion and cancellation always propagate, never become repair warnings.

PDF.js evaluator can fetch built-in CMaps/standard fonts via URLs or worker
messaging and can normalize Unicode/run bidi. Adopt none of those host defaults.
Only versioned bundled licensed assets or explicitly supplied byte capabilities
are admissible. Retain raw code/CID/glyph, chosen mapping, source ranges, geometry
and normalization/order decisions. A text run is not proof of Poppler-compatible
reading order; glyph-name fallback, ligature normalization, ToUnicode overrides,
ActualText and extraction modes qualify separately.

## Existing first-party code audit

| Source | Current behavior | Proposed disposition |
| --- | --- | --- |
| `packages/pdf/package.json`, `src/index.ts` | Private writer @poe-code/pdf, external pdf-lib 1.17.1, @pdf-lib/fontkit 1.1.1, pako 3.0.1; supplied-font LTR PDF 1.7 profile | Do not import whole package or its dependency-bearing objects; rendering remains separate |
| `packages/pdf/src/serialization.ts` | Bounded classic xref writer, contiguous generation-zero identities, validates direct graph/reference membership; rejects Encrypt/ID and sparse identities | Learn bounds/serialization accounting; not a mature qpdf writer, not revision parser, not signature-preserving rewrite |
| `packages/pdf/src/font-admission.ts`, admission in `src/index.ts` | First-party sfnt directory/range/metrics/cmap validation before fontkit; cmap formats 0/4/6/12/13, glyf/loca ranges, explicit supplied bytes | Potential cohesive extraction later with failing tests first; no PDF simple/CID/CFF/Type3/ToUnicode semantics and no complete font parser |
| `packages/pdf/src/text-string.ts` | Emits UTF16BE using PDFHexString, validates input surrogate pairs | Writer behavior only; do not apply text decoding to all binary strings |
| `packages/pdf/src/png.ts` | Pako Inflate, bounded expected scanlines, PNG framing/CRC checks | Dependency-bearing image pipeline; not reusable as zero-dependency PDF Flate |
| `packages/office-package/src/compression.ts` and safe-bash byte `compression/codec.ts` | Bounded cooperative pako-backed raw deflate/gzip; codec adapter composes shell diagnostics/readBytes/yield | Bounds/cancellation examples; runtime dependency prohibits direct closure reuse |
| safe-bash byte `compression/codec-loader.ts` | Generated JS bzip2/xz/zstd codecs, explicit unavailable host hooks, bounded step interface | No PDF zlib/LZW decoder supplied; generated upstream/native-derived source needs separate provenance/license scrutiny, not automatic first-party admission |

No new external runtime imports or package installations were made. Current
safe-bash artifact dependencies do not discharge the new parser closure's zero
external-runtime requirement; neither an empty manifest nor bundling upstream
code converts an unapproved dependency into first-party source.

## Proposed engine contract and ownership

The engine is a leaf, proposed `@poe-code/pdf-parser`, `private: true`, with no
external runtime dependencies. It owns PDF semantics and accepts bytes only.
Commands own VFS acquisition, stdin spooling, diagnostics presentation and writes.
An explicit random-access source has known admitted length and bounded
`readAt(offset,length,signal)`; a command-owned bounded spool handles stdin.
No path/URL overload, ambient fs/network, worker fetch, host-font lookup,
process execution, executable PDF actions or engine-selected crypto randomness.

Proposed APIs (design names, no published SDK claims): openDocument(source,
policy,budget,signal); document.readObject(reference); document.readRaw(range);
document.openRawStream(reference); document.decodeStream(reference,capabilities);
document.readPage(index); document.close(). Public methods are asynchronous where
cooperative scheduling is necessary; raw slices are source-range descriptors,
not accidental copies or mutable aliases. Supplied sources/assets must have a
stable invocation snapshot contract; reads return admitted owned bytes. Copies,
retained source chunks, decoded buffers and result arrays charge before allocation.
Document close releases invocation reservations and invalidates further use.

Values form a discriminated model: exact number token plus safe interpretation,
boolean, null, byte name, byte string, array, ordered dictionary entries, reference
(object/generation), raw stream descriptor. Every value has lexical byte range;
resolved objects add revision/xref location and original generation. Dictionaries
retain duplicate entries; semantic lookup uses an explicit policy with diagnostics,
not irreversible Map replacement. Raw lexical string spelling and decoded string
bytes are distinct; PDFDocEncoding/BOM conversion is role-based semantic work.
Encrypted/signature/font-code strings never undergo indiscriminate text conversion.
Objects and document tokens remain engine-owned; no unbranded cross-document/realm
handle sharing. Disposal, repeated reads and diagnostics must remain deterministic
for the same snapshot, policy, capabilities and budget; no replay depends on host
locale, current time or ambient state.

Filter ownership belongs in this engine (or a separately admitted first-party
codec leaf), not command handlers or rendering. Raw inspection/rewrite can expose
encoded bytes and unsupported filter metadata without decoding images. Required
xref/font/content decoding returns explicit unsupported/corrupt outcomes, never
empty successful output. Encryption is document-level policy with per-object
string/stream transforms and explicit Crypt selection; handle xref/encryption
bootstrap exclusions, object-stream decryption once, metadata exemptions and
password failures separately. Unknown/malformed Encrypt is never silently plain.
Signature verification, modification validity and redaction are independent of
successful parsing or cryptographic authentication.

### Budgets and admitted profiles

Use a single invocation ledger: source/spool bytes, total allocations, live bytes,
decoded bytes per-stage and aggregate, token/name/string length, nesting, objects,
xref entries/ranges/revisions, object-stream header work, reference/page depth,
CMap entries/range expansion, font bytes/glyphs, content operators and text-order
comparisons/output. Finite explicit values are required; omitted budget fields
are not unlimited. This research fixes no unmeasured production default.

Charge arithmetic products and allocations before performing them; release live
reservations on failure/eviction/close while monotonic work totals remain charged.
Check cancellation at entry, read boundaries, bounded lexer/decoder/traversal
checkpoints, before and after every yield and before publishing results. Async
wrappers alone cannot interrupt a long synchronous decompression/crypto call.
The maximum checkpoint interval needs measured qualification on each advertised
runtime. Denied capability, exhaustion, caller cancellation and source failure are
fatal even in recovery. Bound the diagnostic list too. Tests will use in-memory
bytes/memfs and mocked explicit capabilities, no native oracle processes.

Profiles are independent: strict syntax/graph validation; explicit repair with
original bytes, offsets and diagnostic provenance; object inspection with opaque
unsupported payloads; metadata/page interpretation; text extraction; graph-aware
rewrite. Inspection success must not imply extractability or safe transformation.
Partial recovery objects are visibly partial and cannot silently become a valid
catalog/page graph. A command/SDK must select identical profiles and limits.

## Feature matrix and independent gates

All rows are **draft/unqualified** for the proposed engine. Fixtures below are
seeds, not exhaustive evidence or passes. Version labels indicate historical
feature scope, not blanket support declarations.

| Feature / scope | Gate and required evidence | Fixture seeds / remaining cases |
| --- | --- | --- |
| PDF 1.0–2.0 byte objects, whitespace/comments, names, numbers, strings, arrays/dictionaries/refs | `pdf-byte-syntax`: strict grammar, byte offsets, chunk splits, exact numbers, bounded token/depth/work, cancellation | 30 object fragments; giant/deep/cyclic objects and every split still needed |
| Header/catalog version, EOF/startxref, linearization | `pdf-revisions`: effective version and last valid revision; linearization inspection separate from writing | Complete PDFs; prefixed header/trailing data/missing EOF/linearized seeds still needed |
| Classic xref/free generations/incremental reuse | `pdf-revisions`: latest precedence, deletion/reuse, cache correctness | classic-one-page, incremental-page; free chain/reuse/overlap pending |
| PDF 1.5 xref streams/hybrid | `pdf-revisions`: W/Index/defaults/types, unsigned widths, Size/range bounds, hybrid precedence/Prev cycles | 5 field fragments and complete xref stream; hybrid/cycles/huge sparse ids pending |
| PDF 1.5 object streams | `pdf-revisions`: N/First/header pairs/index/generation/forbidden streams, explicit repair | valid and decreasing payload pairs; complete ObjStm PDF/duplicate/huge/repair cases pending |
| Stream framing and inline images | `pdf-stream-filters`: resolved Length, bounded unambiguous recovery and BI/ID/EI rules | embedded endstream and inline EI; indirect/cyclic Length and codec-specific scans pending |
| ASCIIHex/ASCII85/RunLength, Flate/LZW | `pdf-stream-filters`: EOD, chain order/params refs/null, LZW EarlyChange0/1, zlib/checksums, strict vs repair | 7 filter payloads; LZW transition/saturation/truncation and bombs pending |
| TIFF/PNG predictors | `pdf-stream-filters`: checked row products, bits/sample/colors, row recovery and cancellation | none yet; all predictor modes and packed samples pending |
| DCT/JPX/CCITT/JBIG2 image payloads; Brotli/extensions | Raw inspection independently; pixel interpretation/codecs/assets need explicit gate | none yet; preserve raw unsupported streams; no implicit complete PDF2 claim |
| Standard security handler revisions R2–R6, RC4/AES, Crypt/Identity, permissions/metadata exemptions | `pdf-security`: known-answer byte controls, passwords, malformed Encrypt, crypto availability/bounds, no double decryption | none yet; public-key/custom security separate unsupported/inspection cells |
| Page tree, inherited boxes/resources, rotations/user units, Info/XMP | `pdf-pages-metadata`: validated catalog/tree, cycle/shared-node policy, bounded metadata | 3 full PDF seeds; inheritance/XMP/cycle/revision cases pending |
| PDFDocEncoding/UTF16BE, PDF2 UTF8 BOM and language escapes | `pdf-fonts-text`: semantic roles, exact lexical bytes, malformed UTF8/surrogates/output encodings | BOM/surrogate seeds; language escapes and encoding tables pending |
| Simple Type1/TrueType/MMType1, Differences, standard14, embedded sfnt/CFF, Type3 | `pdf-fonts-text`: glyph names/widths/encodings/font programs without host fallback | none yet; sfnt admission is not this gate; license each bundled asset |
| Type0/CID fonts, CMaps/ToUnicode/usecmap, WMode, CIDToGID | `pdf-fonts-text`: variable-length codes, ranges/overrides, supplementary Unicode, mapping provenance and quotas | one ToUnicode fragment; complete font PDFs/predefined licensed maps pending |
| Content text/graphics state, forms, geometry, bidi/ligatures/ActualText/tagged order | `pdf-fonts-text`: matrix math, operators, bounded form recursion, provenance; extraction order/modes independently | one content fragment; complete positioned/multicolumn/vertical/font cases pending |
| qpdf graph rewrite/object streams/encrypted rewrite/linearization/signatures | Separate writer and command compatibility gates after admitted parser features | none; existing renderer serializer is not this gate |
| Runtime, host isolation, cancellation, replay, installed exports | `pdf-parser-qualification` plus maintained command package gates, actual Node/browser/workerd cells | no runtime implementation or artifact exists to qualify |

Missing fixture cells remain acceptance work for the responsible task. This task
supplies the matrix and original fixture seeds, not closure of dependent gates.

## Licenses and adaptation provenance

No source code or upstream fixtures were adapted, translated or vendored in this
task. The fixture corpus is original first-party work. Source download licenses
were inspected, and their identity hashes are recorded below; no upstream license
is silently replaced by this repository's MIT license.

| Source | License evidence and obligations if later adapted |
| --- | --- |
| PDF.js | LICENSE: Apache-2.0, SHA256 `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594`. Retain license, applicable copyright/attribution and notices, mark modifications and carry applicable NOTICE contents; verify each source/asset header separately |
| pdf-lib | LICENSE.md: MIT, SHA256 `f2c9fc00fdb66eb99ac156ba52d734af66d8d309f65753ae809ad34ee2883bcb`. Retain copyright and permission notice in copies/substantial portions; streams and bundled assets need their own header audit |
| qpdf | LICENSE.txt: Apache-2.0, SHA256 `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`. Audit file headers, bundled components and notices before any adaptation; root license does not cover every transitive component automatically |
| MuPDF | COPYING: AGPLv3, SHA256 `57c8ff33c9c0cfc3ef00e650a1cc910d7ee479a8bc509f6c9209a7c2a11399d6`. Commercial licensing is a separate path; neither copying nor translation into JS is authorized here. AGPL source/service obligations conflict with assuming MIT-only distribution |
| Poppler | COPYING: GPLv2 text, SHA256 `ab15fd526bd8dd18a9e77ebc139656bf4d33e97fc7238cd11bf60e2b9b8666c6`. File-level version/options and copyright need separate review; no GPL code adaptation authorized |

Future adaptation requires a ledger entry: exact repository/commit/path/source
range/hash, destination file/range, adaptation author/date, license/notices,
substantive modifications and original acceptance fixtures. Ship required license
and NOTICE material in both private engine sources and bundled safe-bash artifacts;
private package status does not remove distribution obligations. Font/CMap/encoding
assets require independent version/hash/license provenance. Specification PDFs and
errata were consulted as references, not redistributed assets.

Representative inspected source SHA256 values (all at the revisions above):

| Project / path | SHA256 |
| --- | --- |
| PDF.js `src/core/parser.js` | `f861d0e2adc7151961a441fa4fde8872a5d0bc4212526eb49956e68d8b0c2717` |
| PDF.js `src/core/xref.js` | `9b363610bc4b116a52c98143d6973a6171afcc389e0d765dae070502b56aa3a5` |
| PDF.js `src/core/crypto.js` | `44cefafd8845bdb92750c5fe87157ce5ed48f1bc4f09062704a215e64633cdb9` |
| PDF.js `src/core/evaluator.js` | `30bcfc95f6546802c3b5ca28a6e9928c7ba9637e34b62849ba436d51e365566e` |
| pdf-lib `src/core/parser/PDFParser.ts` | `59b2ee42572e4c2e8c388d5a02dc809504270c96f771ded04134d50da3086be2` |
| pdf-lib `src/core/parser/PDFObjectParser.ts` | `929b1d98eab27cca5ec19bbd74dd10974d1ea5918ee87a64fcc85a30c9b475fc` |
| pdf-lib `src/core/streams/decode.ts` | `f5db98e4f4de186dbdd26e66177f824803a465f7f7892463c4112149d90cb311` |
| qpdf `libqpdf/QPDF_objects.cc` | `f5156ccba9da458cd3476aff74df107ead72886d89fde48eced85d39a1481c2d` |
| qpdf `libqpdf/QPDFParser.cc` | `5e5af30087972054b945d65e28f7e2a5db28e9bd91699f8810857a514f452e18` |
| qpdf `libqpdf/QPDF_Stream.cc` | `49c47ae2c5d3e5ef943d54b8436ab3261a06c9fef6bea5aa54fef8f62adc9d5f` |
| qpdf `libqpdf/QPDF_encryption.cc` | `8b4a371e58a346d3526bf172da59bf26787552cb898673587d19d4ae0f4b58c7` |
| MuPDF `source/pdf/pdf-parse.c` | `faab8571003490f009ce9859d629d69dad00d7f2741ee77e5aeb63f360b284f7` |
| MuPDF `source/pdf/pdf-xref.c` | `b526176a743594a260117be163b830f8815767e6162a9181230f146285aeec04` |
| MuPDF `source/pdf/pdf-stream.c` | `eb499f9f3d3d5361e24f5825c121cbc29353270b3e727e79cf747dcce6c640b3` |
| MuPDF `source/pdf/pdf-crypt.c` | `aa1f7abe1a8564c658c08b92565155e506f123afd4ffe29ecc4fe5deefe85836` |
| Poppler `poppler/Lexer.cc` | `084e75d40727415ff50ece5447b8feacd39086c6d1a42d2b10c59a51fd200a6b` |
| Poppler `poppler/UTF.cc` | `f1d707da50b9ceea17c1725bd2bbd4f998cf8d5b740aa922a365196bd2e77a1a` |

## Dependent command exports and adoption decision

The requested `safe-bash-command-package-pattern.md` is deleted in the current
working tree; its available [archived copy](archive/safe-bash-command-package-pattern.md)
was inspected without restoring/moving unrelated work. Follow its leaf engine /
contracts → private command packages → safe-bash dependency DAG. Command packages
must not import safe-bash back and create a build cycle. Proposed parser-dependent
exports remain `@poe-platform/safe-bash/commands/pdfinfo`, `/commands/pdftotext` and
`/commands/qpdf`, explicit opt-in factories implementing canonical command
contracts and preserving byte argv brands/constructor identity. Existing command
candidates are not certified by this research.

Bundle admitted first-party source into maintained safe-bash artifacts; respect
guarded source/tool roots and integration-input manifests, declaration rewriting
and private-import leakage checks. Before admitting any export, run maintained
build/lint/unit scopes and installed-tarball runtime/type consumers outside the
checkout; inspect the complete shipped import/asset closure, retain licenses,
verify opt-in registration and separately test advertised runtimes. No standalone
private package publication, default registration expansion or proxy-only adapter.

**Decision:** pursue an original first-party engine, borrowing architectural
separation and qualification cases rather than adopting an external parser.
No external dependency is recommended or approved. None of the source-repository
manifests establishes a published parser's runtime closure or budget contract.
If that decision changes, first prepare a concrete hey-boss proposal naming
package/version/integrity, actual dist manifest/imports/assets, exact runtime and
transitive graph, all licenses/notices, security maintenance/advisories/update
ownership, Node/browser/workerd support, ambient capabilities, allocation/work and
cancellation limitations, and the exact requirement exception. Then read the
hey-boss skill and request explicit permission through it before adoption.
Silence never admits the package. No such permission flow was triggered here.

## Original fixtures and research verification

[Original byte corpus](../../tests/fixtures/pdf-parser-research.json) contains 50
fixtures: 30 object fragments, 7 filter payloads, 5 xref field payloads, 2 object
stream payloads, an inline-image fragment, a framed stream containing endstream,
a ToUnicode fragment and 3 complete PDFs (classic single-page, incremental page
replacement, xref-stream single-page). `hex` is authoritative; byteLength and
SHA256 detect encoding drift. Xref/ObjStm fragment parameters are explicit.
Expected strict/recovery outcomes are draft contracts, not outputs attributed to
an engine. The complete PDFs have byte-counted object/startxref locations and
explicit page expectations. No upstream fixture copied; no native oracle queried.

Future TDD imports these bytes into memory before implementing each responsible
feature; use memfs only where command/VFS behavior is exercised. Expand split,
malformation, quota, cancellation and negative cases before closing that feature.
Fixture consistency inspection is not a parser test, a native comparison or a
final qualification receipt. No runtime code changed, so no implementation unit
suite, CLI screenshot or broad build is implied by this research delivery.

Research verification: JSON decoding, all 50 unique IDs/hex lengths/hashes,
complete-PDF object offsets/startxref/Prev relations, xref-stream raw field rows,
object-stream First/header positions, and independently specified ASCIIHex →
Flate payload using a development-only standard-library zlib consistency check.
Source comparisons/license headers were inspected at the exact pinned revisions;
all recorded source/reference hashes checked against retrieved bytes. Full ISO
texts, mature corpus compatibility, runtime budgets/cancellation/isolation/replay,
parser implementation and installed command exports remain unqualified.

Task-owned downloaded source/PDF/HTML and temporary evidence were purged after
recording these pins. Research scope is delivered; parent plan and all dependent
implementation/qualification statuses remain untouched. Local commits: none.
Verified remote-main delivery: none. Successful releases: none.
