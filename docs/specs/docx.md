# DOCX Utility Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define the intended document-format coverage and observable behavior of the original `docx` utility and its TypeScript SDK.

This is a proposed contract. No document engine or command implementation has
been verified. The accompanying pipeline sequences implementation; the downloaded
corpus establishes available test inputs, not product conformance.

## Normative language

MUST and MUST NOT identify conformance requirements. SHOULD identifies a strong
recommendation whose exceptions require documentation. MAY identifies permitted
optional behavior. Implementation-defined choices MUST be documented and tested.

## 1. Problem statement

Agents need to inspect, create and modify Word documents through a predictable
command and typed API. A successful edit must preserve unrelated content and the
package relationships that make the document usable. Text extraction alone does
not establish editing fidelity. Supporting a file extension does not establish
support for every structure that can occur inside it.

The public utility MUST be named `docx`. Public and internal identifiers,
comments, examples, tests and shipped metadata MUST use original terminology and
content. Tests MUST derive from this contract, original authored examples and
the document-format standards, not another implementation's test suite.

## 2. Goals and non-goals

### 2.1 Goals

The completed implementation MUST support the feature families in section 5 at
their stated levels, CLI/SDK parity, bounded processing, and capability-aware
virtual filesystem I/O. The support matrix MUST distinguish inspection, editing,
opaque preservation and rejection. Each implementation milestone MUST disclose
which proposed requirements have actually been verified.

The utility MUST handle real reports with many paragraphs, tables, notes,
relationships and images, not only minimal synthesized documents. It MUST
preserve unsupported, unmodified structures where doing so is safe.

### 2.2 Non-goals

The utility is not a page-layout engine, Word application emulator, font rasterizer,
spreadsheet formula engine or universal format converter. It MUST NOT execute
macros, embedded objects, field instructions, external programs or downloaded
resources. Binary `.doc`, encrypted Office containers, PDF conversion, mail
delivery, real-time coauthoring and arbitrary document-supplied code are outside
the product contract. Signature cryptographic verification and regeneration are
not promised. These exclusions do not permit silently deleting their structures.

## 3. Standards boundary and terminology

The baseline is [ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376/),
whose currently published parts have different revision dates:

| Source | Baseline | Application |
| --- | --- | --- |
| ECMA-376 Part 1 | Fifth edition, December 2016 | Fundamentals; WordprocessingML; shared markup including DrawingML and mathematical content. |
| ECMA-376 Part 2 | Fifth edition, December 2021 | Open Packaging Conventions, part names, content types, relationships and package signatures. |
| ECMA-376 Part 3 | Fifth edition, December 2015 | Markup compatibility, ignorable namespaces and alternate content. |
| ECMA-376 Part 4 | Fifth edition, December 2016 | Transitional migration markup and legacy compatibility structures. |
| [MS-DOCX](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/b839fe1f-e1ca-4fa6-8c26-5954d0abbccd) | Pin the downloaded revision during implementation | Microsoft extensions such as modern Word feature metadata; separate from the base standard. |
| [Microsoft markup compatibility guidance](https://learn.microsoft.com/en-us/office/open-xml/general/introduction-to-markup-compatibility) | Supporting implementation guidance | Alternate-content selection and application-version compatibility; does not replace the standard. |

The standards audit MUST record actual section numbers, namespace URIs, schema
types and revision identifiers for each implemented family. An unverified section
number MUST NOT be invented. The implementation MUST NOT imply ECMA/ISO
certification merely because its scoped validator passes.

A **package** is the ZIP/OPC container. A **part** is a named payload in that
package. A **story** is an independently addressable body, header, footer, note,
comment or supported text-box content region. A **location** identifies a part
and structural node within a particular document revision. A **revision** in an
editing API identifies input state; a **tracked change** is WordprocessingML
review markup. These concepts MUST NOT be conflated.

Locations MUST carry a document fingerprint or equivalent stale-selection guard.
An edit against a stale location MUST fail before publication. Part-relative
relationship IDs and package/story-specific identifiers MUST retain their true
scope; they are not globally interchangeable strings.

## 4. System boundary

The document engine accepts owned bytes/streams and injected filesystem access.
The CLI adapter interprets arguments, invokes the same operations exposed by the
SDK, and writes results through safe-bash streams. It MUST NOT bypass the SDK
with a second editing implementation. The root package only wires exports.

The `docx` command is an explicit safe-bash plugin. Default shell command
registration MUST NOT load it implicitly. Registration MUST preflight collisions
and honor the established replacement policy. Browser/worker availability MUST
be advertised only after the full exported dependency closure is tested there.

Network access to acquire corpus files is development activity. The product
MUST NOT gain networking or ambient filesystem authority from that activity.

## 5. Feature and format coverage

In this matrix, **edit** includes inspect and preserve; **preserve** includes
inventory and byte/structure retention but not semantic mutation of the opaque
object. This is the target of the full pipeline, not a list of implemented features.

| ID | Feature family | Required target behavior |
| --- | --- | --- |
| F01 | ZIP/OPC | Bounded stored/deflated read/write, CRC validation, safe names, content types and relationship graph. ZIP64 read within limits; reject multi-disk/encrypted archives. |
| F02 | Strict and Transitional | Detect both, read both, edit supported structures in the original dialect. No silent dialect conversion. |
| F03 | Macro-free templates | Read/create/edit `.docx` and macro-free `.dotx` with explicit output kind and correct content type. Reject macro-enabled mutations. |
| F04 | XML fidelity | Namespace-aware edits; retain unknown unmodified subtrees, attributes, comments, processing instructions, order and meaningful whitespace. |
| F05 | Markup compatibility | Handle `mc:Ignorable`, `MustUnderstand`, `ProcessContent` and `AlternateContent` according to a declared understood-namespace profile; preserve unselected branches. |
| F06 | Package inspection | Parts, content types, relationship edges, properties, signatures, protected/unsupported content and structural counts. |
| F07 | XML access | Raw part bytes, bounded pretty display and a validated explicit XML-part replacement operation; never regex-based editing. |
| F08 | Text extraction | Body and explicit story scopes, paragraphs, runs, tabs, breaks, lists, tables and field results with stable locations. |
| F09 | Unicode and language | Lossless Unicode, RTL/bidirectional and East Asian properties, locale/font metadata and combining characters. No visual-order reshaping in logical text. |
| F10 | Literal replacement | Cross-run matching within explicit structural boundaries; exact first/all/occurrence selection; preserve outside text and formatting. |
| F11 | New documents | Create a minimal valid document or populate a supplied template from typed structured content. |
| F12 | Run formatting | Bold, italic, underline, strike, size, font references, color/theme references, highlight, language, baseline/superscript and hidden-text properties. |
| F13 | Paragraph formatting | Alignment, indentation, spacing, tabs/leaders, borders/shading, keep/widow controls, page/column breaks and outline level. |
| F14 | Styles and themes | Inspect/reuse/create/edit paragraph, character and table styles; inheritance, defaults and linked styles; preserve theme resources and unknown settings. |
| F15 | Headings | Level 0 creates a title; levels 1–9 use valid paragraph/outline styles; avoid overwriting colliding user styles. |
| F16 | Sections and pages | Page size/orientation/margins, columns, section breaks, page-number metadata, first/even/odd header/footer bindings and inherited sections. |
| F17 | Headers and footers | Scoped read/edit/create with explicit link-to-previous/shared-part behavior. |
| F18 | Lists | Multilevel ordered/bulleted lists, restart/start overrides, numbering styles and scoped ID allocation; preserve picture-bullet resources. |
| F19 | Tables | Create/read/edit rows/cells and formatting, grid widths, header repetition, row splitting, nesting and cell margins. |
| F20 | Merged tables | Resolve horizontal/vertical spans, target logical cells, explicit merge/split, validate rectangular grids and reject ambiguous coordinates. |
| F21 | Links and bookmarks | Internal/external hyperlink relationships, safe schemes, bookmark ranges/names and explicit rename/removal reference policy. |
| F22 | Fields and references | Simple/complex/nested field inventory; set displayed results without execution; create bounded PAGE/NUMPAGES/REF/PAGEREF/SEQ/TOC fields and update flags. |
| F23 | TOC and captions | Create/edit TOC field structures, figure/table captions and cross-reference relationships; cached page numbers are not recalculated promises. |
| F24 | Footnotes and endnotes | Read/insert/edit/remove notes, references and required separators; preserve numbering rules and scoped IDs. |
| F25 | Comments | Classic comment ranges and bodies; create/edit/delete with explicit author/time; modern/threaded extension inventory and preservation. |
| F26 | Tracked changes | Original/final/all read views; create simple text insert/delete revisions; accept/reject supported selected revisions and formatting changes atomically. |
| F27 | Complex review structures | Move revisions, table/section revisions and unsupported threaded metadata: inventory and preserve; reject affected edits until verified. |
| F28 | Content controls | Inspect/fill supported plain/rich text, checkbox, choice, date and picture controls; respect locked states and placeholders. |
| F29 | Repeating/data-bound controls | Bounded repeat-row/section expansion and explicit supported custom-XML binding synchronization; no arbitrary XPath evaluation or silent detachment. |
| F30 | Document properties | Core/extended/custom typed properties and explicit removal; preserve unrelated metadata. |
| F31 | Image inventory | Inline/floating image locations, owners, relationships, media type/bytes, dimensions, crop, rotation, wrapping and alt text. |
| F32 | Raster insertion/replacement | Documented API image-format coverage, including PNG/JPEG/GIF/BMP/TIFF with bounded header/dimension/DPI admission; occurrence versus shared-resource replacement and aspect-ratio sizing. |
| F33 | Floating image layout | Read/edit anchor coordinates, relative frames, wrap mode, z-order, crop, rotation/flips and decorative/alt metadata without claiming rendered geometry. |
| F34 | Other media formats | Preserve and extract original GIF/BMP/TIFF/EMF/WMF/WDP/SVG bytes and fallback relationships; no native decoding or conversion. |
| F35 | SVG and alternate graphics | Inventory/preserve SVG plus raster fallback; insertion requires supplied admitted SVG and explicit fallback. Reject external references/scripts; do not rasterize. |
| F36 | Shapes and text boxes | Inspect/preserve DrawingML/VML shapes; edit supported text-box story text without changing geometry; grouped/unsupported geometry stays opaque. |
| F37 | Charts | Inventory chart type/series/cached values and embedded-workbook bindings; preserve chart/workbook bytes on unrelated edits. No formula engine or chart rendering. |
| F38 | SmartArt and diagrams | Inventory graph/data/layout parts and preserve them. No diagram layout generation. |
| F39 | Equations | Inventory and preserve OMML; insert/replace validated bounded OMML fragments explicitly. No implied LaTeX conversion or math evaluation. |
| F40 | Embedded OLE/packages | Inventory and preserve inert objects/relationships; explicit bounded extraction only. Never activate embedded content. |
| F41 | Custom XML and glossary | Inventory/preserve custom XML, bindings, glossary/building-block and ancillary parts; support only declared structural edits. |
| F42 | Settings/fonts/protection | Inspect/preserve compatibility, document settings and embedded fonts; respect editing protection. No password cracking or font installation. |
| F43 | Signatures | Detect/list signature parts; default mutation rejection. An explicit strip-signatures operation removes the signature graph before edits; never claim signatures remain valid. |
| F44 | Removal | Exact range/structure removal with reference checks; retain shared resources and required empty containers. |
| F45 | Dummy text | Seeded deterministic replacement of selected visible text; not an anonymization guarantee. |
| F46 | Sanitization | Explicit, enumerated removal of selected properties/comments/revisions/links/embedded objects, with an exact report; never an unqualified privacy guarantee. |
| F47 | Batch and templates | Versioned typed ordered operations, bounded record expansion and one final publication; no eval or document-supplied code. |
| F48 | Comparison | Part-payload and semantic XML/text/structure diff; distinguish data differences from serialization changes. |
| F49 | Validation | Scoped OPC, XML and cross-part semantic diagnostics with an honest schema/profile report. |
| F50 | Extract/pack | Safe VFS extraction and reconstruction with validated inventories and no host utility fallback. |

Feature families marked preserve-only remain part of acceptance: output must
retain their data and relationships when unrelated content changes. Absence of a
feature in the downloaded corpus MUST lead to an original authored test or an
explicit missing-evidence report, not removal from the matrix.

## 6. Command and SDK Contract

The [shared Office CLI specification](office-cli.md) is authoritative for
command structure, names/actions, options, selectors, JSON, SDK operation IDs,
output publication and exit statuses. Implement those conventions unchanged.
Common literal replacement is `text replace`; discovery includes `schema` and
`capabilities`. Every declared format feature MUST map to supported operations
or explicit read/preserve/reject evidence. Ordinary edits MUST NOT require JSON
or internal XML IDs. All supported SDK behavior must be reachable through direct
CLI operations or typed batch, with direct flags for common workflows.

The [shared JavaScript SDK specification](office-sdk.md) adds complete documented
public API coverage, closely mirrored method/property names and explicit language/
security mappings. It covers live collections, inherited/latent styles, omitted
table cells, rich comments, unit/color helpers and documented XML views even where
the feature matrix above uses broader categories. Public behaviors absent from
upstream tests still require original acceptance cases. API setter semantics may
replace the selected subtree as documented; preserving literal replacement remains
a separate operation.

DOCX-specific families include `paragraphs`, `runs`, `styles`, `sections`,
`headers`, `footers`, `lists`, `bookmarks`, `fields`, `toc`, `captions`,
`revisions`, `controls` and `lorem`. Use resource/action paths, including
`paragraphs add`, `paragraphs set`, `runs set`, `revisions accept` and `revisions
reject`. Shared collections are `images`, `tables` and `properties`; there are
no singular or metadata aliases. Exact format-only flags belong in this spec
and its machine-readable register.

Text defaults to the main body. Header/footer/note/comment/text-box scopes are
explicit; all-story order follows the relationship graph with deterministic
tie-breaking and shared-part deduplication. Final/original/all revision views
retain their distinct semantics.

Both tools use ordinary exit statuses 0/1/2/3/4/130 as defined by the shared
contract. For `diff`, 0 means equal, 1 means different, 2 means comparison trouble,
and 130 means cancellation. A successful difference is not an SDK exception.

## 7. Configuration and defaults

No environment variables or implicit configuration files are required. Trusted
host options set ceilings; operation/CLI options MAY lower them and MUST NOT
raise them. Invalid, nonfinite, negative, fractional or unsafe-integer limits
MUST fail before processing. Counts requiring nonzero capacity reject zero.

Proposed default ceilings, to be tested against the corpus before readiness:

| Resource | Default ceiling |
| --- | --- |
| Compressed input | 64 MiB per document; two-input operations account both |
| Expanded package | 256 MiB per document |
| ZIP entries | 10,000 per document |
| Individual XML part | 32 MiB |
| XML nodes/depth | 2,000,000 nodes; depth 256 |
| Embedded media | 64 MiB per item, also charged to expanded/retained limits |
| Retained owned byte buffers | 512 MiB per invocation, including copies and both diff inputs |
| Serialized output | 256 MiB |
| Batch operations | 1,000 |
| Matches/inserted nodes | 100,000 matches; 1,000,000 new XML nodes |
| Table expansion | 100,000 cells; 10,000 rows; 1,024 columns per table |
| Ordinary diagnostics | 64 KiB, with deterministic truncation indication |

Work accounting and cooperative yield granularity MUST be finite and documented.
Timeouts alone MUST NOT substitute for byte/node/work limits. A trusted explicit
large-document profile MAY raise ceilings for qualification; the report MUST
record actual settings. Byte accounting is not a promise of process RSS isolation.

Deterministic operations MUST NOT read the wall clock or global randomness for
document changes. Revision/comment author and timestamps, dummy-text seed and
requested metadata dates are explicit. ID allocation is deterministic within a
given package and operation sequence.

## 8. Processing and publication state machine

Each mutating invocation progresses through admission, owned acquisition,
parse/validate, selection, staged mutation, result validation, serialization,
publication and cleanup. Failure before publication MUST leave the input and any
preexisting output unchanged. Cleanup MUST settle before invocation completion
for resources enrolled in the existing cooperative cleanup contract.

A publishing mutation requires exactly one of `--output PATH` (including `-`)
or `--in-place`. Dry-run follows the common no-publication contract.
New paths use exclusive creation. Existing outputs require `--force`; in-place
is explicit source-replacement intent. The utility MUST resolve per-path VFS
capabilities and source/destination identities before destructive publication.
Unknown alias identity or missing required conditional/staged guarantees MUST
cause rejection, not a racy exists-then-write or delete-then-write fallback.

The engine validates syntax for an entire batch before edits. Semantic selections
then resolve against the current staged revision in array order. A failed later
operation aborts the whole unpublished result. The final package is published
once; per-operation budgets do not reset. Multi-file output follows the shared contract: an adapter transaction or explicit
`--allow-partial-output` with a precise manifest is required.

Completed publication cannot be undone by cancellation. An interrupted binary
stdout or extraction can leave partial new output; the result MUST say so and
cleanup MUST affect only resources whose ownership is established. Existing
directories and user files MUST NOT be recursively removed as guessed cleanup.

## 9. Preservation and editing invariants

Untouched parts MUST retain identical uncompressed bytes. Repacking MAY change
compression and ZIP metadata under the documented deterministic writer policy.
Dirty XML parts MUST retain all unselected content semantically, including
unknown markup and namespace bindings. Serialization MUST NOT drop comments,
processing instructions or significant whitespace simply because a convenience
parser omits them. Unsupported fidelity means reject the edit.

Relationships MUST resolve using OPC rules and the owning part. Do not assume
`word/document.xml` or fixed XML prefixes. New relationships, style/numbering IDs,
drawing IDs, note IDs and annotation IDs MUST be allocated in their actual scopes.
Deletion MUST preserve a resource still referenced anywhere in the package.

Literal replacement matches a logical text map across adjacent formatting runs
inside a supported paragraph, with explicit barriers at field, object, revision
or incompatible container boundaries. Matches are nonoverlapping, left-to-right
over original selected text. Inserted replacement text is not searched again.
Replacement formatting inherits the first matched run unless explicitly supplied;
surviving prefixes/suffixes retain their properties. Empty search strings fail.

Unambiguous selection is required. Multiple matches require an explicit occurrence
or `--all`; missing matches fail unless `allowMissing` is explicitly selected.
Source locations MUST detect stale fingerprints. Broad operations MUST report
all affected locations within bounded structured output or fail admission.

Shared images, headers, footers and other parts require explicit shared-resource
versus one-occurrence intent. Editing one occurrence MUST clone/rebind only the
necessary part instead of accidentally modifying every reference.

Image changes MUST retain original drawing properties unless specifically
changed. Raster format is determined from bytes, not extension. Checked EMU/pixel
conversion uses a documented 96-DPI convention; dimensions, crop fractions,
rotation and coordinates are range-checked. Unsupported vector/native formats
MUST remain inert and preserve fallback relationships. Alt text is distinct from
filenames and optional decorative status.

Read-only protection and locked controls MUST NOT be silently bypassed. Signed
documents require explicit signature removal before mutation. Field result
updates MUST preserve instructions and MUST NOT execute them; a subsequent Word
recalculation may replace cached values. Page counts read from metadata MUST be
labeled cached, not measured rendered pages.

## 10. Failure, security and observability

Stable error categories include usage, invalid-container, invalid-xml,
invalid-package, unsupported-profile, unsupported-edit, ambiguous-selection,
stale-selection, missing-selection, limit-exceeded, permission, conflict,
unsupported-publication, source-failure and sink-failure. Cancellation MUST NOT
be recategorized as an ordinary missing-file or force-suppressed failure.

The reader MUST reject unsafe paths, duplicate/colliding part names, illegal ZIP
flags/methods, inconsistent local/central metadata, failed CRCs, invalid encoding,
DTD/entity declarations and expansion beyond actual limits. An external
relationship remains data; it MUST NOT cause a network request or local read.
Document text and metadata are untrusted data, never tool instructions.

The command MUST escape terminal control bytes in human diagnostics while
preserving raw bytes in explicit binary/XML output. It MUST NOT log document
bodies, credential-like relationship targets or metadata unnecessarily. Metrics
MAY contain counts, byte totals, elapsed time and feature/profile diagnostics;
they MUST distinguish measured values from estimates and configured ceilings.

## 11. Corpus and original test contract

The implementation MUST account for every collected parameter variant and expanded
BDD example in the pinned research inventory. Adapt every applicable behavioral
case into original TypeScript tests and in-memory fixtures. Python-private wrapper
or mock mechanics MAY map to equivalent observable invariants with an explicit
rationale; missing public functionality remains a visible gap, not a passing case.
Do not omit difficult cases because the initial implementation plan missed them.
Deferred public behavior prevents claims of complete parity.

Reference-project names, links and attributions MUST NOT appear in product source,
code comments, identifiers, test names, fixtures or CLI output. Keep crosslinks in
plans/research and any legally required notices for substantial derived material
in standalone legal files. Original data and names do not remove notice obligations
when test material itself is substantially derived.

The canonical unit suite MUST use original authored scenarios and in-memory
mutations through memfs. Downloaded documents and large stress data belong to a
separate opt-in offline qualification collection, with immutable source files.
These files are disposable QA fixtures only: they MUST NOT ship with the
product, become permanent canonical tests, or be committed as large binaries.
They remain unmodified while a campaign uses them, and MAY be deleted with
invocation-owned outputs after QA. A meaningful discovered behavior or bug MUST
be reduced to a small original deterministic unit test before the corresponding
finding is closed. The regression must assert the relevant invariant and MUST
NOT depend on the downloaded file, network access or copied document passages.
The source/checksum manifest and the small regression tests survive cleanup;
retention of the original downloaded bytes is not required.
The manifest MUST include source/landing URLs, publisher, retrieval date, actual
size, SHA-256, structural census, license evidence and redistribution restrictions.
Do not assume a publisher's text license clears all embedded photographs/logos.

Qualification MUST include long reports, merged tables, headings, notes, fields,
content controls, equations, floating/inline images and multiple image formats.
Missing charts, revisions, comments, Strict inputs or particular languages in
the downloaded collection MUST be supplied by clearly labeled original fixtures
or recorded as pending evidence. Generated stress files MUST NOT count as
downloaded real-world documents.

At least two admitted large inputs MUST successfully round-trip and complete a
targeted edit under an explicit profile before large-document support is claimed.
Correct over-limit rejection is a separate result. Per-file evidence MUST record
input/output hashes, profile, exact actions, structure verification and errors.
Source hash preservation MUST be checked after all mutating failure cases.

## 12. Test and validation matrix

| Requirement | Required evidence |
| --- | --- |
| F01–F05 package/XML/dialects | Original malformed and valid fixtures; independent OPC/XML assertions; Strict/Transitional and MCE fixtures; bounded ZIP tests. |
| F06–F15 reading/text/formatting | Exact logical text and JSON output; cross-run Unicode cases; untouched subtree and formatting checks. |
| F16–F24 document structure | Section/story alias checks; table-grid and numbering invariants; notes/bookmarks/field graphs and stale-location tests. |
| F25–F30 review/forms/properties | Annotation/revision range checks; explicit author/time; bound-control synchronization; typed property assertions. |
| F31–F40 graphics/math/objects | Exact media hashes; shared-reference tests; dimensions/crop/anchors; fallback/opaque-part retention; no external activation. |
| F41–F46 preservation/security | Opaque-part round trips; protection/signature refusal and explicit stripping; exact sanitization effects. |
| F47–F50 compound workflows | Batch failure preservation; semantic diff controls; independent final package validation; safe extract/repack. |
| CLI/SDK parity | Published type/runtime consumers and actual safe-bash scripts, pipes, redirects, errors, help and cancellation. |
| Budgets/publication | At/over boundary tests, reused chunks, aggregate accounting, sink failures, alias/capability conflicts and cleanup settlement. |
| Large/image-heavy inputs | Downloaded corpus plus labeled original stress fixtures; successful edits, not only rejection; measured structure and resource reports. |
| Visual fidelity | Ad hoc CLI screenshots; available document renderer page screenshots and repair-warning checks, separately labeled from structural validity. |

## 13. Conformance criteria

Full proposed conformance requires all MUST requirements and every target row's
declared support level, with passing evidence. Read/preserve-only support MUST
NOT be marketed as editing support. An early milestone MUST publish its actual
subset and remaining work; it does not complete this specification.

Coverage reports SHOULD reach 90% lines and 85% branches for new implementation
code with explicit denominators and justified exceptions. Percentages are not a
replacement for independent assertions, realistic corpus runs or visual review.
Unavailable renderers and skipped documents MUST NOT be reported as passes.

## 14. Open questions and implementation-defined choices

- Exact schema/type-level completeness for Microsoft extensions requires the
  standards-audit task and pinned revision; unknown extensions remain preserved.
- Default ceilings above are proposed. Readiness requires corpus-informed
  measurements and explicit documentation of any change, not silent weakening.
- Font availability and renderer/platform differences remain external to layout
  guarantees; qualification must record the actual environment.
- Particular downloaded image licenses may require keeping files local and
  unmodified outside permitted text edits. The manifest records pending rights;
  no redistribution is implied by acquisition.
- README additions require separate permission under repository rules. Usage
  drafts may be written meanwhile; this is a documentation-delivery constraint,
  not permission to omit package documentation permanently.
