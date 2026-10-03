# Pandoc streaming qualification

Status: incomplete. Streamed file I/O does not establish bounded document
conversion. This plan requires execution in workerd and on Cloudflare before
claiming Worker qualification; no Worker memory or CPU measurements are recorded
here yet.

## Coverage to complete

- Trace each format reader, converter, writer and resource engine, including
  Markdown reference resolution, HTML/XML trees, DOCX/EPUB archives, PDF layout,
  presentation and spreadsheet conversion. Record the tested commit and hashes
  of the owning source files with each run.
- Single-input JSON to JSON now uses retained syntax, schema tasks,
  table occupancy, numeric key ordering and output. Test its fixed cache sizes
  independently of input bytes and document nesting. Other conversions still
  require replacing whole-document input acquisition, joined text, document arrays
  and serialized results with retained sources and a paged document representation.
  Preserve diagnostics, source locations, resource identities and byte results.
- Exercise JSON filter protocol streams and genuine Lua callbacks, including
  document callbacks, arbitrary reordering, long strings, tables and metadata.
  JSON streaming runtimes use retained protocol responses and document generations,
  with at most five page caches live during validation. Test long image URIs
  separately: origin admission still materializes one URI. Runtime-owned state
  is not bounded by protocol streaming. Whole-value runtimes currently retain
  documents. A paged runtime boundary and
  measurements of unavoidable live runtime state are still required.
- Exercise citeproc with bibliography and citation counts that grow independently
  of document bytes. Measure its retained processor state separately.
- External resource extraction now spools payloads when working storage and a
  streaming publisher are supplied. Embedded resources, the document AST and
  resource name/collision indexes remain resident. A memory safe-fs backend is
  a test fixture, not evidence of bounded Worker memory.

## Manual Worker procedure

1. Build the selected package with its maintained workspace closure. Deploy the
   same commit to a workerd fixture and a Cloudflare test Worker using the caller's
   external safe-fs backend. Record runtime version, account limits, compatibility
   date, region and backend configuration. Disable payload caching in the fixture.
2. Generate source chunks lazily, reuse buffers and count bytes; never construct
   a complete input in the fixture. Test 1, 8, 32 and 128 MiB resources, long
   fields, many short blocks, many distinct images and deeply nested documents.
   Keep page-cache size fixed at 16 KiB and then 1 MiB in separate runs.
3. Run each supported format pair and option group, not just CSV to HTML. Include
   archive inputs, external and embedded media, all three filter kinds, metadata,
   includes, templates, finite budgets and stdout versus atomic file publication.
   Use the original converter/native tools on small cases for byte or meaningful
   semantic interoperability comparisons.
4. Consume each output with a throttled sink. Record source and destination
   outstanding bytes, spill writes/reads, largest range, open handles and backing
   bytes separately from Worker resident memory. Check that extraction publishes
   chunks no larger than 16 KiB and retains no resource-sized byte array.
5. Capture actual isolate memory high-water mark from workerd inspector/runtime
   instrumentation and Cloudflare-supported profiling, CPU time from runtime
   telemetry, wall time and first-byte latency from the client. If a runtime does
   not expose a memory measure, record that measurement as unavailable; do not
   substitute Node heap values. Sampling must include acquisition, parsing,
   filtering, rendering and commit, with a stated sampling interval.
6. Repeat with 1, 4 and 16 concurrent requests, independent destinations and a
   shared backing provider. Report individual and aggregate memory/CPU and
   first-byte latency. Check bounded outstanding writes and stable cache sizes.
7. Inject cancellation during source acquisition, spill, filter execution, output
   backpressure and commit. Inject late source errors, short/failed backing I/O,
   destination replacement and a publisher that returns early. Verify byte
   ownership, primary error semantics, guard enforcement, descriptor closure and
   removal of invocation scratch data. Previously committed extraction files
   may survive a later resource failure, as documented by the API.
8. Store temporary profiles and run evidence under `/out`; summarize measured
   results and coverage gaps before purging temporary output. A growing resident
   AST, resource index or filter runtime is a failed bounded-memory qualification,
   even if a small conversion succeeds or a file-size ceiling prevents an OOM.
