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
Except for semantic validation, inspection, structural text, field and XML extraction, the built-in command engine still collects input,
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

The shipped `text get` operation now reuses complete retained presentation
admission and stages human/JSON responses before stdout. Its SDK counterpart
`openRetainedText` stores ordered owners, selection membership, text bodies,
paragraphs, inline values/field attributes and traversal stacks in caller pages.
It preserves grouped-shape inheritance, row-major table cells, structural order,
Strict/Transitional namespaces, compatibility branches, field caches, breaks and
empty paragraphs. No unbounded text/name/field scalar is collected. The shared
serializer emits strings incrementally and coalesces writes to at most 16 KiB.
Inspection and text extraction share the same admission and output-staging code.
Tests verify exact bytes, selection errors/candidates, real spill writes, reused
source buffers, cancellation, storage/sink failures, closed handles and retained,
stream-only, buffered-only convenience and stdin adapter inputs. The richer text
run/paragraph/frame/field inspection commands, other extraction, mutations and
embedded workbook paths still require migration. Verification passed 6,383 engine
tests and 1,103 command tests, scoped lint/typechecking and maintained builds. A
native python-pptx 1.0.2 deck matched complete buffered/retained human and JSON
bytes and native text across two slides, nested groups, table cells, paragraphs,
soft breaks and Unicode. This is not Worker qualification.

The shipped `fields list/get` operations now reuse retained text admission and
caller-backed response staging. Field count, paragraph/inline coordinates, IDs,
types and caches live in stored rows or scalar ranges. Original field caches
remain distinct from compatibility-projected text, preserving mixed namespace
filtering and direct original-child semantics. Human and JSON responses match
the buffered commands, including missing/ambiguous selection diagnostics.
Verification passed 6,407 engine and 1,124 command tests, scoped lint/typechecking
and the maintained command workspace build. Tests cover all date field kinds,
Strict documents, table cells, mixed namespaces, compatibility branches, long
IDs/types/caches, reused input buffers, actual caller-storage spills with at most
16 KiB outstanding writes, limits, cancellation and sink/storage failure cleanup.
A native python-pptx/lxml fixture independently confirmed field metadata and
inline coordinates, with exact retained/buffered response parity and clean storage.
Richer text views, other extraction, mutations and embedded workbooks remain
buffered. No runtime Worker memory qualification is claimed.

The shipped `xml get` operation now uses retained archive/presentation admission
and stages raw, JSON and pretty responses in caller storage before stdout. The
SDK `openRetainedXmlPart` borrows the archive and owns decoded XML plus a stored
tree of pretty-print spans. It preserves original bytes, UTF-8/UTF-16 decoding,
mixed content, comments, CDATA, processing instructions and explicit XML-operation
limit precedence. Traversal uses stored parent/sibling links without a JS stack;
long attributes, text and namespace values remain streamed. Part and metadata
selection diagnostics match the buffered command.
Verification passed 146 focused XML SDK/command tests, scoped lint/typechecks
and the maintained command workspace build. Tests cover deep trees, reused input
buffers, real caller-storage spills with writes capped at 16 KiB, slow sinks,
output limits, cancellation and storage/sink cleanup. Native python-pptx/lxml
independently confirmed unchanged XML semantics and byte-exact command parity in
all four raw/pretty/JSON formats. Interrupted full package suites were not counted
as completed verification. Other extraction, richer text views, mutations and
embedded workbooks remain buffered; no runtime Worker qualification is claimed.

The shared Office XML layer now provides `stageRetainedXmlEdits` for mutation
consumers. It admits the source, consumes ordered disjoint UTF-8 span replacements
without retaining an edit collection, and stages the result in caller pages.
Original encoding, BOM, declaration, CRLF and untouched markup are preserved;
split-character edits, invalid replacements and malformed results are rejected.
Both source and final document undergo namespace/XML admission, and encoded byte,
node and depth ceilings apply before output is exposed. Its staged byte source
can feed retained archive rewriting without whole-part arrays. The borrowed
lexical view expires at return; owned output remains replayable until closed.
Tests generate reused source/replacement buffers, observe real caller-storage
spills and at most 16 KiB outstanding writes, process 512 streamed edits, and
exercise cancellation, source/edit/replacement/storage/sink failures, cleanup
failures, output ownership and no-op bytes in UTF-8/UTF-16LE/UTF-16BE. Verification
passed 35 Office XML tests, 167 retained-engine tests, scoped lint/typechecks and
the maintained presentation-engine build closure. A native python-pptx chart deck
reopened a streamed text-span rewrite with the expected edit, unchanged embedded
workbook and every unrelated part, valid ZIP CRCs and clean caller storage.
This is a shared mutation primitive, not migrated PPTX command behavior: consumers
still need their format-specific intent/result checks and guarded publication.
The retained slide-setting SDK integration is described below; slide ordering
and shipped publication integration remain. Broader text,
extraction and workbook command migration remains as listed below.

`openRetainedSlideSettings` now supplies a caller-backed changed-part view for
slide labels and visibility. It retains selection identities, ordered source
locations and replacement payloads in caller pages, shares option validation with
the buffered API, and validates the original and candidate presentation graphs.
Signature, macro, protection and conditional-presentation guards remain active.
Raw XML updates preserve quote styles, whitespace and unchanged bytes; original
archive ownership remains with the caller. Its `replacement(part)` method feeds
only changed members to retained archive rewriting, preserving unrelated members'
compressed payloads and metadata. No-op callers reuse their exact original bytes.
Verification covers exact part-byte parity, Strict OOXML, selection errors,
allow-empty/duplicate selections, guard rejection, long labels, reused buffers,
real spills capped at 16 KiB outstanding writes, cancellation and read/write
failure cleanup. The focused slide suites passed 111 tests, scoped lint/typechecks
and the maintained engine build. A native python-pptx chart deck confirmed the
new label and visibility, unchanged text/chart/workbook and unrelated members,
valid ZIP CRCs and clean storage.

The default `slides set` now uses `stageRetainedSlideSettings`: immutable retained
input, caller-backed archive and response staging, streamed target/effect metadata,
exact no-op archive reuse, source-based publication and retained original comparison.
Responses are admitted before publication; in-place, force, dry-run, stdout and
publication error formatting preserve the command contract. Buffered SDK requests
keep their existing publication types. All 1,169 command tests and seven new SDK
staging tests passed. Generated large inputs and labels force caller spills,
cap outstanding writes at 16 KiB, reuse input buffers, and cover replay, no-op,
source/storage/sink errors, cancellation and cleanup. Maintained workspace build
and scoped lint/typechecks passed. The shipped default adapter also changed a
native python-pptx chart deck: label/visibility were correct, text/chart/workbook
and all unrelated member bytes remained unchanged, ZIP CRC and scratch cleanup
passed. No Worker runtime memory
qualification is claimed. Slide ordering and other mutations, richer reads,
extraction and embedded workbook migration remain.

## Retained XML replacement comparison primitives

The shared retained document index now stores element end offsets and exposes
`markup(element)`, `shell(element)`, `declarations(element)` and `elements(root)`.
Markup is the exact decoded UTF-8 source, without namespace injection or line
ending/quote/entity normalization. Shells remove direct element children only;
text, comments, CDATA and instructions stay byte-identical. The element iterator
uses existing parent/child/sibling links and includes its selected root. Local
namespace declaration attributes are available separately from normal attributes.
All APIs retain handle ownership, cancellation and diagnostic semantics.
The slide mutation protection/compatibility guard now uses the shared iterator,
removing its redundant caller-backed traversal stack.

Verification: 656 shared XML and retained presentation tests passed, including
13 new cases; the strengthened reused-buffer digest cases passed separately.
Generated deep/wide XML forces real caller spills with outstanding writes capped
at 16 KiB. Tests cover UTF-8/UTF-16LE/UTF-16BE, raw mixed content, namespace scope,
expired/foreign handles, cancellation and storage errors. Maintained XML and
presentation build closures plus scoped lint/typechecks passed. Native lxml
matched namespaces and traversal across all three encodings, while source markup
and child-free shells matched exact expected bytes; scratch storage was empty.

Next use these APIs to replace `validateXmlPartReplacement` and
`validateXmlViewReplacement` with retained validation. Preserve both supported
paths: same element structure with guarded attribute/text changes, and validated
child reorder/removal in drawing trees and text paragraphs. The latter compares
standalone namespace context, fixed children and movable subtrees; do not silently
limit `xml set` to same-structure edits. Package-wide signature/macro/protection
and relationship guards, XML aggregate limits, candidate semantic validation,
selection, retained replacement input and streamed publication must all remain.
The completed command integration is described below.

## Retained XML replacement admission

`openRetainedXmlReplacement` is exported from the engine root and `xml-parts`.
It borrows an admitted archive, accepts an exact part URI and replacement byte
stream, and returns a caller-backed candidate view with `changed`, `replacement`,
`read`, `parts`, `has`, `byteLength` and `close`. Replacement bytes, attribute maps,
comparison stacks and duplicate-child occurrence queues live in caller storage.
Hash indexes verify full keys; matching a repeated child consumes one occurrence.
It preserves both existing admission paths: same-structure attribute/text edits
and guarded child reorder/removal. Ancestor-shell equality preserves inherited
namespace context during raw child comparisons. It shares child-sequence rules
with the buffered validator.

Guards include exact XML part selection, signatures/macros, protection, aggregate
XML limits, namespaced attributes and declarations, dialect, opaque bytes,
relationship references, authored slide dimensions, movable subtrees and candidate
semantic validation. The replacement stream retains maxReads/maxBytes, invalid
chunk and source-error diagnostics, cancellation, and primary-error precedence
over iterator cleanup. Source bytes are copied in bounded chunks before advancing
a reused source buffer. No-op callers retain original archive bytes.

Verification: 39 retained replacement cases and 43 existing XML part/view cases
passed, plus scoped lint/typechecks and the maintained engine build. Coverage
includes Strict and UTF-16, protected/signature/macro decks, opaque extensions,
duplicate opaque runs, required headers, forbidden insertion, byte-source errors,
resource limits, cancellation, real caller spills capped at 16 KiB outstanding
writes, unchanged member bytes and expired handles. Native python-pptx/lxml
verified text replacement and shape removal on a chart deck, unchanged chart and
embedded workbook, exact replacement part bytes, ZIP CRCs and scratch cleanup.
No runtime Worker qualification is claimed.

## XML replacement command publication

Default `xml set` now uses `stageRetainedXmlReplacement` (engine root and
`xml-parts` exports). Both presentation and replacement files use immutable
retained input. It shares selection with XML reads, preserving the existing
mutation rejection of metadata targets, and shares caller-backed archive staging
with slide settings. Result locations retain the original fingerprint. No-op
edits reuse exact input bytes. The full response is admitted before publication;
existing force/dry-run, protected input and stale-original guarantees still apply.
Sources are borrowed, while archives, mutation views, staged bytes and responses
are owned and retired together on every exit.

Verification includes human/JSON/binary parity, token/part selection, lexical
text and structural removal, metadata/malformed rejection, exact no-op identity,
default-adapter in-place/force/dry-run/limit/protected-input/stale/write-failure
cases, and source/storage/sink/cancellation cleanup. Storage spies enforce real
caller spills and at most 16 KiB outstanding writes, including replacement
sources that reuse and overwrite chunks. Native python-pptx validates text and
shape removal, unchanged chart values/workbooks and all unrelated ZIP members,
exact replacement bytes, CRCs and scratch cleanup. Scoped lint/typechecks and
workspace build cover both changed packages. No Worker qualification is claimed.

Next migrate richer text reads and remaining extraction/mutation operations;
embedded workbook intermediates and the synchronous presentation model are still
buffered. Preserve their complete supported behavior through the retained path.

## Retained package extraction API

`openRetainedPackageExtraction` is exported from the engine root and `package-tools`.
It borrows an immutable retained input, owns archive/index/descriptor state, and
admits the whole presentation graph and requested selection before exposing
replayable member streams. Explicit selection keeps caller order; default
selection uses stored JavaScript ordering. Case-folded duplicate detection,
member descriptors, hashes, generated names and long MIME values use caller
pages. Package XML and graph admission match buffered extraction, without reading
whole member payloads. The optional readonly selection array is borrowed until
admission settles, like the retained input.

Verification: 24 focused extraction tests cover buffered byte/hash/type/order
parity, no partial admission, malformed decks, unsafe/sparse/accessor selections,
limits, source faults and iterator cleanup precedence, expired handles,
generated member counts and large type scalars. Spies forbid whole-file reads,
verify actual spills and at most 16 KiB outstanding writes, and check cancellation,
slow consumers, reused input buffers and cleanup. Existing package-tools,
retained inventory/inspection/validation tests, scoped lint/typechecks and build
passed. Native python-pptx compared all 41 members of a chart/workbook deck,
repacked them and confirmed unchanged text/chart/workbook behavior and no scratch.

## Streamed package extraction command

Default `extract` now uses retained presentation input, the retained extraction
API and `stageRetainedExtractionOutput`. Member bytes never enter a publication
array. Stored JSON manifest fragments and numeric prefix boundaries support
success and exact partial-failure responses without full in-memory manifests.
Success and the largest diagnostic are admitted before publication. Diagnostic
storage accepts the operation's cancellation during admission, then detaches only
after sealing so cancellation during publication can still report completed files.

The streaming SDK accepts `publishOutputStreams(AsyncIterable<...>)` for a trusted
all-or-nothing transaction and optional `preflightOutputStream`. The default
adapter preserves its explicit `--allow-partial-output` requirement. All paths
are preflighted before writes, including streamed staging capability admission;
source identity, destination guards, force and nested output handling remain.
Supplying only the legacy array publication/preflight callbacks explicitly keeps
the buffering compatibility path. New stream callbacks avoid that path.

Verification: 1,250 command and extraction tests passed, including 27 command
streaming cases and seven large manifest/storage cases, scoped lint/typechecks
and maintained build. Coverage includes exact human/JSON parity, transactions,
partial failures, cancellation after one published member, preflight collisions,
unsupported later destinations, force/protected inputs, nested directories,
output limits before writes, sink/storage failures, real spills, reused chunks
and at most 16 KiB outstanding writes. Native python-pptx verified all 41 members
through the default adapter with whole-file reads forbidden, reconstructed the
deck and confirmed text/chart/workbook parity and scratch cleanup.

Package packing now also follows the retained execution path described below.
Other extraction/mutation paths, richer reads and embedded workbook intermediates
remain. No Worker runtime qualification or complete migration is claimed.

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

## Retained packing continuation

`stageRetainedPackage` now accepts streamed descriptors and opens member byte
sources only after complete namespace admission. Stored sort keys preserve the
buffered writer's exact ZIP ordering. ZIP intermediates and final output use
caller pages; digest, graph, kind, count and byte validation finish before output
is exposed. Tests cover reused buffers, actual spills, bounded outstanding writes,
slow consumption, source/storage failures, cancellation and iterator retirement.
The 31 new packing cases and 61 archive/package regressions pass, as do the
maintained engine lint/type checks and workspace build. Native python-pptx packing
preserves all 41 chart-deck members, text, chart values and embedded workbook, with
exact buffered ZIP bytes and empty scratch. The default pack command now uses
this capability; no Worker qualification is claimed.

`openRetainedPackManifest` now uses the shared `@poe-code/json-ast` parser with
caller-backed nesting, UTF-16 scalars and duplicate-key indexes. It validates the
complete schema, canonical part uniqueness, scoped paths, stdin ownership and
output/source exclusion before returning replayable descriptors and path lookups.
The JSON tree and part-to-input index stay in caller storage. One path at a time
is materialized for the filesystem's string API; there is no resident path list.
The buffered command shares the same scoped-path function. The default pack
execution branch now composes this parser with retained member admission.

Thirty parser tests cover generated/reused chunks, spills, bounded writes, slow
traversal, syntax/UTF-8/schema/depth/limit failures, cancellation and source cleanup.
All 1,249 command tests, 103 workspace ownership checks, command lint/type checks
and the maintained workspace build passed. A native 41-member chart deck survived
manifest-to-retained-packing composition with exact member/text/chart/workbook
parity, Unicode scoped paths and empty scratch. No Worker qualification is claimed.

Default pack now uses retained manifest/member inputs, staged archives, ordinary
conditional publication, dry-run and binary stdout. Human and JSON responses have
fixed schema/size independent of member count. Protected paths are async iterables.
The input session stores replay offsets and original/retained observations in a
caller-backed catalog, sharing one 1 MiB page cache with payload snapshots. Its
source-object cache has 128 entries. Backend identity scopes use weak capability
labels; registered symbols use their global names. Reconstructed observations
compare against the current destination scope without retaining the old objects.
Buffered-only engine requests keep their compatibility path.

Tests cover source-cache eviction/replay, early/late protected sources, in-place
publication after eviction, object/private-symbol/global-symbol scopes, manifest
and byte parity, output budgets, dry-run, force, cancellation and publication
failure. All 1,272 command tests, maintained command lint/type checks and the
selected workspace build passed. Native default-adapter pack retained all 42 inputs (manifest plus 41
members), made no whole-file reads, preserved exact members/text/chart/workbook
values and left scratch empty. Other mutations, richer reads, other extraction
operations and mandatory embedded-workbook intermediates remain unfinished.

## Retained frame reads

The default `text frames list/get` path now admits retained input and stores
fixed-schema formatting records in caller-backed pages. It shares frame schema
validation with buffered SDK readers. Numeric XML tokens are parsed incrementally
without retaining padding or long leading-zero sequences; unknown attributes are
not collected. Shape/group/scope selection, strict namespaces, raw body property
semantics, table exclusion, signed zero and exact human/JSON formats are preserved.
Missing selections and exact-cardinality errors match the existing reader.

Deterministic parity tests cover retained lifetimes, reused source chunks, slow
sinks, actual storage spills, bounded outstanding writes, cancellation, storage
and sink failures, output budgets and scratch cleanup. All 1,332 command tests,
42 focused engine cases, scoped lint/type checks and the maintained workspace
build passed. A native python-pptx chart/workbook deck matched exact buffered
output and native frame properties through the default adapter, with retained
input, no whole-file reads and empty scratch. This is another read-path
migration; paragraph/run reads, other extraction, most mutations and mandatory
embedded-workbook intermediates remain unfinished. No Worker runtime measurement
or completed release is claimed.

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
