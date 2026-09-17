# Execution context contract

`readDocument`, `writeDocument` and `convert` create an invocation-owned context
and supply it to every reader/writer. Conversion shares its counters across all
inputs, readers, writers and resource resolutions. There are no environment
variables. `ConversionContext` accepts reader, writer, resources, output, signal,
limits and an optional trusted `yield(): Promise<void>` scheduler. Read/write
options remain explicit `from`/`to`; both SDK operations use the same context.

Built-in format availability remains false. This work supplies execution controls
for original TypeScript adapters; it does not implement or certify EPUB, RTF,
LaTeX, RST or PDF format conformance. No native runtime fallback exists here.

## Input and encoding

An input is either `{bytes, base?}` or `{chunks, base?}`, with synchronous or
asynchronous byte iterables. Acquisition reserves input/retained capacity before
copying producer buffers, copies before acquiring the next chunk, and assembles
owned bytes from bounded 4096-byte blocks. Fragment-index reservations depend on
retained blocks rather than producer chunk count. All conversion inputs are
admitted before reader callbacks, retaining independent input boundaries.

UTF-8 formats also receive `input.text`. Strict incremental decoding rejects
invalid leads/continuations, overlong encodings, surrogate scalars, scalars above
U+10FFFF and incomplete trailing sequences. It consumes one leading U+FEFF per
input; interior/additional BOMs are preserved. CRLF and bare CR normalize to LF,
including split CRLF. The owned `input.bytes` preserve the original bytes. Writers
choose output newlines; output Unicode must contain paired surrogates and is
strictly encoded as UTF-8. Neither input boundaries nor chunk sizes change the
successful document/output content.

RTF and binary/container formats receive byte input without blanket UTF-8 decoding.
`decodeCodepage(bytes, 1252 | 28591)` decodes parser-selected RTF text runs using
Windows-1252 (default) or literal ISO-8859-1, preserving raw newlines. Unsupported
pages fail with E_ENCODING; there is no guessed fallback. RTF adapters must parse
controls/codepage changes and select text runs before decoding; Unicode controls
belong to the parser. `retainBinaryBlock(bytes)` reserves one resource, binary and
aggregate resource bytes, and retained capacity before copying opaque binary data.
Readers must check a declared binary length before constructing its source slice.

`decodeUtf8(chunks)` is also available for already admitted resource/part text. It
charges decoding work, owned bytes/text and fragment indexes, rather than charging
the primary input twice. Unadmitted input must go through `acquire` or the public
operations; resources must go through explicit resolution/admission.

## Finite hard defaults

Callers may lower these ceilings using `limits: Partial<Limits>`; unknown keys,
negative/noninteger values and raised ceilings fail with E_OPTION. Zero is valid.
Byte sizes below use binary MiB. Text counts UTF-16 code units, including admitted
AST tags/property keys. Depth uses root depth zero. Node counting includes values,
arrays, objects and property keys, as in original AST normalization.

| Limit | Default | Accounting |
| --- | ---: | --- |
| inputBytes | 32 MiB | Aggregate primary input bytes |
| outputBytes | 64 MiB | Aggregate emitted bytes; complete result checked before publication |
| resourceBytes | 64 MiB | Aggregate resolved/admitted resources, expanded containers and binary blocks |
| retainedBytes | 128 MiB | Conservative total owned byte-buffer capacity and UTF-16 payload reservations |
| text | 32 Mi code units | Decoded text, admitted AST strings/keys, entity expansions, diagnostic text and progress IDs |
| nodes | 100,000 | Aggregate admitted reader/input AST values; merged AST also checked independently |
| depth | 128 | AST nesting gauge |
| attributes | 100,000 | Admitted attribute triples/classes/key-value entries |
| tableCells | 100,000 | Logical row-span × column-span area, reserved before geometry/index growth |
| resources | 1,024 | Resolution calls, admitted AST resource entries and retained binary blocks |
| diagnostics | 1,024 | Owned reports across readers, metadata merging and writers |
| references | 100,000 | Retained input/text blocks, aggregate lists/metadata, span-index capacity and progress IDs; adapter indexes |
| entities | 100,000 | Decoded scalar entity expansions |
| entityBytes | 8 MiB | Expanded scalar entity UTF-8 bytes |
| work | 1,000,000 | Charged processing units across the invocation |
| compressedBytes | 32 MiB | Aggregate compressed EPUB input and explicitly admitted compressed resources |
| expandedBytes | 64 MiB | Expanded container bytes; also reserves resourceBytes and retainedBytes |
| parts | 4,096 | Container part admissions |
| xmlDepth | 128 | XML nesting gauge |
| xmlNodes | 100,000 | XML node admissions |
| binaryBytes | 16 MiB | Aggregate RTF binary blocks; also reserves resourceBytes and retainedBytes |
| macros | 10,000 | Macro definitions/expansion admissions |
| includes | 256 | Include admissions |
| directives | 10,000 | Directive admissions |
| fonts | 64 | Font admissions |
| glyphs | 1,000,000 | Glyph admissions |
| pages | 1,000 | Page admissions |
| objects | 100,000 | PDF object admissions |
| images | 1,024 | Image admissions |
| layoutWork | 1,000,000 | Layout steps, including deterministic progress checks |

These caps overlap. Accounting conservatively counts separately owned copies and
admissions, including a resolved resource later cloned into an AST. Retained
reservations are not refunded; the cumulative bound also bounds concurrent owned
payload retention. It does not measure JavaScript allocator/object overhead or
host allocations. The tightest cap can reject input well below the byte ceilings.
Work includes individual decoded bytes/scalars, bounded copy blocks, traversal
steps and writer encoding scans; producer I/O/chunk handling also costs work.

Conversion retains complete bounded inputs, decoded text and an owned bounded AST
by design. It is **not constant-memory conversion**. AST constructors, order,
metadata and resources are preserved by synchronous/cooperative normalization.

## Adapter admission and CPU work

Use `charge(key, units)` before extending counters, arrays, maps, buffers, indexes
or decoded expansions, and `bound(key, actual)` for gauges such as nesting depth
and complete proposed output size. Invalid charges are E_INTERNAL; capacity
failures are E_LIMIT. Multi-budget expanded/binary reservations validate all their
counters before mutation. `decodeEntity(codepoint)` reserves count, expanded byte
size, text and owned capacity before constructing a valid Unicode scalar. Named
entities producing multiple scalars must admit every scalar; recursive expansion
must charge all expansion steps and enforce depth before descending.

Before work, reserve units with `checkpoint(units)`; periodically await
`cooperate(0)` to yield charged work. Alternatively await `cooperate(units)` before
a bounded processing batch. After 256 accumulated units the default scheduler
yields via an event-loop task. Every cooperation/await boundary checks the shared
caller signal. Original AST preflight, table geometry, decoding and output
encoding contain cooperative boundaries. Trusted custom schedulers must actually
yield in production; immediate schedulers are useful for deterministic tests.

EPUB readers must admit part counts before opening/indexing parts, compressed
resource bytes before retaining them, expanded bytes before decompression growth,
XML nodes/depth before tree growth, and entities before expansion. Primary EPUB
input automatically charges compressedBytes from the declarative format config.
Resource resolution owns returned bytes and bounds aggregate bytes/count before
another resolution. A resolver must enforce limits on its own acquisition before
returning a complete payload; the context cannot undo its prior host allocations.

LaTeX/RST adapters must reserve macros, includes and directives before storing or
expanding them, and use the shared resolver/counters for included resources.
EPUB XML/RTF recursion and LaTeX/RST expansion depth must use the appropriate
depth gauge; charge reference indexes and work before growth/processing.

PDF writers must charge fonts/glyphs/pages/objects/images before creating them,
charge layoutWork before each layout step and use aggregate resource bytes for
font/image payloads. `progress(id, cursor)` requires a nonnegative integer cursor
that strictly advances for an existing ID; repeating or decreasing it fails with
E_LIMIT. Use one stable pagination ID and a consumed-content cursor, including
defined finite substeps for content split over pages. A new ID reserves reference
and ID text capacity before map insertion. Changing IDs cannot bypass finite
references, text, layoutWork or page ceilings. Empty/unchanged pagination must stop.

Format-specific hooks are exposed and tested at their boundaries; absent format
adapters cannot be claimed to enforce them. Trusted adapters must call admission
and cooperation APIs rather than doing unbounded work and merely returning an AST.

## Output, failure and lifecycle

`output` may provide atomic `publish(bytes, signal)` or streaming
`write(bytes, signal)`, `close(signal)`, `abort(reason)`. Complete binary output is
owned before the first awaited write. Streaming publication uses bounded chunks,
awaits each write's backpressure and awaits close; a rejected write or close is
E_IO and can never yield a successful conversion. Atomic publication is awaited
once and requires the host's promised atomicity. Streaming hosts may expose
partial bytes on failure; success cannot imply rollback of those bytes.

Context failures are permanent, even if an adapter catches them. Pending external
awaits race caller cancellation and closure. No new acquisition, output or growth
is allowed after closure. Concurrent output completion calls share one close;
writes during close fail. `report(diagnostic)` reserves capacity and owns the
report before retaining it. Successful write/convert results include reader,
merge and writer reports in order.

Every public operation closes its context in finally. Cleanup is idempotent and
invokes an unfinished producer's return and a failed/uncommitted streaming sink's
abort at most once. Cleanup rejections are observed without replacing the original
failure. Low-level context users must call/await `close()` themselves. Later
cancellation does not retract an already completed result.

Cooperation cannot preempt synchronous host JavaScript, built-in clone/allocation
steps or capability code that ignores the signal. Original AST shape validation
and the final bounded structured clone are synchronous; preflight/geometry yield.
Await cancellation stops further acquisition but cannot prevent a host from
continuing prior I/O or publishing side effects. Hosts must keep returned ASTs
stable during normalization and honor ownership, signal and atomicity contracts.
An uncooperative return/abort cleanup can delay public settlement indefinitely.
This is a bounded cooperative converter context, not isolation of arbitrary host
code. A safe-bash adapter must remain thin, delegate here, use explicit VFS/sinks,
pass caller limits/signal and provide no native executable fallback.
