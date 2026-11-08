# HTML conversion Worker memory qualification

## Scope and prerequisites

This manual QA plan includes local workerd execution evidence below. Hosted
Cloudflare resource limits require separate deployment measurements. The command now uses the
storage-backed incremental parser to write unfinished tags, attribute indexes,
open-element frames and fixed-size document records into caller-backed storage.
Markdown text uses immutable balanced ropes in the same storage; code
fences, ragged-table widths and output staging no longer require whole output
strings or arrays of every table row. Traversal, normalization and formatting
continuations use fixed-width records in the same storage, including pending
list items and table cells. Incremental rope construction keeps a frontier of
strictly decreasing AVL heights (fewer than 80 references for safe-integer text
lengths), avoiding repeated spine copies while preserving immutable snapshots.
The cache is 256 KiB and spills via the
injected safe-fs retained descriptor in `TMPDIR`, falling back to the command
working directory. A memory backend still retains backing bytes in RAM.

Destination security checks and escaping now stream over stored text. Paths,
credentials, arbitrarily long ASCII labels and zero-padded ports do not enter
native URL parsing as full payloads. Percent-decoded host bytes use a bounded
UTF-8 window and caller storage. Individual IDNA labels over 256 UTF-16 units
now use stored Unicode mapping, canonical normalization and RFC 3492 codecs.
Normalization retains at most 255 canonical-class buckets, each with a bounded
2048-unit text window; native normalization sees only scalar-sized inputs and
pairs. Scalar-rank metadata makes punycode insertion use stored rope offsets.
Fixed Unicode tables and 256-entry scalar caches do not grow with input size.
Constant-size native probes preserve Unicode-version admission, Ada ContextJ
behavior, older bidi-start rules and ASCII-only A-label compatibility. Do not
impose DNS wire-size limits: the native URL parser accepts longer labels.
Preserve output/error ordering, retained file identity, cleanup and cancellation
while qualifying these paths; exercise adversarial depth and attribute size
without lowering accepted limits. Deterministic tests are not Worker measurements.

The separate htmlq owner is `packages/safe-bash-command-htmlq`. Command projection
now uses `stored-parser.ts`, `document-store.ts`, `stored-selectors.ts` and
`stored-serializer.ts`. Text, DOM records, child/attribute links, parser stacks,
selector continuations and removal snapshots live in injected caller storage.
The page cache is 256 KiB; additional fixed caches hold at most 512 node records,
16 KiB per live reference sequence and two sets of 256 names of at most 64
UTF-16 units. Normalized/pretty traversal uses parent/sibling records, and selector
attribute comparisons scan bounded text windows. Compatibility tests compare
stored recovery, selectors and formatting with the existing parser, including
adoption, foster parenting, namespaces and template fragments. The public
source-only convenience APIs still retain their DOM. Token frames, decoded values, names and duplicate-attribute indexes now use
caller storage. Long-name end-tag matching scans bounded rope windows. Generated
large text/comment/name/attribute cases assert bounded text writes and spill I/O;
malformed-token cases compare against the existing tokenizer. URL components,
normalized hosts and persistent path stacks also live in caller storage. Bounded
native probes preserve runtime-specific opaque-path and custom-scheme behavior.
The selector AST scales with the caller-supplied selector operand, while
document-dependent matching state is stored; the operand AST is not a retained
copy of the input document. Sibling ordinals and per-type totals use stored
indexes with 64-entry caches, invalidated when the document changes. Edge
predicates stop at the first relevant sibling.
Output publication now prefers direct streaming publication, then retained atomic
staging with one awaited write of at most 16 KiB. Deterministic tests cover reused
chunks, slow writes, cancellation, destination conflicts, aliased input/output,
identity preservation and combined source/cleanup errors. These use a memory
filesystem and do not establish external-storage or Worker qualification. The
byte-only compatibility fallback still buffers output and is unsuitable for a
bounded-memory Worker path; qualification must use a capable injected backend.

## Deterministic prerequisites

Depth regressions instrument outstanding child iterators and render calls. At
128 nested elements the old paths retained 129–131 iterators or 129 render calls;
the stored interpreter uses one render call and at most five child iterators in
these cases. Nested emphasis/list/table output is compared with the legacy
renderer. Generated input also injects failure and cancellation into renderer
spill writes and checks primary errors and once-only descriptor cleanup. These
are deterministic Node tests, not Worker memory measurements.

- Generate input from repeated/reused chunks rather than retaining fixtures
  proportional to input size. Exercise a single large input chunk too.
- Measure maximum outstanding reader/writer bytes and in-memory indexing state.
  Reject payload-wide reads and concatenation in the migrated execution path.
- Use injected safe-fs spies and explicit backing-storage counters. A memory
  filesystem is a unit-test fixture, never evidence of external spilling.
- Pause the output sink and verify input/index work stops at the documented
  bound. Inject read, write, publication, cleanup and cancellation failures;
  verify primary error identity, once-only cleanup and owned-byte behavior.
- Compare output bytes with the current compatibility corpus, including malformed
  input, Unicode entities, split UTF-8, ragged tables, long fences, adjacent
  emphasis, nested lists, selectors, removals and multi-file output.

## Execute in workerd and Cloudflare

1. Record the exact commit, workerd version, deployed Worker configuration and
   provider limits. Configure a caller-injected external safe-fs backend with
   explicit authority over the backing directory. Record backend capabilities,
   request counts, peak backing bytes and cleanup results.
2. Stream 1, 8, 32, 128 and 512 MiB documents, stopping only at actual platform
   limits. Include repeated paragraphs, one long text node, deeply nested tags,
   large attributes, a table whose final row determines width, code with a late
   longest fence, and htmlq selectors requiring later siblings/document context.
3. Drain output into an incremental byte counter/hash; do not collect it in the
   Worker or test client. Run a fast sink and a throttled sink. Record time to
   first byte, total wall time, platform CPU time and platform-reported memory
   (including peak memory where available). If a platform does not expose a
   measurement, mark it unavailable rather than inferring it from Node heap.
4. Repeat with 1, 4 and 16 concurrent requests. Record per-request correctness,
   combined memory, CPU, backend load and resource-limit failures. Distinguish
   input-size growth from concurrency and backend buffering.
5. Abort during reading, spill writes, formatting and output. Simulate backend
   failure and retained-file replacement. Verify no unauthorized file access,
   unremoved staging objects or output publication after failure.
6. Compare increasing-size results against the implementation's stated memory
   bound. Explain first-byte delays required by global formatting/error semantics.
   A Node heap-only run, a RAM spool, passing unit tests or an unexecuted plan
   does not establish Worker qualification.

Record actual measurements in the execution report only after running this plan.
Store temporary logs under `/out` and purge them after reviewing results.


## Local execution evidence

Measured with workerd 1.20260708.1, compatibility date `2026-07-01`, without
Node compatibility. URL resolution was tested from the source delivered in
`1e626016f2`; sibling indexing was tested from `fa7c4bc15f`. The growth and
failure runs preceded sibling indexing, which does not affect their `p` selector.
The final rope improvement is `094b1d566b`. Both package suites passed (297
htmlq and 347 Markdown tests), scoped lint and
types passed, and maintained package builds passed. A focused Node 22.22.2 run
passed 46 tests before the rope change and 16 targeted tests afterward. URL resolution matched 2,595 native Node cases and 2,640 workerd
cases, including large Unicode/ASCII/numeric hostnames.

The manual runner bundled the actual command modules with `workerd`/`browser`
conditions and rejected Node imports. It used the retained-page adapter in
`scripts/pandoc-r2-storage.fixture.mjs` with disk-persisted R2 outside the command
isolate. Only tiny namespace receipts remained in MemoryFileSystem; writes
verified those receipts had zero size and no remaining name. Payload-wide
`readFile`, `writeFile` and `readStream` were forbidden. Input reused 4 KiB
chunks; the awaited output sink checked each byte and accumulated a hash without
collecting output. Peak retained backing bytes and individual transfer sizes
were counted in the adapter.

For reproduction, select the `core:user:` inspector target, enable Runtime and
run it if waiting for the debugger. Sample `Runtime.getHeapUsage` every 20 ms
without overlapping requests. The tables report the maximum sampled
`usedSize + backingStorageSize`, in MiB. These are actual workerd isolate
measurements, not Node heap samples, but exclude native embedder allocations
and can miss shorter peaks. Forced `HeapProfiler.collectGarbage` timed out;
normal GC was left enabled. `Performance.getMetrics` is unavailable in this
runtime. Separate process CPU measurements use the workerd child's operating
system CPU counter, including its R2 fixture isolates and excluding the Node
host. They are not hosted per-request CPU accounting.

### Normal local GC policy before the rope improvement

Single long text node; times are seconds to first output / command completion.
Input MiB excludes the short opening/closing tags. Output is exactly input
payload bytes plus one newline. First-byte delays include parsing and global
formatting/atomic-output preparation.

| Input MiB | htmlq first / total s | htmlq peak MiB | Markdown first / total s | Markdown peak MiB |
| --- | --- | --- | --- | --- |
| 1 | 0.488 / 0.761 | 7.48 | 0.815 / 1.012 | 10.35 |
| 8 | 3.098 / 4.901 | 13.93 | 3.946 / 4.806 | 26.86 |
| 32 | 13.854 / 26.152 | 37.07 | 24.309 / 29.843 | 70.39 |
| 128 | 92.057 / 124.263 | 71.86 | 242.574 / 263.951 | 82.57 |
| 512 | 727.251 / 895.646 | 156.59 | interrupted | unavailable |

The unfinished baseline Markdown 512 MiB run was stopped after the rope
builder changed, to reserve backing I/O capacity for final-version qualification;
it is not a pass.

The unconstrained htmlq 512 MiB peak exceeds 128 MiB, so this run alone does
not qualify a deployment with that limit. At that peak, the inspector also
reported 24.23 MiB of native embedder heap. The post-command heap-plus-buffer
sample fell to 40.72 MiB. Correct output and cleanup do not explain that peak;
a separate constrained-heap experiment is required to distinguish retained
payload from uncollected garbage.

All completed growth runs closed the input and sole retained descriptor once,
left an empty scratch namespace and no R2 objects, and limited backing transfers
to 16 KiB. htmlq output writes were at most 16 KiB; Markdown writes at most
2 KiB. At 512 MiB, htmlq performed 1,116,319 backing reads and 98,694 writes,
with 1,616,904,192 peak backing bytes. External storage and CPU costs remain
material even though command caches have fixed bounds.

### Concurrency, shape and failure coverage

With 1 MiB per request and normal local GC policy:

| Command | Concurrent requests | Batch seconds | Peak isolate MiB |
| --- | --- | --- | --- |
| htmlq | 4 | 2.58 | 13.03 |
| Markdown | 4 | 2.45 | 20.38 |
| htmlq | 16 | 9.25 | 48.94 |
| Markdown | 16 | 11.90 | 73.17 |

Every request produced the expected bytes and cleaned up. Slow sinks, source
cancellation, failure on the third spill write and sink failure also passed.
Failure cases published no output and closed input/descriptors once with no
remaining objects. htmlq propagated the primary injected error. Markdown
preserved its existing behavior: cancellation throws; spill/sink failures return
exit 1 with a diagnostic.

Both commands passed 64 KiB URL attributes, 512-level nesting, a long table cell
and a code block with a late longest fence. A 4,096-paragraph `p:last-child`
case exposed repeated sibling scanning: 440.512 seconds and 937,642 backing
reads. With stored sibling indexing, it took 1.627 seconds and 227 reads.
`p:nth-last-child(1)` took 1.955 seconds/539 reads and
`p:nth-last-of-type(1)` took 2.902 seconds/538 reads. All three returned exactly
`x` plus a newline and cleaned up. The Markdown wide case took 6.064 seconds,
with 1,350 reads and the correct 12,287 output bytes.


### Constrained V8 diagnostic policy

To distinguish live retention from unconstrained local GC scheduling, repeat
with `--max-old-space-size=48` and `--max-semi-space-size=4` in workerd's
`Config.v8Flags`. The temporary Miniflare loader sets those flags immediately
before serializing its generated workerd configuration. This is a diagnostic
runtime configuration, not a production command change, an input-size limit or
a claim about hosted Cloudflare's GC configuration. Keep normal GC enabled and
use the same external R2 backend and byte/cleanup checks.

Before the rope improvement, the 128 MiB htmlq case passed at a sampled
47.17 MiB heap-plus-buffer peak (4.43 MiB native embedder heap at that sample),
with 144.975 seconds to first output and 197.624 seconds total. The 512 MiB
constrained htmlq run on the older builder was stopped when the builder changed;
it is not counted as a passing run. The unfinished older-builder constrained
Markdown 128 MiB run was stopped for the same reason. Large final-version
measurements follow.

The rope regression first failed with 4,848 metadata records for 512 chunks;
the new height frontier passes a linear bound of three records per chunk. At
8 MiB on the final implementation, htmlq backing reads fell from 2,055 to 1,270,
writes from 1,376 to 1,082, and peak backing bytes from 22,528,000 to 17,711,104.
Output stayed byte-identical and cleanup passed. The same Markdown workload's
backing counts were unchanged. Simultaneous QA processes contend for machine
resources, so these storage counts are more directly comparable than wall time.

An attempted second Inspector client displaced sampling on the first final
512 MiB runs. htmlq completed command execution but its final measurement
request timed out before the report was written; the affected Markdown run
was stopped. Neither is counted as a passing qualification run. The recorder
was hardened to save command results before final inspector requests, report
sampling gaps, and measure JS/buffer/native maxima through the single original
connection. The affected cases were rerun.

### Final-version size and concurrency matrix

Final command source: `094b1d566b`; fixed 48 MiB old-generation/4 MiB
semi-space policy. Times below are seconds to first output / command completion.
CPU is measured workerd process CPU, including local R2 fixture work. Peak MiB
is the sampled command-isolate JS heap plus backing buffers. Native embedder
heap is separate; the complete accounting for the largest cases follows.

| Input MiB | htmlq first / total s | CPU s | Peak MiB | Markdown first / total s | CPU s | Peak MiB |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.603 / 0.941 | 0.77 | 6.41 | 0.932 / 1.103 | 0.98 | 10.61 |
| 8 | 4.468 / 7.448 | 5.48 | 13.03 | 10.741 / 12.821 | 8.57 | 24.51 |
| 32 | 20.726 / 32.613 | 23.08 | 20.85 | 45.219 / 56.992 | 33.38 | 45.91 |
| 128 | 53.494 / 99.167 | 74.30 | 47.15 | 461.535 / 574.355 | 365.95 | 47.56 |

Every result passed byte validation, closed its single input and retained
descriptor once, and left no namespace entries or backing objects. At 128 MiB,
htmlq required 20,410 reads/17,282 writes and 283,131,904 backing bytes; Markdown
required 465,940 reads/38,023 writes and 464,928,768 backing bytes. CPU/backend
costs are significant; these figures do not establish hosted per-request CPU
budget compliance.

Sixteen concurrent 1 MiB final-version requests also passed for each command:
htmlq took 32.705 seconds per batch, 12.97 process CPU seconds and peaked at
43.14 MiB; Markdown took 26.502 seconds, 14.18 CPU seconds and 58.80 MiB. The
combined peak includes sixteen invocations' caches and output buffers.

A fresh final-version workerd run also passed all sixteen slow-sink,
cancellation, third-spill-write failure, sink-failure, long-URL, deep-nesting,
ragged-table and late-fence cases (both commands). Every case closed its input
and any acquired retained handle once, respected 16 KiB backing transfers, and
left no namespace entries or backing objects. Cases fitting the fixed cache
did not open a spill handle. Success cases matched every output byte; failure
cases emitted none and preserved the established command error forms.

### Completed 512 MiB final-version runs

Both commands completed from `094b1d566b` with the fixed 48 MiB old-generation
and 4 MiB semi-space V8 policy. Both emitted exactly 536,870,913 checked bytes
(FNV-1a 2399956189), closed input and the sole retained descriptor once, and
left zero namespace entries and zero backing objects.

| Command | First / total seconds | Process CPU seconds | Peak heap + buffers MiB | Peak combined MiB | Maximum native MiB |
| --- | --- | --- | --- | --- | --- |
| htmlq | 445.252 / 649.652 | 372.23 | 47.25 | 57.78 | 10.58 |
| markdown | 2119.600 / 2311.017 | 1707.69 | 48.51 | 56.50 | 8.61 |

Combined means the maximum sampled sum of JS heap, backing buffers and native
embedder heap from a single sample, rather than summing unrelated maxima.
The recorder collected 26,244 htmlq and 94,797 Markdown samples; 6 and 9 sampler
requests respectively timed out. Sampling can miss short peaks, and the figures
are not process RSS or hosted Cloudflare memory accounting. Optional execution
stage introspection was unavailable; byte correctness and final results were
recorded independently.

htmlq used 81,694 backing reads, 69,125 writes and 1,132,478,464 peak backing
bytes. Markdown used 3,002,658 reads, 180,255 writes and 1,874,345,984 peak backing
bytes. Maximum backing transfers remained 16 KiB; output writes were at most
16 KiB and 2 KiB respectively. These results demonstrate execution with bounded
command working memory in local workerd and external backing storage, including
inputs four times the usual 128 MiB Worker memory budget. They do not qualify
hosted latency, CPU or subrequest quotas: the deliberately granular R2 fixture
is expensive, and actual deployment/backend limits must be measured separately.
No accepted input limit was lowered and no forced GC was used.

### Packed public-package verification

After rebasing to `621b941886`, the maintained safe-bash build closure and its
required optional publication companion passed. `scripts/package-safe.mjs`
staged the canonical safe-fs, safe-js and safe-bash libraries. Local version
`13.0.0` tarballs were packed and installed into an isolated consumer with
lifecycle scripts disabled; nothing was published. The maintained installed
htmlq/Markdown Node fixtures passed, including canonical registration, CLI/SDK
parity, mutation, atomic output, cancellation identity and output limits. Both
maintained HTML consumer type fixtures passed strict NodeNext checking.

A workerd bundle imported only installed `@poe-platform/safe-bash/shell`, the
two public command subpaths, and `@poe-platform/safe-fs/core`. Its metafile
rejected checkout sources or workspace aliases; the only non-installed inputs
were the generated entry and the external R2 fixture. Node imports were forbidden.
All eight cases passed: each command through its public SDK and Shell, with
a generated/reused-chunk 1 MiB text input and a 64 KiB URL attribute. Every
1 MiB case spilled more than 1 MiB through the injected R2-backed filesystem.
Shell used `captureOutput: false` with awaited stdout/stderr sinks and returned
empty captured byte arrays. All cases matched output bytes, closed input and
acquired backing handles once, and left no namespace entries or R2 objects.

The large-input, concurrency, failure and installed-public-path gates above are
complete for local workerd. Hosted Cloudflare CPU/subrequest/memory accounting
and deployment-specific quotas remain explicitly outside these measurements.
