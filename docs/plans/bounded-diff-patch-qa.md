# Bounded diff and patch Worker qualification

This is a manual execution plan, not a qualification result. Current coverage is
exact `diff --brief` regular-file payload comparison plus indexed normal, unified,
context, RCS, conditional, ed and side-by-side output (including stdin and
missing-file operands, normalization, display transformations and brief stdin).
Indexed documents, line indexes, LCS cells, edit groups and output use caller-backed
page caches. Ignored lines, function headings, special-file operands, directory
metadata, pagination, patch, apply-patch and diff3 still need migration. Do not infer qualification of those paths from migrated tests.

## Runtime and storage

1. Build the Safe Bash Worker entrypoint at the revision under review. Run it in
   workerd and in a deployed Cloudflare Worker; record runtime versions, Worker
   limits, backend configuration, and revision with each measurement.
2. Inject an external safe-fs backend supporting retained identity-checked reads.
   Generate fixture contents outside the Worker. Do not substitute memory safe-fs,
   a whole-file ByteSource, host temporary files, or a backend that downloads full
   objects into RAM to implement range reads.
3. Instrument backend calls: bytes requested/returned, concurrent operations,
   currently outstanding byte buffers, retained handles, staging writes, cleanup,
   and conditional publication. Reject readFile on the streaming execution path.
   Instrument backend memory separately from command working memory.

## Size and concurrency sweep

1. Compare pairs of 1, 16, 64, and 256 MiB files with `diff -q` and `diff -qs`.
   Cover identical bytes, first/last-byte differences, a single unterminated line,
   LF/CRLF, invalid UTF-8, and embedded NUL. Include unequal sizes and independent
   short reads. Compare exit status and exact output bytes with native GNU diff.
2. Run each case with concurrency 1, 4, and 8 and a deliberately slow output sink.
   Record actual Worker peak memory, CPU time, wall time, first output byte, total
   backend bytes, maximum read size, outstanding bytes, and open handles.
   Brief output follows complete input verification, so first-byte latency includes
   the scan. Repeat warm runs and retain raw measurements outside planning docs.
3. Confirm regular-file payload memory is independent of file size: at most two
   owned comparison blocks plus bounded provider/generator buffers. Read requests
   must never exceed 65,536 bytes; no spool or whole-payload allocation is allowed.
   Report directory traversal metadata and accumulated result output separately.
4. Abort while opening, during a delayed read, between blocks, and during slow
   output. Inject read/stat/close failures and source revision or ancestry changes.
   Check no result is published before source validation, no operation uses a
   closed handle, and all admitted operations retire before cleanup completes.

## Remaining paths before complete qualification

1. Qualify the indexed document and stdin replay path with arbitrarily long lines,
   reused source chunks and mutation after iterator advancement. Measure document,
   index, LCS, edit-group and output spool bytes separately from resident bytes.
   Exercise both mostly-equal inputs and dense changes that force LCS spill.
2. Cover every diff output/normalization mode with bounded edit processing and
   output backpressure. Preserve ordering, contexts, binary handling and limits.
3. Exercise patch and apply-patch context matching, rejects, moves, deletes,
   multiple files and no-newline inputs against native/interoperability fixtures.
   Inject stale sources, ancestry swaps, cancellation and publication failures;
   verify conditional atomic publication and cleanup on every exit.
4. Audit and qualify the independent safe-bash-command-diff3 owner. Its current
   command collects chunks and merged inputs; shared diff source changes do not
   migrate it.
5. Publish measurements only for paths actually run. Node heap measurements and
   generated unit fixtures establish neither Worker memory nor CPU qualification.
