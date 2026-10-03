# Pandoc streaming qualification

Status: incomplete. Streamed file I/O does not establish bounded document
conversion. This plan requires execution in workerd and on Cloudflare before
claiming Worker qualification. Preliminary local isolate-memory measurements
are recorded below; Cloudflare and CPU measurements remain outstanding.

## Coverage to complete

- HTML includes retain decoded input and replacement generations in one extra
  caller-backed page cache. Verify acquisition before document input, UTF-8
  diagnostics, implicit standalone output, raw Unicode, replacement tokens,
  finite output preflight and retirement before commit. The workerd/R2 include
  scenarios cover JSON/CSV with streamed filters and producer/cancel/sink
  failures. Extend the increasing-size and concurrent-request measurements to
  these paths. Custom HTML templates now retain source,
  nested evaluation continuations, body and output in the same cache. Verify
  nested/empty/malformed blocks, dead branches, long names, inherited bindings,
  newline trimming and source/retirement failures. Variable values, nested loop
  bindings and admission traversal state are retained with one extra page cache.
  SDK input maps remain caller-owned resident objects: measure that baseline,
  the maximum immediate Object.keys enumeration and longest complete lookup
  key separately from backed conversion state. CLI variable option parsing is
  still resident. Exercise deep arrays, wide maps, shadowed bindings, zero/false/
  null truthiness, finite output, validation before document acquisition and
  cancellation/storage/retirement failures. Workerd/R2 template cases include
  64 KiB variable payloads with a 16 KiB cache and nested loops. Error messages containing an invalid expression still
  require the complete expression string; full runtime qualification remains
  incomplete.

- JSON metadata files now retain raw input, parsing state, duplicate-key indexes,
  merge jobs and resulting generations in caller storage (at most seven page
  caches during a merge). Exercise long keys/values, duplicate maps, null
  deletion, native JSON numbers and metadata-before-filter ordering. The
  workerd/R2 metadata scenarios cover JSON, standalone HTML and ODT output,
  producer failures, cancellation and destination failures. Direct metadata
  option maps and full memory/CPU qualification remain outstanding.

- Retained JSON and CSV/TSV routes admit finite `work` and `diagnostics` budgets
  through the shared execution context. Exercise both budgets in filtered and
  unfiltered cohorts, including exhaustion before publication. Other finite
  document budgets still require separate retained accounting; these checks do
  not establish qualification for those fallback paths.

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
  JSON to HTML now also retains writer continuations, heading/attribute indexes,
  note queues, table occupancy and text in caller storage. Differential tests cover
  standalone contents, numbering, Unicode IDs, URL policy, raw diagnostics, table
  spans and nested notes; generated inputs and 500 nested containers exercise
  backing I/O and cleanup. Rendering uses three page caches plus fixed indexes.
  Include long identifiers, many notes, colspan/rowspan geometry and standalone
  output in Worker measurements; these tests alone do not qualify their memory.
  CSV/TSV now feeds that same retained filter/transform/writer pipeline for multiple
  inputs, including standalone HTML. Unit cases prohibit input collection and
  whole-file reads, exercise reused chunks and slow sinks, and inject filter,
  backing, cancellation, output and retirement errors. The external R2 workerd
  cohorts include CSV input to JSON, plain and HTML through three filter generations.
  Finite table budgets with filters still select the compatibility converter.
  CommonMark/GFM writers now retain continuations, intermediate text, escaping,
  long code fences, repeated-target indexes and table-span occupancy. Differential
  tests cover writer bytes, parse-back behavior, projections and diagnostics;
  generated inputs cover long targets/code runs, 500 nested containers, bounded
  backing transfers and publication failure cleanup. R2 workerd cohorts include
  Markdown outputs after chained filters, with JSON and CSV input. Include these
  paths in the size/concurrency measurements; functional tests alone are insufficient.
  RST now retains continuations, source projection, substring-search patterns,
  identifiers, notes, tables and output. Differential tests include long names,
  nested notes, leading empty blocks and diagnostics; generated inputs exercise
  reused chunks, bounded transfers, slow sinks and failure cleanup. R2 workerd
  cohorts include JSON/CSV to RST and transformed RST after chained filters.
  These are functional checks, not memory-plateau qualification.
  LaTeX retains labels, note queues, column widths, span occupancy and repeated
  headers, preserving standalone metadata, math safety rules and URI/path checks.
  Tests cover generated long code/targets, 500 nested containers, output/backing
  errors, source retirement and R2-backed JSON/CSV filter generations. Invalid
  math command diagnostics still materialize the offending command name; this
  belongs to the outstanding resident diagnostic boundary.
  RTF retains writer jobs, sorted fonts/colors, list definitions, table columns,
  image target/path indexes and output in caller storage. PNG validation streams
  inflate output; JPEG decoding uses caller storage. Differential tests cover
  resource security, reused chunks, errors and atomic retirement; workerd/R2
  tests exercise filter generations and streamed PNG/baseline/progressive JPEG.
  Extend the size/concurrency measurements to large pictures, fonts, lists and
  paths: filesystem path strings, explicit byte-only resource capabilities and
  full diagnostic messages remain resident boundaries. Functional tests do not
  establish a memory plateau, CPU or first-byte qualification for these cohorts.
  ODT output now retains XML continuations, dynamic list styles, image indexes,
  ZIP member payloads and central records. Differential tests compare complete
  archive bytes, including image density and PNG/JPEG/GIF/BMP/TIFF profiles.
  TIFF directory traversal uses a backed work stack and visited index; long
  authored dimensions use bounded numeric parsing. Include large image metadata,
  many members, nested tables/lists and resource search paths in the Worker
  size/concurrency cohorts. ODT reading and compatibility conversion still
  materialize documents; this output path alone is not full qualification.
  Other conversions still require replacing whole-document input acquisition, joined text, document arrays
  and serialized results with retained sources and a paged document representation.
  Preserve diagnostics, source locations, resource identities and byte results.
- Exercise JSON filter protocol streams and genuine Lua callbacks, including
  document callbacks, arbitrary reordering, long strings, tables and metadata.
  Check timer-driven cancellation during top-level Lua and callback loops, before
  a finite work budget expires. VM instruction hooks now suspend and resume the
  same state; native library callback boundaries still defer those suspensions.
  JSON streaming runtimes use retained protocol responses and document generations,
  with at most five page caches live during validation. Test long image URIs
  separately: origin admission still materializes one URI. Runtime-owned state
  is not bounded by protocol streaming. Whole-value runtimes currently retain
  documents. The internal Lua storage layer retains binary strings, table
  keys/values, collision indexes, iteration cursors, metatables, closure identities
  and shared captured-variable cells in caller storage. Linked activation records
  retain registers, argument counts and return continuations; scope-close and
  tail-call tests cover captured-cell identity after register reuse. Prototype
  storage now retains patchable bytecode, source lines, constants, nested-function
  links and capture descriptors. Numeric values preserve Fengari integer/float
  tags while equivalent numeric table keys still share entries. A retained
  JSON value bridge now transfers strings and containers through fixed-size backed
  traversal frames, including cycle checks and empty-container identities. It is
  connected to public `applyJsonStream` filters. The retained interpreter executes actual
  Lua bytecode through backed frames, including calls/tail calls, loops, captures,
  strings and numeric coercion. Differential tests compare its supported core
  with the existing interpreter; cancellation and error tests verify scratch
  cleanup. Decimal coercion retains 1100 significant digits plus a sticky digit;
  string comparison preserves existing binary collation in bounded chunks.
  Native callbacks now stream arguments/results through these frames. Table
  delegation, arithmetic, comparisons (including reversed less-than fallback),
  callable tables and right-associated concatenation resume through backed
  continuations. Raw base operations preserve protected metatables and arity
  checks. Test recursive callbacks, cancellation inside metamethods and cleanup.
  The private lexer now retains identifier/literal payloads and its intern index
  in caller storage, with fixed token buffers and no retained comment payload.
  Byte-boundary differential tests preserve escapes, long strings, number tags,
  line tracking and existing binary interning collisions. Empty source chunks
  still checkpoint, final partial work quanta are charged, and early/error exits
  close the source. The public stream boundary uses this lexer and compiler:
  the syntax reader now stores complete statement/expression trees and lists in
  caller storage, retaining the existing syntax nesting bound. Grammar tests
  include the shipped Pandoc constructor/traversal bootstrap, assignment targets,
  call forms, associativity and cancellation after a source read. Retained lexical
  scopes now resolve locals, definition-time shadowing and shared upvalues into
  prototype captures, with bounded name indexes and close-before-register-reuse
  execution coverage. Label/goto state and pending jump lists are also retained,
  including inner-label shadowing, illegal local-scope entry, outward jump
  propagation and close-register patching. The private source compiler now emits
  executable retained bytecode for statements, expressions, constructors,
  closures, loops and multiple returns. Expression continuations and numeric
  constant folding use backed stacks/caches; differential tests cover assignment
  conflicts, delayed upvalue table access, native calls, metamethod ordering and
  register pressure at the existing local limit. The shipped constructor/traversal
  bootstrap compiles with a fixed page cache. Base, math, UTF-8, table and string
  libraries and Pandoc constructors/traversal now run through the retained runtime.
  Public JSON/CSV conversions to JSON, plain, HTML, Markdown, RST, LaTeX, RTF and ODT use it
  when workingFiles and the streaming Lua capability are supplied. Lua image-origin
  maps, key indexes and comparison frames use one extra page cache in caller storage.
  Verify unchanged versus replaced/reordered targets, same-URL different-directory
  caching, long/colliding metadata keys, chained generations and comment/heading
  rewrites. Other readers, finite-budget fallbacks and buffered apply still use the
  resident runtime. Preserve their
  behavior while replacing those paths. `onError` delivers retained error bytes
  before scratch closes; the command consumes them with backpressure. Without
  that callback, SDK errors explicitly collect Error.message for compatibility.
  Local workerd/R2 regression coverage exercises shipped SDK and command bundles,
  real callbacks, streamed errors and backing cleanup. Extend it to larger inputs,
  source/callback cancellation, remote failures and concurrent requests; measure
  live memory and CPU rather than inferring a plateau from these functional checks.
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
