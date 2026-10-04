# PPTX bounded streaming and Worker verification

## Current status

The command's in-place conflict check compares the current file incrementally,
using retained reads of at most 64 KiB when available, otherwise a streaming read
with a 64 KiB requested chunk size. Buffered-only filesystems retain their existing
fallback. The original input is still a complete byte array. Metadata identity
checks and conditional publication remain required in addition to byte comparison.

`openPackageArchive` now accepts a stable retained range source and explicit
caller-owned safe-fs working storage. It validates ZIP payloads incrementally,
keeps names and entry metadata in a bounded page cache backed by that storage,
and streams individual parts. Its rewrite operation retains unchanged compressed
members, supports streamed replacements/additions/removals, and stages archive
serialization in the same storage before writing an output sink. Closing retires
scratch storage; input and sink ownership remain with the caller. This layer
admits OPC part names and ZIP contents, not the presentation relationship graph.

Deterministic coverage includes generated payloads larger than the cache,
filesystem descriptor spies, index spills, reused source buffers, concurrent
member streams, slow sinks, byte-preserving passthrough, and injected IO/cancellation
failures. Native python-pptx 1.0.2 opened a two-slide streamed rewrite with expected
edited/unchanged text; Python ZIP CRC verification passed. The retained module
bundled for the browser/workerd target with no external imports. These results
cover the archive layer, not every presentation operation or runtime memory.

The public adapter now supplies `streaming.openInput`, caller working storage,
and stdout/stderr sinks to custom engines. Retained input admission copies at
most 16 KiB per operation into a shared 1 MiB caller-backed page cache, replays
stdin, checks numeric or opaque identity/version metadata, closes handles, and
retires snapshots at invocation completion. Tests observe spill writes and cover
limits, cancellation, changed input and cleanup failure. Exact original comparison
also accepts retained snapshots without a whole-file fallback. The built-in validation operation now adopts these APIs; other operations still
require migration. Public publication now also accepts byte sources
and retained originals, using owned retained staging, bounded writes, exact
in-place rechecks, guarded conditional publication and cleanup. Deterministic
tests cover source failure, cancellation, changed input, force/protected input
policy, dry-run and bounded outstanding staging writes.

The internal retained XML lexical layer now decodes UTF-8/UTF-16 in bounded
windows into caller storage, retaining original encoding/BOM metadata. Tokens
and long scalar values are ranges in that storage. Text/attribute value streams
expand predefined/numeric references and normalize XML 1.0 whitespace without
retaining whole values or digit strings. Tests force storage spills, stream
multi-megabyte reused chunks, and cover split encodings, delimiter overlap,
malformed input, limits, cancellation and error cleanup. Python ElementTree
independently agreed with retained attribute/text normalization for Unicode,
CRLF, predefined references and numeric references.

`openRetainedXmlDocument` now builds the semantic tree in caller storage: fixed-size
node/attribute records, stored sibling/parent links, and stored namespace/duplicate
attribute indexes. It validates qualified names, namespace scope and reserved
bindings, expanded-name uniqueness, element matching, declarations and values.
Scoped bindings are restored from stored records rather than an in-memory stack.
Queries stream children, attributes, namespace values and descendant text. Node
handles are document-owned and expire on close. Tests cover deep trees, large
namespace values and attribute sets, parser admission/node-budget parity, UTF-16,
source-setting ownership, cancellation and IO cleanup. Python ElementTree agreed
with expanded names, attributes and mixed text on an independent fixture.

The internal retained content-type index now stores normalized override/default
keys, original media types and MIME parameter duplicate indexes in caller pages.
It validates manifest structure, URI syntax, MIME syntax and presentation kinds
without collecting arbitrary scalar values. The retained relationship-part index
stores ordered records and exact case-sensitive IDs, streaming identifiers, types
and targets. Both close semantic XML storage after admission and retire returned
streams when closed. The relationship-part index admits records independently; the stored graph
layer below resolves targets across the archive.

Tests compare admission with existing parsers, generate/reuse large scalar chunks,
observe actual spill writes capped at 16 KiB, consume results slowly, force hash
collisions, and cover limits, cancellation and handle expiry. Shared exact stream
comparison now retires both iterators even when one close throws synchronously.
Independent python-pptx/ElementTree verification covers manifest bindings and
relationships in a chart deck with an embedded workbook and external hyperlink.

`openRetainedRelationshipGraph` now connects admitted archive parts and stored
relationship records. Forward/reverse adjacency lists, exact ID indexes, dangling
targets and case-insensitive part lookup live in caller pages. Relative targets
normalize through stored segments and parent links, so long references and deep
`..` paths do not create an in-memory stack. Traversal uses caller-backed visited
indexes and frames, retains existing DFS order and cycle behavior, and owns its
scratch independently of the graph. Graph retirement leaves the archive owned by
its caller. Missing owners, URI rejection and cumulative byte/part/edge ceilings
are enforced; dangling edges remain queryable for presentation validation.

Generated 512-part graph coverage forbids whole-file reads, observes actual graph
and traversal spills with outstanding writes capped at 16 KiB, and consumes output
slowly. URI parity covers 96 base/reference cases plus a generated deep path.
Tests also cover exact edge lookup, differently cased dangling targets, early
iterator retirement, source/cancellation failures and preservation of primary
admission errors when descriptor retirement fails. A native python-pptx chart
deck matched independent Python URI/DFS results for 24 parts, 38 resolved edges
and 24 reachable parts, with no dangling edges or leftover scratch.

`openRetainedCompatibility` now projects the retained XML document through
markup-compatibility controls. Inherited ignorable/process-content rules, work
stacks, alternate selections and flattened child lists live in caller pages.
It preserves first-understood-choice/fallback behavior, opaque extension handling,
MustUnderstand checks, wrapper restrictions, and filtering of unknown ignorable
attributes. Opaque expansion can await a caller callback; configuration is
snapshotted before admission. Closing the view retires its indexes while leaving
the XML document caller-owned. XML documents now provide checked, document-scoped
node references/restoration and replayable namespace-prefix resolution for stored
consumers; foreign node handles remain rejected.

Forty compatibility parity cases compare visible trees and rejection codes with
the existing implementation. Generated long-prefix controls and 512-level views
observe real spills and at most 16 KiB outstanding writes while whole-file reads
are forbidden. Tests cover asynchronous option mutation, cancellation at the final
expansion callback, expired/foreign handles and preservation of primary errors
when spilled descriptor cleanup fails. Independent lxml projection agrees on
nested alternate choices, rebound prefixes, ignored/processed extension content,
opaque payloads and Unicode attributes. This is read-only compatibility admission;
mutation guards for preserving alternate representations remain to be migrated.

These layers remain internal and immutable. Inventory/style admission, mutation
state and the remaining shipped-engine wiring are still required before they
replace the buffered paths.

This is not an end-to-end bounded-memory implementation or Worker qualification.
Except for semantic validation and inspection, the built-in command engine still collects input,
returns complete stdout/stderr, and publishes complete output arrays. `safe-bash-presentation-engine` still collects the archive,
retains decompressed members in `readPackage`, copies members in
`writePackageArchive`, and builds embedded chart workbooks in memory.

`openRetainedPresentationValidation` now runs all ten semantic rules with stored
root/dialect status, duplicate/reference sets, issue indexes and traversal frames.
Two sequential XML passes keep the number of live document caches fixed. Large
relationship IDs and integer scalars remain streamed. The shipped `validate`
operation uses retained adapter input and output sinks; direct buffered engine
calls retain their convenience behavior. Deterministic tests cover result/order
parity, resource limits, generated/reused chunks, observed bounded spill writes,
slow output sinks, default file/stdin invocation, cancellation and error cleanup.
A native python-pptx deck containing a chart workbook, notes and an external
hyperlink produced the identical successful result through both engine paths.
These checks are not runtime Worker memory qualification.

`openRetainedSelectionRecords` now retains slide, part and drawing records,
scopes, duplicate-ID indexes and nested-group traversal frames in caller storage.
Names remain replayable byte streams; bounded record metadata and selection tokens
match the buffered index. Both paths share query admission. Retained selection
checks missing/ambiguous/stale queries before yielding and preserves the existing
20-candidate diagnostic cap. Tests cover nested order, normalized IDs, long reused
name chunks, actual spill writes, bounded outstanding IO, expired names, query
snapshots and cancellation/read-error cleanup. A native python-pptx deck matched
all 2 slide, 27 part and 83 object records, including Unicode, groups and notes.
This is record admission only: it does not replace full inventory/style inspection
or wire the remaining shipped operations to retained selection yet.

`openRetainedPackageInventory` now admits package-level metadata into caller
storage: sorted parts/media with streamed hashes, ordered relationships, distinct
master/layout/theme targets, and unsupported diagnostics. Arbitrary MIME values,
relationship IDs and targets remain replayable streams. A stable external merge
sort stores UTF-16 ordering keys and list links in the same bounded page cache;
readers cannot observe an unfinished or failed sort. Metadata indexes retire the
temporary relationship/content-type stores before returning.

Parity tests cover exact buffered metadata ordering and values, Unicode ordering,
long shared-prefix keys, reused source buffers, actual spill writes capped at
16 KiB, slow consumers, cancellation and source/storage failure cleanup. Independent
python-pptx verification matched sizes and SHA-256 hashes for all 25 parts in a
two-slide deck with an embedded chart workbook. This is package metadata only:
text-style context admission and shipped-operation integration are described below.

Diagram inventory now also uses caller pages for each traversal FIFO, visited
and missing-target sets, owner deduplication, and sorted result lists. MIME
classification takes precedence over the first matching incoming relationship,
as in the buffered path. Cycles, shared dependencies, external edges and missing
targets retain their existing meaning; arbitrarily long missing targets stream
from stored ranges. Returned diagram lists are immutable and replayable until
inventory retirement, without keeping one JavaScript collection per diagram.

Tests cover all five diagram MIME types, incoming-order fallback, sorted cyclic
closures, a 128-part generated dependency chain, a 40 KiB reused-buffer target,
slow consumers, actual caller spill writes capped at 16 KiB and read/write/cancel
failure cleanup during traversal. A Python-authored diagram resource graph inside
a native-readable PPTX matched owners, cyclic dependencies and missing targets.
This is dependency inventory, not semantic diagram editing or Worker runtime
qualification.

`openRetainedSlideInventory` now stores ordered slide rows, indexed shape counts,
layout/master/theme references, visibility and ordered handout references in
caller pages. It borrows admitted selection records and the archive, owns its
relationship/XML admission stores, and closes those temporary stores before
returning. Visibility consumes arbitrarily long whitespace incrementally;
handout relationship IDs stay streamed. Shape counts use a single record pass
and indexed lookups rather than filtering all objects for every slide.

Parity tests cover visibility values and rejection codes, ambiguous and absent
inheritance, nested shapes, handout list order/duplicates and invalid references.
Generated coverage observes actual caller spills capped at 16 KiB with 32 slides,
a 32 KiB reused-buffer handout ID, slow consumers, and read/write/cancellation
failure cleanup. Independent python-pptx verification matched two slides' IDs,
nested shape counts, layout/master/theme parts and hidden-slide state. Per-slide text-style resolution is described below; complete deck inventory and
selection integration into the shipped commands remain. No Worker runtime
qualification or end-to-end completion is claimed.

`openRetainedTextStyles` now admits one slide's style inheritance context into
caller-backed XML stores. Shape traversal frames and ordered shape lists spill
through a separate caller page cache. The fixed set of run/paragraph/shape/layout/
master/presentation/font-reference layers resolves all 14 existing properties,
including theme fonts, color maps, theme overrides and unresolved reasons.
Shape IDs, tokens, string values and provenance paths are replayable byte streams;
long numeric tokens are parsed incrementally. It validates every record before
returning a replayable read-only iterator, and owns no archive or source handles.
At most eight inheritance documents are live, regardless of deck size.

Fifty-six focused cases cover property/provenance parity, strict namespaces,
placeholder ambiguity, grouped ordering, malformed structures, 32 KiB scalar
values supplied through reused buffers, slow consumers, cancellation and source/
read/write cleanup. A generated 1,024-shape case observes separate traversal and
XML spills, with outstanding writes capped at 16 KiB. An independent python-pptx
deck matched all three complete style records against buffered inventory; Python
also confirmed explicit font, size, emphasis and RGB values. Complete-deck context
wiring, theme-override relationship admission, compatibility checks for additional
style parts, and streamed inventory serialization still need integration into
the shipped engine. This is not end-to-end completion or Worker qualification.

The shipped `inspect` operation now composes retained selection, slide/package
inventory and per-slide styles, including theme overrides and compatibility
admission. Complete JSON/human responses stage through caller storage before
stdout; output limits fail before publication. Lookup and output stores are
separate so nested reads/index writes cannot interleave contiguous value writes.
Default retained, stream-only, buffered-only convenience and stdin inputs remain
supported. Stream-only snapshots copy reused chunks in at most 16 KiB writes,
check available identity metadata and never retry a partially consumed stream
through readFile. Tests cover byte parity, Unicode escaping, actual spills,
slow sinks, cancellation, limits and storage errors. Verification passed 6,373
engine tests, 1,081 command tests, the 45 shell selector tests, scoped lint and
typechecks. A native python-pptx 1.0.2 deck produced byte-identical buffered and
retained inspection, including explicit Arial/21pt text style and clean storage.
Extraction, mutations and
workbooks remain buffered; no runtime Worker qualification is claimed.

## Remaining implementation

1. Carry caller-owned retained/range sources, explicit spill-storage authorization,
   output sinks and owned staged publications through both command and engine APIs.
   Keep buffering convenience APIs available without requiring them for Worker use.
2. Build presentation selection and mutation admission on the retained archive,
   XML, compatibility, content-type and relationship graph layers before extraction/publication.
   Semantic validation is retained and wired, and selection records/queries are
   retained. Inspection now composes the inventory/style layers. Mutation models
   and integration into the other shipped operations remain.
   Replace synchronous package-member access on the streaming execution path with
   asynchronous reads and a bounded cache backed by the caller's safe-fs. Migrate
   mutation state, embedded workbooks, archive indexes and serialization too.
   Do not hide full-payload arrays behind a source interface or a private RAM spool.
3. Keep protected-source identity, in-place conflict checks, force/dry-run behavior,
   byte ownership and conditional atomic publication. Retire retained handles and
   owned staging on success, cancellation and failure without masking primary errors.
4. Test generated/reused input chunks, slow sinks, injected external-storage spies,
   bounded outstanding bytes, errors and cancellation. Fail tests on payload-wide
   reads or hidden in-memory spooling. Compare output semantics with existing
   presentation and native interoperability fixtures across supported operations.

## Manual workerd / Cloudflare QA

Execute these steps after the streaming engine path is implemented. Do not treat
Node heap statistics, this plan, or mocked storage tests as Worker measurements.

1. Record the exact commit, workerd version or deployed Worker identifier, runtime
   limits, backend configuration, cache/window limits and measurement tools. Use
   caller-injected external storage that supports the required retained identity
   and atomic staged publication guarantees. Record backend resident buffers,
   pending reads/writes, staged bytes and cleanup events. A memory filesystem or
   RAM-backed mock is not the large-data backend for this qualification.
2. Prepare equivalent decks at 1, 8, 32, 128 and 512 MiB, staying within the service's
   explicitly configured admission limits. Vary media payload size, archive member
   count, XML part size and embedded chart workbook size separately. Generate and
   upload inputs outside the measured Worker. Reuse fixed-size chunks during data
   generation so the generator does not contaminate memory observations.
3. Run inspect, text extraction, media extraction, text replacement, slide
   import/merge/split, chart editing and in-place mutations through both SDK and CLI
   entry points. Verify an unchanged baseline and intended edited results using a
   native presentation reader; inspect archive members, relationships and embedded
   workbook values. Preserve opaque members and media bytes where applicable.
4. Record actual runtime peak memory, baseline memory, CPU time, elapsed time,
   first stdout byte, first staged write and publication time for every input size.
   Explain how each metric was measured. If the chosen platform cannot expose a
   metric, mark it unavailable and obtain it from an instrumented workerd run;
   never substitute a Node-only measurement. Record output sizes and digests.
5. Repeat with a deliberately slow stdout consumer and a slow external-storage
   writer. Measure outstanding source/sink bytes and cache occupancy. Verify that
   they stay within configured windows as payload size increases; separately
   account for externally stored data and per-request metadata.
6. Repeat at concurrency 1, 4 and 8. Record per-request and isolate-wide memory and
   CPU, latency, first-byte times, backend pressure and publication outcomes.
   Investigate any growth with total payload size or retained completed requests.
7. Cancel during admission, archive decode, workbook mutation, staging and output.
   Inject read/write/close failures; change source contents or identity before
   commit; replace protected inputs with aliases. Verify destination preservation,
   conflict errors, handle closure and owned-staging cleanup. Check force and
   dry-run independently, including missing output directories and multi-output
   operations with their documented partial-publication policy.
8. Keep a results table with one row per size/operation/concurrency and links to
   runtime evidence. Store temporary captures under `/out` and remove them after
   recording the needed evidence. Report failures and missing metrics explicitly;
   qualification requires both functional results and measured bounded execution.
