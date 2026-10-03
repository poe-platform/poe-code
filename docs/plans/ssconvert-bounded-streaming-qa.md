# ssconvert bounded streaming qualification

This is a manual execution plan, not a completed Worker qualification. Incremental
CSV/text range input and incremental output, plus caller-backed input staging,
are available. Other built-in input collection, the owned array-based workbook,
CSV cell lookup, large individual fields, and the remaining format codecs still
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
4. For sequential text export, observe first output before all cells are formatted
   and verify formatting stops while the consumer is blocked. For conversions
   needing global state, record the staging/indexing phase separately from output.
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
