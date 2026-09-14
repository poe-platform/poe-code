# DOCX markup compatibility and alternate representation preservation

Status: Implemented; maintained scoped checks passed.

Scope: `markup-compatibility` only. Starting revision: `c83cfb1fb`. All later pipeline tasks remain pending.
The existing edits to the main pipeline plan and unrelated plan move are preserved
and excluded from this task's commit.

## Standards and implemented boundary

Reviewed the root instructions, DOCX specification, shared office CLI and SDK
contracts, public API audit, complete parsed 920-record API inventory, API
reconciliation and test crosswalk. No scoped instructions exist under DOCX/docs.
The crosswalk assigns no source test rows to this MCE task: the original
regressions implement the F05 standard/contract acceptance obligations directly.
No source tests or downloaded assets were copied or executed.

The pinned ECMA-376 Part 3 (2015) §§7.1–7.7, 8 and 9.2–9.4 define namespace
scope, control grammar, extension boundaries and effective branch selection.
Local source evidence remains `/tmp/docx-standards-20260913/ECMA-P3.txt` and the
existing standards source manifest. Prefix values resolve at their declaring
element, and inherited rules retain expanded namespace names after rebinding.
The first Choice whose entire Requires list is understood wins. Otherwise the
Fallback wins; no eligible Choice and no Fallback yields an explicit selection
record with `selected === undefined` and empty effective content.

Documentation drift: PreserveElements and PreserveAttributes do not occur in the
pinned 2015 Part 3 grammar. They were removed from that edition, as documented in
the [2015 edition foreword](https://assets.vde-verlag.de/iec-normen/preview-pdf/info_isoiec29500-3%7Bed4.0%7Den.pdf).
Older producers still emit them; the
[PreserveElements API documentation](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.markupcompatibilityattributes.preserveelements?view=openxml-3.0.1)
describes their preservation intent. This implementation explicitly accepts them
as legacy preservation hints, validates prefix/local-name or wildcard pairs
against the inherited ignorable namespaces, and preserves their exact bytes and
all source content. They do not make ignored markup semantically visible.
This is an explicit compatibility policy, not a claim they remain normative
2015 attributes. Unknown MCE control names reject as invalid XML.

`documentCompatibilityProfile` is an immutable, declared traversal profile:
no-namespace markup, XML, both WordprocessingML main namespaces, both DrawingML
main/wordprocessingDrawing/picture namespaces and both office relationship
attribute namespaces. It does not advertise full semantic edit/render support
for any namespace. In particular, SVG and arbitrary extension namespaces are
not understood by default. DrawingML `ext` in either dialect is the declared
application extension boundary; its own attributes and entire contents remain
opaque, without MCE interpretation. Custom profiles supply an explicit namespace
array and optional exact expanded extension-element names. OPC relationship
processing does not inherit this profile: its existing reader is unchanged.

`DocumentXmlEditor(bytes, limits?, profile?)` and
`DocumentArchiveEditor(archive, limits?, profile?)` copy and validate the same
profile before use. Their `compatibility` / `xml(name).compatibility` read view
uses `MarkupCompatibility` over the original bounded parser tree. The raw
`root` remains the original frozen lexical snapshot. Effective `content` contains
immutable records with `source`, `disposition`, filtered `attributes` and ordered
`content`; non-element tokens retain source identity. `branches` records each
examined AlternateContent and its selected original element, including nested
selected branches. Unknown nonignorable elements remain visible with `opaque`
disposition; unknown attributes remain retained. They are not silently deleted
or represented as supported features. The effective view is not a serializer.

Ignored elements are omitted from the effective view. ProcessContent wrappers
are unwrapped with ordered mixed content retained. Rules apply by expanded URI,
including wildcards, inherited declarations and local Choice bindings. Known
namespaces remain visible even when declared ignorable. Required unsupported
namespaces fail on examined ordinary/unwrapped elements, AlternateContent and
its selected branch; requirements in ignored/unselected content and declared
extension content do not fail the read. Control grammar rejects invalid branch
order/counts, unbound/reserved prefixes, invalid name pairs, unexpected control
attributes, forbidden XML attributes and non-whitespace control text.

## Mutation and preservation

The existing lexical editor is still the sole serializer. Original source bytes,
namespace declarations, unselected branches, attributes, comments, relationship
parts and SVG/raster payloads are retained exactly. Lazy compatibility processing
does not dirty a node or part. Clean serialization remains available even for
opaque/unsupported documents; effective inspection or a real edit may reject.

When compatibility markup or a declared extension boundary is present, every
actual mutation goes through the effective view's ownership/editability check.
All AlternateContent representations are preserve-only: no branch synchronizer
is implemented. Edits to selected or unselected branches, Requires, MCE controls,
ignored/opaque content, or descendants of a ProcessContent wrapper reject with
UnsupportedEditError. The latter is conservative: unknown wrapper semantics do
not establish safe mutation even though child content can be read. DrawingML
blips with extLst are also preserve-only, protecting the SVG extension and
its raster fallback together even without an AlternateContent wrapper.
Unrelated understood text/attributes can still be edited. Failure retains all
previously accepted patches. Setting a token to its original decoded value is a
no-op, retaining its original lexical bytes.

The historical generic XML editor remains a low-level lexical codec for documents
without compatibility markup/declared extension boundaries. This task does not
turn arbitrary XML editing into a complete semantic document mutation engine.
Raw parseDocumentXml and package admission remain raw/package operations; callers
must use the effective view for compatibility-aware reading. Typed live model
views, semantic operations, publication gates and CLI adapters remain later work.

## Exact JavaScript and security mappings

- Inputs: owned Uint8Array and existing in-memory archive; no ambient filesystem,
  network, clock, resource fetching, native parser/runtime or reference build.
- Configuration: explicit readonly string arrays and expanded-name records;
  copied/frozen at acquisition. Undefined optional arguments use declared defaults;
  null, malformed/unknown fields and invalid member values raise InvalidValueError
  (`usage`, future ordinary CLI exit 2). No prefix-as-feature guessing.
- Reading: synchronous, readonly arrays with zero-based positions, `.length` and
  standard JS iteration. Source identity is explicit, not copied class identity.
  `selected === undefined` means no applicable representation, not failure.
- Failures: InvalidXmlError (`invalid-xml`, exit 1) for malformed controls;
  UnsupportedProfileError (`unsupported-profile`, exit 1) for examined required
  unsupported namespaces; UnsupportedEditError (`unsupported-edit`, exit 1) for
  unsafe synchronization/opaque edits. Existing XML limits retain
  ResourceLimitError (`limit-exceeded`, exit 4). Messages exclude document text.
- Boundedness: XML admission retains existing byte/depth/node/attribute/text/work
  limits. View traversal uses admitted trees and inherited scope; it adds no
  unbounded document-supplied callbacks or I/O. This synchronous codec does not
  claim aggregate invocation/cancellation accounting or a wall-clock guarantee.
- Standalone MarkupCompatibility accepts an already admitted XmlElement tree;
  editor-owned use provides the frozen source snapshot. It is not a parser for
  arbitrary JavaScript object graphs or a live owner-bound model handle.

No CLI command/schema/capability or visual language changes occur. The shared
plural resources, text replace, flags/selectors/JSON/status contracts remain
unchanged; there is no competing CLI implementation or new singular alias.
No public model inventory rows are promoted to implemented by this codec.
Neutral method/property names, inherited members, helpers, collections, enums,
APIs without source tests and documented underscore-prefixed public types remain
pending obligations. The old audit's "SDK not started" refers to that model
surface; this task establishes only the stated low-level compatibility API.

## Red/green evidence and verification

All 50 new tests use original small data independent of downloads. Filesystem
mutations use memfs. Existing original tests remain unchanged. Technical raster
bytes reuse the original technicalBitmap fixture, and the SVG payload is an
original empty technical viewport, with separate image relationships.

- Initial failures: 34 new cases failed before implementation; all 235 existing
  cases passed. `/tmp/docx-mce-red.log`.
- Follow-up failures: extension content without MCE attributes admitted an unsafe
  edit, and archive editors did not forward a custom profile. Both were reproduced
  before their corrections. `/tmp/docx-mce-boundaries-red.log`.
- Two additional red cases distinguished valid ignorable alternate children that
  survive processing (profile mismatch) from malformed control grammar. Fixed to
  raise UnsupportedProfileError; `/tmp/docx-mce-mismatch-red.log`.
- Final maintained package tests: `npm run test --workspace=docx`, 285 passed
  across nine files. `/tmp/docx-mce-tests.log`.
- Selected maintained build: `npm run build:workspaces -- --workspace=docx`,
  declaration-derived dependency closure passed. `/tmp/docx-mce-build.log`.
- Maintained DOCX ESLint and production/test TypeScript checks:
  `npm run lint --workspace=docx`, passed. `/tmp/docx-mce-lint.log`.
- Built ESM export consumer: profile immutability, fallback selection, typed edit
  refusal and exact unrelated-edit preservation passed.
- `git diff --check`: passed.

Scope is DOCX-only; no shared codecs, root command wiring or adapters changed.
No CLI screenshot or document rendering fidelity claim is appropriate for this
codec-only task. No downloads, ignored QA fixtures, generated dist, README
additions or unrelated changes are included. One atomic local Conventional
Commit contains this plan and the owned implementation/tests. No push or release.
