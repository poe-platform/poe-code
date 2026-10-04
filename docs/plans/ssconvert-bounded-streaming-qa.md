# ssconvert bounded streaming qualification

This is a manual execution plan, not a completed Worker qualification. Incremental
CSV/text range input and incremental output, plus caller-backed input staging,
are available. Gnumeric XML and gzip exporters also stream encoded output and
consume replayable text cells without full cell arrays. Individual fields and
retained subtrees remain resident; non-replayable inputs still retain cells. Gnumeric cell ordering
uses bounded caller-backed merge runs when working storage is configured.
XLSX and ODF also read compressed archives through retained ranges;
their directories use caller-backed indexes when working storage is configured.
XLSX exporters also stage ZIP member payloads and central records in caller
storage. UTF-8 encoding and member compression consume bounded chunks before
bounded archive output. Worksheet rows are staged before metadata registration,
and row, worksheet and shared-string XML containers stream. Shared-string counts,
IDs and XML use caller-backed storage with a fixed header cache. Cell coordinates
use an ordered external index; row traversal keeps bounded batches and generates
style-region blanks from templates. Individual cell strings, style indexes,
other metadata XML and the workbook model
are still buffered. ODF exporters stage compressed ZIP members and central records
through working storage, with incremental unencrypted UTF-8 encoding, compression
and archive output. ODF XML byte accounting does not allocate encoded containers.
Rows, tables and the main document body stream through caller-backed staging
before style declarations. Row boundaries and row traversal use caller-backed
ordered indexes; rendering retains one row of cells at a time. Engine-owned cell
addresses use ordinals into frozen inputs; mutable low-level SDK workbooks retain
captured references. Non-replayable workbook payloads remain resident. The generated cell-style registry
uses caller-backed key/name indexes and coalesced XML staging; its container
streams. Generated axis/region metadata, validation and database fragments also
use coalesced staging; named-expression, label-range and validation containers stream.
Retained definition identities, shape/name indexes and generated definition text use
caller storage; style sections stream and generated name allocation is monotonic.
Style, metadata and table bytes share output admission. Individual cell strings,
imported style payloads and individual shape strings, cell metadata and embedded binary resources, encrypted/decrypted members and wrapped inner packages are still buffered.
Retained validation/database XML, document metadata and embedded XML documents
serialize incrementally, with bounded escaped text/attribute fragments and a fixed XML-name cache.
Plain text conversions to text, Gnumeric XML/gzip, either XLSX edition or either ODF profile without global evaluation now replay cells from retained input through the exporter; they do not retain a full cell array. Formula-bearing and clock-dependent inputs, transformations, and explicit workbook SDK reads still use the array model. Gnumeric plain/gzip imports now read retained ranges, decompress with fixed output windows and incrementally decode UTF-8, UTF-16 and supported legacy single-byte encodings. Gnumeric probes validate the complete plain/gzip document without retaining its XML tree; full imports now stage direct children of cell containers in caller storage and replay them for diagnostics, ordered formula-name binding, cell decoding and axis inference. Cell XML no longer stays in the retained document tree; ordinary formula-bearing imports now stage axis, binding, shared-expression, name-visibility and name-cycle traversal indexes as well. Other XML metadata, ordinary workbook cells, name/declaration identity maps and global evaluator state remain resident. The streaming XML validator retains open-element namespace scopes and individual parser tokens, so giant tokens remain a separate qualification gap. BIFF file imports now use retained CFB ranges with caller-backed FAT/chain/traversal indexes, constant-state cycle checks and fixed sector caches. They avoid whole-container/Workbook stream copies and ignored ancillary payload reads. BIFF record headers and per-sheet record selections now use caller-backed indexes, with payloads read on demand and decrypted replacements staged in fixed blocks. Shared-string CONTINUE payloads decode lazily, retaining one active record rather than the entire string-table chain. Decoded BIFF shared strings and rich runs use caller-backed descriptors/payloads with fixed lookup windows. Scalar BIFF imports can stage cells and replay them in row-major order to source-capable exporters without pending/output cell arrays. Formula-bearing imports and global transformations retain their workbook path; scalar row lookup and insertion order now use caller-backed indexes, including inferred heights captured before later default-height records. Final nondefault row metadata arrays still remain resident. Other workbook models, formula/style state, stream descriptors and interpreted property/encryption buffers remain resident; the explicit byte-array and cached-value convenience readers still buffer. XLSX shared-string children now stage as raw XML records, replay schema recognition in source order, then stage decoded values behind a bounded ordinal index. A shared-string part referenced in another metadata role keeps that role's XML tree while decoded values still stage. Shared-string lookups retain one value at a time. Worksheet row subtrees now stage before schema recognition, then recognized rows replay during cell decoding. An opt-in XML capture hook preserves preceding mixed content at selection time; a worksheet requested again as opaque metadata restores its original tree from stored records. Duplicate-cell positions and shared-formula definitions now share one caller-backed index cache across worksheets, preserving exact identifiers and source-order replacement. Row/column metadata and captured default heights also stage in this shared index, with insertion-order replay preserving duplicate and late-default semantics. XLSX cells now stage behind bounded ordinal and coordinate indexes; scalar imports replay row-major cells directly to source exporters, while formula imports return the completed workbook through normal load preparation without rereading or duplicate diagnostics. Explicit workbook SDK reads still materialize cells. Scalar XLSX and Gnumeric sources now replay row/column metadata from caller-backed indexes. Their text and Gnumeric exporters consume those iterators directly; XLSX and ODF exporters stage them behind a shared bounded coordinate index, preserving row boundaries, column order and format metadata without final axis arrays. Explicit workbook reads still materialize axes. Individual rows and axis records, other worksheet metadata and formula workbook cells remain resident. XLSX and ODF XML decoding and parsing consume ZIP chunks directly without full member byte/string copies; ODF probes retain only their prefix while validating the complete member. The cached-value XLSX helper also parses UTF-8 chunks incrementally. UTF-8/UTF-16 trees, individual parser tokens, decrypted buffers and non-text workbooks remain resident. Other built-in input collection, the owned array-based workbook,
unordered CSV lookup without working storage, large individual fields, and the remaining format codecs still
need migration before the complete conversion pipeline can pass this plan.

## Environment and evidence

Record the exact Git revision, deployed Worker version, workerd version, runtime
flags, backend configuration, cache budgets, and concurrency for every run. Use
the same injected safe-fs instance for input, staging, indexes, and output. Use an
external backend with retained identity and bounded range reads/writes; an
in-isolate memory filesystem does not qualify as spill storage. Do not create
host temporary files inside the codec or introduce a separate private filesystem.

Capture actual isolate memory, CPU time, first output byte, completion latency,
backend bytes/requests, maximum read/write request size, maximum pending bytes,
and staging bytes. For local workerd, use its inspector/profiling facilities and
identify the memory metric and sampling method. For deployed Cloudflare Workers,
record the available runtime telemetry, including CPU and memory-limit failures.
If peak isolate memory is unavailable, report it as unmeasured rather than
substituting Node heap or host RSS for Worker memory. Keep raw evidence outside
planning documents and remove temporary logs after recording verified results.

## Scaling runs

1. Prepare equivalent CSV, XLSX, ODS, BIFF/XLS, and compressed/uncompressed Gnumeric
   inputs at approximately 1, 8, 64, and 256 MiB. Also vary rows, sheets, unique
   shared strings, metadata, archive member count, and a single very large field
   independently. Generate input outside the measured isolate or supply reused
   chunks; do not preload the entire input into its heap.
2. Run each supported conversion with concurrency 1, 4, and 16. Repeat with a slow
   output consumer and slow external storage. Hold cache limits fixed as input
   size increases. Record cold and warm runs separately.
3. Verify that measured working memory plateaus with fixed caches and scales with
   concurrency, rather than file/workbook size. Backing storage may grow with
   payload size. Inspect backend counters to rule out a RAM spool or a hidden
   payload-wide read, concatenation, decompression, or archive member cache.
4. For sequential text and Gnumeric XML export, observe first output before all
   cells are formatted and verify formatting stops while the consumer is blocked.
   For gzip, separately bound pending compression input and output bytes, verify
   the UNIX header byte, and compare decompressed XML with uncompressed export.
   For conversions needing global state, record the staging/indexing phase
   separately from output.
5. Repeat through the public SDK and the Safe Bash CLI. Keep input/output limits
   unchanged. Verify byte ownership by reusing source buffers after each awaited
   transfer and mutating returned range buffers on subsequent reads.

## Semantics and failure cases

- Compare bytes where deterministic with the existing native fixture corpus.
  Open generated XLSX/ODS/XLS files in an independent spreadsheet implementation.
  Exercise shared/array formulas, forward and cross-sheet references, names,
  recalc, merge, selections, range export, metadata, encodings, and encryption.
- Exercise shared strings and member indexes much larger than their caches,
  repeated seeks, interleaved sheet reads, and source-path replacement after open.
  All reads must retain the originally authorized object identity.
- Cancel during input acquisition, range reads, spill writes, formula evaluation,
  compression, export, and publication. Inject read/write/close/remove failures,
  early consumer return, partial writes, storage exhaustion, and rename failure.
- Verify iterator/handle retirement, original error identity or documented
  aggregated cleanup errors, no unowned staging entries, and unchanged existing
  output before publication. Retain complete staging only for the documented
  publication-failure case. Check native export-failure output separately.

## Completion gate

Record results per format and operation, with explicit failures and unmeasured
cases. Passing an output-only test does not qualify ingestion or workbook storage.
The complete gate requires migrated incremental/range readers, external row/string/
member/dependency indexes, bounded global operations, semantic/interoperability
checks, and actual Worker measurements. Verify the delivered revision on remote
main independently from any release publication.
