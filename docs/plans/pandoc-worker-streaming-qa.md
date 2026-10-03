# Pandoc streaming qualification

Status: incomplete. Streamed file I/O does not establish bounded document
conversion. This plan requires execution in workerd and on Cloudflare before
claiming Worker qualification. Preliminary local isolate-memory measurements
are recorded below; Cloudflare and CPU measurements remain outstanding.

## Coverage to complete

- Trace each format reader, converter, writer and resource engine, including
  Markdown reference resolution, HTML/XML trees, DOCX/EPUB archives, PDF layout,
  presentation and spreadsheet conversion. Record the tested commit and hashes
  of the owning source files with each run.
- Single-input JSON to JSON now uses retained syntax, schema tasks,
  table occupancy, numeric key ordering and output. Test its fixed cache sizes
  independently of input bytes and document nesting. JSON and CSV/TSV to plain
  text now retain writer jobs, linked diagnostic paths, intermediate text, wrapping
  and indentation in caller storage. Differential unit tests cover existing plain
  constructors, diagnostics, long words and deep nesting; external R2 workerd tests
  cover JSON filters to plain output with failure/cancellation cleanup. Rendering
  uses three page caches; filter validation uses up to five. These tests establish
  behavior and backing I/O, not a memory plateau or Cloudflare qualification.
  Heading shifts and HTML comment removal on JSON input also use retained rewrite
  jobs, scalar slices and two document generations (four page caches). Tests cover
  split comment delimiters, generated long comments, deep nesting, filter ordering,
  unchanged metadata, original math-error paths and backing/sink/cancellation
  failures. Exercise these options in the measurement cohorts below.
  Other conversions still require replacing whole-document input acquisition, joined text, document arrays
  and serialized results with retained sources and a paged document representation.
  Preserve diagnostics, source locations, resource identities and byte results.
- Exercise JSON filter protocol streams and genuine Lua callbacks, including
  document callbacks, arbitrary reordering, long strings, tables and metadata.
  JSON streaming runtimes use retained protocol responses and document generations,
  with at most five page caches live during validation. Test long image URIs
  separately: origin admission still materializes one URI. Runtime-owned state
  is not bounded by protocol streaming. Whole-value runtimes currently retain
  documents. The internal Lua storage layer retains binary strings, table
  keys/values, collision indexes, iteration cursors, metatables, closure identities
  and shared captured-variable cells in caller storage. Linked activation records
  retain registers, argument counts and return continuations; scope-close and
  tail-call tests cover captured-cell identity after register reuse. A retained
  JSON value bridge now transfers strings and containers through fixed-size backed
  traversal frames, including cycle checks and empty-container identities. It is
  not yet connected to the compiler/interpreter: bytecode, constants, frame
  execution, standard libraries and Pandoc constructor translation still require
  integration and runtime qualification. Measurements of unavoidable live runtime
  state are still required.
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


## Preliminary local measurements, 2026-10-03

Conversion source: `0a6a9e9f77`, with the R2 fixture's handle high-water
instrumentation added. macOS arm64, Miniflare `4.20260708.1`, workerd
`1.20260708.1`, compatibility date `2026-07-01`, no Node compatibility.
The generated input is one JSON CodeBlock, using a reused 8 KiB source chunk.
Three stream-only protocol passes transform its text before a slow output sink.
Each page cache is fixed at 16 KiB. Only namespace receipts use memory safe-fs;
16 KiB payload pages use the injected local R2 simulator outside the user isolate.
This is not a deployed Cloudflare backend or a real language-interpreter filter.

The manual run sampled `Runtime.getHeapUsage` on the **user workerd isolate**
with a 100 ms delay between responses while conversion ran. These are sampled heap values, not total
resident memory or a proof of maximum live state. Backing storage and embedder
heap are reported separately; their independently sampled maxima must not be
summed as a simultaneous peak. Forced collection was not used for these measurements: an idle inspector
`HeapProfiler.collectGarbage` call did not respond within five seconds. A later
probe completed it after dispatching another request; future live-state runs
should use that request boundary. Sequential cases reuse an isolate; baseline
includes prior uncollected allocations. CPU time is unavailable in this run; wall time must not
be substituted for CPU consumption.

| Payload | Concurrency | Wall ms | First output ms | Baseline used heap bytes | Peak used heap bytes | Peak backing bytes | Peak embedder heap bytes | Samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 1 | 5456 | 4889 | 26660720 | 37352524 | 3089684 | 1289616 | 52 |
| 8 MiB | 1 | 50552 | 43564 | 31167260 | 72714352 | 13324956 | 4771552 | 453 |
| 1 MiB | 4 | 77258 | 74639–74642 | 52308472 | 79434636 | 14660724 | 6190112 | 461 |

Both runs emitted payload bytes plus 93 JSON framing bytes, closed all seven
spill handles (three simultaneously open), and removed every page. Maximum
storage transfers were 16 KiB and output chunks 4 KiB. The 1 MiB run performed
3,263 page reads and 1,731 writes; 8 MiB performed 26,111 reads and 13,827 writes.
The four concurrent requests each emitted the correct hash, closed seven handles
and left an empty namespace. The last request observed no remaining bucket pages;
earlier requests still observed pages belonging to peers. Concurrency substantially
increased latency. The memory increase has not established a plateau; larger cases
and higher concurrency are still needed before qualification.

The maintained `scripts/pandoc-filter-worker.test.ts` separately verifies exact
output bytes, cleanup and publication behavior for successful chained filters,
filter failure, cancellation in the second filter, and destination failure in
workerd with R2 pages. This functional coverage does not replace the measurements
or the remaining format/runtime coverage above.

Owning-source SHA-256 values for this run:

```text
665bf0e658b0c2aa911bf0c9658d24ac8aebf59097c35dda85908fd88e18cd80  packages/safe-bash-command-pandoc/src/engine.ts
620ae9841ecff4f7e30eddd1e2241144c3f30bf7b01a48c57d84361688b8af7e  packages/safe-bash-command-pandoc/src/retained-json.ts
767acef0df7adb158c6e8c785d09bb8d0e7d31f034b3441e30863bd6b72d9643  packages/safe-bash-command-pandoc/src/stream-json.ts
97a4789e6c9e592e28f8604a9756ec66629627a234ffbcff51a6ca5ea99bc0c3  packages/safe-bash-command-pandoc/src/json-filters.ts
a7f4b4dd2917ca5e145afbd4dec48d55e6b79570045aa731abed194b047893ad  packages/safe-bash-command-pandoc/src/backed-json.ts
0cede0da84c31e89d90f2449f49b484ebbe79685e0ea673172dd7452e2a983c0  scripts/pandoc-r2-storage.fixture.mjs
```

A subsequent pre-optimization 32 MiB run did not complete its measurement:
an inspector `Runtime.getHeapUsage` request timed out after five seconds and
the temporary measurement driver exited before collecting conversion results.
No output, memory peak or cleanup result is claimed for that attempt. The driver
must tolerate missing samples and retain partial evidence before larger reruns.


After `916b5f384a` caches the current node's scalar flag (one boolean, no
node-index growth), repeated header-page reads during scalar construction are
removed. The deterministic test fell from 253 backing reads to at most four for
128 chunks with a single-page cache. Source SHA-256 for `backed-json.ts` is
`d326a459a946c11e7e337ed3b4a39474ef38f7194565dc76c75e51930e011d30`.

| Payload | Wall ms | First output ms | Baseline used heap bytes | Peak used heap bytes | Peak backing bytes | Peak embedder heap bytes | Samples | Page reads | Page writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 20448 | 18284 | 26663248 | 37602596 | 1823116 | 773776 | 136 | 1231 | 715 |
| 8 MiB | 98355 | 88407 | 32533920 | 71774144 | 3916212 | 4126752 | 771 | 9743 | 5643 |

These reruns used one request, the same fixed caches, three filters and slow sink.
Both matched the prior output hashes, closed all seven handles, and left no
bucket pages after all requests completed. No inspector samples timed out.
The shared machine was contended, so these wall times do not establish a speedup;
the page counts demonstrate reduced I/O. Neither these samples nor the change
establishes a memory plateau or completes the remaining qualification cohorts.
