# PDF streaming Worker qualification

## Status and prerequisites

This is a manual execution plan, not a qualification result. The retained
`PdfFileSource` primitive has deterministic range, ownership, budget, lifecycle,
and backpressure tests. Retained document traversal, filters, attachment extraction
and the `pdfdetach` / `pdffonts` commands now use caller-backed sources and staging. Other
command adapters, editing/rendering engines and giant structural values still
need migration before claiming command-level bounded working memory. No actual Worker memory or CPU measurements have yet
been recorded for this implementation.

Use the caller's injected external safe-fs backend with retained reads and the
required staged-publication capabilities. Record backend/version, workerd or
Cloudflare deployment/version, compatibility date and flags, limits, commit,
CPU allocation, and request concurrency. Do not use a RAM spool, host temporary
files, or a full-payload ByteSource adapter. Backend file storage must be outside
the Worker isolate; instrument its requests and staged-object lifecycle.

The initial source revalidation was at
`671c0f236e51222f7c2b966eb591053ace4316b4`. Relevant SHA-256 hashes:

| Source | SHA-256 |
| --- | --- |
| `packages/pdf-ast/src/document.ts` | `d3d611d81e56fc6eeee3cf78ec8bd80c24414a75239f854f6b5280e1c8733b01` |
| `packages/pdf-ast/src/cos/parser.ts` | `a7c582fd30fd37a206f07f27fd78ac295062999a2a04bcdc4ae981e50e1fc9a0` |
| `packages/safe-bash-command-pdfinfo/src/index.ts` | `dd4ad9118d28864813d38e63fe6dcd841d47b7d5335154a2c7227761b3f5f724` |

## Fixtures and measurement

1. Prepare valid PDFs at 1, 16, 64, 256 and 1024 MiB by increasing page and
   object counts with fixed page dimensions. Include separate families with
   large individual streams, compressed object streams, incremental revisions,
   repaired xrefs, shared fonts/images, and R2–R6 encryption. Record fixture
   hashes and expected page counts. Upload fixtures to the external backend;
   do not construct large fixtures inside the measured request.
2. Run a source-only scan, then each command operation below. Use an injected
   backend observer to record read position/length, retained-handle opens and
   closes, writes, outstanding bytes and staging cleanup. Reject payload-wide
   reads and growing in-isolate storage in the streaming path. Test sources
   whose read buffers are reused after each response.
3. Repeat with concurrency 1, 2, 4 and 8, both normal consumers and a throttled
   output consumer. Measure actual Worker isolate peak memory with workerd's
   runtime inspector or a platform-supported profiler, CPU time with runtime
   profiling, wall time, and time to first byte at the client. Keep source-only
   and complete-command results separate. Record unavailable metrics as
   unavailable: do not substitute Node heap statistics or call missing metrics
   a pass. Profiling runs and timing runs should be identified separately.
4. Keep cache budgets and page dimensions fixed while increasing document size.
   Memory must be explained by configured caches, bounded I/O, concurrent
   requests, and the largest active page/font/decoder state, rather than total
   file/page count. Then increase page dimensions independently to characterize
   intrinsic raster surfaces and prove admission precedes their allocation.
   Record first-byte latency versus size; seek-dependent formats may need
   staging, but must not retain whole payloads in the isolate.
5. Put temporary raw measurements in `/out`, inspect them, and summarize exact
   measured values, runtime configuration and provenance in the delivery
   record. Purge temporary output after use. Do not mark this plan executed
   without actual measurements.

## Operations and interoperability

Exercise the public SDK and command execution for `pdfinfo`, `pdffonts`,
`pdfdetach`, `pdfimages`, `pdftotext`, `pdftoppm`, `pdftocairo`, `pdfunite`,
`pdfseparate`, `pdftk` and `qpdf`, including exported asynchronous runners and
remaining duplicate implementations. Cover file and stdin sources, multiple
inputs, output prefixes, stdout and file outputs, page ranges, attachments,
merge/split, metadata/forms, redaction, incremental saves, object-stream
creation/preservation, encryption and rendering. Establish one-page-at-a-time
output consumption rather than retaining all rendered results.

Compare unchanged deterministic outputs byte-for-byte against the buffered
reference. Validate emitted documents with native `qpdf --check`, inspect with
Poppler, and render representative encrypted, edited and repaired documents
with an independent renderer. Fresh encryption randomness needs semantic and
password/permission verification rather than identical ciphertext. Preserve
redaction removal and resource-retention checks. Record tool versions and the
actual commands and results; skipped native tools are not passes.

## Failure, identity and publication

1. Cancel during acquisition, range reads, spill writes, rendering and a slow
   output write. Verify no continued input prefetch or output, no retained
   handles and no leaked staging objects after cleanup.
2. Inject a short read, unexpected EOF, a read error, write failure and cleanup
   failure. Verify primary errors survive cleanup and no partial cache entry
   is reused. Re-run against the same injected backend after recovery.
3. Replace a pathname after acquisition and while processing. Verify reads
   remain attached to the acquired object. Exercise output replacement and
   ancestry changes during staged publication; never publish into a substituted
   destination. Do not claim retained identity provides an immutable snapshot
   of a file being edited in place.
4. Reject input/output/object/page/decoder limits before the corresponding
   allocation or backend read. Verify exact-limit success and one-byte-over
   rejection without reducing existing supported file-size limits.
5. Confirm cancellation and failure leave the old published destination intact,
   preserve byte ownership with reused chunks, release locks/handles, and clean
   caller-authorized external staging. Test concurrent invocations with
   overlapping source and destination names.
