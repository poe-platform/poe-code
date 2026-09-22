# Private PDF byte parser

Inspect PDF object syntax using caller-supplied bytes without opening files or
accessing a network. This private first-party engine has no runtime dependencies
and is separate from the PDF rendering package.

Robustness controls and the remaining mature-corpus gates are recorded in
[`pdf-parser-qualification.md`](../../docs/plans/pdf-parser-qualification.md).
Pinned external differential QA is opt-in; unavailable corpus cells are not
counted as passes. The current increments do not qualify complete PDF 1.0–2.0
support.

`pdfCapabilities` exposes a frozen, feature-by-feature evidence matrix.
`local` means original unit controls exist, `unsupported` means the integration
or implementation is missing, and `qualified` is reserved for a reviewed mature
profile with consumer evidence. No feature currently claims that qualification.
Evidence paths are relative to this package; limitations are part of the contract.

| Gate | Current evidence/profile |
| --- | --- |
| Strict syntax, recovery, raw object inspection | Local controls, independently gated |
| Classic/stream/hybrid cross references and revisions | Local unfiltered controls |
| Filtered xref/object-stream integration | Unsupported |
| Filters/predictors | Local strict codec controls; image/extension codecs excluded |
| Security primitives | Local independent vectors with explicit crypto capability |
| Encrypted document interpretation | Unsupported |
| Page graph/metadata inventory | Local original controls |
| Fonts, text, layout | Separate local partial profiles |
| Lossless rewriting | Unsupported; no writer |
| Installed parser-consuming Safe Bash artifacts | Unqualified |

`getPdfCommandGate("pdfinfo" | "pdftotext" | "qpdf", { signal })` returns a
frozen `{ command, qualified, missing }` decision for the full intended command
profile. All three currently return `qualified: false`. Initial parser APIs
remain usable directly within their documented bounds; this decision cannot be
overridden by supplying an evidence object or requesting recovery. Cancellation
propagates unchanged, including falsey reasons. Invalid command names fail with
`ARGUMENT`.

pdfinfo requires inspection/page/security/index and consumer qualification;
pdftotext additionally requires font/text/layout qualification. qpdf additionally
requires graph-aware lossless rewriting qualification. Raw byte preservation
alone does not qualify rewriting. CLI and SDK integrations must use the same
decision before acquiring input or writing output. Admission/help-only command
exports do not establish extraction qualification. Follow the command package
pattern in [the archived source](../../docs/plans/archive/safe-bash-command-package-pattern.md)
(the original `docs/plans/safe-bash-command-package-pattern.md` has been moved in
this working tree). Consumer commands source-bundle the required first-party
closure; neither bare private-workspace imports nor the separate Node crypto
entry belong in portable Safe Bash artifacts. No parser-consuming command is
admitted by this increment.

Errors have separate fatal contracts: `PdfSyntaxError` codes `ARGUMENT` (invalid
API inputs), `SYNTAX` (malformed data), `REFERENCE` (invalid/cyclic/missing
references), `UNSUPPORTED` (required interpretation unavailable), and `LIMIT`
(exhausted quotas), with byte offsets. `PdfSecurityError` separately distinguishes
password, encryption-format and unsupported-handler failures. Cancellation and
explicit capability failures retain their original values. Recovery only admits
the documented syntax scan; it never converts quota/cancellation/security or
unsupported interpretation into successful extraction.

```ts
import { parsePdfObjects, resolvePdfReference } from "pdf-parser";

const objects = parsePdfObjects(inputBytes, {
  signal,
  limits: { inputBytes: 1_000_000, objects: 10_000 },
  duplicateKeys: "preserve"
});
```

The input may be a `Uint8Array` or an array of byte chunks. Input is snapshotted
after admission; chunk boundaries do not affect syntax. `offset` selects the
starting byte within the combined input. Every object has absolute, half-open
`start`/`end` source offsets. Names and strings expose decoded `bytes` and their
exact source `raw` bytes. No text encoding is inferred. Literal strings normalize
unescaped CR/CRLF to LF, remove escaped line continuations, and implement PDF
escapes and three-digit octal bytes. Hex strings pad a final odd nibble.

Numbers retain the original token, alongside a JavaScript numeric value. Exact
decimal magnitude must be within the safe-integer range before conversion;
fractional values may round, so use `raw` when exact decimal identity matters.
Exponent notation and malformed tokens are rejected. References require lexical
integers, nonnegative safe object numbers and generations from 0 through 65535.

Dictionary `entries` preserve source order, duplicate byte keys and null values.
No value silently replaces an earlier entry. Set `duplicateKeys: "reject"` to
reject duplicates after name-escape decoding. Consumers choosing a last-value
interpretation must do so explicitly. Arrays expose `items`.

Limits bound input bytes, token bytes (including comments), nesting, parsed object
count, retained allocation accounting and work. The nesting ceiling is 128.
Allocation accounting conservatively charges token staging, copies and object
records; it is an admission model rather than an exact JavaScript heap-size
measurement. Input snapshot allocation is separately bounded by `inputBytes`.
Abort signals are checked during admission, scanning and reference resolution;
the cancellation reason and lookup errors propagate unchanged. Quota failures
are fatal `PdfSyntaxError` errors with code `LIMIT`, never recovery warnings.

`resolvePdfReference(object, lookup, { maxReferences, signal })` resolves a bounded
reference chain through an explicit synchronous byte/object capability. It rejects
cycles and invalid reference identifiers. It does not traverse container graphs.

`openPdf(inputBytes, { signal, limits, recovery: false })` reads classic tables,
xref streams and hybrid `/XRefStm` sections, following `/Prev` newest first.
`getObject(number, generation)` returns an owned syntax object and optional raw
`stream` bytes. Free entries mask older revisions; generation mismatches fail.
`resolve(number, generation)` resolves reference chains with cycle detection.
Stream lengths may be indirect references in the resolved document index.
Unfiltered xref-stream indirect lengths bootstrap from checked `/W` and `/Index`
row sizes, then must match the referenced value in that revision's index. A
newer replacement of the length object does not invalidate an older revision.

Unfiltered object streams validate `/N`, `/First`, ordered header offsets and the
exact compressed-object index. No index repair or eager object cache is used.
Compressed-object spans are local to their bounded member bytes; uncompressed
object spans are absolute document offsets. Repeated reads share cumulative
allocation/work quotas. Xref fields use checked arithmetic, never 32-bit shifts.
Filtered xref and object streams remain a separate integration gate and fail
explicitly with `UNSUPPORTED`; raw ordinary streams remain available for
inspection without decoding.

Recovery must be explicitly requested with `recovery: true`. A syntax failure
then permits a quota-bounded object scan with `RECOVERY_SCAN` diagnostics. This
is best-effort object inspection, not reconstruction of deleted objects or the
original revision graph. Quota, cancellation, unsupported-feature and reference
errors are never converted to recovery warnings. Strict parsing requires the PDF
header at byte zero and a final `%%EOF`; permissive producer profiles are separate.

The current revision gate covers original in-memory fixtures, including a PDF
2.0 header with unfiltered xref/object streams. It does not qualify all PDF 2.0
structures, linearization or a mature PDF 1.0–2.0 profile. The filter gate below
is an initial increment; encryption, fonts,
extraction and rewriting retain independent gates.
No command export is added by this increment.
Dependent safe-bash commands must bundle this first-party source through the
maintained private-package boundary; they must not ship an ambient import of
this unpublished workspace.

`decodePdfStream(inputBytes, dictionary, { signal, limits, lookup })` decodes an
explicit caller-supplied stream dictionary. `document.decodeStream(number,
generation, { imageMode })` reads and decodes an ordinary stream using the same
cumulative document quotas and reference index. Both return `{ raw, bytes,
remainingFilters }`. `raw` retains the original stream bytes; no string encoding
or ciphertext normalization is applied. Standalone calls start fresh quotas.

Filters run in array order, with `/Filter` or `/F` and `/DecodeParms` or `/DP`.
Reference parameters use the explicit `lookup` capability (the document index
for document decoding); null parameters use defaults. Supported codecs are
Flate (zlib stored/fixed/dynamic blocks and checksum), LZW (`EarlyChange` 0/1,
default 1), ASCIIHex, ASCII85 and RunLength, including their standard aliases.
Flate/LZW support TIFF predictor 2 with 1/2/4/8/16-bit samples and PNG predictors
10–15 with row tags 0–4. This strict increment requires ASCII end markers,
rejects invalid digits/tuples, and rejects truncated predictors and codec data.
It does not adopt upstream permissive EOF or malformed-input recovery.
Codec end markers terminate decoding; trailing bytes remain in `raw`. Flate
checks the zlib checksum immediately after its final block, before any trailing
bytes. Concatenated zlib members are not automatically decoded as one stream.
`Crypt` accepts only Identity (also its default); document decoding rejects
`/Encrypt` and recovered documents lacking a revision security context.
No encryption gate is closed by Identity passthrough.

`limits.expandedBytes` bounds cumulative bytes emitted by all decoding stages,
including predictor output (default 32 MiB). Staging, dictionary/tree storage,
row buffers and final copies also consume the shared retained-allocation quota;
it can stop decoding before the expanded quota. Work is charged for input bits,
dictionary walks, output bytes and predictor samples. Quotas never reset between
filters or repeated document reads; cancellation reasons propagate unchanged.

DCT, JPX, JBIG2 and CCITT decoding remain unsupported independent image gates.
For inspection or text-only image skipping, set `imageMode: "preserve"`: decoding
stops at the first image filter and returns its encoded `bytes` and the complete
`remainingFilters` suffix. Nonempty `remainingFilters` means the result is still
encoded. The original `raw` bytes remain available even after preceding filters.
Unknown filters, including Brotli extensions, always fail explicitly. This API
supplies no renderer, font assets, host file access or network capability.

`document.inspectPages({ maxNodes })` returns ordered `pages`, checked
`pageCount`, the raw `catalog` and `pageTree`, document `info`, XMP `raw` and
decoded `bytes`, and flat `outlines`, `links`, `attachments` and `forms`
inventories. Graph reads share the document's cumulative work/allocation limits
and abort signal. `maxNodes` bounds visited inventory/page nodes (defaulting to
the object limit); `limits.nesting` also bounds graph depth. Invalid graph
parents/counts, repeated page/outline/form nodes and cycles fail explicitly.
Encrypted and recovered documents require separate interpretation gates;
`getObject` remains available for raw inspection.

Pages inherit `MediaBox`, `CropBox`, `Rotate` and `Resources`. `mediaBox` and
`cropBox` are unrotated PDF coordinates; effective CropBox intersects MediaBox.
`rotate` is normalized to 0/90/180/270. Page-local `bleedBox`, `trimBox` and
`artBox` default to the effective CropBox. `raw`, `reference` and `inherited`
preserve objects and source spans, including original rotations and boxes.
Resources are resolved dictionaries; an empty local dictionary overrides an
ancestor. Link `page` numbers are one-based; link rectangles remain unrotated.
Outline and field inventories retain parent references and original dictionaries;
fields additionally expose inherited type and value. Null values, including
indirect nulls, act as absent during inheritance while raw entries are retained.
Attachments inventory the
EmbeddedFiles name tree, associated files and file-attachment annotations, with
file specifications and embedded-stream references. Attachment payloads are not
decoded by inventory traversal.

Info values, outline titles, field/attachment names, destinations, actions and
unknown entries retain PDF syntax objects and original string bytes. Metadata
encoding is preserved, without Unicode normalization or inferred text decoding.
XMP bytes are filter-decoded without XML evaluation. No action, document
JavaScript, XFA, URI or linked content is executed or fetched. The draft page
qualification is recorded in `docs/plans/pdf-page-tree-qualification.md`;
it does not qualify fonts, text extraction, encryption, rewriting or command
exports. No adapted upstream source or new runtime dependency is used.

The draft filter qualification and separate image acceptance requirements are
recorded in `docs/plans/pdf-filters-qualification.md`. No Safe Bash command
behavior or export is qualified by this engine increment.

`createPdfSecurity(encryptionDictionary, originalIdBytes, { crypto, signal,
limits })` admits a resolved Standard encryption dictionary. `authenticate`
returns a frozen session with `role`, signed `permissions`, `encryptMetadata`
and `decrypt(ciphertext, { objectNumber, generation, kind, cryptFilter,
metadata })`. Dictionaries, ID bytes and ciphertext are snapshotted; decryption
returns separate owned bytes. Ciphertext and lexical PDF strings are never
normalized. A factory's authentication/decryption calls share cumulative quotas.

The draft security increment covers V1/R2 RC4-40, V2/R3 RC4-40 through RC4-128,
V4/R4 V2/AESV2/Identity crypt filters, and V5/R5–R6 AESV3/Identity. It handles
StrF, StmF, EFF, DocOpen/EFOpen, per-object legacy keys, AES IV/PKCS#7 envelopes,
OE/UE key unwrapping and Perms validation. Undefined or unsupported filters and
malformed dictionary fields fail explicitly. Metadata exemption requires the
caller to identify a metadata stream; this API does not infer object roles.

Passwords are explicit `{ bytes, encoding }`: `legacy` for R2–R4 caller-encoded
PDFDocEncoding bytes (32-byte truncation/padding), `utf8` for R5, and
`saslprep-utf8` for R6 caller-prepared RFC 4013 bytes. Modern passwords require
valid UTF-8 before truncation to 127 bytes. No SASLprep tables, locale conversion
or raw-password compatibility retry is supplied. An omitted password tries empty
bytes; failed authentication reports `MISSING_PASSWORD`, while an explicitly
supplied wrong password reports `WRONG_PASSWORD`. Public-key handlers report
`PUBLIC_KEY_UNSUPPORTED` separately. Successful authentication validates the
password/key and reports permission bits; it does not enforce permissions,
authenticate arbitrary CBC ciphertext, provide public-key support or establish
cryptographic redaction.

`crypto` is a caller-supplied platform capability for MD5/SHA-256/384/512, RC4,
and AES-CBC/ECB without automatic padding, with propagated cancellation. No external
crypto dependency, native addon, WASM, ambient import or network fallback is bundled. Provider methods must treat arguments as read-only, return
owned exact-length results and bound their own execution. Engine work/allocation
admission occurs before primitive calls; abort reasons and provider failures
propagate unchanged. WebCrypto alone lacks required legacy primitives and ECB;
the portable engine does not select a default provider. `createPdfCrypto({ digest,
aes }, { inputBytes })` captures explicit platform methods and supplies original
first-party RC4. RC4 admits 1–256-byte keys and at most 32 MiB per call, snapshots
intrinsic byte storage, checks cancellation every 4096 bytes, and clears its
owned key/state on return or failure. Security sessions additionally apply their
cumulative quotas. RC4 exists for legacy decryption interoperability.

Node consumers can explicitly import `createNodePdfCrypto` from
`pdf-parser/node-crypto`. This separate entry uses Node's platform MD5/SHA and
raw AES-CBC/ECB primitives plus first-party RC4; it is never imported by the
portable entry. `inputBytes` applies to each primitive. The exercised runtime is
Node 22.22.2; other Node versions, Bun, browser and workerd runtime cells remain
unverified. Platform algorithm restrictions (such as FIPS disabling MD5) propagate
as errors without fallback. Synchronous platform calls are bounded by admitted
input size and check cancellation before/after execution; they cannot be
interrupted midway by an event-loop abort. No platform files or network are
acquired. This is local specification/control review, not an independent
cryptographic audit or runtime-wide qualification.

Automatic document/string/object-stream decryption, encrypted page/text
interpretation and command password flags remain independent integration gates.
`openPdf` still exposes raw ciphertext and rejects encrypted interpretation;
`decodePdfStream` still admits only Identity Crypt. The security API consumes
explicit ciphertext before ordinary filter decoding and must not be applied
again to strings already decrypted inside an object stream. Its quotas are
independent of document quotas; a future document integration must share them.
See `docs/plans/pdf-security-qualification.md` for controls and remaining gates.

`tokenizePdfContent(bytes, options)` preserves content operands and operator
spans. `interpretPdfText(bytes, resources, { lookup, stream, signal, limits })`
interprets explicit caller-supplied font/stream capabilities.
`document.extractPageText(zeroBasedPageIndex, { normalization, maxMappings })`
shares document quotas and records content-stream provenance. Results contain
source-order glyphs, transforms, mapping diagnostics, ActualText scope extents
and a logical text projection. Normalization defaults to `preserve`; opt-in NFC
or NFKC only changes the projection. Unmapped glyphs remain unknown.

This draft increment covers simple encodings/Differences, ToUnicode, supplied
CID CMaps, horizontal/vertical widths and embedded TrueType Unicode cmaps.
It has no host-font or external-CMap fallback. Inline images, complete embedded
Type1/CFF/Type3 semantics, clipping-aware visibility and reading-order/layout
remain independent gates. Nested ActualText uses outermost-scope replacement,
intentionally differing from the pinned Poppler producer profile. See
`docs/plans/pdf-font-text-qualification.md` for the controls and limitations.

`extractPdfLayout(contentBytes, resources, options)` extracts caller-supplied
content with `mode: "logical" | "layout" | "content"`. For a document,
`document.extractPageLayout(index, options)` uses the inherited CropBox and page
rotation; `document.extractLayout(options)` returns ordered page results and the
raw metadata/page inventory. All document extraction shares cumulative limits.

```ts
const document = openPdf(inputBytes, { signal, limits });
const { inventory, pages } = document.extractLayout({ mode: "layout" });
// pages[0].runs: display-coordinate baseline segments and glyph index ranges
// pages[0].glyphs: original codes, Unicode, PDF-space geometry and provenance
// inventory.info / inventory.xmp: byte-preserving metadata
```

Logical mode (the default) keeps semantic content order and ActualText. Content
mode keeps glyph Unicode in content-stream order. Layout mode sorts string runs
by fixed display row bands, then x coordinate, with source-order tie breaking;
it inserts line breaks across bands and spaces across measured gaps. Use
`lineTolerance` to set band/gap size in PDF units (default 2), and `maxRuns` to
bound run staging. Display coordinates start at the selected box's top left
with y increasing downward. Standalone calls accept explicit `box` and `rotate`
(default US Letter and zero rotation). Original glyph coordinates remain intact.
Run `origin`/`end` describe baselines, not ink bounding boxes. Unknown geometry
remains undefined and sets `geometryComplete: false`.

These deterministic modes do not infer author-intended reading order, perform
bidi/shaping, reconstruct tables or resolve column structure. RTL Unicode and
vertical glyph order remain those of the interpreted source. Ligatures stay
unchanged unless explicit normalization is requested. Image-only pages return
empty text without OCR. Existing font/operator diagnostics and unsupported
syntax failures remain visible. This is a draft extraction increment, not
complete PDF 1.0–2.0 or pdftotext compatibility qualification.
