# Pandoc streaming qualification

Status: incomplete. Streamed file I/O does not establish bounded document
conversion. This plan requires execution in workerd and on Cloudflare before
claiming Worker qualification. Preliminary local isolate-memory measurements
are recorded below; Cloudflare and CPU measurements remain outstanding.

## Coverage to complete

- Supplying `resourcePath` now preserves the retained route for all supported
  text writers, including non-embedding HTML and empty input. Compare output,
  diagnostics and finite byte/reference budgets with the buffered API; reject
  invalid directories before pulling input and verify cancellation/sink cleanup.
  The public reference Worker matrix supplies 64 search directories to SDK and
  command conversions, forbids whole-file reads, and rejects resident directory
  array copies in the SDK. Run the increasing-size/concurrency measurements below
  with these options too; local workerd parity alone is not deployed qualification.

- Single-input, joined-input and file-scope MediaWiki now retain UTF-16 source spans, line indexes, inline
  continuations and AST nodes in caller storage. Compare long paragraphs, code
  blocks, wide tables, many list items and nested markup with the compatibility
  reader, including finite quotas, source locations and failure cleanup. The
  public reference Worker matrix covers SDK/command with no filter, JSON and
  Lua filters, plus joined SDK/command operands with finite byte/reference quotas.
  File-scope SDK/command cases also cover Lua filters. Separate documents retain
  quota ordering, acquisition precedence and per-source image origins through
  metadata merges, Lua filters and transforms; image checks cover RTF/ODT/HTML.

- Composed workerd coverage in `scripts/pandoc-composed-worker.test.ts` builds
  the shipped Sips, Shuf and Pandoc exports with explicit Node-import rejection
  and no source aliases. Sips inspects an R2-backed image; Shuf streams a sampled
  document into Lua-filtered Pandoc, which reads the same image through the same
  supplied filesystem. SDK and command paths prohibit whole-file reads, enforce
  pipe backpressure and verify source/scratch closure and empty backing storage.
  Both modes also inject sink failure and cancellation after the first output
  write, assert the expected error and no later writes, and verify closure and
  empty backing storage. SDK checks require abort without commit. Cancellation
  may leave already-delivered stdout bytes; it does not promise rollback of an
  external sink. These cases explicitly reject whole-file reads.
  This functional cohort does not qualify Sips mutations, all format pairs, or
  memory/CPU plateaus. Extend its size, concurrency and failure cohorts below.
  Retained Lua translates wire enums to the established string API and back;
  differential tests cover quotes, math, ordered lists, citations and table
  alignments. Numeric Lua traversal preserves tuple/list order independently of
  table insertion order.

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
  producer failures, cancellation and destination failures. `metadataJson`
  option layers now share one retained snapshot and use the same merger directly,
  without encoding/reparsing or extra input-byte charges. Validate all layers
  before input acquisition, preserve file-then-option order and filter timing,
  and compare growing layer counts with fixed page caches (two additional caches
  regardless of layer count; nine total during file merges with option layers).
  Workerd/R2 scenarios include large option values and overlapping file metadata.
  Measure the resident SDK input map and immediate key enumeration separately.
  Typed `metadata` maps now retain snapshot/schema/enum translation and merge
  after JSON layers for all retained writers. Exercise all enum positions, nested
  maps, shared values, rejected accessors/cycles and retirement failures. Separate
  the caller graph and immediate property-name enumeration from the typed wire
  cache and shared option cache. R2 scenarios include typed maps and filter
  ordering. RTF/ODT typed merges retain original-image authority and clear it
  for replaced values, including identical image tuples and replaced lists.
  Exercise nested maps, shared resource paths, Lua round trips and RTF unused
  resource rejection. Full memory/CPU qualification remains outstanding.

  Typed admission now shares the strict retained option snapshot and retires its
  source tape before document acquisition, keeping only the translated wire
  tape and shared scratch. Differential coverage includes deep/shared maps,
  large keys/values, malformed Unicode, descriptors and cycles. Failure checks
  cover backing writes, cancellation, destination and owner retirement. SDK
  input objects, immediate key enumeration and diagnostic paths remain resident
  API costs; these tests do not establish full memory/CPU qualification.

- Retained JSON/RTF/CSV/TSV routes admit finite document budgets through the shared
  execution context, including `references` and `retainedBytes` with metadata,
  filters, templates and image resources. Exercise allocation boundaries and
  exhaustion before publication in filtered and unfiltered cohorts. Native quota
  parity and local workerd/R2 checks do not establish deployed memory/CPU bounds.

- Trace each format reader, converter, writer and resource engine, including
  Markdown reference resolution, HTML/XML trees, DOCX/EPUB archives, PDF layout,
  presentation and spreadsheet conversion. Record the tested commit and hashes
  of the owning source files with each run.
- Abort inside filesystem image stream factories for retained RTF/ODT and media
  extraction. Require zero pulls, one return, no publication and no leftover pages.
  Also verify pending-pull cancellation and synchronous factory failure; the R2
  image matrix applies cancellation cases to both filesystem and custom resolvers.
- For retained JSON input, abort inside the iterator factory before its first pull.
  Verify zero pulls, exactly one iterator return, no output commit and no remaining
  backing files; repeat with finite references and retained-byte budgets.
- EPUB archive input must enroll iterator cleanup before a host factory can
  cancel. `scripts/pandoc-epub-worker.test.ts` exercises the public output SDK in
  workerd with synchronous/asynchronous factories and failing cleanup. Require
  cancellation to win, zero pulls/writes, one return, no output lifecycle calls,
  and no scratch or R2 objects. This verifies producer ownership only: EPUB XML,
  chapter ASTs and media resources still require bounded retained intermediates.
  The same Worker fixture checks oversized `mimetype` members with R2 backing:
  validation probes at most 23 bytes, preserving the accepted UTF-8 BOM spelling,
  quota precedence and the invalid-mimetype diagnostic. Unit parity covers valid,
  truncated and trailing-content spellings. Fixture archive construction is
  buffered test setup, not evidence of a bounded EPUB writer or a memory plateau.
  Long EPUB chapter/media URIs must normalize and encode one component at a
  time without path-wide component or character arrays. Preserve one-pass percent
  decoding, root traversal rejection, fragment identity and exact output. The
  Worker fixture covers a 2048-pair redundant path through SDK and command;
  unit cases also reject encoded separators/controls and malformed escapes.
  Normalized archive-key strings and the EPUB DOM/AST remain resident boundaries.
  Fallback-graph membership now uses one eight-byte epoch mark per manifest
  entry in caller storage, reusing the records across traversals. Grow chain size
  independently; compare success, cycles, missing targets and finite depth errors
  against the buffered reader. Inject cancellation/storage failure during marking
  and require empty scratch. The public SDK/command Worker fixture forbids a
  resident fallback-ID Set across a 96-entry chain. XML trees
  and chapter ASTs still need retained representations; this is not whole-reader
  qualification and does not change the graph's existing traversal complexity.
  Anchor IDs, note definitions and the expanding note-reference queue now use
  collision-checked caller-backed text sets, with a backed insertion-order chain.
  Active note expansion membership also uses caller storage instead of copying
  ancestor Sets. Compare duplicate/missing anchors, recursive/repeated notes and
  dependencies discovered in non-spine note documents against buffered results.
  Inject cancellation and storage errors during identity insertion; require empty
  scratch and the original error. The Worker fixture forbids resident anchor Sets
  across 96 IDs. Current individual identity strings, XML/AST traversal frames,
  chapter membership, note-block Maps and copied note ASTs remain resident; this
  bookkeeping change does not qualify the entire EPUB reader as bounded.
  Manifest records now share an ordered caller-backed record chain with bounded
  ID/path indexes. Attribute text is stored in linked UTF-16 chunks and only one
  current item is decoded during iteration/lookup; cover/navigation selection no
  longer collects manifest-wide arrays. Test growing item counts independently of
  single-attribute width, including IDs above 65536 units, Unicode and unpaired
  surrogates. Preserve admission order, duplicate ID/path rejection, fallback and
  cover/navigation ambiguity diagnostics. Inject failure/cancellation during
  record admission and require scratch cleanup. The public SDK/command Worker
  fixture rejects resident manifest objects across 96 fallback entries. Direct
  OPF manifest subtrees now stream their item headers to caller-backed source
  records before normal admission; the XML tree retains neither item nodes nor
  ignored descendant/whitespace nodes. Drain completed headers after each
  256-unit parser window and await storage before another input pull. Compare
  XML charges/depth checks with the ordinary parser, validate ignored content,
  preserve namespace/ancestry selection and original storage errors on cleanup.
  Unit fixtures grow to 512 items; the Worker fixture also forbids growing
  manifest XML arrays. Other OPF sections, individual SAX attribute/token values,
  XHTML/NCX trees and chapter ASTs remain resident boundaries. This is not a claim
  of a complete retained XML reader or a deployed memory plateau.
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
  Finite row, column and field-text limits remain retained with filters and typed
  metadata. Differential checks cover exact and exhausted bounds, empty and
  multiple inputs, all retained writers and retirement before output. Table-cell
  budgets with filters still select the compatibility converter.
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
  Single-input RTF conversion now retains source bytes, opaque text/binary spans,
  token/group links, semantic definitions, document nodes and group/field/note
  continuations in caller storage. Font/color/style and list/override indexes
  are backed; supported list levels and label-length windows remain bounded.
  Differential checks cover malformed definitions, byte offsets, Unicode/code
  pages, tables, notes, hyperlinks, deep groups and cancellation/storage cleanup.
  The public output path supports JSON, plain text, HTML, Markdown, RST, LaTeX,
  RTF and ODT with genuine Lua filters. Picture bytes outlive replaceable filter
  generations and retire before publication. Test Lua replacement/deletion,
  shared picture identities across origins, external resolver priority, JSON
  image-origin diagnostics and RTF unreferenced-resource errors with and without
  a resource filesystem. Finite image-count, binary-byte and layout-work budgets
  remain on this path; other finite structural budgets still need accounting.
  Finite resource-count and resource-byte budgets also retain JSON/RTF/CSV/TSV
  conversion. RTF reserves its backed picture lengths at initial normalization,
  after combined metadata layers, and after each filter generation. Ownership
  transfers do not charge the bytes again. Differential checks cover exact limits,
  repeated filesystem/resolver images, source locations, templates/includes,
  cleanup, and ODT resolver accounting. Include these budgeted paths in the
  size/concurrency measurements; functional parity alone does not qualify memory.
  Shipped SDK/command workerd tests use R2 pages and prohibit resident Lua.
  These functional checks do not establish size/concurrency memory or CPU limits.

  Embedded HTML uses caller-backed resource bytes and base64 text. The encoder
  retains at most 12 KiB of raw binary string before emitting a base64 segment;
  resource chunks are at most 16 KiB. Exercise zero/one/two-byte payloads, MIME
  sniffing, base64 remainder boundaries, long pictures, Lua image origins,
  templates, and standalone output from JSON, RTF and delimited inputs. Verify
  source/scratch cleanup before publication and the unchanged behavior of absent
  filesystems and explicit resource resolvers. Workerd/R2 SDK and command cohorts
  cover JSON/RTF images, real Lua and the CLI embedding option. Extend the size,
  concurrency, cancellation and failing-storage measurements to this path before
  claiming full Worker qualification.
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
  separately: origin admission now scans absolute paths, relative references and
  opaque URLs in bounded chunks. Authority URLs, including file URLs, replay only
  the host/port into native validation; credentials, paths, queries and fragments
  stay out of the resident string. Ports use bounded numeric parsing; opaque hosts stream and IPv6 literals use a
  format-bounded buffer. ASCII domain labels and decimal/octal/hex IPv4 numbers
  use bounded state, including percent-encoded ASCII with escape carry across
  chunks and no recursive decoding. Fixed-size UTF-8 decoding rejects malformed
  byte sequences, unpaired surrogates and forbidden decoded characters even after
  encountering Unicode or punycode. Valid Unicode and punycode hostnames (including
  their percent-encoded forms) still use native whole-value validation. Preserve
  whole-host admission when replacing this fallback: large Unicode hosts can be
  rejected even when the corresponding ASCII host is accepted, and a nonempty
  file host made entirely of ignored IDNA characters differs from an empty host.
  Per-code-point ASCII normalization alone does not preserve these behaviors.
  Runtime-owned state
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
  Public JSON/RTF/CSV/TSV conversions to JSON, plain, HTML, Markdown, RST, LaTeX, RTF and ODT use it
  when workingFiles and the streaming Lua capability are supplied. Lua image-origin
  maps, key indexes and comparison frames use one extra page cache in caller storage.
  Verify unchanged versus replaced/reordered targets, same-URL different-directory
  caching, long/colliding metadata keys, chained generations and comment/heading
  rewrites. Finite reference/byte quotas remain caller-backed for these pairs, including
  metadata, templates and image embedding. JSON/RTF reject multiple operands before
  acquisition; this is an existing unsupported operation, not a buffering path.
  Other readers and buffered apply still use the resident runtime. Preserve their
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

## Real Lua local memory cohorts, 2026-10-03

Source `6da4652796` includes the public retained Lua runtime and enum/traversal
fixes. Runtime: macOS arm64, Node harness 26.10.0, Miniflare `4.20260708.1`,
workerd `1.20260708.1`, compatibility date `2026-07-01`, no `nodejs_compat`.
The shipped public package is bundled with browser/workerd conditions. Each
request lazily generates one JSON CodeBlock using a reused 8 KiB source chunk.
The injected source reader supplies genuine Lua:
`function CodeBlock(el) assert(#el.text==SIZE); return el end`.
The buffered `apply` capability throws if selected. All payload/scratch pages
use the injected R2 simulator outside the user isolate; memory safe-fs holds
only detached namespace receipts. Each individual page cache is fixed at 1 MiB;
this is not a single shared 1 MiB budget for the complete conversion.

The sink delays each write by 1 ms, counts bytes and computes a rolling 32-bit
FNV-1a checksum without accumulating output. Independently generated expected
JSON (including the final newline) gives checksums 370089679, 2806980303,
2572099279 and 1632575183 for 1, 8, 32 and 128 MiB respectively. A checksum is
not an exact byte comparison; maintained small-case differential tests provide
that separate check. Inspector samples target `core:user:` exclusively, with
250 ms between responses and a 5-second command timeout. Missed samples are
counted and do not cancel conversion. Values below are independently sampled
maxima, not RSS, simultaneous totals or guaranteed high-water marks. These
sequential cases share an isolate and include prior uncollected allocations.

| Payload | Wall ms | First output ms | Baseline used heap bytes | Peak used heap bytes | Peak backing bytes | Peak embedder heap bytes | Samples | Page reads | Page writes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 6179 | 5609 | 29629768 | 65879984 | 51492782 | 1160672 | 23 | 4652 | 2550 |
| 8 MiB | 25488 | 21907 | 50802676 | 71067260 | 90710364 | 2063392 | 93 | 12102 | 7738 |
| 32 MiB | 78652 | 59235 | 58175692 | 77778340 | 164012348 | 5287392 | 292 | 41096 | 26124 |

All three runs matched their expected checksum and payload-plus-93-byte length,
closed all six scratch handles (five simultaneously open), and left no R2 pages
or namespace entries. Maximum storage transfers were 16 KiB and output chunks
4 KiB. No inspector commands timed out. These results demonstrate successful
larger real Lua conversions and cleanup, not Cloudflare memory qualification.
CPU telemetry and deployed Cloudflare measurements remain unavailable here.

Owning-source SHA-256 values:

```text
c9b718d70927c0d9f1cca87823bdfcf780e25f05e3782411a3899cb1e3da3468  packages/safe-bash-command-pandoc/src/lua-stream-filter.ts
0056161e4bdeb0b2e520be935e907ed365b064e447dc184fa84a83b77dc273a9  packages/safe-bash-command-pandoc/src/lua-retained-filter.ts
0f7735243dca41d931fcb26c4a2948b6ee15cdffc5b03b068c58f2c4522f08df  packages/safe-bash-command-pandoc/src/lua-storage.ts
c4adc3c436166045a77c74e664d64a482c3613dbb0ee35b45d86a279b64c796b  packages/safe-fs/src/storage.ts
0cede0da84c31e89d90f2449f49b484ebbe79685e0ea673172dd7452e2a983c0  scripts/pandoc-r2-storage.fixture.mjs
```

A separate diagnostic cohort requests `HeapProfiler.collectGarbage` before each
heap sample. It runs in a fresh isolate, with sequential cases and the same
conversion/sink/cache settings. It overlaps the unforced 128 MiB cohort on the
shared machine; its wall times are neither isolated benchmarks nor CPU times.
Each case had one inspector timeout, including the request-completion boundary;
conversion results were still collected. Post-collection samples can miss live
state between samples and cannot replace unforced or deployed measurements.

| Payload | Wall ms | First output ms | Peak used heap bytes | Peak backing bytes | Peak embedder heap bytes | Successful samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 8299 | 7622 | 34136928 | 5619996 | 257936 | 24 |
| 8 MiB | 25504 | 21610 | 35506172 | 6507948 | 82792 | 86 |
| 32 MiB | 95400 | 78653 | 36514660 | 6597692 | 129184 | 328 |

All three collected runs matched their expected checksums and lengths, closed
six handles and removed all backing pages. Page read/write counts and maximum
transfer/output sizes matched the unforced cases. The low post-collection
backing values suggest allocation pressure rather than retaining the complete
payload in this particular Lua cohort. This does not establish a strict memory
bound: unforced backing peaks already exceed typical Worker memory budgets,
and no production implementation may rely on an inspector to force collection.
The remote-backend allocation behavior and deployed runtime pressure response
still require investigation. The 16 KiB-cache, larger/concurrent post-collection,
other document shapes, other formats/options and CPU cohorts remain outstanding.

Four concurrent 1 MiB requests in one fresh user isolate, using independent
namespaces and a shared external R2 bucket, completed in 30,957 ms client wall
time (per-request 30,747–30,805 ms; first output 30,074–30,186 ms). All four
matched checksum 370089679 and 1,048,669 output bytes, closed six handles each,
and emptied their namespaces. Early completions observed peers' bucket pages;
the last completion observed zero pages. Each request performed 4,652 reads and
2,550 writes with 16 KiB maximum storage transfers and 4 KiB output chunks.
Without forced collection, 82 successful samples and zero timeouts measured
baseline used heap 29,565,660 bytes, peak used heap 69,404,424 bytes, peak backing
58,711,919 bytes and peak embedder heap 1,031,712 bytes. These are aggregate
isolate metrics, not per-request memory. This cohort overlapped the larger
single-request measurement on the host, so wall time is not a throughput claim.

Sixteen concurrent 1 MiB requests, also in a fresh user isolate without forced
collection, completed in 128,601 ms client wall time. Per-request wall times
were 127,966–128,334 ms and first-output times 125,853–126,486 ms. All sixteen
matched the same checksum and length, closed six handles each and emptied their
namespaces; the last completions observed an empty shared bucket. Per-request
I/O counts and transfer sizes matched the four-request cohort. Aggregate
baseline used heap was 29,631,284 bytes; independently sampled peaks were
73,643,376 used heap, 147,473,956 backing storage and 2,450,272 embedder heap
bytes. There were 209 successful samples and two inspector timeouts. This run
also overlapped other host cohorts and is not isolated throughput evidence.
Successful concurrent completion does not resolve the unforced memory-pressure
or deployed CPU/subrequest-budget qualification gaps.

The unforced 128 MiB single-request run completed in 397,150 ms (first output
330,959 ms), with 134,217,821 bytes and expected checksum 1632575183. It closed
all six handles and left no pages or namespace entries. It performed 172,850
reads and 100,235 writes, with the same 16 KiB/4 KiB transfer/output maxima.
Baseline used heap was 29,629,768 bytes. Across 1,456 successful samples and
three missed samples, independently sampled peaks were 107,144,216 used heap,
406,118,716 backing storage and 9,672,032 embedder heap bytes. Automatic
collection reduced backing storage sharply during the run, but this does not
qualify the transient pressure for a deployed Worker's memory limit.

With each cache reduced to 16 KiB, the 1 MiB case completed in 176,916 ms
(first output 176,118 ms), matched the expected checksum/length, closed six
handles and removed all pages. It required 140,110 reads and 57,006 writes.
Across 149 successful samples and 19 missed samples, peaks were 59,895,932
used heap, 66,935,305 backing storage and 3,095,072 embedder heap bytes; baseline
used heap was 29,568,260 bytes. The many missed samples weaken its memory
observation. Small caches substantially increase backing I/O for real Lua;
local completion alone does not establish acceptable deployed CPU/subrequest
costs. This run overlapped other cohorts and later local verification commands.

The 16 KiB-cache 8 MiB case also completed: 315,971 ms wall, 308,306 ms to
first output, expected checksum/length, all six handles closed and no remaining
pages. It performed 155,182 reads and 67,014 writes. Baseline used heap was
65,166,644 bytes; sampled peaks were 84,712,884 used heap, 66,870,914 backing
and 5,416,352 embedder heap bytes. There were 359 successful samples and twelve
timeouts. Larger and concurrent 16 KiB-cache cohorts remain unmeasured.

### Page-buffer reuse follow-up

A focused storage regression observed seventeen distinct 16 KiB backing buffers
for eight sparse pages with a one-page cache. The cache now reuses an evicted
buffer after its awaited flush, zeroing it before loading a new page. Regression
coverage checks one- and three-page caches, zero-filled unwritten ranges,
independent returned bytes, existing partial I/O and cancellation/cleanup.
This reduces allocation churn without changing cache capacity, backend authority
or returned-buffer ownership. It does not remove the backend's own allocations.
Modified storage SHA-256:
`01c337443c9139174c2ac50b68fa6d3d7beaef5e2fe840208e10910c0e050756`.

The shipped bundle was rebuilt and the unforced 1 MiB-cache Lua cohort rerun.
These sequential cases overlapped local builds and the smaller-cache measurement;
wall times cannot support a speedup claim. Output checksums, lengths, six-handle
cleanup, page counts and transfer sizes exactly matched the earlier cases.

| Payload | Wall ms | First output ms | Baseline used heap bytes | Peak used heap bytes | Peak backing bytes | Peak embedder heap bytes | Samples |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 MiB | 20350 | 19364 | 29568532 | 53259592 | 8219241 | 1289632 | 62 |
| 8 MiB | 64079 | 58374 | 37225108 | 75513692 | 23458148 | 3224032 | 211 |

No samples timed out. These lower backing peaks are encouraging observations,
not a general upper bound or isolated attribution of all memory savings.
The subsequent larger/concurrent reruns are recorded below. Deployed cohorts
remain outstanding; pre-change measurements above must not be presented as
measurements of the modified cache.


Subsequent unforced reruns used the rebuilt cache change above on base
`b0a0d09b1a`, before the final delivery rebase; the storage source hash is
unchanged. The 32/128 MiB cases share one isolate; sixteen concurrent 1 MiB
requests use a separate isolate and overlap the size cohort on the host.
All output checksums, lengths, transfer bounds, handle closure and cleanup
receipts were checked. Sixteen requests each closed six handles; the last
completions observed an empty shared bucket. Per-request page counts match
the corresponding pre-change cases.

| Payload | Concurrency | Wall ms | First output ms | Peak used heap bytes | Peak backing bytes | Peak embedder heap bytes | Samples | Timeouts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 32 MiB | 1 | 93680 | 78650 | 87139984 | 47665732 | 7479712 | 344 | 0 |
| 128 MiB | 1 | 352248 | 264519 | 99531528 | 47071596 | 12509152 | 1308 | 1 |
| 1 MiB | 16 | 111731–112071 | 109837–110352 | 93441000 | 105199438 | 4642592 | 204 | 0 |

Baseline used heap was 29,573,496 bytes for 32 MiB, 59,083,740 for 128 MiB,
and 29,572,164 for the concurrency cohort. The 128 MiB backing peak fell from
406,118,716 to 47,071,596 bytes in these observations; backing peaks at 32 and
128 MiB were similar after reuse. This supports reduced allocation pressure
for one long CodeBlock, not a guarantee for all document shapes or formats.
The 16-request aggregate backing peak was 105,199,438 bytes; independently
sampled heap metrics must not be summed into a simultaneous memory total.
Cloudflare deployment, runtime CPU/subrequest costs, other document shapes,
small-cache reruns and resident fallback paths still require qualification.


RTF reader qualification must cover long text, wide font/style/list indexes,
deep formatting/field continuations, tables, notes and large hexadecimal/binary
pictures. Run each increasing-size and concurrent cohort with externally backed
working files and record actual isolate memory, CPU and first-output latency.
Compare all supported retained writer outputs against the compatibility reader,
including real Lua image deletion/replacement and JSON sidecar rejection.
`scripts/pandoc-rtf-reader-worker.test.ts` exercises reused input chunks, slow
sinks and source/cancellation/sink failures with R2 pages under local workerd.
Transfer and cleanup assertions are conformance evidence, not deployed
Cloudflare memory or CPU qualification.


For custom image providers, repeat RTF/ODT resource cohorts with
`resources.resolveStream` and externally backed `workingFiles`. Use generated,
reused chunks and slow sinks; record peak isolate memory, CPU, first-byte latency
and concurrent-request behavior. Verify that `resolve` is never called when a
stream is available, that stream-only providers work, and that producer errors,
invalid chunks, cancellation, limits and backing-store failures retire resources
before output commit. Include a resolver whose `next()` waits until `return()`
closes it, and one that aborts during creation; require exactly one return call
and no further pulls in both cases. The RTF workerd/R2 fixture covers both filesystem streams
and custom resolvers for PNG, baseline JPEG and progressive JPEG. Those bounded
transfer/cleanup checks do not replace deployed memory and CPU measurements.


Current per-format remainder (revalidated against the registry and conversion
admission in `engine.ts`; a retained default pair is not complete option coverage):

| Input | Remaining document-wide owner | End-to-end exit |
| --- | --- | --- |
| CommonMark/GFM | `commonmark.ts`, pending blocks/inlines, definitions and YAML metadata | Source, parser state and AST backed for every admitted extension |
| HTML | `html.ts`, parse5 tree and mapper arrays | Retained HTML recovery tree and retained Pandoc mapping |
| RST | `rst.ts`, source lines, definitions, jobs, notes and tables | Retained parsing/resolution including includes and substitutions |
| LaTeX | `latex.ts`, syntax/expansion state and AST | Retained macro expansion and mapping with existing diagnostics |
| EPUB | `epub-retained-book.ts` still materializes URI/manifest control values; other output pairs use `epub.ts` trees and ASTs | Qualify public plain output, remove remaining control-value materialization, and connect every output pair |
| DOCX | `docx.ts`, imported document/AST conversion | Stream package resources and retain imported document and Pandoc nodes |
| ODT | `odt.ts`, package bytes, XML/styles and AST | Retained package/XML/style resolution and mapping |
| PPTX | `pptx.ts`, presentation selection/text/format/note/image results | Retained presentation traversal and mapping |
| PDF | `pdf-reader.ts`, `PdfDocument.load` and `toSemanticAst` | Retained semantic extraction, images and Pandoc mapping |
| XLSX | `xlsx.ts`, workbook recalculation, cell Maps and row arrays | Retained formulas/workbook metadata plus Pandoc tables; scalar-only sources are insufficient |
| JSON, RTF, MediaWiki, CSV/TSV | Existing retained default conversions; option/filter admission still matters | Prove supported options and finite budgets do not fall back to the buffered converter |

Remaining output owners are EPUB, PDF, DOCX and PPTX. Existing retained JSON,
plain, HTML5, CommonMark/GFM, RST, LaTeX, RTF and ODT writers still need composed
coverage with each completed reader, options, resources and real filters.
`extractMedia`, citeproc and format-specific PDF/EPUB options are outside the
current retained admission lists; do not certify their execution from default-pair
checks. Runtime coordination retains Lua/IDNA/citeproc ownership separately.

The retained EPUB book owner now connects XML acquisition, XHTML mapping,
metadata/navigation, scoped anchors, independent note expansion and replayable
archive media to the public EPUB-to-plain output route. XML part caches
retire serially; chapter trees, metadata maps and note worklists use caller pages.
The public regression forbids the buffered XML parser and whole-file reads,
poisons reused input chunks, and exercises a slow sink, cancellation, sink failure
and finite reference/retained-byte budgets. Differential book tests compare spine,
metadata, navigation/NCX, notes, media, diagnostics and malformed input behavior.

This is not complete EPUB qualification. Other EPUB output pairs still use the
buffered route. URI/manifest control values and some diagnostic strings still
cross whole-string interfaces; budget/diagnostic precedence needs broader
comparison, and deployed memory/CPU/concurrency measurements remain required.
The local workerd fixture now rejects resident XML for both public SDK and command
conversions and includes an external note; its transfer/cleanup evidence does not
replace deployed measurements or prove every option/filter combination.

The next qualification path completes EPUB-to-plain control-value and XML
budget/error parity, then connects the same retained book to JSON and the other
retained writers. Preserve document language/direction sidecars, resource identity
and filter behavior when adding those output pairs. Keep XHTML, chapter/note trees
and intermediate serialization in caller storage; do not introduce another
whole-document serialization boundary.
The next Worker measurement must include generated multi-chapter books, increasing
chapter text, notes, tables and embedded images, finite budgets, a slow sink and
concurrent requests. Record peak isolate memory, CPU, first-byte time and R2 I/O
for both SDK and command. Local workerd verifies execution, ownership and bounded
transfers; deployed Cloudflare memory/CPU evidence remains a required separate
measurement. A successful manifest-only test cannot pass this gate.

Remaining ownership and exit gates (proposed coordination split):

- Conversion/storage work owns retained readers, writers, resources and atomic
  publication. Lua/runtime work owns the portable Lua graph, Unicode IDNA and
  citeproc runtime storage boundaries. Composed qualification covers both.
- Reader exits: CommonMark/GFM, HTML, RST, LaTeX, EPUB, DOCX, ODT, PPTX, PDF and
  XLSX must each demonstrate caller-backed intermediate state, output parity,
  failure/cancellation cleanup and no mandatory document collector. Recheck the
  actual registry and admission routes before implementing any format.
- Writer exits: EPUB, PDF, DOCX and PPTX need equivalent retained-state evidence.
  Exercise supported options and finite budgets without silently selecting the
  buffered converter. Preserve supported real filters and resource identities.
- Runtime exits: valid Unicode IDNA retains native URL parity; citeproc preserves
  citation ordering, disambiguation and bibliography output; Lua preserves real
  filters and diagnostics. Document and measure any mandatory native whole-value
  state rather than treating a bounded surrounding stream as completion.
- Resource exits: grow local-image paths, queries/fragments and diagnostics
  independently. Query/fragment identity and budget accounting now stream; path
  strings and full diagnostic messages remain explicit whole-value boundaries.
  Repeat long-suffix cases for RTF, ODT and embedded HTML with duplicate paths,
  distinct fragments, Unicode, finite budgets, slow sinks and cleanup failures.
  At path admission, assert that backing reads stop at the chunk containing the
  first query/fragment delimiter; suffix counts come from the retained scalar
  extent. Cover delimiters on both sides of a 4096-unit chunk boundary.
  Grow path depth and component width independently. Resource directory and URI
  normalization must avoid whole-path component arrays and decoded-character
  arrays while preserving parent traversal rejection, one-pass percent decoding
  and tilde rules. Ancestor inspection, embedded-key validation, basename
  selection and extraction URL encoding must likewise avoid component arrays.
  Verify root-first inspection, immediate rejection of symlink/non-directory
  ancestors, literal percent signs in media keys and no writes after rejection.
  Stream repeated `folder/../` components across scalar chunk boundaries and
  verify normalization/checkpoints occur before the next backing read. Reject
  invalid initial components without reading the remaining path. Cover escapes
  and surrogate pairs split across chunks, and derive suffix lengths from raw
  UTF-16 units even when normalization shortens the path. The required normalized
  filesystem path and unfinished component strings remain resident.
  Grow the explicit resource search list independently of document size. Require
  its normalized snapshot and index to use caller storage, with one directory
  resident during lookup. Preserve ordered fallback, preflight validation and
  the snapshot when caller options change during filesystem reads. Exercise the
  spilled list with slow sinks, source/sink failures and cancellation in the R2
  Worker resource matrix; require bounded transfers and empty backing storage.
- Final exits: run the composed public SDK/command workerd matrix without Node
  compatibility, then the increasing-size and concurrent deployed Cloudflare
  cohorts above. Record actual memory, CPU and first-byte measurements. Local
  workerd transfer checks alone do not satisfy deployment qualification.


For custom identifier-source resolvers, increase opaque identifier size separately
from image size. Require replay through `resolveSource` without invoking legacy
string resolvers, with chunks no larger than 4096 UTF-16 units and exact Unicode
content across surrogate boundaries. Verify source-only buffered SDK compatibility
and retained RTF/ODT parity, producer ownership and pending/factory cancellation.
Run those cases on R2-backed workerd along with filesystem and string resolver
cases; deployed memory/CPU/first-byte qualification remains a separate gate.


Repeat resource lookups for the same retained document nodes after the first
admission, with large identifiers and distinct nodes sharing the same identifier.
Require stable identities, no repeated identifier scalar reads, no growth in the
resource backing store, and unchanged resolver deduplication. The node-to-identity
index must itself use caller storage. Apply the same invariant to filesystem
resource identities with long query/fragment suffixes; keep different fragments
distinct while reusing the same admitted file bytes. Both target and resource
identity caches are scoped to the immutable admitted document. Repeat
origin-separation and finite-budget
checks along with the Worker resource matrix.


For distinct image nodes with equal long identifiers, verify that the backed
text index compares replayable chunks before allocating text. Duplicate keys
must grow only bounded node-index records, not another identifier copy. Include
empty identifiers at the index layer, split surrogate pairs, equal-length hash
collisions, producer failures and early iterator closure. Repeat filesystem and
custom-resolver output, origin, budget and Worker cleanup checks.
