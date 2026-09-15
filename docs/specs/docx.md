# DOCX Utility Specification

Status: Proposed

Implemented Through: Not applicable

Purpose: Define the intended document-format coverage and observable behavior of the original `docx` utility and its TypeScript SDK.

This remains the full proposed contract. Scoped package-engine evidence is in
[the validation profile](../docx/validation-profile.md), and the bounded command
discovery milestone is recorded in [help/output evidence](../docx/help-errors-output.md).
The bounded inspect/validate implementation and additive result fields are recorded
in [inspection evidence](../docx/inspection-profile.md). None of these milestones
establishes complete document-operation or model API conformance. The
accompanying pipeline sequences implementation; downloaded corpus availability
does not establish product conformance.

The bounded logical text read milestone and its additive segment context are
recorded in [text extraction evidence](../docx/text-extraction.md). It implements
the utility read surface only, not the proposed document object model.

The bounded scoped direct-formatting operation is described in
[run formatting evidence](../docx/run-formatting.md). It does not promote the
planned live object model, run whole-text setters or batch execution to implemented.

The bounded tracked text creation milestone is recorded in
[tracked text evidence](../docx/tracked-text-evidence.md). Its original tests
qualify creation only; decision edits, live review owners, corpus/renderer QA
and whole public API conformance require separate verified evidence.
The later [bounded decision evidence](../docx/revision-decisions-evidence.md)
qualifies selected inline text and exposed-property acceptance/rejection only;
live owners, ordered batches and whole-format conformance remain pending.

The later [bounded control evidence](../docx/content-control-values.md) qualifies
typed utility inspection/filling and existing PNG picture-control replacement.
The later [bounded repeat/binding evidence](../docx/repeat-controls-bindings.md)
qualifies native row/block expansion, contained classic-comment/bookmark/inline
PNG graph remapping and explicit singleton custom-XML synchronization. Live
owners, ordered batches, template apply and corpus/renderer qualification remain
pending; neither milestone promotes the complete format contract.

The bounded paragraph operations are described in
[paragraph editing evidence](../docx/paragraph-editing.md). They add paragraph
properties and explicit whole-paragraph text assignment, plus block/inline caret
insertion. Whole Paragraph owner bindings remain pending; the later style
milestone below implements its bounded formatting model and batch subset.

The bounded style/default operations and collision-safe Title/headings 0–9 are
recorded in [style evidence](../docx/styles.md). They expose utility operations;
the later [style-formatting evidence](../docx/style-formatting-audit.md) records
latent mutation and the bounded live style/font/paragraph/tab subgraph. Complete
document-model coverage remains pending.

The bounded theme/font-resource inventory and preservation evidence is recorded
in [font resource evidence](../docx/font-resources.md). It adds detailed inspection
and an explicit embedded-font mutation boundary; it does not establish whole-model
or rendered font-selection coverage.

The bounded section utility and its ownership/inheritance limits are recorded in
[section and page-setting evidence](../docx/sections-page-settings.md). It does
not complete the live section model or pagination. The later bounded
[header/footer story evidence](../plans/docx-header-footer-stories.md) records
noncreating reads, explicit local/shared edits and binding removal. General
image editors and the complete live model remain pending. The bounded
[table construction milestone](../plans/docx-table-construction.md) now adds
rectangular table insertion and typed table/row/cell formatting. The bounded
[table editing milestone](../plans/docx-table-editing.md) adds logical table
inspection, selected cell values/formatting and explicit rectangular row/column
insertion/deletion. The bounded [merged-cell milestone](../plans/docx-merged-cells.md)
adds explicit content-preserving merge/split and row deletion through spans.
Live table owners remain pending.

The bounded [hyperlink milestone](../plans/docx-hyperlinks.md) adds `links list`,
`links add`, `links set` and `links remove` through the shared CLI/SDK engine.
Removal unwraps visible label runs by default; `deleteContent: true` explicitly
deletes the label. Shared-story mutation and the live hyperlink model remain pending.

The bounded [cached-field milestone](../plans/docx-fields.md) adds `fields list`
and `fields set` through the shared CLI/SDK engine. It inventories simple, complex
and nested fields and edits supported cached results without execution, preserving
instructions, run formatting and omitted flags. Field creation, outer nested-result
replacement, shared-story editing and the live model remain pending. The bounded
`FieldListData` reports instruction keyword `kind`, simple/complex `form`, exact
decoded `instruction`, cached `result`, `update`, `locked`, `nested` child locations
and each owner `location`; it is separate from the full proposed ResourceDetails.

The later [bounded TOC/caption structure milestone](../plans/docx-toc-caption-structures.md)
adds fields.add, toc.add/set and captions.add/set, plus typed field instruction
edits. It preserves unselected caches and supports static caption labels. Creation
uses simple fields; complex/nested existing fields remain inspectable and editable
within the recorded boundaries. Shared stories, nested instruction replacement,
outer nested-cache replacement, field batches and live field models remain pending.
No page numbers, sequence counters or TOC entries are recalculated.

The bounded [footnote/endnote milestone](../plans/docx-notes.md) implements
notes.list/get/add/set/remove with explicit shared-reference and storage-ID
policies. Numbering/restart settings are preserved and inspected without layout.
Rich bodies reuse scoped story editors; whole-note text assignment rejects
affected tables/images/fields/opaque content. This is utility coverage, not a
new live model or note batch executor.

The bounded [classic-comment milestone](../plans/docx-comments.md) implements
comments.list/get/add/set/remove with explicit identity/time, run-boundary body
anchors, consistency checks and targeted marker/body deletion. Its snapshot
CommentReadData uses comment_id and stored timestamp strings; the proposed live
Comment model retains its Date-valued timestamp. The later
[comment extension milestone](../plans/docx-comment-extensions.md) inventories
modern parts/IDs and adds verified single-paragraph text retention and synchronized
removal. Opaque affected metadata and orphaned replies reject; thread authoring
remains unsupported.
Comment batches, cross-paragraph anchor creation and live model owners remain pending.

The bounded [revision read milestone](../plans/docx-revision-read-views.md) adds
revision inventory, direct run/paragraph property snapshots for original view,
current/original formatting context in all view, and explicit opaque metadata.
Its snapshot IDs/authors/times retain nullable stored strings. Ordinary unrelated
edits preserve review markup; affected unsafe range/removal boundaries reject.
Tracked creation, acceptance/rejection, revision batches and live owners remain
pending. This supersedes the earlier text-read limitation on property history
only for the supported direct snapshots.

The bounded [inert object milestone](../plans/docx-inert-objects.md) implements
`objects.list` and `objects.extract`: OLE/package bindings, shared owner and preview
metadata, exact VFS payload extraction and redacted security reports. Object
inventory without selectors is package-global; explicit story/owner selectors
narrow stored occurrences. Embedded binaries remain opaque and previews remain
preserved. This does not implement live owners, object batches, activation or
whole-public-API coverage.

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
content. Tests MUST assert this contract and the document-format standards using
original wording and authored in-memory assets. Behavioral cases discovered in
other test suites MUST be adapted as required by section 11, including their
meaningful parameter boundaries. Adaptation MUST NOT copy project identities,
incidental mock mechanics or binary fixtures into the product. Contract-based
language, security and correctness differences require explicit original
acceptance cases; they are not grounds to discard applicable behavior.

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

| Source                                                                                                                                    | Baseline                                    | Application                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ECMA-376 Part 1                                                                                                                           | Fifth edition, December 2016                | Fundamentals; WordprocessingML; shared markup including DrawingML and mathematical content.                 |
| ECMA-376 Part 2                                                                                                                           | Fifth edition, December 2021                | Open Packaging Conventions, part names, content types, relationships and package signatures.                |
| ECMA-376 Part 3                                                                                                                           | Fifth edition, December 2015                | Markup compatibility, ignorable namespaces and alternate content.                                           |
| ECMA-376 Part 4                                                                                                                           | Fifth edition, December 2016                | Transitional migration markup and legacy compatibility structures.                                          |
| [MS-DOCX](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/b839fe1f-e1ca-4fa6-8c26-5954d0abbccd)                      | Revision 23.0, v20260818, August 18, 2026   | Word extensions including controls and modern annotation metadata; separate from the base standard.         |
| [MS-ODRAWXML](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/06cff208-c6e1-4db7-bb68-665135e5f0de)              | Revision 34.0, v20260217, February 17, 2026 | Drawing extensions including Word shapes/groups, SVG references and decorative metadata; separately pinned. |
| [Microsoft markup compatibility guidance](https://learn.microsoft.com/en-us/office/open-xml/general/introduction-to-markup-compatibility) | Supporting implementation guidance          | Alternate-content selection and application-version compatibility; does not replace the standard.           |

The standards audit MUST record actual section numbers, namespace URIs, schema
types and revision identifiers for each implemented family. An unverified section
number MUST NOT be invented. The implementation MUST NOT imply ECMA/ISO
certification merely because its scoped validator passes.

The [standards coverage register](../docx/standards-coverage.md) maps F01–F50 to
reviewed sections, namespaces, schema declarations and explicit unsupported
subfeatures. The [source manifest](../docx/standards-sources.json) pins exact
download bytes and schema hashes. These are research evidence, not implemented
support. Unknown extensions MUST remain opaque where preservation is safe;
operations requiring unverified extension semantics MUST reject affected edits.

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

| ID  | Feature family                | Required target behavior                                                                                                                                                                  |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | ZIP/OPC                       | Bounded stored/deflated read/write, CRC validation, safe names, content types and relationship graph. ZIP64 read within limits; reject multi-disk/encrypted archives.                     |
| F02 | Strict and Transitional       | Detect both, read both, edit supported structures in the original dialect. No silent dialect conversion.                                                                                  |
| F03 | Macro-free templates          | Read/create/edit `.docx` and macro-free `.dotx` with explicit output kind and correct content type. Reject macro-enabled mutations.                                                       |
| F04 | XML fidelity                  | Namespace-aware edits; retain unknown unmodified subtrees, attributes, comments, processing instructions, order and meaningful whitespace.                                                |
| F05 | Markup compatibility          | Handle `mc:Ignorable`, `MustUnderstand`, `ProcessContent` and `AlternateContent` according to a declared understood-namespace profile; preserve unselected branches.                      |
| F06 | Package inspection            | Parts, content types, relationship edges, properties, signatures, protected/unsupported content and structural counts.                                                                    |
| F07 | XML access                    | Raw part bytes, bounded pretty display and a validated explicit XML-part replacement operation; never regex-based editing.                                                                |
| F08 | Text extraction               | Body and explicit story scopes, paragraphs, runs, tabs, breaks, lists, tables and field results with stable locations.                                                                    |
| F09 | Unicode and language          | Lossless Unicode, RTL/bidirectional and East Asian properties, locale/font metadata and combining characters. No visual-order reshaping in logical text.                                  |
| F10 | Literal replacement           | Cross-run matching within explicit structural boundaries; exact first/all/occurrence selection; preserve outside text and formatting.                                                     |
| F11 | New documents                 | Create a minimal valid document or populate a supplied template from typed structured content.                                                                                            |
| F12 | Run formatting                | Bold, italic, underline, strike, size, font references, color/theme references, highlight, language, baseline/superscript and hidden-text properties.                                     |
| F13 | Paragraph formatting          | Alignment, indentation, spacing, tabs/leaders, borders/shading, keep/widow controls, page/column breaks and outline level.                                                                |
| F14 | Styles and themes             | Inspect/reuse/create/edit paragraph, character and table styles; inheritance, defaults and linked styles; preserve theme resources and unknown settings.                                  |
| F15 | Headings                      | Level 0 creates a title; levels 1–9 use valid paragraph/outline styles; avoid overwriting colliding user styles.                                                                          |
| F16 | Sections and pages            | Page size/orientation/margins, columns, section breaks, page-number metadata, first/even/odd header/footer bindings and inherited sections.                                               |
| F17 | Headers and footers           | Scoped read/edit/create with explicit link-to-previous/shared-part behavior.                                                                                                              |
| F18 | Lists                         | Multilevel ordered/bulleted lists, restart/start overrides, numbering styles and scoped ID allocation; preserve picture-bullet resources.                                                 |
| F19 | Tables                        | Create/read/edit rows/cells and formatting, grid widths, header repetition, row splitting, nesting and cell margins.                                                                      |
| F20 | Merged tables                 | Resolve horizontal/vertical spans, target logical cells, explicit merge/split, validate rectangular grids and reject ambiguous coordinates.                                               |
| F21 | Links and bookmarks           | Internal/external hyperlink relationships, safe schemes, bookmark ranges/names and explicit rename/removal reference policy.                                                              |
| F22 | Fields and references         | Simple/complex/nested field inventory; set displayed results without execution; create bounded PAGE/NUMPAGES/REF/PAGEREF/SEQ/TOC fields and update flags.                                 |
| F23 | TOC and captions              | Create/edit TOC field structures, figure/table captions and cross-reference relationships; cached page numbers are not recalculated promises.                                             |
| F24 | Footnotes and endnotes        | Read/insert/edit/remove notes, references and required separators; preserve numbering rules and scoped IDs.                                                                               |
| F25 | Comments                      | Classic comment ranges and bodies; create/edit/delete with explicit author/time; modern/threaded extension inventory and preservation.                                                    |
| F26 | Tracked changes               | Original/final/all read views; create simple text insert/delete revisions; accept/reject supported selected revisions and formatting changes atomically.                                  |
| F27 | Complex review structures     | Move revisions, table/section revisions and unsupported threaded metadata: inventory and preserve; reject affected edits until verified.                                                  |
| F28 | Content controls              | Inspect/fill supported plain/rich text, checkbox, choice, date and picture controls; respect locked states and placeholders.                                                              |
| F29 | Repeating/data-bound controls | Bounded repeat-row/section expansion and explicit supported custom-XML binding synchronization; no arbitrary XPath evaluation or silent detachment.                                       |
| F30 | Document properties           | Core/extended/custom typed properties and explicit removal; preserve unrelated metadata.                                                                                                  |
| F31 | Image inventory               | Inline/floating image locations, owners, relationships, media type/bytes, dimensions, crop, rotation, wrapping and alt text.                                                              |
| F32 | Raster insertion/replacement  | Documented API image-format coverage, including PNG/JPEG/GIF/BMP/TIFF with bounded header/dimension/DPI admission; occurrence versus shared-resource replacement and aspect-ratio sizing. |
| F33 | Floating image layout         | Read/edit anchor coordinates, relative frames, wrap mode, z-order, crop, rotation/flips and decorative/alt metadata without claiming rendered geometry.                                   |
| F34 | Other media formats           | Preserve and extract original GIF/BMP/TIFF/EMF/WMF/WDP/SVG bytes and fallback relationships; no native decoding or conversion.                                                            |
| F35 | SVG and alternate graphics    | Inventory/preserve SVG plus raster fallback; insertion requires supplied admitted SVG and explicit fallback. Reject external references/scripts; do not rasterize.                        |
| F36 | Shapes and text boxes         | Inspect/preserve DrawingML/VML shapes; edit supported text-box story text without changing geometry; grouped/unsupported geometry stays opaque.                                           |
| F37 | Charts                        | Inventory chart type/series/cached values and embedded-workbook bindings; preserve chart/workbook bytes on unrelated edits. No formula engine or chart rendering.                         |
| F38 | SmartArt and diagrams         | Inventory graph/data/layout parts and preserve them. No diagram layout generation.                                                                                                        |
| F39 | Equations                     | Inventory and preserve OMML; insert/replace validated bounded OMML fragments explicitly. No implied LaTeX conversion or math evaluation.                                                  |
| F40 | Embedded OLE/packages         | Inventory and preserve inert objects/relationships; explicit bounded extraction only. Never activate embedded content.                                                                    |
| F41 | Custom XML and glossary       | Inventory/preserve custom XML, bindings, glossary/building-block and ancillary parts; typed values use controls bind, raw replacement uses validated xml set.                                                             |
| F42 | Settings/fonts/protection     | Inspect/preserve compatibility, document settings and embedded fonts; respect editing protection. No password cracking or font installation.                                              |
| F43 | Signatures                    | Detect/list signature parts; default mutation rejection. An explicit strip-signatures operation removes the signature graph before edits; never claim signatures remain valid.            |
| F44 | Removal                       | Exact range/structure removal with reference checks; retain shared resources and required empty containers.                                                                               |
| F45 | Dummy text                    | Seeded deterministic replacement of selected visible text; not an anonymization guarantee.                                                                                                |
| F46 | Sanitization                  | Explicit, enumerated removal of selected properties/comments/revisions/links/embedded objects, with an exact report; never an unqualified privacy guarantee.                              |
| F47 | Batch and templates           | Versioned typed ordered operations, bounded record expansion and one final publication; no eval or document-supplied code.                                                                |
| F48 | Comparison                    | Part-payload and semantic XML/text/structure diff; distinguish data differences from serialization changes.                                                                               |
| F49 | Validation                    | Scoped OPC, XML and cross-part semantic diagnostics with an honest schema/profile report.                                                                                                 |
| F50 | Extract/pack                  | Safe VFS extraction and reconstruction with validated inventories and no host utility fallback.                                                                                           |

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

Classic comments expose read-only `comment_id: number` and
`timestamp: Date | null`; the utility MUST NOT add `id`/`date` aliases from
inconsistent guide examples. Missing `Comments.get(comment_id)` returns `null`.

DOCX-specific families include `paragraphs`, `runs`, `styles`, `sections`,
`headers`, `footers`, `lists`, `bookmarks`, `fields`, `toc`, `captions`,
`revisions`, `controls` and `lorem`. Use resource/action paths, including
`paragraphs add`, `paragraphs set`, `runs set`, `revisions accept` and `revisions
reject`. Shared collections are `images`, `tables` and `properties`; there are
no singular or metadata aliases. Exact format-only flags belong in this spec
and its machine-readable register.

Text defaults to the main body. Header/footer/note/comment/text-box scopes are
explicit; all-story order follows section 6.3 with deterministic owner traversal and
shared-part deduplication. Final/original/all revision views
retain their distinct semantics.

Both tools use ordinary exit statuses 0/1/2/3/4/130 as defined by the shared
contract. For `diff`, 0 means equal, 1 means different, 2 means comparison trouble,
and 130 means cancellation. A successful difference is not an SDK exception.

### 6.1 Lexical grammar

This section defines product choices, not requirements imposed by the file
format. The shared contracts take precedence; this section supplies DOCX-specific
arguments and effects. The [command register](../docx/command-coverage.json)
records these declarations and their acceptance associations. It is an evidence
register subordinate to this single specification, not a second contract.

```text
docx create [OPTIONS]
docx PATH INPUT [OPTIONS]
docx diff LEFT RIGHT [OPTIONS]
docx pack INVENTORY [OPTIONS]
docx help [COMMAND PATH] [--operation OPERATION_ID] [--json]
docx schema [COMMAND PATH] [--operation OPERATION_ID] [--json]
docx capabilities [INPUT] [--json] [--limit NAME=VALUE ...]
docx version [--json]
```

`PATH` is exactly a direct path in section 6.4. All paths are case-sensitive.
Options follow the complete path, before or after input; `--` stops parsing.
`--name=value` and `--name value` are equivalent for value options; empty values
are preserved for schema validation. `-o PATH` and `-o=PATH` mean `--output PATH`;
short-option clusters and attached `-oPATH` are not accepted. Presence switches
accept no value. Property booleans such as `--bold` require `true`, `false`, or
`null` where their type admits it; they are not presence switches. Numeric input
uses finite decimal notation without surrounding whitespace; counts and IDs
require safe integers. JSON numbers are never coerced from strings.

`docx text INPUT` is exactly `docx text get INPUT`, including result operation
`text.get`. `docx`, `docx help`, `docx --help` and `docx -h` display root help.
`docx PATH --help` or `-h` selects that path's help without acquiring input.
Discovery preflight still rejects unknown paths/options and repeated scalar
options; it waives only required operational values/input. `docx --version`
means `docx version`; combining version and help or placing version on an edit
path is `usage`. Unknown discovery paths/IDs fail; they do not read filenames.
`help batch --operation ID` and `schema batch --operation ID` address one closed
batch discriminator. A conflicting path/ID pair fails. `schema` always emits the
structured schema result; `--json` is redundant and accepted there.

No other compatibility aliases exist. In particular top-level `replace`,
`image`, `table`, `metadata`, `edit`, `update`, `unpack`, `raw-xml`, and
`strip-signatures` reject with `usage`; the corresponding declared paths are
`text replace`, `images`, `tables`, `properties`, `extract`, `xml get` and
`signatures remove`. `--allow-missing`, `--overwrite`, `--input` and
`--inventory` reject. Model `table_direction` is retained; the direct operation
argument `direction` is a separate documented option, not a model alias.

### 6.2 Input, output and option precedence

The CLI MUST first resolve discovery/path, then validate arity, scalar repetitions,
closed fields and conflicts, then reserve stdin, acquire bounded sources, admit
packages, resolve selections, stage edits, validate and publish. Failures in an
earlier phase take precedence over later failures. Within argument validation,
report errors in argv order; JSON keys use lexical order for deterministic errors.
There is no last-option-wins rule or environment fallback.

Exactly one positional input is required for ordinary document paths. Omitted
input is `usage` even when stdin has bytes. Literal `-` explicitly consumes stdin.
`diff` requires two inputs and permits `-` on only one side. `pack` takes one
inventory JSON path or `-`, not a document and not an implied directory scan.
Creation has no positional input; its optional template is `--template PATH`.
An empty path is invalid. File suffixes do not establish kind or validation;
`kind` must agree with the admitted package content type where no conversion is
specified. No operation silently converts Strict/Transitional or docx/dotx input.

Every auxiliary file flag (`--file`, `--fallback`, `--template`, `--content-file`,
`--data-file`, `--ops-file`) accepts `-`. Across all document and auxiliary
sources there is exactly one stdin consumer. Batches count auxiliary sources in
all items before any read; a JSON VFS path `-` is a literal path, never a hidden
second stdin consumer. SDK streams are explicit capabilities, not string guesses.
JSON sources are UTF-8 (one leading BOM accepted), with no comments/trailing
commas/duplicate keys/nonfinite numbers. Null top-level envelopes reject.

| Combination                                                        | Required result                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `--ops-json` plus `--ops-file`, or neither on batch                | `usage`; no precedence/merge                                                         |
| `--data-json` plus `--data-file`, or neither on template/repeat    | `usage`                                                                              |
| Both create content sources                                        | `usage`; neither means empty supplied content                                        |
| Direct flags and a JSON source                                     | Only the sources declared for that command are legal; no general `--json` input mode |
| `--output` plus `--in-place`                                       | `usage`, including dry-run                                                           |
| Mutation without either destination                                | `usage`, except dry-run or read/value-only batch                                     |
| `--in-place` with stdin, create or pack                            | `usage`                                                                              |
| `--force` without output/output-dir, including with in-place alone | `usage`                                                                              |
| `--output` aliases input, even with force                          | `conflict`; require in-place instead                                                 |
| Existing output without force                                      | `conflict`; source/destination unchanged                                             |
| `--output -` plus JSON                                             | `usage`, except dry-run reports JSON only                                            |
| `--raw` plus `--json` or `--pretty` on XML get                     | `usage`; raw and pretty are inapplicable elsewhere                                   |
| `--pretty --json` on XML get                                       | Pretty text inside XmlData; never raw stdout                                         |
| `--output` on a read command                                       | `usage`; use shell redirection for read stdout                                       |
| `--allow-partial-output` outside multi-file extraction             | `usage`                                                                              |

Read/list/get commands return data; mutation summaries go to stdout unless the
package itself occupies stdout. `--json` selects the shared envelope. In-place
implies only source replacement, never permission to bypass protection. Force
with output `-` rejects because no existing file can be replaced. Dry-run validates
supplied destination syntax, identity and capabilities but never stages a sink.
A read-only batch with publication flags rejects as inapplicable; documented
creating getters make it a mutating batch. Extraction always requires output-dir,
rejects package-output flags, and reports a manifest under the shared transaction
or explicit partial-output rule.

The switch defaults are false. No output, force, shared intent, author identity,
timestamp, seed, or selection cardinality is implicitly chosen. An absent optional
edit value leaves state unchanged; creation defaults below apply only to new
objects. At least one effect field is required for `set`; selector/publication
flags do not count. Empty `arguments:{}` is valid only when no arguments are
required. `--allow-empty` permits no matching mutation targets, not a missing
selector, missing effect, invalid field, or an unsupported edit.

### 6.3 Selectors, scopes and location fingerprints

The accepted scopes are `body`, `headers`, `footers`, `footnotes`, `endnotes`,
`comments`, `text-boxes`, `all-stories`. A scope is a story set, not an XML query.
Text and ordinary body resources default to body. A dedicated resource command
implicitly selects its own resource owners: headers/footers across sections,
notes of the selected kind, comments in the comments part; style/section/settings/
font/property/signature/custom-XML/glossary inventories are package-global.
`inspect` inventories the whole package without narrowing its package census;
selectors narrow its location details. `extract` always extracts the full package
and rejects selectors. Global resources reject scope unless it actually restricts
story-owned occurrences. Explicit `--scope body` on headers is inapplicable;
`headers` or `all-stories` are compatible. No empty body default hides review
or header resources from their own list commands.

Story order is body first, then headers, footers, footnotes, endnotes, comments,
text boxes. Header/footer order is section order then default/first/even, with
shared part identities deduplicated at first visit. Notes/comments use numeric
ID order (separator notes excluded from text); text boxes use owning-story XML
document order, recursively, with visited-node guards. Remaining inventory-only
parts use canonical part-name Unicode code-point order. Relationships within an
owner use XML order, with ID code-point order as a tie-breaker. A shared occurrence
list keeps all references; story text visits each unique story once.

Simple selectors are positive one-based ordinals: `--section`, `--paragraph`,
`--run`, `--table`, `--image`, `--comment`, `--note`, `--link`, `--control`,
`--revision`, `--shape`, `--field`, `--bookmark`. They are positions, never stored
IDs. `--cell B2` uses uppercase ASCII column letters and a positive row; both
coordinates are one-based. Merged slots resolve to their owner for reads. Scalar
cell writes through covered coordinates require explicit `covered: owner`; the
owner coordinate/token is already unambiguous. A range that partly intersects a
merge fails `ambiguous-selection`. Explicit split targets the whole logical owner.

Valid owner chains are section → selected story → table → cell → paragraph → run,
or story → paragraph → run; image/link/control/revision/shape/field/bookmark may
select a descendant occurrence within that owner. Notes/comments select their
own story; header/footer get/set/remove require section and variant (default below).
At most one selector of each kind occurs; unrelated/sibling chains fail usage.
A table selector without cell targets the table; text on `tables set` requires
cell. Run selection requires paragraph. Descendant indexes use document order
inside the resolved owner, including nested tables, not package-wide counters.
Commands exposing a named resource (`styles --name`, `properties --name`) use
that key alone and reject opaque/ordinal selection. Named lookup is exact and
case-sensitive; duplicate applicable names fail with bounded candidates.

`get`, `set`, `remove`, `replace`, merge/split and targeted review actions require
one resource unless explicit `--all` is allowed. Lists/extracts allow no selection
and return every matching item in scope. `--all` is allowed for text replacement,
resource set/remove, revisions accept/reject and lorem; it conflicts with a target
ordinal or token, except text cardinality may apply inside a selected owner.
Add commands use a selected container or the unique body; they do not silently
choose one of multiple headers/cells. Paragraph add appends to the owner unless
a paragraph anchor is supplied, when it inserts after it (`--before` reverses). Before without a paragraph anchor is usage.
Inline add commands append inside the selected paragraph; range operations require
a fingerprinted range token. No hidden first-paragraph default is used.

`--select` MUST use `docx-loc-v1.` followed by unpadded base64url of UTF-8 JSON
with keys serialized in the following order and no extra whitespace:

```typescript
type LocationPayload = {
  version: 1;
  sourceSha256: string; // 64 lowercase hex digits: exact admitted archive bytes
  generation: number; // safe nonnegative staged mutation counter
  part: string; // canonical absolute OPC part name
  story: string; // owner part plus story-local identifier from inspection
  path: number[]; // zero-based element-child indexes from part root; [] is root
  range: { start: number; end: number } | null; // half-open logical Unicode scalars
};
```

All keys are required. The prefix, encoding, hash, generation and schema are
validated before node resolution. Malformed token is `usage`; a different hash,
generation, owner, path or out-of-date range is `stale-selection`. Paths are not
XPath; only element-child indexing is allowed. Range offsets refer to the logical
text map in section 9, counting scalars, not UTF-16 code units, and cannot cross
its barriers. Comments require run-boundary endpoints. A token must carry a valid
story owner even for a part-root selection. Package resources use their part name
as story ID. Tokens are guards, not authority or authentication credentials.

Fresh admission has generation zero. Each successful operation that changes the
staged document increments generation once; reads and no-change mutations do not.
A batch resolves later tokens against the current generation, so tokens from its
original input become stale after an edit. Use simple selectors resolved in array
order or preceding typed result handles for later edits. Model handles retain
owner/node semantics and survive unrelated changes as specified in section 9.2;
they are not immutable CLI location tokens. Published output has a fresh archive
fingerprint on next admission. No fuzzy reattachment or force override is allowed.
Tokens cannot be mixed with simple selectors or explicit scope (owner already
encoded). Inspection emits both location tokens and readable owner/position data.

### 6.4 Exhaustive direct operation register

Each row below is one public path; spaces convert to dots for the SDK operation
ID. `!` means required, `?` optional. Field names are JSON argument keys; CLI flags
are their mechanical kebab-case spelling with `--`. Types are closed unions;
`Length` is positive/nonnegative according to the target and uses explicit shared
units. Enum symbols/setter subsets are the complete neutral declarations in the
[public surface register](../docx/public-api-map.json), including inherited members,
helpers and aliases. No arbitrary strings/numbers substitute for enums.

Profiles are compositional applicability rules, not permission to ignore flags:
`read` allows json/limit; `selectedRead` adds section 6.3 selection/scope;
`edit` adds output/inPlace/force/dryRun/allowEmpty to read; `equationEdit` adds
only required select to edit, with the exact applicability in section 6.5.4;
`selectedEdit` adds
valid selection and explicit supported all; `create` allows json/limit/output/
force/dryRun/timestamp/author; `extract` allows json/limit/outputDir/force/
allowPartialOutput and applicable resource selection; `batch` allows json/limit/
output/inPlace/force/dryRun/timestamp/author; `discovery` allows json only.
Pack excludes timestamp/author; capabilities additionally allows limit. The
conditional rules in sections 6.2–6.5 narrow these profiles. None is a promise
that all selectors apply to every row.

All rows take INPUT except create, diff (LEFT RIGHT), pack (INVENTORY), help/schema
(optional path/operation ID), capabilities (optional INPUT) and version (none).
`text` is the sole path shorthand. The result column names `data`, not a second
envelope. Every row's acceptance ID is `command.` plus its dotted path, with its
F-IDs in the last column; those cases MUST compare actual CLI/SDK behavior to
independent text/XML/OPC/value assertions, not only to one another.

| Path                    | Profile      | Closed argument keys/types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Result data      | Features                                                                                           |
| ----------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| `create`                | create       | `kind?`: docx / dotx; `dialect?`: strict / transitional; `template?`: VfsInput; `contentFile?`: VfsInput; `contentJson?`: OriginalDocumentContentV1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | MutationData     | F01, F02, F03, F11, F12, F13, F15, F19, F32                                                             |
| `inspect`               | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | InspectionData   | F01, F02, F03, F05, F06, F11, F27, F41, F42                                                        |
| `validate`              | read         | `profile?`: declared understood-namespace profile                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | ValidationData   | F01, F02, F05, F49                                                                                 |
| `text get`              | selectedRead | `view?`: final / original / all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | TextData         | F08, F09, F26, F36                                                                                 |
| `text replace`          | selectedEdit | `find!`: string; `with!`: string; `first?`: boolean; `occurrence?`: positive integer; `view?`: final / original / all; `bold?`: boolean; `italic?`: boolean; `trackChanges?`: boolean; `author?`: string; `timestamp?`: UTC instant                                                                                                                                                                                                                                                                                                                                                                                                              | MutationData     | F02, F04, F05, F10, F26                                                                            |
| `xml get`               | read         | `part!`: string; `pretty?`: boolean; `raw?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | XmlData          | F04, F07                                                                                           |
| `xml set`               | edit         | `part!`: string; `file!`: VfsInput                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | MutationData     | F04, F07                                                                                           |
| `paragraphs list`       | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F08                                                                                                |
| `paragraphs get`        | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceData     | F01, F04, F08, F19                                                                                 |
| `paragraphs add`        | selectedEdit | `text?`: string; `style?`: string; `level?`: integer 0..9; `before?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | MutationData     | F06, F11, F12, F13, F15, F16, F17, F19, F20, F25, F32                                              |
| `paragraphs set`        | selectedEdit | `text?`: string / null; `style?`: string; `alignment?`: WD_PARAGRAPH_ALIGNMENT / null; `leftIndent?`: Length (explicit emu/in/cm/mm/pt) / null; `rightIndent?`: Length (explicit emu/in/cm/mm/pt) / null; `firstLineIndent?`: Length (explicit emu/in/cm/mm/pt) / null; `spaceBefore?`: Length (explicit emu/in/cm/mm/pt) / null; `spaceAfter?`: Length (explicit emu/in/cm/mm/pt) / null; `lineSpacing?`: Length / finite number / null; `keepWithNext?`: boolean / null; `keepTogether?`: boolean / null; `widowControl?`: boolean / null; `pageBreakBefore?`: boolean / null; `outlineLevel?`: integer 0..9 / null; `lineSpacingRule?`: WD_LINE_SPACING / null; `tabStopsJson?`: array of {position: Length, alignment?: WD_TAB_ALIGNMENT, leader?: WD_TAB_LEADER} / null; `bordersJson?`: typed paragraph border sides / null; `shadingJson?`: typed fill/color/pattern / null                         | MutationData     | F08, F12, F13, F14, F15                                                                            |
| `paragraphs remove`     | selectedEdit | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F44                                                                                                |
| `runs list`             | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F08, F19                                                                                           |
| `runs get`              | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceData     | F01, F04                                                                                           |
| `runs add`              | selectedEdit | `text?`: string; `style?`: string; `break?`: line / page / column                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MutationData     | F01, F04                                                                                           |
| `runs set`              | selectedEdit | `text?`: string; `bold?`: boolean / null; `italic?`: boolean / null; `underline?`: boolean / WD_UNDERLINE / null; `strike?`: boolean / null; `size?`: Length (explicit emu/in/cm/mm/pt) / null; `font?`: string / null; `color?`: RGB hex / null; `highlight?`: WD_COLOR_INDEX / null; `language?`: string / null; `hidden?`: boolean / null; `rtl?`: boolean / null; `superscript?`: boolean / null; `subscript?`: boolean / null; additional nullable font-slot/theme/baseline fields in section 6.5                                                                                                                                                                                              | MutationData     | F08, F09, F12, F25, F32                                                                            |
| `runs remove`           | selectedEdit | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F44                                                                                                |
| `styles list` | read | none | StyleInspectionData | F14 |
| `sections list`         | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F16                                                                                                |
| `headers list`          | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | StoryReadData | F01, F04                                                                                           |
| `footers list`          | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | StoryReadData | F01, F04                                                                                           |
| `tables list`           | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F19                                                                                                |
| `links list`            | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F21                                                                                                |
| `bookmarks list`        | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F21                                                                                                |
| `fields list`           | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F22                                                                                                |
| `notes list`            | selectedRead | `kind?`: footnote / endnote | NoteReadData | F24                                                                                                |
| `comments list`         | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F25                                                                                                |
| `controls list`         | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ControlReadData | F28 F29                                                                                                |
| `images list`           | selectedRead | `unique?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | ResourceListData | F31, F34, F35                                                                                      |
| `styles get` | read | `name!`: string | StyleInspectionData | F14 |
| `styles add` | edit | `name!`: string; `type!`: paragraph / character / table / numbering; optional StyleDefinitionFields below | StyleMutationData | F14 |
| `styles set` | edit | `name!`: string; optional StyleDefinitionFields below | StyleMutationData | F12, F14 |
| `styles defaults get` | read | none | StyleInspectionData | F14 |
| `styles defaults set` | edit | optional StyleFormattingFields below | StyleMutationData | F14 |
| `styles latent list` | read | none | StyleInspectionData | F14 |
| `styles latent get` | read | `name!`: string | StyleInspectionData | F14 |
| `styles latent add` | edit | `name!`: string; optional latent entry fields below | StyleMutationData | F14 |
| `styles latent set` | edit | `name!`: string; optional latent entry fields below | StyleMutationData | F14 |
| `styles latent remove` | edit | `name!`: string | StyleMutationData | F14 |
| `styles latent defaults get` | read | none | StyleInspectionData | F14 |
| `styles latent defaults set` | edit | latent default fields below | StyleMutationData | F14 |
| `styles remove`         | selectedEdit | `name!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F14                                                                                                |
| `sections add`          | selectedEdit | `startType?`: WD_SECTION_START                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | MutationData     | F06, F11, F16                                                                                      |
| `sections set` | selectedEdit | `orientation?`: WD_ORIENTATION; `pageWidth?`: Length (explicit emu/in/cm/mm/pt); `pageHeight?`: Length (explicit emu/in/cm/mm/pt); `topMargin?`: Length (explicit emu/in/cm/mm/pt); `bottomMargin?`: Length (explicit emu/in/cm/mm/pt); `leftMargin?`: Length (explicit emu/in/cm/mm/pt); `rightMargin?`: Length (explicit emu/in/cm/mm/pt); `columns?`: positive integer; `pageNumberStart?`: nonnegative integer; `differentFirstPage?`: boolean; `gutter?`: Length (explicit emu/in/cm/mm/pt); `headerDistance?`: Length (explicit emu/in/cm/mm/pt); `footerDistance?`: Length (explicit emu/in/cm/mm/pt); `startType?`: WD_SECTION_START; `columnGap?`: Length (explicit emu/in/cm/mm/pt); `columnSeparator?`: boolean; `pageNumberFormat?`: decimal / upperRoman / lowerRoman / upperLetter / lowerLetter; `evenAndOddHeaders?`: boolean | MutationData | F16                                                                                                |
| `headers get`           | selectedRead | `variant?`: default / first / even                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | StoryReadData     | F17                                                                                                |
| `headers set`           | selectedEdit | `variant?`: default / first / even; `text?`: string; `linkToPrevious?`: boolean; `shared?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | StoryEditData     | F16, F17                                                                                           |
| `headers remove` | selectedEdit | `variant?`: default / first / even | StoryEditData | F16, F17 |
| `footers get`           | selectedRead | `variant?`: default / first / even                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | StoryReadData     | F17                                                                                                |
| `footers set`           | selectedEdit | `variant?`: default / first / even; `text?`: string; `linkToPrevious?`: boolean; `shared?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | StoryEditData     | F17                                                                                                |
| `footers remove` | selectedEdit | `variant?`: default / first / even | StoryEditData | F16, F17 |
| `lists add`             | selectedEdit | `kind!`: bullet / decimal / lowerLetter / upperLetter / lowerRoman / upperRoman; `level?`: integer 0..8; `start?`: integer; `text?`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                | MutationData     | F18                                                                                                |
| `lists set`             | selectedEdit | `level?`: integer 0..8; `start?`: integer; `restart?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | MutationData     | F18                                                                                                |
| `tables get`            | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceData     | F19, F20                                                                                           |
| `tables add` | selectedEdit | `rows!`, `cols!`: positive integers; `width?`, `rowHeight?`, `cellMargin?`: Length; `style?`: string; `autofit?`, `repeatHeader?`, `allowRowSplit?`, `before?`: boolean; `headerRows?`: nonnegative integer; `heightRule?`: WD_ROW_HEIGHT_RULE; `columnWidthsJson?`: Length[]; `bordersJson?`: TableBorders; `shadingJson?`: Shading; `rowOptionsJson?`: TableRowOptions[]; `contentFile?` / `contentJson?`: OriginalDocumentContentV1 | MutationData | F19 |
| `tables set`            | selectedEdit | `text?`: string; `style?`: string; `width?`: Length (explicit emu/in/cm/mm/pt); `autofit?`: boolean; `alignment?`: WD_TABLE_ALIGNMENT / null; `direction?`: WD_TABLE_DIRECTION / null; `repeatHeader?`: boolean; `allowRowSplit?`: boolean; `cellMargin?`: Length (explicit emu/in/cm/mm/pt); `covered?`: reject / owner | MutationData     | F19, F20                                                                                           |
| `tables rows add`       | selectedEdit | `index?`: positive integer; `width?`: Length (explicit emu/in/cm/mm/pt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MutationData     | F19                                                                                                |
| `tables rows remove`    | selectedEdit | `index!`: positive integer; `join?`: paragraphs / reject | MutationData     | F19                                                                                                |
| `tables columns add`    | selectedEdit | `index?`: positive integer; `width?`: Length (explicit emu/in/cm/mm/pt)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MutationData     | F19                                                                                                |
| `tables columns remove` | selectedEdit | `index!`: positive integer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | MutationData     | F19                                                                                                |
| `tables merge`          | selectedEdit | `from!`: string; `to!`: string; `join!`: paragraphs / reject | MutationData     | F20                                                                                                |
| `tables split`          | selectedEdit | `rows!`: positive integer; `cols!`: positive integer; `distribute!`: anchor / paragraphs | MutationData     | F20                                                                                                |
| `tables remove`         | selectedEdit | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F44                                                                                                |
| `links add`             | selectedEdit | `text!`: string; `target?`: string; `bookmark?`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MutationData     | F21                                                                                                |
| `links set`             | selectedEdit | `target?`: string; `bookmark?`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | MutationData     | F21                                                                                                |
| `links remove`          | selectedEdit | `deleteContent?`: boolean (default false; presence switch `--delete-content`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F21                                                                                                |
| `bookmarks add`         | selectedEdit | `name!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F21                                                                                                |
| `bookmarks set`         | selectedEdit | `name!`: string; `references!`: update / reject                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F21                                                                                                |
| `bookmarks remove`      | selectedEdit | `references!`: remove / reject                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | MutationData     | F21                                                                                                |
| `fields add`            | selectedEdit | `kind!`: PAGE / NUMPAGES / REF / PAGEREF / SEQ / TOC; `target?`: string; `result?`: string; `update?`: boolean; `levels?`: bounded range 1..9 | MutationData     | F22                                                                                                |
| `fields set`            | selectedEdit | `result?`: string; `update?`: boolean; `kind?`: PAGE / NUMPAGES / REF / PAGEREF / SEQ / TOC; `target?`: string; `levels?`: bounded range 1..9 | MutationData     | F22                                                                                                |
| `toc add`               | selectedEdit | `levels?`: bounded range 1..9; `title?`: string; `result?`: string; `update?`: boolean | MutationData     | F23                                                                                                |
| `captions add`          | selectedEdit | `label!`: string; `text!`: string; `sequence?`: string; `result?`: string; `update?`: boolean; `static?`: boolean | MutationData     | F23                                                                                                |
| `toc set`               | selectedEdit | `text?`: string; `update?`: boolean; `levels?`: bounded range 1..9 | MutationData     | F23                                                                                                |
| `captions set`          | selectedEdit | `text?`: string; `update?`: boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | MutationData     | F23                                                                                                |
| `notes get`             | selectedRead | `kind?`: footnote / endnote | NoteReadData | F24                                                                                                |
| `notes add`             | selectedEdit | `kind!`: footnote / endnote; `text?`: string; `renumber?`: preserve / document-order | NoteEditData | F24                                                                                                |
| `notes set`             | selectedEdit | `kind?`: footnote / endnote; `text!`: string; `shared?`: boolean | NoteEditData | F24                                                                                                |
| `notes remove`          | selectedEdit | `kind?`: footnote / endnote; `reference?`: positive integer; `references?`: single / all; `renumber?`: preserve / document-order | NoteEditData | F24                                                                                                |
| `comments get`          | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceData     | F25                                                                                                |
| `comments add`          | selectedEdit | `text?`: string; `author!`: string; `timestamp!`: UTC instant; `initials?`: string / null                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | MutationData     | F06, F11, F25                                                                                      |
| `comments set`          | selectedEdit | `text!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F25                                                                                                |
| `comments remove`       | selectedEdit | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F25                                                                                                |
| `revisions list`        | selectedRead | `view?`: final / original / all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ResourceListData | F26, F27                                                                                           |
| `revisions add`         | selectedEdit | `kind!`: insert / delete; `text?`: string; `author!`: string; `timestamp!`: UTC instant                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | MutationData     | F26                                                                                                |
| `revisions accept`      | selectedEdit | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F26                                                                                                |
| `revisions reject`      | selectedEdit | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F26                                                                                                |
| `controls set`          | selectedEdit | `text?`: string; `checked?`: boolean; `choice?`: string; `date?`: UTC date; `file?`: VfsInput                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | MutationData     | F28                                                                                                |
| `controls repeat`       | selectedEdit | `dataFile?`: VfsInput; `dataJson?`: ReadonlyArray<DeclaredControlRecord>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | MutationData     | F29                                                                                                |
| `controls bind`         | selectedEdit | `binding!`: declared binding ID; `valueJson!`: DeclaredBindingValue                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | MutationData     | F29                                                                                                |
| `properties list`       | read         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F30                                                                                                |
| `properties get`        | read         | `name!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | ResourceData     | F30                                                                                                |
| `properties set`        | edit         | `name!`: string; `value!`: typed scalar; `type?`: string / boolean / integer / number / date                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | MutationData     | F30                                                                                                |
| `properties remove`     | edit         | `name!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F30                                                                                                |
| `images get`            | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceData     | F31, F33                                                                                           |
| `images add`            | selectedEdit | `file!`: VfsInput; `width?`: Length (explicit emu/in/cm/mm/pt); `height?`: Length (explicit emu/in/cm/mm/pt); `fit?`: contain / cover / stretch; `placement?`: inline / floating; `fallback?`: VfsInput; `alt?`: string; `decorative?`: boolean                                                                                                                                                                                                                                                                                                                                                                                    | MutationData     | F06, F08, F11, F12, F31, F32, F35                                                                  |
| `images replace`        | selectedEdit | `file!`: VfsInput; `shared?`: boolean; `width?`: Length (explicit emu/in/cm/mm/pt); `height?`: Length (explicit emu/in/cm/mm/pt); `fit?`: contain / cover / stretch; `fallback?`: VfsInput                                                                                                                                                                                                                                                                                                                                                                                                                 | MutationData     | F32, F35                                                                                           |
| `images set`            | selectedEdit | `x?`, `y?`: signed32-EMU Length; `horizontalRelativeFrom?`: native horizontal frame; `verticalRelativeFrom?`: native vertical frame; `horizontalAlignment?`, `verticalAlignment?`: axis-native alignment; `relativeTo?`: page / margin / insideMargin / outsideMargin; `wrap?`: none / square / tight / through / top-bottom; `wrapText?`: bothSides / left / right / largest; `wrapPolygonJson?`: ImageWrapPolygon; `distanceTop?`, `distanceBottom?`, `distanceLeft?`, `distanceRight?`: unsigned32-EMU Length; `allowOverlap?`, `behindText?`, `lockAspect?`: boolean; `zOrder?`: integer 0..4294967295; `cropLeft?`, `cropRight?`, `cropTop?`, `cropBottom?`: fraction 0..1; `rotation?`: finite degrees -360..360; `flipHorizontal?`, `flipVertical?`: boolean; `alt?`: string; `decorative?`: boolean; `width?`, `height?`: positive Length <=2147483647 EMU; `fit?`: contain / cover / stretch | MutationData     | F33                                                                                                |
| `images extract`        | extract      | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ExtractionData   | F31, F34                                                                                           |
| `shapes list`           | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F36                                                                                                |
| `charts list` | read | none | ResourceListData | F37 |
| `diagrams list`         | read         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F38                                                                                                |
| `equations list`        | read | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | EquationListData | F39                                                                                                |
| `objects list`          | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F40                                                                                                |
| `signatures list`       | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F43                                                                                                |
| `settings list`         | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F42                                                                                                |
| `fonts list`            | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F42                                                                                                |
| `custom-xml list`       | read         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F41                                                                                                |
| `glossary list`         | read         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F41                                                                                                |
| `shapes set`            | selectedEdit | `text!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F36                                                                                                |
| `equations add`         | equationEdit | `file!`: VfsInput; `select!`: string | MutationData | F39                                                                                                |
| `equations replace`     | equationEdit | `file!`: VfsInput; `select!`: string | MutationData | F39                                                                                                |
| `objects extract`       | extract      | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ExtractionData   | F40                                                                                                |
| `signatures remove`     | edit         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F43                                                                                                |
| `lorem set`             | selectedEdit | `seed!`: safe integer; `words?`: positive integer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MutationData     | F45                                                                                                |
| `sanitize`              | edit         | `remove!`: nonempty unique list: properties / comments / revisions / links / objects; `revisionPolicy?`: accept / reject                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | MutationData     | F46                                                                                                |
| `batch`                 | batch        | `opsFile?`: VfsInput; `opsJson?`: BatchV1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | BatchData        | F01, F11, F47                                                                                      |
| `template apply`        | edit         | `dataFile?`: VfsInput; `dataJson?`: DeclaredTemplateRecord / ReadonlyArray<DeclaredTemplateRecord>                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | MutationData     | F47                                                                                                |
| `diff`                  | read         | `mode?`: parts / xml / text / structure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | DiffData         | F48                                                                                                |
| `extract`               | extract      | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ExtractionData   | F50                                                                                                |
| `pack`                  | create       | `kind?`: docx / dotx                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | MutationData     | F01, F50                                                                                           |
| `help`                  | discovery    | `operation?`: closed operation ID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | HelpData         | F06, F49                                                                                           |
| `schema`                | discovery    | `operation?`: closed operation ID                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | SchemaData       | F01, F04, F06, F08, F11, F12, F13, F14, F15, F16, F17, F19, F20, F21, F25, F30, F31, F32, F42, F49 |
| `capabilities`          | discovery    | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | CapabilitiesData | F01, F04, F06, F08, F11, F12, F13, F14, F15, F16, F17, F19, F20, F21, F25, F30, F31, F32, F42, F49 |
| `version`               | discovery    | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | VersionData      | F06, F49                                                                                           |

For style operations, `StyleFormattingFields` includes the run-formatting and
paragraph-formatting fields described below, including their nullable values,
explicit units and enum symbols. `fontHidden` controls hidden text in a style;
`hidden` controls style-gallery visibility. The additional Font flags are
`allCaps`, `complexScriptEnabled`, `csBold`, `csItalic`, `doubleStrike`, `emboss`,
`imprint`, `math`, `noProof`, `outline`, `shadow`, `smallCaps`, `snapToGrid`,
`specVanish` and `webHidden`. These are nullable booleans. Font-slot
`complexScript` remains a nullable font name. `tabStopAdd` inserts one typed stop,
`tabStopDelete` removes a zero-based stop (negative indices count from the end),
and `tabStopsClear` removes direct stops. These options and `tabStops` replacement
are mutually exclusive. A missing deletion index MUST fail before publication.

`StyleDefinitionFields` additionally includes `base`, `next`, `linkedStyle`
(string or null), `defaultForType` (boolean), `hidden`, `locked`, `quickStyle`,
`unhideWhenUsed` (boolean or null), and `priority` (integer 0–99 or null).
Character styles MUST reject paragraph formatting. Direct `next` requires a
paragraph style. Numbering style creation remains unsupported by direct utility
commands; the live model includes its documented base interface.

The direct latent paths are `styles latent list/get/add/set/remove` and
`styles latent defaults get/set`. Entry get/add/set/remove require `name`.
Entry add/set accepts nullable `hidden`, `locked`, `quickStyle`, `unhideWhenUsed`
and `priority` (integer 0–99). Defaults set accepts strict boolean
`defaultToHidden`, `defaultToLocked`, `defaultToQuickStyle`,
`defaultToUnhideWhenUsed`, nullable `defaultPriority` (integer 0–99) and nullable
`loadCount` (nonnegative safe integer). Entry absence remains null; absent
boolean defaults read false. Inspection MUST NOT materialize missing definitions.

Style operations are package-global and reject scope, ordinal/token selectors and
`allowEmpty`. Their edit profile admits json/limit/output/inPlace/force/dryRun.
Defaults get takes no name; set requires at least one applicable property.
The schema enumerates the exact closed fields and implemented model batch IDs.
Typed batch execution is limited to the declared style/formatting subgraph;
unrelated model operations MUST reject without publication.

### 6.5 Format operation semantics and defaults

The listed fields are exhaustive. A conditional required field missing at
preflight is usage; an admitted document that cannot satisfy it produces the
appropriate semantic error. Unsupported affected content is `unsupported-edit`.

- **Create/validate.** Create defaults to kind docx, Transitional, a body with one
  empty paragraph, portrait US Letter (8.5in × 11in), 1in margins, one column,
  no images/comments/fields, original Normal paragraph style and no implicit
  author/time/application branding. A supplied template retains kind/dialect and
  document content; content blocks append to its body. Explicit conflicting kind
  or dialect fails. New documents accept `--dialect strict|transitional`, mapped
  to SDK `dialect`; omission uses Transitional. With a template, omission retains
  the template dialect. Unknown or null dialect is usage; an explicit conflict
  with a template is unsupported-edit. No suffix inference or whole-document
  dialect conversion is permitted. CLI creation omits dated properties unless timestamp
  supplied; author defaults to empty. Explicit timestamp populates created and
  modified, normalized to UTC seconds. The model factory's documented requirement
  for context when initializing dates is unchanged. `validate --profile core-v1`
  is the sole initial profile/default: OPC safety, XML well-formedness, supported
  WordprocessingML semantic checks and MCE understood namespaces for the supported
  subsets in section 5. The exact namespace list and check IDs below MUST be exposed by
  schema/capabilities; unsupported extensions are reported as unvalidated, never
  blanket schema-certified. Unknown profiles are usage. Invalid diagnostics make
  validation `ok:false`; lack of full-schema coverage is an explicit warning.
- **Text/XML.** Text get/replace view defaults final; original omits inserted
  revisions, final omits deleted revisions, all includes both in XML order and
  records revision kind in JSON segments without inserting labels into plain
  text. Paragraphs join with LF, table cells with TAB and rows with LF, stories
  with two LFs; no extra trailing separator. Tabs/breaks preserve logical order;
  cached page breaks add nothing. Complex unsupported revisions may be read but
  cannot be edited. XML get requires the exact canonical part name and defaults
  to original bytes; `--raw` explicitly locks that representation. Pretty is a
  bounded UTF-8 display transformation only. XML set replaces an existing XML
  part using admitted file bytes, preserving its identity/content type and
  requiring a valid final graph; it cannot add a part, replace binary media or
  bypass namespace/protection/signature checks.
- **Paragraphs/runs/styles.** Add text defaults empty, style inherited/default,
  paragraph before defaults false. Level is absent by default; when supplied
  0 means title and 1–9 headings; style plus level is usage. Whole-text setters
  have section 9.1's destructive semantics. Paragraph null text explicitly clears
  content; run null text rejects. Style names must exist unless creating them.
  A new style requires name/type, defaults base absent and formatting inherited;
  duplicate names reject. Set/remove resolve by exact name; style removal retains
  content and dangling references resolve through the documented fallback.
  Negative indentation is allowed, negative spacing/font size is not; font size
  must be positive. Line spacing accepts an explicit length or positive decimal
  multiple, or nullable reset. Outline level 9 is body text. Superscript and
  subscript cannot both be true. Advanced style/font/tab model operations use
  fixed typed batches; common
  formatting, tab edits and latent settings also have direct flags.
  The bounded `runs set` formatting subset additionally accepts nullable `size`,
  `font` and `language`; `ascii`, `highAnsi`, `eastAsia`, `complexScript` are
  nullable font names, and `asciiTheme`, `highAnsiTheme`, `eastAsiaTheme`,
  `complexScriptTheme` are nullable ThemeFont references. ThemeFont is one of
  majorAscii/majorHAnsi/majorEastAsia/majorBidi or the corresponding minor values.
  `themeColor` is nullable MSO_THEME_COLOR; `baseline` is nullable
  baseline/superscript/subscript. These additive fields use identical direct,
  SDK and proposed batch schemas. Actual batch execution remains pending.
  `font` updates ascii/hAnsi and conflicts with those explicit slots; it retains
  their theme references. Language patches val only. Null clears the named slot
  or property; omitted/undefined fields retain it. False superscript/subscript
  writes explicit baseline, while null removes vertAlign. Baseline cannot combine
  with superscript/subscript. RGB and themeColor are alternative assignments;
  RGB clears theme transforms, theme assignment retains fallback/transforms, and
  null themeColor removes only theme attributes. INHERITED/NOT_THEME_COLOR setter
  sentinels reject; null expresses removal. Font names reject empty/control text.
  Theme/font inspection MUST expose stored schemes, font-table entries, embedding
  bindings, obfuscation metadata, language settings and unresolved references.
  A resolved resource reference MUST NOT imply availability or licensing; both
  remain unknown. Unresolved stored references MAY survive unrelated edits without
  synthesis of resources. Typed token validation precedes acquisition; inventory
  diagnoses missing themes/slots and invalid embedded bindings. Missing physical
  internal targets fail package admission. Embedded font definition or binding
  mutation through XML replacement MUST fail before publication with unsupported-edit
  and a specific embedded-font message, including dry-run.
  Sizes convert to integer EMUs then nearest half-points, halfway away from zero;
  this bounded editor admits 1–3276 half-points. Run/paragraph scalar ranges are
  accepted for formatting only. Partial unsupported run content rejects; unchanged
  formatting does not split. Only selected semantically equivalent adjacent runs
  may merge; markers, opaque content and style/direct-property differences remain
  boundaries. Whole-text assignment remains outside this implemented subset.
- **Style defaults and relationships.** Defaults inspection MUST NOT create a
  styles part. Defaults set materializes it only for an actual change; resetting
  an absent value to null remains a no-op. Base links require matching types and
  acyclic inheritance. Linked paragraph/character styles form reciprocal pairs;
  rebinding clears the old reciprocal edges. Longer link cycles and missing
  references are diagnosed; self-next is valid. Null next restores self fallback.
  Setting a type default clears the previous default of that type. Edits MUST
  preserve unedited latent/style metadata, numbering and theme resources. Heading
  allocation MUST be deterministic and collision-free, preserve custom styles,
  and reuse valid generated identities; a matching name alone is insufficient.
- **Sections/stories.** Section add appends a new section, inheriting current
  geometry; startType defaults NEW_PAGE. Section set does not infer a width/height
  swap from orientation. Margins must leave positive content extent. Columns
  defaults unchanged; explicit count creates equal widths with existing gap or
  0.5in for a previously single-column section, rejecting insufficient space.
  Explicit columnGap sets the nonnegative equal-column gap; columnSeparator sets
  its display flag. Gutter and header/footer distances are nonnegative explicit
  lengths. Section set additionally accepts startType and the closed page-number
  format tokens declared above; these edit metadata without calculating pages.
  differentFirstPage is section-local. evenAndOddHeaders is document-global and
  MUST require all true with no local selector; toggling either policy MUST retain
  all story definitions and bindings. Missing direct geometry MUST remain
  distinguishable from known values; the utility MUST NOT infer blanket geometry
  inheritance from the preceding section. Geometry-dependent edits MUST reject
  when required effective values or isolation from continuous-section page-level
  dependencies cannot be established. Unselected section ownership and bindings
  MUST survive local changes. The final body sectPr and paragraph-owned breaks
  MUST retain their respective ownership.
  Header/footer variant defaults default. Get does not create missing parts.
  Set text on a linked story requires either shared true (edit all owners) or
  linkToPrevious false (clone/materialize and rebind this section). Shared defaults
  false but is not implicit clone consent. Link-to-previous true plus text or
  shared conflicts; linking first section fails. Unlink alone makes a local copy.
  Shared effects report every affected section, including owners outside scope.
  A set MUST include text or linkToPrevious; shared alone is not an effect.
  shared true conflicts with any explicit linkToPrevious value. Local binding
  changes MUST preserve later sections' effective content by pinning the next
  inherited binding to its original part, or an empty definition for original
  absence. Such preservation bindings do not count as semantic shared effects.
  Explicit headers remove / footers remove MUST delete the selected local binding;
  initial-section removal is allowed. Removal of an already inherited binding
  fails missing-selection unless allowEmpty, in which case it is unchanged.
  Removal from a later section exposes its preceding definition. These operations
  require one section or unambiguous section/story token; all-section edits reject.
  Unreferenced story relationships/parts may be deleted, but parts with any
  remaining incoming relationship and outgoing resources referenced elsewhere
  MUST survive. An implementation MAY conservatively retain unused media.
  Whole-story text assignment in the bounded utility profile MUST reject fields,
  tables and opaque blocks rather than discard them. Callers may first localize
  a story and use existing scoped text/paragraph operations on its content.
  The first paragraph's properties and annotations MUST survive text assignment;
  deleting later paragraphs with annotations or cross-paragraph markers MUST fail.
  No story operation evaluates field instructions or acquires external targets.
- **Lists/tables.** List add uses explicit kind, level 0, start 1, text empty;
  numbering levels are 0–8. List set targets an existing list paragraph, with
  restart false by default; start requires restart true. Starts are nonnegative
  safe integers. Table add requires positive rows/cols, creates unmerged cells
  each with an empty paragraph, uses available container width if width absent,
  equal grid columns, and autofit true. Set text needs a cell; repeatHeader and
  allowRowSplit apply to the selected row identified by cell, or every row of
  the selected table. Width applies to selected cell or table as appropriate.
  Row/column add index defaults count+1; explicit index inserts before that
  one-based position and count+1 appends. New row mirrors grid widths; row width
  if supplied must equal table width. New column requires width if container
  geometry cannot determine equal division. Remove needs explicit valid index.
  Merge from/to are logical corner coordinates of one rectangular selection;
  split needs a cell and positive rows/cols that divide its existing spans
  exactly. Merge requires `join: paragraphs|reject`: paragraphs preserves rich
  blocks in physical row order; reject accepts only structurally empty cells.
  Split requires `distribute: anchor|paragraphs`: anchor retains all content in
  the first resulting cell; paragraphs requires one paragraph per resulting
  logical cell. New continuations contain structural empty paragraphs.
  Deleting through vertical spans requires `join: paragraphs` and preserves
  surviving owner content, promoting the next continuation when needed.
  Partial overlaps, omitted slots, range-marker movement and over-limit grids reject.
  Construction admits at most one story/cell/paragraph insertion owner. A collapsed
  paragraph range splits at a Unicode scalar caret, retaining section properties
  on the suffix; `before` requires a whole paragraph. Existing cell insertion
  requires stored dxa width; explicit cell margins override table-level margins.
  `columnWidths` must match cols and sum to explicit width when both are given;
  without width their sum supplies the preferred width. Widths must fit the stored
  container. Both autofit modes store explicit preferred/grid/cell widths;
  autofit is a layout hint, not a pagination/rendering guarantee. Section columns
  constrain body insertion to the smallest stored column width.
  `repeatHeader: true` repeats the first row; `headerRows` selects consecutive
  leading rows and is exclusive with repeatHeader. Per-row overrides must retain
  this leading consecutive invariant. `rowOptions` has exactly rows entries,
  each admitting repeatHeader, allowRowSplit, height and heightRule. Omitted height
  rule with a supplied height uses AT_LEAST; AUTO may omit height and stores zero;
  AT_LEAST/EXACTLY require a nonnegative height. Lengths round to twips, half away
  from zero. Borders use eighth-points (2–96, or 0 for none), spacing 0–31 points;
  RGB colors use six hex digits. Margins are nonnegative and must leave content
  width positive. No null formatting reset is part of construction.
  TableBorders admits top/left/bottom/right/insideH/insideV Border fields;
  Shading admits fill, optional color and pattern as for paragraph shading.
  Typed table blocks accept width/style and the same formatting fields, with
  semantic columnWidths/borders/shading/rowOptions names. Typed cells admit
  blocks, borders, shading and per-side margins. Every cell ends in a paragraph.
  For tables.add, content contains exactly one matching table, no document
  settings/styles/theme; formatting cannot be supplied both directly and in that
  table. Nested paragraphs may reuse styles or create collision-safe headings.
  SDK options use content/columnWidths/borders/shading/rowOptions; command JSON
  transport suffixes and source files normalize to those same fields. Aggregate
  newly constructed cells share the invocation budget. Bounded cell updates and
  rectangular row/column insertion/deletion are implemented by the
  [table editing milestone](../plans/docx-table-editing.md). The
  [merged-cell milestone](../plans/docx-merged-cells.md) adds merge/split and span-aware
  row removal. Live table model batches, span insertion and column removal remain pending.
- **Links/bookmarks/fields.** Link add/set requires exactly one target or bookmark;
  external target accepts absolute https/http/mailto only and is never fetched;
  destinations may remain unresolved (section 9.1). Removing a link unwraps its
  visible content. Bookmark names are 1–40 ASCII letters/digits/underscore, begin
  with a letter or underscore, and must be unique; collisions fail. Rename/remove
  require the explicit references policy; unknown/opaque dependent references
  block edits. Add uses a selected nonempty admitted text range. Fields require
  target for REF/PAGEREF/SEQ and forbid it for PAGE/NUMPAGES/TOC. Result defaults
  empty, update false for new fields; set updates only supplied fields and never
  executes instructions. TOC add defaults levels 1-3, empty title and update true;
  levels CLI syntax is `N-M` with 1 ≤ N ≤ M ≤ 9, JSON is `{start,end}`.
  Captions require label/text, sequence defaults label; inserted SEQ result is
  empty and marked for update. TOC/caption set select their field location;
  cached text is explicitly replaced, without recalculation.
  The bounded structure profile adds explicit update and result to creation,
  levels to fields.add/toc.set, and kind/target/levels to fields.set. Levels-only
  and target-only edits preserve other instruction switches. Explicit kind
  replaces the instruction definition and requires its target where applicable.
  Nested instruction replacement rejects. Creation appends to an explicitly
  selected whole paragraph; insertion inside a spanning field rejects.
  captions.add additionally accepts static: true to emit label/text without a
  field; static conflicts with sequence/result/update. Default caption sequence
  collisions reject; explicit sequence authorizes reuse without counter evaluation.
  captions.set text addresses only the selected SEQ cache; surrounding/static
  label text uses scoped text replace or paragraph editing. Omitted flags retain
  their XML. Metadata/instruction-only TOC changes preserve nested cached content.
- **Notes/review.** Notes get kind defaults footnote; add requires kind and defaults
  text empty. Note mutation maintains reference and separator integrity; remove
  removes the reference and unreferenced body together. The bounded note profile
  additionally accepts kind on list/set/remove, shared on set, and
  renumber: preserve / document-order on add/remove. Remove accepts reference
  (positive ordinal within the selected note census) or references: single / all.
  List defaults to both kinds; get/set/remove default to footnotes, with explicit
  kind/scope narrowing. Shared-body set requires shared true. Removal defaults to
  one reference and rejects multiple references without explicit cardinality;
  all selects all notes/references but cannot override explicit references single.
  Any other raw reference, including inactive branches, retains the body.
  Independent bookmark/review/permission ownership retains its note body too.
  Storage-ID renumbering defaults preserve; document-order uses final reference
  order and requires every affected reference to be editable. Existing normal ID
  zero is admitted; new normal IDs use unused positive integers. Special types
  retain their IDs and contents; absent separator/continuationSeparator entries
  use -1/0 if free, otherwise unused positive IDs. Numbering settings remain
  unchanged; no page numbering is calculated. Add requires a whole body paragraph
  outside controlled/tracked content and enclosing fields. Set replaces simple
  paragraph text while retaining note markers and first-paragraph properties;
  rich bodies use existing scoped paragraph/table/run/text operations.
  Bounded NoteReadData is {items, separators, numbering}; each item contains kind,
  id, type, text, location and addressable reference locations. Separators contain
  kind/id/type. Numbering contains document footnote/endnote rules and effective
  per-section rules, each with format/start/restart. NoteEditData contains changed,
  changes, output and dryRun; changes use insert/replace/remove and nullable after
  locations when a body is deleted. Note batch execution remains pending.
  Comment add requires
  author and timestamp even when author is the explicit empty string; text and
  initials default empty. Null initials removes the attribute, null text fails.
  Only admitted run-boundary ranges are accepted. Revision list defaults all;
  add requires kind, author, timestamp; insert requires text (empty allowed only
  with allowEmpty), delete requires a nonempty text range and forbids text.
  Accept/reject act atomically on the selected supported revisions. Unsupported
  moves, table/section revisions and modern annotation edits reject rather than
  discarding their metadata.
  Text replacement additionally accepts `trackChanges` (CLI `--track-changes`),
  default false. When true, explicit author and timestamp are required, including
  an explicitly empty author; otherwise author/timestamp options are rejected.
  Tracking retains deleted content in deletion runs and emits replacement content
  in insertion runs. Deleted text retains its original run properties; inserted
  text inherits the first affected run properties, with any explicit bold/italic
  overrides applied only to the insertion. Empty replacement creates deletion
  only. The original view retains exact pre-edit original-view logical text and final view
  contains the requested edit; all retains deleted then inserted XML order.
  Ordinary replacement remains a distinct untracked operation.
  `revisions add` insertion accepts a collapsed paragraph/run scalar range;
  a whole paragraph/run selection appends to that admitted text container.
  Deletion accepts a nonempty scalar range or the whole nonempty text of a
  selected paragraph/run, retaining its required owning containers/properties.
  Selection and all-scope rules remain those of the shared command contract.
  Supported creation operates on ordinary text runs, tabs and line breaks;
  affected existing revisions/property history/review ranges, fields, controls,
  opaque content and compound nontext boundaries reject before mutation.
  No existing revision is nested, overwritten or implicitly accepted.
  New text-change IDs are deterministic unused positive safe integers in the
  document-wide supported revision identity domain across package parts, including
  inactive compatibility content. Existing range-pair identities retain their
  independently scoped meanings. Valid numeric opaque review identities are
  reserved conservatively; stored lexical IDs are never normalized or reassigned.
  Author/time are escaped/validated explicit values, with the shared UTC timestamp
  precision; no ambient identity or clock is consulted. Creation does not imply
  support for acceptance/rejection, live review owners or ordered batches.
  Acceptance/rejection editing support is distinct from revision-list read
  interpretation. The bounded editing subset is ordinary inline insertion and
  deletion wrappers containing admitted text runs, plus direct run/paragraph
  property history with a single supported exposed-field snapshot. Accepting an
  insertion unwraps its text; accepting a deletion removes its text. Rejecting
  an insertion removes its text; rejecting a deletion unwraps its text and
  restores deletion-text elements to ordinary text elements. Required paragraph
  and run containers remain. Accepting supported property history removes only
  its history and retains current properties; rejecting restores the exact
  admitted old property container rather than deep-merging old and current
  formatting. Unknown or compound property state is not an implicit rollback.
  Nested/overlapping review owners, paragraph-mark/row revision marks, moves,
  table/section changes, opaque history and affected unsupported field/control/
  range boundaries reject the entire affected operation. Unselected changes
  remain intact. All selected candidates are validated before any staged edit;
  annotation/bookmark/field ranges and namespace scopes must remain faithful.
  Removing a review owner must also preserve effective inherited XML language
  and whitespace semantics on surviving content, including explicit descendant
  overrides. Unsupported inherited XML semantics reject before mutation.
  Whole revision tokens or one-based revision ordinals select inside the explicit
  scope; scoped multi-revision mutation requires all. Text-range tokens do not
  imply revision selection. Reports retain before identities and describe removed
  review owners without claiming their tokens remain live. Repeated operations
  resolve against the new input; no match rejects unless allowEmpty is explicit.
  Acceptance preserves the selected current/final text and rejection restores the
  selected original text within this subset; unrelated existing review views
  remain distinct. These operations do not promise universal reversibility or
  ordered-batch/live-owner support.
- **Controls/templates.** Control set requires exactly one text/checked/choice/
  date/file field matching the control kind. Date is a valid `YYYY-MM-DD` calendar
  date; no timezone inference. Choice uses a declared option value, not its label.
  The bounded utility inspection route is `controls list`, including targeted
  inspection; no separate `controls get` route is declared. Each control snapshot
  includes its location, kind, stored ID/tag/alias, lock mode, placeholder state,
  binding descriptor, typed current value, declared choice values/labels and
  picture relationship metadata where applicable. Unsupported and nested controls
  remain individually inventoried rather than silently flattened.
  Plain/rich scalar filling preserves control properties and required paragraph/
  run containers, retaining first affected run formatting for inserted text and
  treating tabs/line breaks as logical text rather than XML input. Successful
  explicit filling, including an empty string, clears only showingPlcHdr; it does
  not delete placeholder definitions or unrelated control metadata. Parent fill
  that would erase nested controls rejects. A nested leaf may be filled only when
  its selected content and all control ancestors are admitted and unlocked.
  Any non-unlocked or unknown selected/ancestor lock mode refuses filling.
  Dropdown and combo choices use distinct declared values and render their stored
  display labels. Checkbox filling updates stored checked state and its declared
  checked/unchecked Unicode glyph/font; missing or malformed glyph mappings reject.
  Only verified checkbox extension elements/attributes are admitted; understanding
  them does not declare their whole namespace understood or activate otherwise
  inactive compatibility choices. Date filling updates fullDate at UTC midnight
  and renders admitted numeric Gregorian formats without host locale inference:
  absent/default or yyyy-MM-dd, MM-dd-yyyy and dd/MM/yyyy. Unsupported stored
  formats, languages or calendars reject; numeric rendering is bounded to absent
  language or en-US/en-GB and absent/default Gregorian calendar.
  Picture filling replaces one admitted existing internal DrawingML image
  occurrence using bounded owned non-interlaced eight-bit RGB/RGBA PNG input,
  with structural, checksum and bounded payload validation. Retain geometry, crop, alt text and
  control/drawing properties; use an occurrence-local relationship and retain
  shared old media and unrelated relationships. Missing, external, multiple or
  unsupported picture structures reject. This does not implement general image
  insertion, format conversion or arbitrary picture synthesis.
  SDK picture input uses the declared BinaryInput descriptor. Embedded bytes are
  decoded with admission budgets; VFS descriptors require an explicit matching
  capability-bound binary resolver. CLI file acquisition uses only its injected
  command VFS/stdin and the same bounds; no host fallback or implicit network.
  Filling validates every selected candidate before staging; kind mismatches or
  unsupported candidates in all-selection fail atomically. Bound controls are
  inspected and preserved here; filling them rejects until an explicit supported
  synchronization operation is available, without detaching dataBinding.
  Native repeating-section/item snapshots have their explicit kinds and null
  scalar value; controls set cannot treat repeat owners as rich-text scalars.
  Locked controls reject. Bound controls require the declared binding path and
  synchronized custom-XML value; missing/unsupported mapping rejects instead of
  detaching. Repeat requires one data source containing an array; empty array
  removes repetitions while retaining a valid prototype/container. Bind requires
  exact binding ID and a typed scalar value. Template apply matches explicit
  content-control tags only, not arbitrary brace text or executable expressions.
  Repetition is bounded, data records cannot introduce bindings, and missing/
  extra/duplicate keys fail. A template data array uses exactly one declared
  repeating region; ambiguous regions fail. No implicit concatenation of docs.
  The bounded repeat/bind utility routes require whole-owner control tokens,
  one-based scoped control ordinals or explicit all; text ranges reject. Repeat
  requires exactly one CLI data-file/data-json source whose value is an array of
  DeclaredControlRecord, matching the required SDK data array. Bind requires its
  explicit binding key and typed scalar value; false, zero and empty string retain
  their identity and are never treated as omitted.
  A binding key is an exact declared control tag. It identifies one logical
  declaration, not necessarily one physical control. Multiple controls with that
  tag may share one store-item/namespace-resolved selector/scalar-kind declaration;
  conflicting declarations for the same key are ambiguous and reject. Binding
  synchronization MUST update the singleton custom-XML value and every admitted
  bound recipient for that target, including differently tagged aliases, within
  the explicit selection/scope. An incomplete selection or scope rejects before
  mutation; callers may explicitly select all within all-stories to include
  header/note recipients. No ordinary body operation silently edits other stories.
  Locks, unsupported recipients and conflicting scalar declarations reject the
  entire synchronization; dataBinding is preserved, never detached.
  Store-item identity requires one internal custom-XML item and its internal
  customXmlProps relationship with a matching datastoreItem itemID. Missing,
  external or duplicate store declarations reject. The bounded selector is an
  absolute nonempty child-only path of QName steps, including the root step;
  each step resolves exactly one element. Prefixed names use explicit stored
  prefixMappings XML namespace declarations; unprefixed names match no namespace.
  Duplicate/invalid mappings or unbound prefixes reject. Descendant/parent axes,
  wildcards, predicates, attribute steps, functions, unions and executable
  expressions are unsupported. The selected element must be a singleton scalar
  text leaf containing only text content; element/comment/PI or mixed children
  reject. No arbitrary XPath engine is used.
  Text/rich-text, choice and date declarations use strings; checkbox uses boolean.
  Choice stores the declared value and displays its label; date stores a validated
  YYYY-MM-DD day and uses the admitted deterministic display formats. Supported
  explicit XML Schema instance types are string/boolean and, for ordinary bound
  text, integer/double: integer requires a safe integer, double a finite number.
  Numeric lexical output is deterministic JavaScript decimal/exponent spelling;
  boolean lexical output is true/false. Unsupported or conflicting type
  declarations reject; no host locale or value-based type inference.
  Repeating regions use namespace
  http://schemas.microsoft.com/office/word/2012/wordml repeatingSection/repeatingSectionItem
  declarations on outer/item SDT properties. A row region is a direct table-child
  outer SDT; each item contains exactly one valid unmerged grid row with required
  cells/paragraphs. A block region is a direct admitted story-root or cell-child
  outer SDT; each item contains nonempty paragraph/table blocks without sectPr.
  Outer content contains only item SDTs; exactly one first structural prototype
  is used and prior items must share its admitted schema/layout independently of
  filled values/remapped IDs. Nested repeats, bound repeat owners/items/fields,
  section/header-boundary changes, merge fragments, crossing annotations and
  affected opaque/review/modern-comment structures reject before cloning.
  Each record supplies exactly the prototype's distinct tagged scalar keys.
  Expansion replaces prior data items with the requested number of independently
  owned items. Empty data retains exactly one native reusable placeholder item,
  not a data repetition: clear tagged scalar displays/date/choice current state, reset
  checkbox state to its declared unchecked glyph and mark placeholder state.
  Preserve required row/cell/paragraph shape, control declarations and unrelated
  template decorations, without stale prior field values. Nonempty filling clears
  current placeholder state using the same bounded value rules.
  Validate and remap control IDs, bookmark names/IDs and contained internal
  references, classic comment anchors/body IDs and DrawingML drawing IDs per item.
  Clone admitted comment bodies with their stored author/time; modern review or
  cross-boundary ownership rejects. Relationship IDs are occurrence/owner-local,
  retaining admitted shared media and unrelated edges; no resource fetch occurs.
  The maintained matches budget bounds record/item count, alongside tableRows,
  tableCells and insertedNodes for expanded structures. Count/node/work/media/output
  budgets MUST be admitted before clone copies
  and publication; unsupported candidates fail atomically. Exact repeat extension
  admission does not declare the entire namespace understood or activate inactive
  compatibility choices.
- **Properties.** Unqualified names search core, extended and custom namespaces;
  collision across classes fails rather than choosing. `core:`, `extended:` and
  `custom:` explicitly qualify. Core string keys are title, subject, author,
  keywords, comments, lastModifiedBy, category, contentStatus, identifier,
  language, version; revision is positive safe integer; created, modified,
  lastPrinted are UTC instants. Extended writable keys are company, manager,
  template (strings). Extended pages, words, characters, charactersWithSpaces,
  lines, paragraphs, totalTime (nonnegative integers), application/appVersion
  (strings) are readable cached/source metadata, not recalculated or writable
  values. Other properties remain inventory/preserve-only unless declared custom.
  Custom supports string/boolean/integer/number/date; new names require type;
  existing type conflicts fail. Empty string is a value, null is invalid; remove
  is the only deletion route. Core strings use the 255-scalar limit. No inferred
  custom types or implicit modified timestamp updates.
  Metadata admission uses exact internal package-root OPC relationships, standard
  content types and matching expanded roots for the original dialect. Multiple
  declarations of a group, even duplicate edges to the same part, are ambiguous:
  inventory each part once with bounded warnings and preserve support; named get
  and affected mutations reject ambiguity. Matching declared orphan metadata roots
  are inventoried preserve-only; external edges remain inert. Namespace-shaped
  data in unrelated parts never becomes document metadata. Wrong-namespace key
  lookalikes remain opaque and do not shadow genuine native keys by local spelling.
  Unknown local names in the genuine native group vocabulary retain their
  qualified group:localName inventory names and preserve-only support. A known
  native key in the wrong expanded namespace remains nameless, even when that
  namespace is otherwise a genuine group vocabulary.
  Native core keys require their exact DC/core expanded names. Unqualified name
  resolution uses admitted stored names before predefined creation keys, and
  ambiguous cross-group names reject. Names are case-sensitive and not trimmed.
  Property records have kind property, a qualified group:key name when the stored
  name is nonempty, current part-root Location and exact package-root references.
  They contain one known PropertyValue, or an empty properties array for opaque
  stored data. Details identify group, the exact stored value expanded name (null
  when missing/ambiguous) and stored custom ID (null for other groups), without a
  content dump or guessed scalar type. Missing/empty custom names omit record name.
  Admitted writable known values have edit support; cached known values have read
  support; opaque, invalid or ambiguously owned values have preserve support.
  Invalid known lexical values read null with bounded diagnostics and cannot be
  mutated through the typed route. Inspection properties includes only known
  scalar snapshots; opaque metadata remains visible through part references and
  diagnostics. Reads never create missing parts or invent absent defaults.
  Utility date inputs/snapshots are explicit UTC instant strings, normalized to
  UTC whole seconds by dropping fractional seconds, including before the epoch.
  Invalid calendar values/timezone guesses reject. The separate live model retains
  its documented Date ownership/mapping; utility snapshots do not implement it.
  Cached extended and unsupported opaque properties reject both set and remove.
  Existing supported custom XML width variants retain their stored variant and
  numeric range; mutation cannot silently widen or change types. New custom types
  use lpwstr, bool, i8, r8 and filetime for string, boolean, integer, number and date.
  Custom IDs are positive safe integers at least 2; new IDs take the smallest
  unused admitted value. Standard custom fmtid is
  {D5CDD505-2E9C-101B-9397-08002B2CF9AE}, with GUID case-insensitive admission and
  original spelling preserved. Invalid fmtid/ID or duplicate IDs/names makes that
  custom part unsafe for typed mutation or new-property creation; never renumber
  or repair unrelated data. Unknown unselected values and all unrelated XML bytes
  remain unchanged. Missing parts use collision-safe maintained part-name and
  owner-local relationship ID allocation, standard root/content-type declarations
  and the original dialect. No orphan resource is adopted or overwritten.
  Removal deletes only the selected supported property node, retaining the empty
  part and its package relationship. Missing get/remove is missing-selection;
  remove with explicit allowEmpty may return an unchanged zero-target result.
  Unchanged typed edits retain exact package bytes and do not update clocks/counts.
- **Graphics.** Image add defaults inline, empty alt and native size. Floating add
  anchors at x=0/y=0 with horizontal column and vertical paragraph frames,
  wrap square, zOrder=0, no crop/rotation/
  flips, decorative false. Width/height are positive shared-unit lengths. With no
  explicit fit, zero/one dimensions use native ratio and two dimensions set both
  extents; explicit contain/cover require both box dimensions, stretch requires
  both dimensions. Contain preserves ratio inside the box, cover fills it using
  centered crop, stretch uses both extents. Replacement retains current drawing
  extents without resize; explicit fit applies only when resizing and conflicts
  with manual crop fields. Crops are fractions 0–1 with opposing sums <1; rotation
  is finite in [-360,360], no silent clamp; geometry setters on inline drawings
  reject anchor-only fields. SVG requires admitted supplied fallback; PNG/JPEG/
  GIF/BMP/TIFF use bounded characterization; preserved native media remains inert.
  Shared false replacement clones/rebinds the selected occurrence. Shared true
  changes all references to the selected resource and reports all owners; a resize
  combined with shared replacement rejects because layout is occurrence-local.
  The bounded raster replacement profile admits PNG/JPEG/GIF/BMP/TIFF bytes for
  a selected unambiguous embedded raster drawing. It MUST reject any linked
  carrier, including an embedded carrier with a competing external link,
  missing, unsupported or alternate/fallback-bearing carriers before replacement
  input acquisition; SVG/fallback replacement remains a separate unsupported
  profile, not an implicit conversion or detachment. Supplying fallback to this
  raster profile MUST reject. Image replacement does not accept all-selection.
  A Location identifies a physical drawing in its owner part; when that story
  has multiple section appearances, one-appearance replacement MUST reject as
  ambiguous unless explicit shared intent authorizes all affected appearances.
  Occurrence replacement MUST allocate a distinct media part and owner-local
  relationship, rebinding only the selected drawing even when another drawing
  uses the same relationship ID. Shared replacement identifies the resolved
  internal resource, never its filename, extension, hash or relationship ID alone.
  A format change MUST leave each affected target with coherent byte signature,
  canonical format suffix and content type, and preserve all incoming references
  when rebinding the shared resource. Resource retirement MUST census every
  package relationship, including unreachable owners; relationship retirement
  MUST preserve references in inactive or opaque XML branches. Content-type
  overrides are removed only with their retired part; unrelated declarations
  and resources MUST remain unchanged. Default replacement preserves crop and
  extents. One explicit dimension scales the replacement's native physical ratio;
  two explicit dimensions set both extents. Explicit contain/cover/stretch requires
  both dimensions; cover replaces crop with centered crop, contain/stretch clears
  crop. Anchor, wrapping, transforms and alt metadata remain unchanged otherwise.
  Decorative true with nonempty alt conflicts. Shapes set edits supported text
  boxes only. Charts/diagrams/fonts/custom-XML/glossary expose inventory/preserve,
  not invented semantic editing commands. Equations add/replace require one
  bounded OMML math root, reject arbitrary surrounding WordprocessingML. Objects
  extract emits inert admitted bytes only, never activation.
- **Bounded SVG insertion and alternate graphics.**

The SVG insertion utility profile uses the existing `images add` operation and
`file`/`fallback` inputs. It MUST admit SVG only with an explicitly supplied
validated PNG, JPEG, GIF, BMP or TIFF fallback. A raster `file` with `fallback`
MUST reject rather than ignore it. This profile inserts an inline native picture;
floating insertion remains unsupported. It MUST NOT fetch, rasterize, decode
pixel payloads, convert an existing representation or activate additional MCE
Choices. Existing inert SVG/EMF/WMF/WDP/GIF/BMP/TIFF and alternate associations
MUST remain byte-identical on unrelated edits. SVG/fallback replacement remains
outside the existing raster replacement profile; incomplete or linked alternate
replacement MUST reject before replacement-byte acquisition.

Native size, one-axis ratio and explicit contain/cover/stretch behavior MUST use
the supplied fallback's admitted pixel dimensions and per-axis DPI, including
the independent 72-DPI fallback. SVG width, height and viewBox MUST NOT establish
physical drawing dimensions or require a renderer. Existing explicit length,
fit, alt/decorative, owner selection and publication rules apply unchanged.
Both admitted original SVG and fallback byte arrays MUST be retained exactly.
They require distinct collision-safe media parts, canonical suffixes/content
types and owner-local image relationships. The raster base blip and one direct
SVG extension MUST form one coherent physical occurrence; inventory/extraction
MUST expose both resources without implying renderer preference.

New SVG input MUST be one well-formed SVG-namespace svg root under the normal
XML/media/work/retention limits. The bounded static vocabulary is svg, g, defs,
symbol, use, rect, circle, ellipse, line, polyline, polygon, path, title, desc,
text, tspan, textPath, linearGradient, radialGradient, stop, clipPath, mask,
pattern and marker. Other elements, foreign-namespace elements, scripts,
foreignObject, image embedding, animation, event attributes, style elements or
style/class attributes MUST reject. Processing instructions other than the XML
declaration, DTDs and entity declarations MUST reject. Standard predefined XML
escapes and numeric character references remain permitted under existing XML
admission; no custom/external entity is admitted. This profile is a static XML
admission policy, not complete SVG rendering or visual-conformance validation.

Attributes MUST belong to an explicit static presentation/geometry vocabulary:
id, version, x, y, width, height, viewBox, preserveAspectRatio, transform, cx, cy,
r, rx, ry, x1, y1, x2, y2, points, d, dx, dy, rotate, textLength, lengthAdjust,
fill, fill-rule, fill-opacity, stroke, stroke-width, stroke-opacity,
stroke-linecap, stroke-linejoin, stroke-miterlimit, stroke-dasharray,
stroke-dashoffset, opacity, color, clip-rule, clip-path, mask, marker-start,
marker-mid, marker-end, markerWidth, markerHeight, refX, refY, orient,
markerUnits, gradientUnits, gradientTransform, spreadMethod, offset, stop-color,
stop-opacity, fx, fy, fr, patternUnits, patternContentUnits, patternTransform,
clipPathUnits, maskUnits, maskContentUnits, font-family, font-size, font-weight,
font-style, text-anchor, dominant-baseline and visibility. Namespace declarations
are permitted; xml:lang and xml:space are permitted, xml:base is not. Unknown
attributes or attribute namespaces MUST reject. href in the empty or XLink
namespace is permitted only on use, textPath, linearGradient, radialGradient or
pattern and MUST contain one literal local fragment. Competing empty-namespace
and XLink href attributes on the same element MUST reject, even when equal.
Reference grammar operates on parsed attribute values after standard XML
character/predefined-reference decoding; for example `&#35;g` decodes to an admitted
local `#g` when that ID exists. Prohibited escape encoding means CSS backslashes
or percent encoding, not permitted standard XML character references.
No external, data, file,
scheme-relative or percent/escape-encoded reference is admitted.

An admitted local ID MUST start with an ASCII letter or underscore and contain
only ASCII letters, digits, underscore, hyphen, dot or colon. IDs MUST be unique,
nonempty and bounded by normal input budgets. Every referenced ID MUST resolve.
Paint/reference fields MUST reject escapes, percent encoding, CSS variables,
imports and trailing/fallback tokens. A resource reference accepts exactly one
lowercase url( followed by optional ASCII XML whitespace, an optional matching
single/double quote, one #ID, matching quote/whitespace and a closing ); no
remaining token is admitted. fill/stroke/color/stop-color may instead use none,
currentColor, transparent, ASCII letter-only color tokens, hex colors of exactly
3, 4, 6 or 8 ASCII hexadecimal digits after #, or numeric rgb/rgba/hsl/hsla
colors. The lowercase color functions accept exactly three channels, or four
for rgba/hsla, separated by commas with optional ASCII XML whitespace. Numeric
tokens use decimal notation with optional sign/fraction/exponent and MUST be
finite. RGB channels MUST all be unitless in [0,255] or all percentages in
[0,100]. HSL hue is unitless finite degrees with absolute value at most
Number.MAX_SAFE_INTEGER; fractions are permitted. Saturation/lightness MUST be
percentages in [0,100]. Alpha MUST be unitless in [0,1] or percentage in [0,100].
Other units, separators, escapes, trailing tokens and mixed RGB channel units
MUST reject; values never clamp. clip-path/mask/marker fields admit none or one local
resource reference. The complete grammar MUST be parsed, not inferred from a
matching substring. #ID is parsed as a literal fragment first; an admitted colon
or dot within that ID is not a URI scheme or external pathname. The dependency
graph contains every parent-to-child containment edge and every explicit
source-element-to-target-ID-element reference edge, including href and admitted
paint/clip/mask/marker references. It MUST be acyclic;
recursive use, paint, clipping, mask or inherited resources MUST reject.

The native SVG extension namespace is
http://schemas.microsoft.com/office/drawing/2016/SVG/main. Its embed/link
attribute namespace is the Transitional officeDocument relationship namespace
http://schemas.openxmlformats.org/officeDocument/2006/relationships independently
of the surrounding Strict/Transitional owner dialect, as declared by the pinned
extension schema's a:AG_Blob import. The owner graph still uses the owner's
native relationship types. This exception MUST NOT relax core mixed-dialect
guards or activate an MCE Choice. Existing single direct SVG-extension inventory
associations MUST NOT be tightened solely from an assumed extension GUID;
ambiguous, missing, linked or competing associations remain preserve/refusal
evidence. Newly authored extension metadata MUST use one explicitly documented
writer profile; schema/format claims and observed writer metadata are distinct.
This utility writer profile uses a direct native drawing extension with uri
{96DAC541-7B7A-43D3-8B79-37D633B846F1}, one svgBlip and its admitted internal
embed relationship. The URI is the explicitly selected observed writer profile,
not a claimed requirement proved by the pinned extension XSD. Existing admitted
single-extension URI spellings remain preserved and are not rewritten.

- **Bounded image layout.**

`images set` edits the selected physical picture drawing's stored metadata. Its
bounded profile admits one unambiguous native picture with one inline or anchor
frame, one direct `pic:spPr/a:xfrm`, and coherent common picture geometry. It
MUST NOT convert inline to anchor, acquire linked image bytes, reinterpret image
DPI, replace media, rebind image relationships, or alter unrelated package parts.
Existing media, alternate/fallback associations and relationship bytes MUST
remain unchanged. Unsupported or ambiguous selected representations MUST fail
with unsupported-edit before publication. Tracked containers/ranges and generic
faithful-XML edit guards MUST remain enforced. A story part with multiple section
appearances MUST fail ambiguous-selection; image layout has no shared-resource
expansion or shared-story override in this profile. Explicit all-selection selects distinct physical drawings, subject to the same
per-drawing guards. Every selected drawing MUST be semantically preadmitted before
publication; one unsupported selection rejects the entire ordinary write.

In addition to its existing fields, the setter admits `horizontalRelativeFrom`,
`verticalRelativeFrom`, `horizontalAlignment`, `verticalAlignment`, `distanceTop`,
`distanceBottom`, `distanceLeft`, `distanceRight`, `allowOverlap`, `behindText`,
`lockAspect`, `wrapText`, and `wrapPolygon`. All have identical SDK/CLI semantics. CLI --wrap-polygon-json carries the
closed JSON value corresponding to SDK wrapPolygon; the transport key
wrapPolygonJson is not an additional SDK property.
The distance fields and x/y use the shared explicit emu/in/cm/mm/pt lengths.
Positions and distances are converted once with halfway values away from zero.
This writer profile bounds x/y to signed 32-bit integer EMUs
[-2147483648,2147483647] and distances/zOrder to unsigned 32-bit integers
[0,4294967295]. These offset bounds are explicit utility limits, not a claim that
the reviewed schema metadata resolves the external simple type's primitive.
Width/height and both stored drawing extents MUST be positive integer EMUs no
greater than 2147483647 when read for a geometry-dependent write or newly written.
Every finite/range check applies before and after conversion; values never clamp.
For supplied or computed extent lengths, the unrounded physical value and
converted EMU value MUST be strictly positive, and converted EMUs MUST NOT exceed
2147483647 before rounding. The rounded written extent MUST be an integer in
[1,2147483647]. Thus 0.5emu and 0.75emu round to 1emu; a positive value below
0.5emu that rounds to zero MUST reject. This distinction between positive
unrounded lengths and positive written integers MUST NOT relax the pre-round
upper bound or the pre-round signed-offset/nonnegative-distance bounds.

Horizontal relative frames are page, margin, column, character, leftMargin,
rightMargin, insideMargin and outsideMargin. Vertical frames are page, margin,
paragraph, line, topMargin, bottomMargin, insideMargin and outsideMargin.
Horizontal alignment is left, right, center, inside or outside. Vertical alignment
is top, bottom, center, inside or outside. x conflicts with horizontalAlignment;
y conflicts with verticalAlignment. An explicit offset selects posOffset for
that axis and an explicit alignment selects align; either replaces the existing
axis choice without altering the opposite axis. A frame-only edit preserves the
existing unambiguous admitted axis choice. Unsupported percentage positioning,
conflicting/multiple choices, and simple-position mode MUST reject axis edits;
no implicit coordinate or frame is invented.

relativeTo is a both-axis compatibility alias and admits only page, margin,
insideMargin or outsideMargin, the native intersection of the axis enums. It
conflicts with explicit horizontalRelativeFrom/verticalRelativeFrom and sets both
axis frames while preserving each admitted axis choice except an explicitly
requested offset/alignment. Former axis-specific paragraph/column/character
spellings MUST reject; callers use the corresponding independent frame field.
No silent mapping to another native frame is allowed.

x/y, all relative-frame/alignment fields, wrap/wrapText/wrapPolygon, distances,
allowOverlap, behindText and zOrder are anchor-only and MUST reject on inline
pictures. Inline pictures may use coherent extent, crop, rotation, flip, aspect
lock and alt/decorative edits. No rendered coordinate accuracy is implied.
Anchor writes preserve required child ordering and all unaffected attributes,
effect extents, anchor identifiers and relative-size metadata. allowOverlap maps
to allowOverlap, behindText to behindDoc and zOrder to relativeHeight.

wrap admits none, square, tight, through and top-bottom and MUST preserve exactly
one native wrap choice. wrapText admits bothSides, left, right and largest and
is applicable only to square/tight/through. Creating one of those modes requires
an explicit wrapText or an existing unambiguous applicable native value; no
wrapping-side default is invented. tight/through require a supplied wrapPolygon
or an existing admitted polygon retained exactly. Switching between tight and
through MAY retain that polygon. Other new modes MUST NOT fabricate polygons.
Supplying wrapPolygon requires a resulting tight/through mode; an inapplicable
wrapText/polygon MUST reject. Removing/replacing a wrap mode MUST reject when its
unknown children/metadata cannot be faithfully preserved coherently.

ImageWrapPolygon (SDK wrapPolygon) is closed plain data `{start:{x:number,y:number},lineTo:[{x:number,
y:number},...]}`. It has exactly one start and at least two lineTo points. Every
coordinate is an integer in [-27273042329600,27273042316900]. These are native
integer coordinates, not implicit pixels, inferred normalized points or lengths.
The point count is bounded by normal operation/XML/work/retention budgets.
An explicitly authored polygon records edited=true. No native closure equality,
nonintersection, distinctness or nonzero-area rule is claimed or added by this
profile. Existing unsupplied polygon coordinates/edited spelling remain exact.

Distance setters write the anchor distance and every existing applicable override
on its selected wrap choice, so a conflicting stored override cannot negate the
requested value. Square admits all four overrides, tight/through left/right,
and top-bottom top/bottom; no other wrap attributes are authored. Unselected
sides and stored effect extents MUST remain unchanged. When a wrap switch would
silently discard existing distance/effect metadata without a coherent equivalent,
the write MUST reject rather than normalize it without explicit intent.

With neither width nor height, images set preserves extents. One explicit
size scales the existing coherent unrotated drawing extent ratio; two explicit
sizes set both. This is distinct from images replace, whose one-size ratio uses
its newly admitted media's native physical dimensions. Fit requires both box
sizes and conflicts with manual crop fields. Contain scales the existing extent
ratio into the box, cover fills it with centered crop, stretch sets both box
extents independently. Explicit contain/stretch clear crop; cover replaces crop
with the centered crop. Ordinary size changes preserve crop. Outer wp:extent and
the selected direct a:xfrm/a:ext MUST agree and update together; contradictory,
missing or multiple geometry and group/child transforms MUST reject dependent
writes. Rotation does not become a width/height bounding-box computation.

Manual crop fields merge with the selected native srcRect's unspecified sides;
absent native sides have their schema zero value. Each merged side is finite in
[0,1] and opposing sums MUST be less than one before and after quantization to
native hundred-thousandths. Only explicitly changed crop attributes are rewritten;
a missing srcRect is authored in its correct blipFill order when needed. Invalid
or ambiguous required existing crop values MUST reject dependent crop edits.
Unrelated layout edits preserve unsupplied crop markup exactly.

Rotation is finite degrees [-360,360], written to the unique selected direct
picture transform as an integer number of 1/60000 degrees with halfway values
away from zero. flipHorizontal/flipVertical map to that transform's flipH/flipV.
lockAspect explicitly sets noChangeAspect coherently on both native
cNvGraphicFramePr/a:graphicFrameLocks and pic:cNvPicPr/a:picLocks, creating an
absent supported lock container in its native order without dropping unrelated
lock fields. Multiple, opaque or conflicting carrier structures that cannot be
kept coherent MUST reject; unrelated lock properties remain unchanged.

Alt/decorative validation uses merged existing and requested values. Decorative
true conflicts with nonempty alt, including retained nonempty alt; new nonempty
alt conflicts with retained decorative true. Explicit alt empty or decorative
false may resolve that conflict. Metadata changes preserve unrelated docPr and
extension data. Alternate representations may remain exact when a narrow edit
of shared common geometry is admitted and keeps all representations coherent.
Separate active/opaque branch geometry requiring unsupported coordinated edits
MUST reject. No SVG/native-format activation or fallback creation is added.

An unchanged typed write retains exact input package bytes and reports no changed
Locations. Changed results use the shared MutationData contract with current
before/after physical image Locations; directly targeted drawings count once.
Publication, capability budgets, cancellation and error envelopes follow the
shared contracts. No live InlineShape/collection API or rendering parity is
qualified by this bounded utility.

- **Image inventory and extraction.** Images list/get use kind images records,
  current image Locations and exact owner-local relationship references. The
  record name is the canonical primary internal part name when available; linked
  or unresolved images omit name. Native image carriers in admitted stories are
  occurrences; unrelated namespace-shaped payloads and orphan media parts are
  not occurrences. Stored dimensions, transforms, crop, wrapping, stacking and
  alt/decorative metadata use exact native namespaces and bounded validated
  numeric values. Unsupported, missing, ambiguous or invalid fields read null
  with bounded warnings, never fabricated layout defaults. HorizontalPosition and
  verticalPosition retain separate native relativeFrom frames and exactly one
  stored offsetEmu or alignment; frames/alignments use admitted native enumeration
  spellings. Unsupported or conflicting axis modes read null with warnings.
  Inline carriers have null axis positions; no anchor coordinates are inferred.
  Effective anchor distances are emitted as integer EMUs and read applicable
  wrap overrides before anchor values;
  unsupported/missing values read null. Inline anchor-only fields read null.
  Aspect-lock reads require coherent admitted native frame/picture values, otherwise
  null with warnings. Polygon reads use the bounded native point shape; no outline
  or rendered frame is inferred. Axis alignments MUST use their separate native
  horizontal/vertical vocabularies.
  Pixel dimensions
  remain null unless independently admitted by the bounded media header codec;
  inventory does not render, decode pixel payloads or establish native-size parity.
  Actual recognized media type is distinct from declared content type. Unknown
  internal byte formats use application/octet-stream with preserve support;
  missing/external media uses null type/bytes/hash and is never acquired.
  Image read queries may use an explicit read-only inventory view over the
  admitted archive, retaining ZIP/XML/package/dialect and capability budgets
  without imposing mutation-semantic validation on unresolved image metadata.
  Such a view rejects every mutation before selection or stage callbacks and
  returns a fresh bounded owned archive snapshot on each call. Snapshot byte/Date
  mutation cannot change its internal source or subsequent Locations/snapshots.
  Normal editing views retain their existing semantic validation and edit guards;
  inventory admission is not a publication or mutation validation bypass.
  Selected core-v1 MCE branches supply active occurrences. Inventory MUST NOT
  activate a Choice by extending the compatibility profile merely to recognize
  VML or opaque image metadata. Inactive branches remain preserved part/reference
  evidence, not duplicate visible occurrences. Raw native VML imagedata in a
  selected story/branch may have a preserve-only image Location and inert resource
  references even when its layout vocabulary is opaque. This raw inventory does
  not declare that vocabulary understood, activate a Choice or promise visibility.
  A selected native carrier may
  expose admitted internal alternate resources without choosing a renderer's
  preferred encoding. fallbackPart is populated only for an unambiguous stored
  fallback association; alternateParts retains other exact internal associations.
  For one exact admitted SVG extension associated with a recognized raster base
  blip, the base remains the primary resource and may also be fallbackPart;
  neither field implies a renderer preference. Extraction emits each distinct
  associated part once per occurrence before advancing to the next occurrence.
  Ambiguous association remains null with warnings and preserved references.
  Image extraction writes exact admitted primary and unambiguously associated
  alternate/fallback bytes, in selected occurrence order and then stored resource
  order. A repeated shared resource may have repeated entries/owner Locations.
  Generated image-N.ext names use admitted MIME extensions; opaque unknown bytes
  use the fixed inert .bin extension, never a document-supplied name. External,
  unresolved or ambiguous resource selections are skipped with bounded warnings
  and complete false; no placeholder bytes/hash/path is fabricated. A fully
  extracted selection, including an empty internal selection, has complete true.
  A deterministic manifest.json records a closed version 1, kind images envelope
  with entries of relative path, canonical part, byte count, source sha256 and
  owner locations. This image-only manifest is not PackageInventoryV1;
  ExtractionData.inventory is null. Image ExtractionData always includes a
  manifest descriptor (or null before manifest admission). Descriptor and entry
  receipt paths are absolute VFS paths; manifest entries use generated relative
  filenames. Descriptor bytes/hash identify the exact admitted manifest bytes;
  published records actual publication. The output directory is explicitly admitted
  VFS capability input; all output names and aliases are preflighted before any
  staged acquisition. Without multi-file transactions, more than one output
  requires explicit allowPartialOutput, counting manifest.json as an output:
  one image plus its manifest is two outputs; an empty selection emits one
  manifest. Failure reports actual published entries
  and does not claim rollback or guarantee a published manifest. Existing
  chosen result/diagnostic serialization budgets, including newlines and partial
  receipts, are admitted before staged acquisition using the same extraction
  plan. Trusted synchronous publication-admission rejection prevents all output
  publication; it does not add an argv option or permit asynchronous admission.
  Late output/diagnostic sink or cancellation failures retain actual published
  receipt data rather than claiming zero effects. A programmatic inspection
  command engine MAY return its actual image extraction receipt and warnings
  through a typed optional extraction result field when final stdout fails,
  alongside exitCode 3. This execution-result field is separate from the closed
  OfficeResultV1 stdout envelope. Cancellation retains the actual receipt on a
  typed cancellation error with the stable cancelled code and Shell status 130.
  Failed stdout is not retried and does not guarantee delivery of a JSON receipt.
  Receipt transport MUST NOT parse serialized stdout to reconstruct publication
  effects or impose new fallible allocation admission after publication. Existing
  extraction profile excludes dryRun and requires outputDir even for empty input.
- **Custom XML/glossary inventories.** Custom-xml list and glossary list are
  package-global reads with json/limit only; story selectors, scope and select
  reject. They return ResourceListData in canonical part-name order, one record
  per internal customXML item or glossary document root, identified by declared
  OPC relationships/content types rather than folder spelling. A record has kind
  custom-xml or glossary, name equal to its canonical part name, a current whole
  part Location, no text dump, readonly properties, references and support preserve.
  Missing/ambiguous/unrecognized metadata remains inventoried with null fields and
  bounded warnings; it is not certified as editable. Associated properties and
  internal ancillary resources appear in details.parts, including unknown types;
  related internal graph closure is visited once, external edges are metadata only
  and never fetched. Orphan declared properties/glossary parts are inventoried too;
  other unclassified orphan parts remain in inspect.parts and are never deleted.
  References retain owner-local IDs/types/targets and deterministic owner/ID order.
  CustomXML details report item root expanded name, matching properties parts,
  declared store item ID, namespace bindings and inert schema-reference URIs.
  Glossary details report direct native docPart building-block metadata and paths,
  including name/GUID/category/gallery/types/behaviors; unknown blocks are preserved
  without content dumps or semantic imports. All counts/traversals and serialized
  inventories are admitted on the invocation budget before copies/output.
  Unedited member payloads and relationship XML remain byte-identical across
  no-op, targeted binding and other admitted mutations; OPC membership is not
  inferred from ordinary body reachability. No glossary import/execution, schema
  fetch, custom schema validation, ancillary activation or semantic edit is added.
  Controls bind MUST reject a target group with a bound glossary or other
  unsupported Word-part recipient outside its admitted story inventory. Such a
  recipient is retained without importing/editing it; all-stories does not hide
  it or authorize partial cache synchronization. A genuinely different-store
  unsupported glossary declaration remains unrelated and preserved. Unresolvable
  same-store declarations reject when target isolation cannot be established.
  Raw xml set retains root identity, package graph/content-type/profile, protection,
  signature and resource invariants. An explicitly selected unbound internal
  customXML item may replace its inert data payload after bounded XML and complete
  maintained package validation; this is not arbitrary custom-schema certification.
  Changed raw replacement of a referenced binding item, its store properties, or
  a Word part containing binding declarations rejects: controls bind is the typed
  synchronization route. Unchanged raw replacement remains a no-op. Unrelated
  external/unsupported stores are not fetched or silently detached.
  Protection/lock and package-signature inspection and mutation admission follow
  declared OPC part roles, matching roots and owning Word declarations. Signature
  roles use exact standard content types and relationship URIs; folder names,
  URI suffixes and MIME prefixes/substrings do not establish a signature graph.
  Internal parts declared by signature relationships are inventoried even when
  their well-formed payload root is unrecognized; invalid XML still fails package
  admission. External declarations remain inert metadata and still trigger
  default mutation refusal. Arbitrary inert customXML
  data using those same namespace/local-name spellings is not a story lock,
  settings protection or package signature. Declared package protection and
  signature parts/relationships still reject unconditionally, including malformed
  signature payload roots. Affected/ancestor SDT locks retain the existing control
  rules; unchanged unrelated locked owners may retain the admitted baseline
  preservation route. No real lock is detached or bypassed, and default
  publication remains lock-closed when no such baseline is supplied.
- **Removal/sanitization/lorem.** signatures remove strips the full signature
  graph and is explicit consent in the command path; no cryptographic claim.
  Other mutations reject signed input. Sanitize remove is a nonempty unique
  comma-separated CLI list (JSON array) from properties/comments/revisions/links/
  objects; revisionPolicy is required only with revisions. It applies only the
  enumerated actions in that fixed order; unsupported affected structures reject
  the whole transaction. Referenced targets survive until the last reference is
  removed. Lorem requires seed; words defaults to the count of maximal nonempty
  whitespace-delimited visible text spans per selected paragraph. Seed is mapped
  modulo 2^32; word i is chosen from `amber birch cedar delta elm fern grove heath`
  using `(seed + i) modulo 8`, joined by spaces, restarting i=0 for each paragraph.
  Explicit words is positive; a computed zero yields no change. This deterministic
  original dummy vocabulary is not an anonymization promise.
- **Diff/extract/pack.** Diff mode defaults structure. Parts compares sorted part
  names/content types and exact uncompressed bytes, ignoring ZIP metadata; XML
  replaces XML-part byte comparison with expanded names, attributes as unordered
  maps and ordered nodes with meaningful whitespace/comments/PI retained (prefix choice ignored), while non-XML parts still compare hashes;
  text compares all admitted story text in final view; structure compares XML
  semantics plus relationship edges and all binary part hashes. There is no
  silent ignore-metadata policy. Extraction writes safe relative paths derived
  from canonical part names and a manifest, refusing case-fold/path aliases on
  the target VFS. Image/object extraction uses `image-N.ext`/`object-N.bin` in
  occurrence order with MIME-derived admitted extensions, exact source hashes and
  owner locations; shared bytes may have multiple occurrence entries. No target
  filename comes from document-supplied alt/title text. Pack reads only manifest
  entries relative to its admitted inventory directory (stdin inventory requires
  explicit VFS paths in records); unknown files are not scanned. Hash mismatch,
  duplicate paths, traversal, undeclared content or invalid final graph reject.
  Kind defaults inventory.kind; conflicting explicit kind rejects. Pack does not
  permit arbitrary OPC-to-DOCX conversion. Deterministic ZIP output uses sorted
  canonical part names, stored entries, fixed 1980-01-01 timestamps and no archive
  comment; unchanged payload bytes remain exact.

The core-v1 understood-namespace set is the Strict and Transitional URI pairs
for w, r, a, wp, pic, m, ep, cus and vt, plus shared ct, pr, cp, mc and xml,
and the two Dublin Core namespaces, exactly as pinned in the
[standards namespace register](../docx/standards-coverage.md). Recognizing an
extension to inspect or perform a narrow explicitly declared edit does not
claim understanding its whole namespace for MCE Requires/MustUnderstand. Extension
namespaces outside that set are not eligible MCE Choice requirements in core-v1.
If no eligible Choice or Fallback exists, admission fails unsupported-profile;
unselected branches remain preserved. Check IDs are `container`, `part-names`,
`content-types`, `relationships`, `xml`, `mce`, `structure`, `references`,
`protection`, `signatures`, and `extension-coverage`. Their statuses distinguish
passed/failed/unvalidated; validation never repairs input. These IDs and the
understood set are product choices against the pinned standards facts.

Advanced format setters have these additional closed constraints: border space
omits to zero on creation and is otherwise unchanged; border widths/spaces are
nonnegative, shading color defaults black when creating a shading value. Font
language tags are nonempty BCP-47 strings validated as data, never locale discovery.
Numbering levels have unique 0–8 levels, nonnegative starts, no self/cyclic
restartAfter dependencies; omitted optional level fields retain existing values
or have no link/indent on a new level. Explicit section columns are nonempty;
widths are positive, gap/gapAfter are nonnegative. An omitted gapAfter uses gap,
then current section gap; final gapAfter must be zero. equalWidth true conflicts
with unequal explicit widths. Omissions retain separator/equalWidth state and
links; null clears only the declared nullable values. Linked styles require
compatible paragraph/character types and cannot introduce cycles or multiple
default styles for a type. No extra fields beyond the five register schemas
are accepted.

### 6.5.1 Bounded shapes and text-box stories

F36 inventories native shape and group carriers without rendering, flattening or
converting them. `shapes.list` returns active logical occurrences in selected story
order. Each record MUST identify its revision-bound `shape` location, native
representation, shape/group kind, containing group location or null, associated
text-box story locations, edit support and bounded refusal reasons. The record
MUST retain physical owner-part identity and all header/footer section references.
Labels and native IDs are metadata, not unique selectors. A header occurrence or
stored WordArt/text-path declaration MAY be reported as watermark-like evidence;
the utility MUST NOT infer visibility, rendered appearance or watermark activation.

Native recognition MUST use expanded names and exact carrier ancestry. The
bounded carrier vocabulary comprises Word drawing/pict owners; native `wp:wsp`,
`wp:wgp` and nested `wp:grpSp`; Office 2010 `wps:wsp`, `wpg:wgp` and nested
`wpg:grpSp`; and VML `shape`, `arc`, `curve`, `line`, `oval`, `polyline`, `rect`,
`roundrect` and `group`. Native canvas `wp:wpc` is a preserve-only compound owner;
its native contained shape/group inventory MUST retain that opaque ancestry.
VML `shapetype` is a definition, not an occurrence; background/image and pictures
or other graphic payloads remain governed by their own resource contracts. A
text-box tag beneath an arbitrary foreign wrapper MUST NOT establish native shape
edit authority. Native Strict and Transitional
`wp:wsp/wp:txbx/wp:txbxContent` have owner-dialect WML block children. It is distinct from legacy VML
`v:shape/v:textbox/w:txbxContent` and Office
`wps:wsp/wps:txbx/w12:txbxContent`, whose body is Transitional WML independently of
the drawing owner's dialect. The bounded Office/VML editable profile requires a
Transitional owner and body; a Strict owner with extension or legacy body remains
preserve-only and MUST reject affected edits without relaxing mixed-dialect guards.
Office `wne:txbxContent` and simultaneous multiple text-body variants MUST be
inventoried as opaque text-body evidence, with no admitted associated story
locations, and MUST reject affected text edits;
recognition MUST NOT equate them with owner-WML or native Strict `wp` content.

Recognition MUST NOT expand the core-v1 MCE understood-namespace set. Only the
selected branch contributes logical shape occurrences and story text. Inactive
alternatives remain physical preservation evidence, not additional active shapes
or duplicate text. Equal text, labels or default IDs MUST NOT be used to merge
independent objects or assert equivalence across alternatives. Nested groups and
boxes MUST retain their hierarchy; text-box stories use recursive owning-story XML
order and visited-node guards. Native content in either dialect MUST NOT leak its
paragraphs into the enclosing body/header story. Historical read-only text-box discovery
outside admitted shape carriers conveys no editing permission.

A shape carrier location belongs to its enclosing story; its associated text-box
story is a separate owner. `shapes.list --scope text-boxes` selects shapes nested
inside those stories, not the outer carriers whose text boxes define them. Scope
MUST NOT silently expand to outer owners or change ordinal ownership.

A shape ordinal is positive, one-based and resets within each resolved story or
selected owner. Valid shape owner chains are section/story, table/cell and
paragraph/run followed by shape; unrelated image/link/control/revision/field/
bookmark selectors are inapplicable to shape operations. `shapes.list` allows no
selector and lists the matching occurrences; `shapes.set` requires an explicit
shape/token or `all`. A shape token carries the common fingerprint/path guards
and MUST NOT be an image token or text-range token. Missing selector intent is a
usage failure; ambiguous shape ordinal across stories is ambiguous-selection.
Text operations MAY select an admitted shape as the owner of its unique text-box
story; a shape without one unambiguous text body fails missing-selection or
unsupported-edit as appropriate. `all` never grants unsupported edit authority.

`shapes.set --text` explicitly replaces the whole text of one admitted simple
text-box body. The bounded setter profile requires one direct WML paragraph with
plain runs and supported paragraph/run properties, with no fields, hyperlinks,
controls, annotation/permission ranges, note markers, review markup, tables,
nested boxes, foreign content or other compound payload. It MUST preserve the
paragraph's properties and required empty paragraph, while intentionally replacing
its runs and their formatting. Tabs and line breaks use the existing plain-text
assignment semantics; empty text clears the runs without deleting the paragraph.
This setter is distinct from preserving literal `text.replace`, which retains
unaffected runs and uses the existing bounded matching/cardinality semantics.

Supported existing text/paragraph/run operations within a box MUST reuse the
same admitted story and bounded editors. Every affected box edit, including edits
selected through text-box scope, paragraph/run tokens or another ancestor, MUST
validate native carrier authority before publication. Group-contained boxes,
nested boxes and their affected containing boxes, linked text flows, multiple-body
carriers and opaque/unsupported text-body variants MUST reject affected edits with
unsupported-edit while retaining read inventory and safe unrelated edits. Native
linked-flow evidence MUST be censused owner-locally, including inactive and opaque
candidates when resolving affected flow; repeated independent default IDs alone
MUST NOT be treated as a linked flow. A selected physical header/footer box with
multiple section references MUST fail ambiguous-selection rather than silently
mutating every reference. F36 introduces no implicit shared edit or geometry flag.

Admitted text edits MUST preserve shape geometry, group membership, transforms,
wrapping, anchoring, drawing properties, owner-local relationships and inactive
alternate bytes. No affected geometry/compound edit, renderer, conversion or
network acquisition is implied. Refusals MUST occur before output publication and
leave input/preexisting destinations unchanged. Tests MUST independently cover
native Strict, Office and VML carriers; groups/nested bodies; foreign wrappers;
linked/opaque/multiple bodies; active fallback deduplication; shared headers;
setter versus preserving replacement; and exact unaffected geometry/alternate
retention through public CLI, typed operations and the SDK.

### 6.5.2 Bounded chart-part and workbook inventory

The following is the exhaustive F37 resource-role register. Content-type matching
is case-insensitive while descriptors retain the declared spelling. Relationship
type matching is exact. No suffix inference or implicit resource loading is
permitted.

| Role | Declared content types | Relationship types |
| --- | --- | --- |
| Standard definition | `application/vnd.openxmlformats-officedocument.drawingml.chart+xml` | `http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart`; `http://purl.oclc.org/ooxml/officeDocument/relationships/chart` |
| Opaque extended definition | `application/vnd.ms-office.chartex+xml` | `http://schemas.microsoft.com/office/2014/relationships/chartEx` |
| Style resource | `application/vnd.ms-office.chartstyle+xml` | `http://schemas.microsoft.com/office/2011/relationships/chartStyle` |
| Color resource | `application/vnd.ms-office.chartcolorstyle+xml` | `http://schemas.microsoft.com/office/2011/relationships/chartColorStyle` |
| Inert workbook | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`; `application/vnd.openxmlformats-officedocument.spreadsheetml.template`; `application/vnd.ms-excel.sheet.macroEnabled.12`; `application/vnd.ms-excel.template.macroEnabled.12`; `application/vnd.ms-excel.sheet.binary.macroEnabled.12` | `http://schemas.openxmlformats.org/officeDocument/2006/relationships/package`; `http://purl.oclc.org/ooxml/officeDocument/relationships/package` |

F37 is a package-wide physical inventory. `charts.list` uses the `read` profile
with `json` and `limit` only. Scope, token, ordinal and other selection flags MUST
fail usage before input acquisition; this operation introduces no chart ordinal,
story scope or active drawing-location contract. The SDK MUST expose the same
supported snapshot operation and options. Read results have affected zero and
revision-bound `part` locations. Neither utility inventory nor its typed snapshot
establishes a live chart/workbook object model or batch execution.

The inventory MUST contain each distinct admitted chart-definition part once,
including unreferenced definitions, in canonical part-name order. Equal hashes,
reused incoming relationships and inactive drawings MUST NOT merge distinct part
identities or imply active rendered occurrences. Candidates comprise declared
standard/extension chart content types and admitted internal targets of exact
chart-definition relationship types; filenames/directories alone confer no chart
authority. Raw incoming/outgoing relationship metadata MUST retain physical owner,
ID, type, target and external status. It is physical graph evidence, not proof of
selected branch, visibility, refresh or rendering. Chart style/color support parts
MUST NOT be counted as additional chart definitions.

Standard decoded content requires the declared standard chart content type and
exact `chartSpace` root in either
`http://schemas.openxmlformats.org/drawingml/2006/chart` or
`http://purl.oclc.org/ooxml/drawingml/chart`. Descendants MUST use that root's chart
namespace and native ancestry. Each chart namespace MUST be tested within its
matching admitted document dialect; F37 does not relax existing opposite-dialect
part-root admission. Wrong roots/types, foreign
wrappers and modern extension chart vocabulary MUST remain opaque inventory with
bounded reasons, not local-name-decoded series. Malformed XML/OPC remains the
existing invalid-document failure; well-formed unsupported semantics MUST NOT be
silently reported as a successfully decoded empty chart.

The bounded standard profile MUST retain the ordered plot groups under the
selected native `chart/plotArea`, including area/area3D, line/line3D, stock, radar,
scatter, pie/pie3D, doughnut, bar/bar3D, ofPie, surface/surface3D and bubble forms.
`chartTypes` uses their exact native element names in XML order, retaining repeated
groups. `chartType` is that name for exactly one group and null otherwise. Series
MUST retain their group association, XML order and stored index/order metadata.
The generated series group index is zero-based into `plotGroups`; native series
index/order spellings are separate metadata. A standard root with no admitted
native plot group is opaque/preserve-only with an explicit issue. Unknown native
plot children/extensions MUST have explicit opaque evidence without being decoded
as a supported type; ordinary native layout/axis/formatting children are not plot
groups. Namespace recognition
MUST NOT expand core-v1 MCE understood namespaces; only selected content contributes
decoded plot groups/caches, while inactive bytes remain preserved physical data.

Series data MUST distinguish literal versus reference sources, stored formula/
address text, string/numeric/multilevel categories, value/y/x/bubble sources and
label provenance. Formula/address strings are inert metadata, never evaluated,
followed or refreshed. Referenced cache data MUST be labeled cached with freshness
unknown; literal values MUST NOT be described as refreshed workbook results.
Indexed point records MUST preserve XML order, raw stored index/count spellings,
duplicate/sparse indices, empty versus absent values and numeric value spellings.
The utility MUST NOT allocate holes from untrusted `ptCount` or point indices,
renumber/sort/deduplicate points, coerce nonfinite/unsafe numeric values, or silently
substitute zero for unsupported/malformed cache content. Malformed well-formed
cache semantics MUST have bounded issues and retain stored metadata; no full
schema certification is implied. A compact name/value projection is nonauthoritative:
ambiguous label sources yield null, and absent/ambiguous primary cached-value
sources yield an empty projection with explicit source/issue evidence.

`name` is decoded stored text from exactly one admitted series `tx` source: one
literal native `v`, or a native string-reference cache containing exactly one
point with stored index `0` and exactly one admitted native `v`. Otherwise it is
null with missing/ambiguous/opaque provenance and issue evidence where malformed.
The primary values source is native `val` for ordinary groups and native `yVal`
for scatter/bubble groups. `cachedValues` projects exactly one admitted numeric
reference cache on that source in point XML order; each point projects its sole
admitted native value or null with an issue. No count/index holes are synthesized.
Literal numeric data is retained in its explicit source/cache record, not passed
off as cached values. Multiple sources/caches make the compact projection empty
and ambiguous; x/category/bubble data remain separate source records.

Every selected native `externalData` MUST retain its owner-local relationship ID,
stored `autoUpdate` declaration and binding status. Resolution MUST use only that
chart owner's exact package relationship and canonical admitted target. Missing
IDs, wrong relationship/resource types, external targets and opaque resources
MUST be distinguished from admitted internal workbook bindings. An internal
package target's declared content type, original bytes and hash are evidence of
an inert resource binding, not proof of a valid spreadsheet or consistent formulas.
Workbook classification MUST use explicit declared workbook content types, never
filename suffixes or arbitrary relationship position. Stored auto-update does not
authorize execution or network access.

The inventory MUST separately report chart style/color resource relationships and
their admitted target metadata, including external/wrong-type/opaque dispositions.
Definition and internal graph resources MUST retain canonical names, declared
content types, byte lengths and hashes; repeated/cyclic graph edges MUST remain
bounded by visited-part guards. External targets are descriptive only. No nested
workbook unzip, spreadsheet editing, formula engine, external refresh, renderer,
asset activation or implicit network/native tool is part of F37.

Malformed duplicate singleton declarations use arrays rather than silently taking
the first value. In the documentary types below, absent native values use `[]`,
empty stored values use `[""]`, multiple values retain XML order, and an opaque
scalar declaration uses null with an issue. Point indices and native counts/order
remain strings; generated path/group/level indices are bounded zero-based integers.
All paths are physical element-child paths relative to the definition root.
`autoUpdate` is the array of stored native `val` spellings, including missing/opaque
declarations as null, and MUST NOT be defaulted into refresh authority.

Binding status precedence is missing ID, missing owner-local relationship, wrong
relationship type, external target, wrong resource type, then admitted internal
resource. Well-formed unsupported semantics in an otherwise matching XML resource
use opaque. A dangling internal OPC target fails existing package admission rather
than producing a fabricated descriptor. Workbook internal status classifies only
declared MIME and inert bytes, never nested ZIP validity or formula consistency.
`graphParts` contains the definition and its bounded transitive internal outgoing
resource closure in canonical part-name order. Raw references retain all physical
incoming definition edges and outgoing closure edges, deterministically ordered
by owner then ID, including external and unrelated edge types. `resources` lists
workbook/style/color role edges separately; every native externalData has its own
binding even when no relationship resolves.

These closed documentary types define the exact nested snapshot fields:

```typescript
type ChartPart = { name: string; contentType: string; bytes: number; sha256: string };
type ChartIssue = { code: string; part: string; path: number[]; message: string };
type ChartPoint = { path: number[]; index: string | null;
  values: (string | null)[]; issues: ChartIssue[] };
type ChartCache = {
  kind: "string" | "numeric" | "multilevel-string"; path: number[];
  cached: boolean; freshness: "unknown" | null;
  counts: (string | null)[]; formatCodes: (string | null)[];
  points: ChartPoint[]; levels: { path: number[]; points: ChartPoint[] }[];
  issues: ChartIssue[];
};
type ChartSource = {
  role: "label" | "category" | "value" | "x" | "y" | "bubble";
  namespace: string; localName: string; path: number[];
  kind: "literal" | "reference" | "opaque";
  literals: (string | null)[]; formulas: (string | null)[];
  caches: ChartCache[]; issues: ChartIssue[];
};
type ChartSeries = {
  group: number; path: number[]; indices: (string | null)[];
  orders: (string | null)[]; name: string | null;
  label: { provenance: "literal" | "cached" | "missing" | "ambiguous" | "opaque" };
  cachedValues: (string | null)[]; sources: ChartSource[]; issues: ChartIssue[];
};
type ChartBinding = {
  role: "workbook" | "style" | "color"; relationshipId: string | null;
  reference: Reference | null;
  status: "internal" | "external" | "missing-id" | "missing-relationship" |
    "wrong-relationship-type" | "wrong-resource-type" | "opaque";
  target: ChartPart | null; issues: ChartIssue[];
};
type ChartExternalData = { path: number[]; relationshipId: string | null;
  autoUpdate: (string | null)[]; binding: ChartBinding };
type ChartDetails = {
  kind: "charts"; definition: ChartPart;
  root: { namespace: string; localName: string }; status: "decoded" | "opaque";
  chartType: string | null; chartTypes: string[];
  plotGroups: { type: string; path: number[] }[]; series: ChartSeries[];
  externalData: ChartExternalData[]; workbookParts: string[];
  resources: ChartBinding[]; graphParts: ChartPart[]; issues: ChartIssue[];
};
type ChartRecord = { kind: "charts"; location: Location; name: string;
  properties: []; references: Reference[]; support: "read" | "preserve";
  details: ChartDetails };
type ChartInspectionData = { items: ChartRecord[];
  warnings: { code: string; message: string }[] };
```

Cache freshness is unknown for referenced caches and null for literal data;
`cached` MUST agree with that source distinction. `ChartInspectionData` is the
SDK snapshot; the CLI moves warnings to the standard envelope and exposes
`data: {items}`, affected zero and those records' part locations. Opaque records
retain root/part/binding descriptors but have no invented native decoded groups.
Issues/messages MUST be bounded static descriptions without source passages or
formula text; stored source data appears only in the explicitly requested result.

The existing resource record envelope applies, with details containing physical
definition status/namespace, `chartType`, ordered `chartTypes`, grouped series and
their source/cache/index metadata, `externalData`, inert workbook/style/color
bindings, original part descriptors and bounded issues. `workbookParts` contains
distinct resolved declared workbook targets in canonical order. Standard bounded
decoded records are read-only; opaque definitions/resources are preserve-only.
Generated result schemas MUST expose these distinctions and all nested fields
explicitly. Empty inventory is a successful read, not unsupported-profile success.

Unrelated admitted edits MUST preserve every chart/workbook/style/color payload,
relationship/content-type declaration, member order and inactive/opaque/unreferenced
bytes exactly. Tests MUST cover both chart namespaces, mixed plot groups, literal/
reference labels/categories/values, sparse/duplicate/malformed cache indices,
owner-local internal/external/wrong-type bindings, reused/unreferenced/opaque parts,
MCE branch preservation, bounded output/cancellation and paired public SDK/CLI
results. Original tests MUST prove unrelated edit preservation independently of
downloaded corpus or native tooling. Corpus/resource failures and unavailable
rendering/consistency profiles MUST remain separately qualified.

### 6.5.3 Bounded diagram and opaque graphics inventory

`diagrams list` is a package-global physical inventory of inert diagram resources
and eligible stored graphics observations. Only `json` and `limit` apply. Every
selector/scope flag, including a Location, MUST reject as usage before input
acquisition. List position is not a diagram ordinal, rendering count or active
document-model occurrence. This profile adds no semantic diagram mutation command,
live shape enum/collection, layout generation, text editing, refresh or rendering.

Each record identifies one canonical physical part: either a diagram-role candidate
or an owner of an eligible graphics observation. A part meeting both conditions
has one record. Distinct parts MUST remain distinct even with equal hashes; include
declared or relationship-recognized orphan/unreachable resources. Filename, suffix,
local spelling, body traversal and apparent nonuse confer no diagram authority.
All records have preserve support and a current source-bound part-root Location.

The exact native content types use prefix
`application/vnd.openxmlformats-officedocument.drawingml.` with role suffixes
`diagramData+xml`, `diagramLayout+xml`, `diagramStyle+xml`, `diagramColors+xml`
for data/layout/style/color. Native relationship types use the package's matching
officeDocument relationship namespace and suffixes `diagramData`, `diagramLayout`,
`diagramQuickStyle`, `diagramColors`. Matching native diagram namespace roots are
`dataModel`, `layoutDef`, `styleDef`, `colorsDef`. Header/list roots are opaque
resources, not additional generated diagram definitions. A recognized content type
or internal incoming role relationship establishes candidacy; record both evidence
forms when present. Wrong/missing roots or conflicting role evidence retain opaque
descriptors with located issues rather than guessed semantic contents. Existing
OPC/XML/dialect admission failures remain failures, not opaque success.
When a part has evidence for distinct roles, every role entry is opaque with a
conflict issue, even if its expanded root matches one role. A nonconflicting entry
is matching only when its XML expanded root matches that role's declared root.
Relationship-only candidacy with a matching root can therefore have matching role
evidence even with wrong declared MIME; it still cannot yield an internal native
binding, which requires both the exact role MIME and nonconflicting matching root.

The separate inert drawing role has exact content type
`application/vnd.ms-office.drawingml.diagramDrawing+xml`, relationship type
`http://schemas.microsoft.com/office/2007/relationships/diagramDrawing`, and root
`{http://schemas.microsoft.com/office/drawing/2008/diagram}drawing`. This extension
is observed preserve-only; recognizing it MUST NOT expand MCE understanding.

Eligible observations use raw namespace-qualified element-child paths in admitted
XML, including inactive/opaque branches. The native carrier chain is
`w:drawing/wp:inline|wp:anchor/a:graphic/a:graphicData/dgm:relIds`, with matching
package namespaces and only existing transparent MCE wrappers permitted between
elements. Foreign wrappers confer no carrier authority. Native binding authority
also requires graphicData's URI to equal the matching diagram namespace; a
different/missing URI is an unknown-graphic observation without inferred native
bindings. Preserve exact
stored URI and resolve `r:dm`, `r:lo`, `r:qs`, `r:cs` against that physical owner
only, respectively data/layout/style/color. Missing/empty IDs, absent relationships,
wrong relationship roles, external targets and wrong resource roles remain explicit
unresolved evidence. Precedence is missing-id, missing-relationship, wrong
relationship type, external, wrong resource MIME, opaque root/role, internal.
Wrong resource MIME is wrong-resource-type; matching role MIME with a wrong or
conflicting root is opaque. Retain the descriptor and graph traversal of every
resolved internal target even when its binding has a wrong/opaque status. Never fetch
external targets or infer relationship authority from arbitrary payload attributes.

Observe exact `dataModelExt` in the drawing-extension namespace under native
`dgm:dataModel/dgm:extLst/a:ext` with that exact namespace URI. Its drawing binding
uses unqualified `relId`, not `r:id`; missing/empty values remain unresolved.
Other stored extension attributes remain inert. Observe unknown native graphicData
envelopes, including missing URI, outside the existing recognized picture/chart/
shape profiles, and unsupported extensions under native diagram/drawing extension
lists. An extension observation identifies each unsupported direct element child
of a:ext in an eligible list; a:ext with no element child is itself an opaque
observation. Its `uri` is the unqualified a:ext envelope attribute, never an
attribute inferred from the unknown child. RelIds and unknown-graphic observations
use the enclosing graphicData's unqualified URI attribute.
Native diagram lists are direct dgm:extLst children of matching diagram-role
roots. Native drawing lists occur in either the exact
`w:drawing/wp:inline|wp:anchor/wp:docPr/a:extLst` chain or below the exact native
graphicData carrier chain. Below graphicData, intermediate descendants may use
only matching DrawingML main/picture namespaces and the already supported exact
wordprocessingShape/wordprocessingGroup namespaces from §6.5.1; their stored
content is observed, not semantically admitted by that namespace test. Only
existing transparent MCE wrappers are permitted. A list behind a foreign wrapper or elsewhere in XML
confers no graphics authority. Require native graphics ancestry; an arbitrary unknown namespace elsewhere
is not a graphic. Retain expanded names, stored envelope/extension URI, owner/path
and bounded issues without source text/payload dumps. Existing supported SVG,
decorative, chart and shape profiles MUST NOT be reclassified as unknown solely
because they use an extension namespace. Observation `active` means reachable in
the existing admitted compatibility projection; it never means rendered, safe to
edit or newly activated. Raw observations MUST survive independently of that flag.
An observation is active exactly when that raw node itself is exposed by the
existing MarkupCompatibility content projection, including an exposed opaque
source node; traversal MUST NOT descend into such a node to manufacture active
descendants. Selected-branch ancestry alone is insufficient for active status.

For a role record, graph closure starts at that candidate part. For an observation
owner, it starts at distinct resolved internal binding targets; the owner descriptor
is also included. A record meeting both conditions uses the union of these seeds.
The descriptor-only observation owner is not itself a traversal seed; do not
implicitly traverse all unrelated story relationships. Visit all outgoing internal edges transitively with a visited set,
including cycles and opaque resources. Retain descriptors only, never activate,
unpack or interpret nested resources. Record original incoming references to the
record's physical owner and all outgoing closure references, including external
edges, in canonical owner/ID/type/target order without duplicate physical edges.
Parts/roles/records sort by canonical part name and then declared role order;
observations sort by owner and lexicographic numeric child path. Bindings retain
the fixed native dm/lo/qs/cs order; extension drawing bindings follow their observed
physical path. Issues use bounded static descriptions without document passages.

The following exact closed utility types replace the generic diagrams detail arm.
`DiagramRole` order is data/layout/style/color/drawing. Root metadata is an expanded
name or null for non-XML/unavailable content; opaque resources are never decoded
into generated layout or semantic points.

```typescript
type DiagramRole = "data" | "layout" | "style" | "color" | "drawing";
type DiagramPart = { name: string; contentType: string; bytes: number; sha256: string };
type DiagramIssue = { code: string; part: string; path: number[]; message: string };
type DiagramRoleEvidence = { role: DiagramRole; part: string;
  evidence: "content-type" | "relationship" | "both";
  root: { namespace: string; localName: string } | null;
  status: "matching" | "opaque" };
type DiagramBinding = { role: DiagramRole; attribute: string;
  relationshipId: string | null; reference: Reference | null;
  status: "internal" | "external" | "missing-id" | "missing-relationship" |
    "wrong-relationship-type" | "wrong-resource-type" | "opaque";
  target: DiagramPart | null; issues: DiagramIssue[] };
type DiagramObservation = { kind: "relIds" | "unknown-graphic" | "extension";
  part: string; path: number[]; namespace: string; localName: string;
  uri: string | null; active: boolean; bindings: DiagramBinding[];
  issues: DiagramIssue[] };
type DiagramDetails = { kind: "diagrams"; parts: DiagramPart[];
  roles: DiagramRoleEvidence[]; observations: DiagramObservation[];
  issues: DiagramIssue[] };
type DiagramRecord = { kind: "diagrams"; location: Location; name: string;
  properties: []; references: Reference[]; support: "preserve";
  details: DiagramDetails };
type DiagramInspectionData = { items: DiagramRecord[];
  warnings: { code: string; message: string }[] };
```

The SDK returns `DiagramInspectionData`; the CLI moves warnings to the standard
envelope with data `{items}`, affected zero and physical record locations. Empty
inventory succeeds. Generated schemas MUST expose every closed nested field. Help
and standards coverage MUST identify inventory/preserve-only support explicitly.
Inspection MUST expose F38 detection from recognized diagram-role candidates or
native relIds observations. Unknown-only observations use a separately qualified
opaque-graphics subset; their presence MUST NOT be presented as a known SmartArt
diagram or complete semantic diagram recognition.

Unrelated admitted text/metadata/image edits MUST retain every diagram/resource
payload, relationship/content-type declaration, member order and inactive/opaque/
unreferenced bytes exactly. Raw XML replacement that changes unsupported diagram
resources or containing opaque graphics MUST reject unsupported-edit before any
publication; an unchanged byte replacement retains no-op behavior. Destructive
containing paragraph/subtree mutation MUST reject rather than remove the graphics.
Rejection MUST carry an existing source-bound Location token: a part Location with
path `[]` for a whole diagram resource, the raw element-child path of offending
inline opaque graphics in their physical owner, or the applicable containing
paragraph Location for destructive paragraph edits.
For raw replacement introducing an observation without an existing source
counterpart, rejection MUST identify that existing physical owner's part root
with path `[]`; a replacement-only child path MUST NOT be bound to the original
source fingerprint. Existing-observation mutation/removal uses the original
offending observation path even when proposed content relocates it.
Diagnostic part Locations have
empty readable positions, generation zero and no range; no diagram ordinal or new
location kind is introduced. Public SDK error, JSON diagnostic `location` token and
failure-envelope `locations` objects MUST agree. The failure remains affected zero
with no published output.
An unrelated selected writable leaf remains admissible under its existing profile.

Original small tests MUST cover both matching dialects, all role/binding forms,
orphan/reused/cyclic resources, unknown inline graphics without resource parts,
inactive/opaque observations, precise unsupported mutation locations, no-op and
unrelated text/metadata/image preservation, snapshot ownership, bounded output/
cancellation and paired SDK/actual Shell behavior. Corpus absence, limit failures
and unavailable real SmartArt/rendering profiles remain separately qualified;
preparation or reference recognition tests do not establish live model parity.

### 6.5.4 Bounded OMML equation inventory and explicit fragments

F39 exposes physical OMML inventory plus explicit bounded fragment add/replace.
It MUST NOT evaluate expressions, infer mathematical meaning, convert LaTeX,
render, discover fonts, activate resources or expand MCE understanding. Namespace
authority uses the admitted package's matching math namespace: Transitional
`http://schemas.openxmlformats.org/officeDocument/2006/math` or Strict
`http://purl.oclc.org/ooxml/officeDocument/math`. WordprocessingML `w:oMath` is a
run-formatting property, not an OMML expression or new equation-model API.

`equations.list` is a package-global physical read with only json/limit. All
selectors and scope flags MUST reject as usage before input acquisition. Observe
outer matching-namespace `m:oMath` and `m:oMathPara` units in admitted XML,
including inactive/opaque/unreachable storage. An oMathPara is one display unit;
its direct matching oMath children have explicit raw `mathPaths` and MUST NOT also
produce separate inline records. An outer oMath without a containing math unit
is one inline unit. Descendants of either unit MUST NOT create duplicate units.
Wrong/foreign hosts or unsupported stored trees remain preserve-only physical
evidence with issues, never guessed editable logical equations. Existing XML /
OPC/dialect admission failures remain failures; this profile does not validate
every stored math tree against the full primary schema.

Each record has an existing source-bound `part` Location at the unit's raw
namespace-qualified element-child path, generation zero, no range and empty
readable positions. Its story is the applicable admitted physical story identity
or its physical part when no admitted story applies. Records sort by canonical
owner part and lexicographic numeric raw path. Incoming physical owner references
and original outgoing owner relationships are inert metadata in existing canonical
Reference order. List position is not an equation ordinal, rendered count or
mathematical value. Existing inspection `counts.equations` retains its count of
exposed oMath expressions; grouped raw unit counts can differ, especially in
multi-expression displays and inactive/opaque storage. `active` describes exposure
of that raw unit itself in the existing compatibility projection; selected branch
ancestry MUST NOT manufacture active descendants of opaque nodes.

Property snapshots retain expanded names, exact raw paths and stored attribute
strings without computed defaults, coercion, inheritance, layout or evaluation.
Recognize native math property wrappers accPr/barPr/boxPr/borderBoxPr/dPr/eqArrPr/
fPr/funcPr/groupChrPr/limLowPr/limUppPr/mPr/naryPr/phantPr/radPr/sPrePr/sSubPr/
sSubSupPr/sSupPr/rPr/argPr/ctrlPr/oMathParaPr and their stored descendants in
their physical math context. Preserve associated matching WordprocessingML
run/control property subtrees as inert metadata. Snapshot wrapper and descendant
nodes individually, including duplicates, missing/empty values and unsupported
attributes; do not dump source XML or equation text into issues. Property scope is
display for oMathParaPr, run for rPr, argument for argPr, equation for other math
properties and global for mathPr. Descendants inherit the nearest property scope.
`stored` identifies recognized native stored metadata only, not schema validation
or edit authority; foreign/unsupported context or attributes are opaque with
bounded static issues. Attributes sort by namespace/local name; properties sort
by part/numeric path. `globalProperties` additionally snapshots each direct mathPr
and descendants in matching declared Word settings parts with an expanded settings
root, including orphan parts. No property getter creates settings or fonts.

The following exact closed utility snapshots replace the generic equations detail
arm; global properties are present even when the physical unit list is empty.

```typescript
type EquationPropertyScope = "equation" | "run" | "argument" | "display" | "global";
type EquationIssue = { code: string; part: string; path: number[]; message: string };
type EquationAttribute = { namespace: string; localName: string; value: string };
type EquationProperty = { scope: EquationPropertyScope; part: string; path: number[];
  namespace: string; localName: string; attributes: EquationAttribute[];
  status: "stored" | "opaque"; issues: EquationIssue[] };
type EquationDetails = { kind: "equations"; mode: "inline" | "display";
  ownerPart: string; root: { namespace: string; localName: string }; path: number[];
  mathPaths: number[][]; active: boolean; properties: EquationProperty[];
  status: "bounded" | "opaque"; issues: EquationIssue[] };
type EquationRecord = { kind: "equations"; location: Location; name: string;
  properties: []; references: Reference[]; support: "edit" | "preserve";
  details: EquationDetails };
type EquationInspectionData = { items: EquationRecord[];
  globalProperties: EquationProperty[]; warnings: { code: string; message: string }[] };
type EquationListData = { items: EquationRecord[]; globalProperties: EquationProperty[] };
```

The public SDK utilities are inspectDocumentEquations, addDocumentEquation and
replaceDocumentEquation, corresponding to equations.list/add/replace and their
declared typed arguments. The inspector returns EquationInspectionData; list JSON moves warnings to the standard
envelope with EquationListData, affected zero and ordered record locations. Empty
inventory succeeds. Bounded status means only the declared fragment grammar below;
it MUST NOT imply full XSD, mathematical correctness or safe host authority.
Record support is edit only for an active bounded unit in an admitted unambiguous
editable native paragraph context below; all others are preserve with reasons.
Generated result schemas MUST expose every closed nested field. Help/capabilities
MUST distinguish physical read/preservation, explicit supported fragments and
unsupported full math/model/layout/rendering profiles.

The equationEdit option profile contains only json/limit/output/inPlace/force/
dryRun/allowEmpty/select. Add and replace each require select plus file in CLI,
SDK and typed batch schemas; common publication conflict rules still apply.
All other selectors, scope and all-selection are inapplicable before acquisition.
`equations.add` requires one emitted current whole-paragraph select token.
No run, image, shape, link, field, control, bookmark, revision, range/caret or
block-container insertion is supported. Add appends exactly one
validated fragment root as the final direct child of that existing native w:p,
retaining every prior child/marker/attribute and its bytes. Root oMath yields inline;
oMathPara yields display within that paragraph. No implicit new paragraph, caret
splitting, adjacent content replacement or mode conversion occurs.

`equations.replace` requires one select token emitted for an existing physical
equation unit. Resolve the token against acquired
source fingerprint, raw path and physical story; only that native unit is targeted.
Replacement MUST retain the same expanded root/mode, including a whole display
group when its wrapper is selected. It MUST NOT replace just one inner display
member using a fabricated token or mutate adjacent math/paragraph content.

Both mutations use an existing admitted editable story paragraph, whose unit /
anchor is exposed directly through existing understood transparent MCE wrappers
and compatible native story/block ancestry. Foreign wrappers, inactive/opaque
math, fields/control/review/unsupported compound ancestry, protected or signed
content and ambiguous shared header/footer appearances MUST refuse. Text-box
story mutation remains outside this first equation profile. Resolve and validate
host selection/ownership/staleness and supported existing replacement tree before
opening fragment input; invalid/unsupported hosts MUST NOT acquire fragment bytes.
`file` uses existing BinaryInput in the SDK and an explicit scoped VfsInput path
at the CLI, with the same operation IDs/options. No ambient path or implicit
network resource resolution is permitted. Snapshot invocation/input/fragment bytes
before asynchronous use; apply inherited and caller-lowered admission/work/retention/
output limits and cancellation at acquisition, parsing, traversal and publication.

New fragment input is exactly one standalone matching-namespace oMath/oMathPara
root under existing UTF-8/UTF-16 XML byte admission. An optional valid XML
declaration is standalone framing, never inserted paragraph content. Other
processing instructions/comments are outside this new-input profile, including
inside the root. This math-only utility grammar deliberately narrows full primary XSD WML
content/property groups. It supports only these ordered structures:

- oMath contains zero or more mathematical r/f/m/sSub children.
- oMathPara has optional oMathParaPr first, then one or more oMath children.
- r has optional rPr first, then zero or more t children.
- f has optional fPr first, exactly one num, then exactly one den.
- m has optional empty mPr first, then one or more mr; each mr has one or more e.
- sSub has optional empty sSubPr first, exactly one e, then exactly one sub.
- num/den/e/sub each have optional argPr first, then zero or more r/f/m/sSub.
- argPr has optional argSz; fPr has optional type; oMathParaPr has optional jc.
- rPr has optional lit, then either optional nor or optional scr then optional sty,
  then optional brk and optional aln. Nor MUST NOT coexist with scr/sty.

Empty oMath/arguments/run text and ragged matrix rows are permitted within these
cardinalities; the primary XSD does not require nonempty expressions or rectangular
matrices. Structural whitespace outside t is permitted, not literal content.
t contains only literal XML text and optional xml:space default/preserve. It is
never interpreted as an expression language. Other attributes are prohibited
except namespace declarations binding the matching math or fixed XML namespace
and exact qualified math attributes on empty property leaves:
type requires val bar/skw/lin/noBar; argSz requires an XML-integer val in -2..2;
jc has optional val left/right/center/centerGroup; scr has optional val roman/script/
fraktur/double-struck/sans-serif/monospace; sty has optional val p/b/i/bi; lit/nor/
aln have optional val true/false/1/0 (Transitional additionally on/off); brk has
optional alnAt integer1..255. Integer/boolean whitespace follows XML-schema lexical
normalization; string enumerations remain exact. No additional property children,
unqualified val, imported WML/control properties, resources/relationships, drawings,
links/objects, foreign namespace elements/attributes, MCE or extension wrappers
are admitted. Unsupported schema-valid math remains unsupported by this explicit
profile, not falsely declared invalid against the full XSD. Existing XML admission
rejects malformed encoding/XML, DTD/entities and multiple roots. Root/namespace/
structure/property misuse MUST refuse before publication with the stable shared
failure model. Well-formed root/namespace/cardinality/property violations and
unsupported fragment families outside this bounded grammar use unsupported-edit, while malformed
XML retains existing invalid-document admission categories. No full XSD validator
or external schema fetch enters product/build closure.

Changed successful add/replace returns existing MutationData with affected one, one current
generation/location for the inserted/replacement physical unit, standard warnings
and publication metadata. An identical byte replacement preserves existing no-op /
allowEmpty behavior. Ordinary admitted text/metadata/image edits MUST retain every
untargeted OMML/resource/property byte, relationship/content-type declaration and
unaffected member order. Raw XML replacement changing stored math units or global
math properties MUST refuse unsupported-edit with an original source-bound unit /
property raw-path part Location, rather than claim arbitrary whole-part math
validation. Unchanged byte no-op and unrelated writable leaf replacement remain
admissible when stored math and namespace context are unchanged. Added math with
no source counterpart identifies existing owner root []; existing mutation/removal
uses original offending raw path even when proposed content relocates it.
Destructive containing paragraph/subtree edits MUST refuse with the existing
containing paragraph Location. SDK error, JSON diagnostic token and standard
failure locations MUST agree, affected zero and no prepublication output; existing
source and destination bytes remain unchanged.

Original tests MUST cover both matching dialects, inline/multiple-expression
display units, fraction/matrix/subscript grammar and properties, empty/ragged valid
cases, malformed/unsupported/resource-bearing input, stale/ambiguous/foreign/
inactive hosts and poison fragment pre-acquisition refusal, unrelated retention,
precise located errors, snapshot limits/cancellation, closed public types/schemas
and paired SDK/actual Shell/virtual.sh behavior. The manifest's stored-expression
census is QA preparation only; list-unit grouping, full-input limits, available
round-trip profiles and rendering/model gaps remain explicitly qualified.

### 6.6 Closed JSON input types

These are documentary type declarations for schema generation, not product code.
Every object is closed (`additionalProperties:false`), including nested records.
`?` means absence permitted; null is permitted only in an explicit union. JSON
cannot express undefined; optional SDK undefined behaves as absent, required
undefined fails. Empty strings are valid text, invalid for identifiers/paths/search
patterns. Empty arrays are valid only for explicitly zero-item content/data/read
results; operations requiring targets/levels/cells reject empty arrays. Reject
unsafe values in integer-typed positions, nonfinite values, prototype keys and
cyclic SDK objects. Finite number/double positions accept exactly representable
values beyond the safe-integer range; integer/ID and shared-unit range constraints
remain independently enforced. JSON integral numeric tokens MUST NOT silently
round to a different integer during parsing.
JSON source bytes ≤ xmlPartBytes, total values ≤ xmlNodes, depth ≤ xmlDepth;
strings and decoded bytes also count toward retainedBytes. Limits are section 7's
exact camelCase register names via `--limit NAME=VALUE`, not new environment knobs.

```typescript
type BinaryInput =
  | { kind: "bytes"; base64: string }
  | { kind: "vfs"; path: string; capability: string };
type Length = { value: number; unit: "emu" | "in" | "cm" | "mm" | "pt" | "twip" };
type EnumInput = { enum: string; name: string }; // each use narrows to its declared enum
// No path grants authority: capability must already exist in admitted host context.
type OriginalDocumentContentV1 = {
  version: 1;
  blocks: Block[];
  page?: CreationPage;
  styles?: CreationStyle[];
  theme?: CreationTheme;
};
type CreationPage = {
  width?: Length;
  height?: Length;
  orientation?: "portrait" | "landscape";
  margins?: Partial<Record<"top" | "right" | "bottom" | "left" | "header" | "footer" | "gutter", Length>>;
};
type CreationStyle = {
  name: string;
  type: "paragraph" | "character" | "table";
  font?: string;
  size?: Length;
  bold?: boolean;
  italic?: boolean;
};
type CreationTheme = {
  name: string;
  majorFont: string;
  minorFont: string;
  colors?: Partial<Record<"dark1" | "light1" | "dark2" | "light2" |
    "accent1" | "accent2" | "accent3" | "accent4" | "accent5" | "accent6" |
    "hyperlink" | "followedHyperlink", string>>;
};
type Block =
  | { kind: "paragraph"; text?: string; style?: string; level?: number; runs?: RunInput[] }
  | ({ kind: "table"; rows: CellInput[][]; width?: Length; style?: string } & TableConstructionFormat);
type TableConstructionFormat = {
  columnWidths?: Length[]; autofit?: boolean;
  repeatHeader?: boolean; headerRows?: number; allowRowSplit?: boolean;
  rowHeight?: Length; heightRule?: EnumInput; cellMargin?: Length;
  borders?: TableBorders; shading?: Shading; rowOptions?: TableRowOptions[];
};
type TableRowOptions = {
  repeatHeader?: boolean; allowRowSplit?: boolean; height?: Length; heightRule?: EnumInput;
};
type Border = {
  style: "none" | "single" | "double" | "dotted" | "dashed";
  width: Length; color: string; space?: Length;
};
type Shading = {
  fill: string; color?: string;
  pattern: "clear" | "solid" | "pct5" | "pct10" | "pct20" | "pct25" | "pct50" | "pct75";
};
type TableBorders = Partial<Record<"top" | "left" | "bottom" | "right" | "insideH" | "insideV", Border>>;
type CellInput = {
  blocks: Block[]; borders?: TableBorders; shading?: Shading;
  margins?: Partial<Record<"top" | "left" | "bottom" | "right", Length>>;
};
type RunInput = {
  text: string;
  bold?: boolean | null;
  italic?: boolean | null;
  underline?: boolean | EnumInput | null;
  style?: string;
};
type DeclaredBindingValue = string | boolean | number;
type BindingEntry = { binding: string; value: DeclaredBindingValue };
type DeclaredControlRecord = { values: BindingEntry[] };
type DeclaredTemplateRecord = { values: BindingEntry[] };
type TemplateData = DeclaredTemplateRecord | DeclaredTemplateRecord[];
type Receiver =
  | { id: string; type: string; owner: string; revision: number }
  | { resultHandle: string; index?: number; key?: string };
type BatchV1 = { version: 1; operations: OperationV1[] };
type OperationV1 = {
  operation: string;
  arguments: OperationArguments;
  receiver?: Receiver;
  resultHandle?: string;
};
type PackageInventoryV1 = {
  version: 1;
  kind: "docx" | "dotx";
  dialect: "strict" | "transitional";
  entries: PackageEntry[];
};
type PackageEntry = {
  part: string;
  path: string;
  contentType: string;
  bytes: number;
  sha256: string;
};
```

Paragraph text and runs are exclusive; neither creates an empty paragraph.
The bounded creation settings profile exposes page/style/theme values through
the same content object in CLI JSON and SDK calls. New-package page values merge
with the section 6.5 defaults. Page dimensions are positive, margins nonnegative,
and margins including the gutter MUST leave positive content extent. Dimensions
and margins serialize as integer twips after shared integer-EMU conversion;
the initial profile admits values through 31,680 twips. Orientation MUST NOT
implicitly swap dimensions. Header/footer margins default to 720 twips and the
gutter to zero. Named styles use exact names, deterministic collision-free IDs,
and an explicit paragraph/character/table type. Duplicate names or references to
missing/wrong-kind styles MUST fail. Optional font sizes MUST round to positive
half-point values; false formatting values remain explicit.

Theme settings contain supplied font names and six-digit RGB colors, normalized
to uppercase. Font names are references, never host font discovery. No theme
part is implicit. When a theme is supplied, omitted colors use the original
palette: dark1/light1 `000000`/`FFFFFF`, dark2/light2 `202020`/`F0F0F0`, accents
`305070`, `507050`, `705030`, `604070`, `307070`, `706030`, hyperlink `0000FF`
and followedHyperlink `800080`. The generated theme contains the required color,
font and format schemes without external assets.

Supplied-template creation appends blocks and new nonconflicting named styles;
it preserves existing page, theme and metadata settings. In this bounded profile,
explicit page/theme/author/timestamp overrides on templates MUST fail with
unsupported-edit. Their broader editing operations remain separately proposed.
Creation MUST NOT execute expressions, callbacks, field instructions or template
code. These settings do not establish live model, style-cascade or layout support.

Style and level are exclusive. Table rows must be nonempty, rectangular and
within table budgets; zero blocks in a cell becomes one required empty paragraph.
The additive TableConstructionFormat and cell-format fields are defined in the
construction contract in section 6.5; they apply to nested table blocks too.
No implicit merges or binary fixtures are embedded in content. Each binding entry
ID must match exactly one logical control-tag declaration, which may have multiple
physical recipients with the same admitted target/type; scalar type comes from its
admitted control/custom-XML declaration, including date represented as a validated
string. Dynamic JSON property names are avoided by the values array. Duplicate
bindings and null values reject. Repeated controls may repeat the same schema
across cloned rows but each row's input keys must exactly match that schema.

Inventory entries include `[Content_Types].xml` and all relationship parts as
payloads, with exact hashes and byte lengths. Part names are canonical OPC names;
the content-types item uses that literal special name. Each path is a safe
relative VFS path under the granted inventory directory, or an explicitly granted
VFS path for stdin inventory. It cannot contain dot segments, backslashes, encoded
separators, absolute host paths or symlink escapes. Media manifests are not pack
inventories. Editing a payload requires updating the caller-owned inventory hash;
pack never trusts a stale hash or follows targets outside its capability.

`OperationArguments` is a closed discriminated union, not a free dictionary:
for every direct-and-batch operation it is the section 6.4 fields plus its
applicable selection fields and allowEmpty/shared/cardinality. File arguments
become BinaryInput; CLI-only `*File`/`*Json` alternatives normalize to the one
semantic field (`content`, `data`) before SDK dispatch; batch sources decode directly
to the version/operations envelope, never a nested second BatchV1. A batch item
uses only that semantic field, never two alternate sources. Outer batch supplies
publication, limits, context time/author and cancellation; items cannot include
output/inPlace/force/json/dryRun/limit, recursive batch, discovery, create, diff,
pack or multi-file extraction. Content/control/template schemas are reused without
widening them to arbitrary JSON.

The existing closed `model.*` operation IDs and five format IDs in the register
are the exhaustive advanced union: `paragraphs.format.set`, `runs.fonts.set`,
`lists.levels.set`, `sections.columns.set`, `styles.links.set`, and each enumerated
model get/set/call/sequence operation. Each has its exact `arguments.fields`,
receiver, resultHandle type, effects, model signature, language and error mapping
through its API row. This specification incorporates those individual neutral
typed declarations by reference; it does not introduce wildcard dispatch for
`model.*`. Schema MUST enumerate each discriminator and fully resolve its field,
return, enum and nullability references. Public underscore-prefixed types remain
included. Package-source acquisition in a model operation is explicitly admitted
under outer capabilities before that item's effect; it cannot publish externally.
A model save stages bytes for the single outer destination and rejects a different
or additional destination. No JSON-supplied function, prototype access, XPath,
host object or method name is evaluated.

`receiver` must match a declared owner/type. Batch-local resultHandle names are
nonempty unique ASCII letters/digits/underscore, start with a letter, and cannot
refer forward. Reserved `document` identifies the already admitted DocumentModel;
users cannot overwrite it. Index and key are exclusive, and only declared returned
collection lookup is available; there is no arbitrary property path. Typed model
setters returning void cannot bind resultHandle. Empty operations is a successful
read/value-only batch with zero results; absent operations is usage. A later
failure discards all staged changes, reports the failing operation index and
leaves prior files untouched. Original result objects may be returned in BatchData
only on whole success; failed prepublication data remains null.

### 6.7 Typed results and stable errors

All structured output uses exactly the shared OfficeResultV1 keys. The following
closed types specify data; omitted optional data means unknown/not applicable,
never an invented zero. Collections are deterministic and bounded; overflow is
limit-exceeded, not silent truncation. Only diagnostics may truncate with an
explicit marker within diagnosticBytes. `Location` is the token and decoded
LocationPayload with readable one-based positions. A result location refers to
input for reads, staged output for mutations; deleted locations are recorded as
before-locations in changes, not falsely addressable in output.

```typescript
type Diagnostic = {
  code: ErrorCode;
  message: string;
  location?: string;
  operationIndex?: number;
  candidates?: string[];
  truncated?: boolean;
};
type OfficeResultV1<T> = {
  version: 1;
  operation: string;
  ok: boolean;
  data: T | null;
  warnings: Diagnostic[];
  errors: Diagnostic[];
  affected: number;
  locations: Location[];
};
type Location = {
  token: string;
  value: LocationPayload;
  positions: {
    section?: number;
    paragraph?: number;
    run?: number;
    table?: number;
    cell?: string;
    image?: number;
    comment?: number;
    note?: number;
  };
};
type ResourceRecord = {
  kind: string;
  location: Location;
  name?: string;
  text?: string;
  properties: PropertyValue[];
  references: Reference[];
  support: "edit" | "read" | "preserve" | "reject";
  details?: ResourceDetails;
};
// Bounded utility snapshots; this does not complete the live ResourceDetails model.
type ControlReadData = { items: ControlSnapshot[] };
type ControlSnapshot = {
  location: Location;
  kind: "plain-text" | "rich-text" | "checkbox" | "dropdown" | "combo-box" |
    "date" | "picture" | "repeating-section" | "repeating-item" | "unsupported";
  id: string | null; tag: string | null; alias: string | null;
  lock: string; placeholder: boolean;
  binding: { storeItemId: string | null; xpath: string | null;
    prefixMappings: string | null } | null;
  value: string | boolean | ControlPicture | null;
  choices: { value: string; label: string }[];
  support: "supported" | "unsupported";
  reason: string | null;
};
type ControlPicture = {
  relationshipId: string; target: string | null;
  external: boolean; contentType: string | null;
};
type PropertyValue = {
  name: string;
  type: "string" | "boolean" | "integer" | "number" | "date";
  value: string | boolean | number | null;
  writable: boolean;
  cached: boolean;
};
type Reference = { owner: string; id: string; type: string; target: string; external: boolean };
type ResourceListData = { items: ResourceRecord[] };
type ResourceData = { item: ResourceRecord };
type InspectionData = {
  kind: "docx" | "dotx";
  dialect: "strict" | "transitional";
  parts: { name: string; contentType: string; bytes: number; sha256: string }[];
  relationships: Reference[];
  stories: ResourceRecord[];
  properties: (PropertyValue & { part: string; group: "core" | "extended" | "custom" })[];
  features: FeatureSupport[];
  counts: {
    paragraphs: number; runs: number; tables: number; rows: number; cells: number;
    images: number; sections: number; comments: number; footnotes: number;
    endnotes: number; fields: number; controls: number; equations: number;
    cachedPages: number | null;
  };
  sizes: { archiveBytes: number; expandedBytes: number; mediaBytes: number };
  contentTypes: {
    defaults: { extension: string; contentType: string }[];
    overrides: { name: string; contentType: string }[];
  };
  signed: boolean;
  protected: boolean;
  pages: { rendered: null; cachedBreaks: number };
  fonts: { references: string[]; themeReferences: string[]; embedded: string[]; installed: null };
  fontResources: FontResourceData;
  signatures: { parts: string[]; verified: null };
  media: { name: string; contentType: string; bytes: number; sha256: string }[];
  annotations: { part: string; kind: string; id: string | null; author: string | null; date: string | null }[];
  protection: { part: string; kind: string; enforced: boolean | null; edit: string | null }[];
  warnings: { code: string; message: string }[];
};
type FontResourceData = {
  themes: { part: string; name: string | null;
    colors: { slot: string; kind: string; value: string | null; lastColor: string | null }[];
    fonts: { family: "major" | "minor"; slot: string; script: string | null; typeface: string | null }[] }[];
  fontTables: { part: string; fonts: { name: string | null; alternateName: string | null;
    charset: string | null; family: string | null; pitch: string | null;
    embedded: { kind: string; id: string | null; fontKey: string | null;
      subsetted: string | null; target: string | null;
      status: "resolved" | "invalid-font-reference" }[] }[] }[];
  references: { part: string; path: number[]; attribute: string; value: string;
    resource: string | null;
    status: "resolved" | "missing-theme" | "invalid-theme-reference" | "missing-theme-slot" }[];
  languages: { part: string; values: Record<string, string> }[];
  colorMappings: { part: string; values: Record<string, string> }[];
  diagnostics: { code: string; part: string; message: string }[];
  availability: null; licensing: null; embeddedFontMutation: "unsupported";
};
type ValidationData = {
  valid: boolean;
  profile: "core-v1";
  checks: { id: string; status: "passed" | "failed" | "unvalidated" }[];
};
type TextData = {
  text: string;
  view: "final" | "original" | "all";
  segments: { text: string; location: Location; revision: "insert" | "delete" | "unchanged" }[];
};
type XmlData = {
  part: string;
  encoding: "base64" | "utf-8";
  content: string;
  pretty: boolean;
  bytes: number;
  sha256: string;
};
type Change = {
  kind: "add" | "set" | "remove" | "replace";
  before: Location | null;
  after: Location | null;
};
type MutationData = {
  changed: boolean;
  changes: Change[];
  output: { path: string | null; bytes: number; sha256: string } | null;
  dryRun: boolean;
};
type DiffData = {
  equal: boolean;
  mode: "parts" | "xml" | "text" | "structure";
  differences: {
    kind: "add" | "remove" | "change";
    left: Location | null;
    right: Location | null;
    part: string;
  }[];
};
type ExtractionData = {
  complete: boolean;
  inventory: PackageInventoryV1 | null;
  manifest?: { path: string; bytes: number; sha256: string; published: boolean } | null;
  entries: {
    path: string;
    part: string;
    bytes: number;
    sha256: string;
    locations: Location[];
    published: boolean;
  }[];
};
type ImageExtractionManifestV1 = {
  version: 1;
  kind: "images";
  entries: { path: string; part: string; bytes: number; sha256: string; locations: Location[] }[];
};
type ModelData = { value: ModelResultValue };
type BatchData = { results: OfficeResultV1<ModelResultValue>[]; publication: MutationData | null };
type FeatureSupport = {
  id: string;
  level: "edit" | "read" | "preserve" | "reject";
  subsets: { name: string; level: "edit" | "read" | "preserve" | "reject"; reason: string }[];
  detected: boolean | null;
};
type CapabilitiesData = {
  features: FeatureSupport[];
  host: { read: boolean; atomicReplace: boolean; transactions: boolean; binaryStdout: boolean };
  limits: { name: string; ceiling: number }[];
};
type VersionData = { name: "docx"; version: string; schemaVersion: 1 };
type HelpData = {
  name: "docx";
  paths: { path: string[]; usage: string; description: string; operationIds: string[] }[];
};
type SchemaData = {
  schemaVersion: 1;
  operations: {
    id: string;
    path: string[];
    input: JsonSchema;
    result: JsonSchema;
    featureIds: string[];
    support: "edit" | "read" | "preserve" | "reject";
  }[];
};
```

The bounded style utility uses the following closed result types instead of the
planned generic resource/location records. Style/default reads return the full
inspection envelope, with get narrowing `styles` to one exact name and defaults
get retaining the definition list. Raw metadata is inert retained XML. Resolved
values cover only the supported subset, not layout or conditional table/theme
resolution; OOXML toggle flags follow style toggle inheritance, while absolute
flags preserve explicit false. Built-in aliases use their finite documented name
map; custom names remain case-sensitive. Size/spacing reads are
points, except relative line spacing is a multiplier. Unresolved style references
use document defaults or inherited formatting and produce a validation warning;
missing required reference values and invalid relationship types remain errors.
A cyclic base chain yields null effective properties and diagnostics.

```typescript
type StyleProperties = {
  bold: boolean | null; italic: boolean | null; allCaps: boolean | null;
  complexScriptEnabled: boolean | null; csBold: boolean | null; csItalic: boolean | null;
  doubleStrike: boolean | null; emboss: boolean | null; imprint: boolean | null;
  math: boolean | null; noProof: boolean | null; outline: boolean | null;
  shadow: boolean | null; smallCaps: boolean | null; snapToGrid: boolean | null;
  specVanish: boolean | null; webHidden: boolean | null; strike: boolean | null;
  fontHidden: boolean | null; rtl: boolean | null;
  font: string | null; size: number | null; color: string | null;
  themeColor: string | null; underline: string | null; highlight: string | null;
  baseline: string | null; language: string | null;
  outlineLevel: number | null; keepWithNext: boolean | null;
  keepTogether: boolean | null; widowControl: boolean | null; pageBreakBefore: boolean | null;
  spaceBefore: number | null; spaceAfter: number | null;
  leftIndent: number | null; rightIndent: number | null; firstLineIndent: number | null;
  lineSpacing: number | null; lineSpacingRule: string | null; alignment: string | null;
  tabStops: { position: number; alignment: string; leader: string }[] | null;
  numbering: { id: string | null; level: number | null } | null;
};
type StyleInspectionData = {
  styles: {
    id: string; name: string; type: string; builtin: boolean;
    base: string | null; next: string | null; linkedStyle: string | null;
    defaultForType: boolean; priority: number | null;
    hidden: boolean; locked: boolean; quickStyle: boolean; unhideWhenUsed: boolean;
    direct: StyleProperties; effective: StyleProperties | null;
    runXml: string | null; paragraphXml: string | null; tableXml: string | null;
  }[];
  defaults: { run: StyleProperties; paragraph: StyleProperties };
  latentXml: string | null;
  latent: {
    defaults: { defaultToHidden: boolean; defaultToLocked: boolean;
      defaultToQuickStyle: boolean; defaultToUnhideWhenUsed: boolean;
      defaultPriority: number | null; loadCount: number | null };
    entries: { name: string; hidden: boolean | null; locked: boolean | null;
      quickStyle: boolean | null; unhideWhenUsed: boolean | null; priority: number | null }[];
  } | null;
  diagnostics: { code: string; part: string; location: string; message: string }[];
};
type StyleMutationData = {
  changed: boolean;
  changes: { kind: "style"; id: string }[];
  dryRun: boolean;
  output: { path: string | null; bytes: number; sha256: string } | null;
};
```

Style mutations report each changed definition once (including reciprocal/default
updates); document-default changes use ID `docDefaults`; latent-default changes
use `latentStyles`, and individual exceptions use their names. Their `affected` is the
change count and `locations` is empty. Existing common error/publication rules
apply. These utility result types do not establish full document-model coverage;
the style-formatting evidence separately records implemented live members,
inherited interfaces, enums and collections.

Compound resource data uses a closed, resource-discriminated `details` union.
It is required for the listed resource kinds and absent for other kinds; scalar
properties are encoded as native values (lengths as integer EMUs, enums as their
canonical symbol string, dates as UTC strings). Null reads remain explicit.

```typescript
type ResourceDetails =
  | {
      kind: "images";
      part: string | null;
      mime: string | null;
      declaredMime: string | null;
      bytes: number | null;
      sha256: string | null;
      pixelWidth: number | null;
      pixelHeight: number | null;
      widthEmu: number | null;
      heightEmu: number | null;
      placement: "inline" | "floating" | null;
      crop: { left: number; right: number; top: number; bottom: number } | null;
      rotation: number | null;
      flipHorizontal: boolean | null;
      flipVertical: boolean | null;
      wrap: "none" | "square" | "tight" | "through" | "top-bottom" | null;
      zOrder: number | null;
      wrapText: "bothSides" | "left" | "right" | "largest" | null;
      wrapPolygon: { start: { x: number; y: number };
        lineTo: { x: number; y: number }[] } | null;
      distances: { top: number | null; bottom: number | null;
        left: number | null; right: number | null } | null;
      allowOverlap: boolean | null;
      behindText: boolean | null;
      lockAspect: boolean | null;
      horizontalPosition: {
        relativeFrom: string | null; offsetEmu: number | null; alignment: string | null;
      } | null;
      verticalPosition: {
        relativeFrom: string | null; offsetEmu: number | null; alignment: string | null;
      } | null;
      alt: string | null;
      decorative: boolean | null;
      owners: Location[];
      fallbackPart: string | null;
      alternateParts: string[];
      linked: boolean;
    }
  | {
      kind: "tables";
      rows: number;
      columns: number;
      cells: {
        row: number;
        column: number;
        rowSpan: number;
        columnSpan: number;
        location: Location;
        text: string;
      }[];
      omitted: { row: number; before: number; after: number }[];
    }
  | {
      kind: "controls";
      type:
        | "plain"
        | "rich"
        | "checkbox"
        | "choice"
        | "date"
        | "picture"
        | "repeat"
        | "unsupported";
      tag: string | null;
      locked: boolean;
      binding: string | null;
      options: { value: string; label: string }[];
    }
  | {
      kind: "comments";
      commentId: number;
      author: string;
      timestamp: string | null;
      initials: string | null;
      modern: boolean;
      anchors: Location[];
    }
  | {
      kind: "revisions";
      revisionId: number;
      author: string;
      timestamp: string | null;
      type: "insert" | "delete" | "format" | "move" | "table" | "section" | "unsupported";
    }
  | { kind: "notes"; noteId: number; type: "footnote" | "endnote"; references: Location[] }
  | {
      kind: "fields";
      instruction: string;
      result: string;
      nested: Location[];
      type: "PAGE" | "NUMPAGES" | "REF" | "PAGEREF" | "SEQ" | "TOC" | "unsupported";
      update: boolean;
    }
  | ChartDetails
  | DiagramDetails
  | EquationDetails
  | {
      kind: "headers" | "footers";
      section: number;
      variant: "default" | "first" | "even";
      linked: boolean;
      owners: number[];
    }
  | {
      kind:
        | "shapes"
        | "objects"
        | "signatures"
        | "fonts";
      parts: { name: string; contentType: string; bytes: number; sha256: string }[];
    }
  | {
      kind: "property";
      group: "core" | "extended" | "custom";
      storedType: { namespace: string; localName: string } | null;
      id: string | null;
    }
  | {
      kind: "custom-xml";
      parts: { name: string; contentType: string; bytes: number; sha256: string }[];
      root: { namespace: string; localName: string } | null;
      storeItemId: string | null;
      propertiesParts: string[];
      namespaces: { prefix: string; uri: string }[];
      schemaReferences: string[];
    }
  | {
      kind: "glossary";
      parts: { name: string; contentType: string; bytes: number; sha256: string }[];
      buildingBlocks: {
        path: number[]; name: string | null; guid: string | null;
        category: string | null; gallery: string | null;
        types: string[]; behaviors: string[];
      }[];
    };
```

Table cells lists each physical anchor once; omitted slots are not fabricated.
Merged continuations refer to the anchor location through the logical grid.
The bounded `tables.get` utility returns `{item}` with kind `tables`, the owning
table location, support `read` and these structural `details`; its properties and
references arrays are empty until the complete table property inventory is
implemented. Cell selection inspects its nearest owning table. The bounded
`TableEditData` retains the paragraph transaction receipt: changed, changes,
output and dryRun. Each change has kind `format`, `replace`, `insert` or `delete`,
before and after. Cell edits return the resulting physical cell location;
structural edits return the surviving table location. The affected count is the
number of directly selected objects changed. These bounded receipts do not
establish live table-model or general model-batch coverage.
Image unique mode returns one record per identical byte hash with all owners;
grouping occurs after selection and includes only selected owners. The first
selected occurrence supplies the representative Location and occurrence-local
geometry; its geometry MUST NOT be presented as shared by the other owners.
All exact selected owner-local references and distinct part identities remain
available through references and alternateParts. Null hashes never group.
linked-only drawings remain individual records with null hash/pixel dimensions
and no acquisition. Noncreating absent header/footer records use section binding
locations, empty text, linked state and an empty owners list when no definition
exists. This avoids inventing a location in a nonexistent part. Inventory records
for opaque content always retain part references even when semantic fields are
unavailable; required unsupported-field alternatives are explicit.

The bounded header/footer utility uses `StoryReadData = { items: StoryRecord[] }`
for both list and get; get returns one record, while list includes default/first/even
in section order, including absent definitions. Each StoryRecord contains kind,
section, variant, part (string or null), linked (boolean), sourceSection (number
or null), owners (unique section numbers), text and location. Text includes cached
field results. Absent definitions use the section location as described above.
`StoryEditData` contains changed, changes, output and dryRun with the ordinary
publication meanings, plus affectedSections (unique section numbers). Each change
contains kind (`replace`, `remove` or `bind`), before and after section locations;
remove records the surviving section binding owner, not a deleted-part location.
The envelope affected count is the number of semantically affected sections.
Physical downstream bindings inserted solely for isolation are reported by the
next inspection; they do not add semantic effects. General model/batch story
execution remains separately proposed.

ModelResultValue is the exact per-operation declared return, JSON-encoded using
owned bytes as base64, dates as UTC strings, units/enums as their typed records,
void as null, sequences as bounded arrays and live objects as owner-bound handles.
It is not an arbitrary recursive JSON object. Direct resource properties use the
closed set of scalar fields admitted by that resource's section 6.4 setter plus
its declared model read properties; list/get additionally expose image MIME/hash/
pixel and EMU dimensions, crop/anchor/fallback/owners, review IDs/author/timestamp,
control type/tag/locked/binding/options, field instruction/kind/cached result,
table row/column/span counts and style type/base. Schema MUST enumerate each
resource's property names and types from these declarations and model read rows;
unknown extension data is represented by part references and preserve support,
not guessed editable properties. Missing nullable model values are null; a missing
resource get is missing-selection rather than a fabricated item. Empty list is
`items:[]`. `properties get/list` encode one/all PropertyValue entries in resource
records, with part-root location. Hashes are SHA-256 except explicit image model
compatibility sha1. XmlData defaults original bytes encoded base64; pretty uses
UTF-8 and reports original bytes/hash for provenance. JsonSchema means a fully
resolved JSON Schema document, with no dependency on internal implementation
objects or network resolution.

`affected` counts directly targeted logical objects once: replacements count
matches, resource actions count unique target nodes, shared actions count all
changed occurrences, sanitization counts removed logical records, create/pack
count the new document (1), batch sums successful item counts. Read/diff/extraction
and prepublication failures count zero. Dry-run reports prospective affected
counts and changes, with output null and changed indicating the proposed edit.
Validation failure follows the shared error rule (`data:null`); individual check
failures are bounded diagnostics, not an exception to the envelope. Diff equal
false is successful data with exit 1. Successful schema/capabilities output must
report actual support, not this proposal as implemented functionality.

| Stable code               | Ordinary exit | Condition                                                                         |
| ------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `usage`                   | 2             | Unknown path/key/flag, type/value error, bad arity, syntax or conflicting options |
| `invalid-container`       | 1             | Invalid ZIP/container structure or CRC                                            |
| `invalid-xml`             | 1             | Invalid encoding, well-formedness or prohibited XML declarations                  |
| `invalid-package`         | 1             | Invalid relationships, content types or semantic graph                            |
| `unsupported-profile`     | 1             | Recognized document/dialect/security profile not admitted                         |
| `unsupported-edit`        | 1             | Affected feature is preserve-only, protected, signed or unsupported               |
| `ambiguous-selection`     | 1             | Multiple owners, ambiguous label or merged range                                  |
| `stale-selection`         | 1             | Location/handle guard no longer matches                                           |
| `missing-selection`       | 1             | Required valid target cannot be found or index/key is absent                      |
| `conflict`                | 1             | Existing destination, alias intent, source version or ownership conflict          |
| `limit-exceeded`          | 4             | Any actual configured byte/node/work limit exceeded                               |
| `permission`              | 3             | Supplied VFS lacks granted access                                                 |
| `unsupported-publication` | 3             | Required atomic/conditional/transaction capability unavailable                    |
| `source-failure`          | 3             | Source read, inventory file or transport failed                                   |
| `sink-failure`            | 3             | Serialization destination write/commit failed                                     |
| `cancelled`               | 130           | Cooperative cancellation, including settled cleanup                               |

ErrorCode is precisely the table's union. Missing selection _syntax_ is usage;
a syntactically valid selector with no target is missing-selection. Invalid
caller values map to neutral InputTypeError/InvalidValueError (TypeError/RangeError),
sequence/key errors to BoundsError/MissingKeyError, ownership to OwnershipError,
stale handles to StaleHandleError, semantic graph to SemanticValidationError,
budgets to ResourceLimitError, I/O to SourceError/SinkError/PermissionError,
publication to PublicationError and cancellation to CancellationError. They expose
stable code and bounded context; nullable lookups remain null. All diff failures
except cancelled translate to exit 2 while retaining these detailed codes. Partial
multi-file publication alone may carry ExtractionData on error. Diagnostic text
must not expose document content, host credentials or reference-project identity.

### 6.8 Whole public surface and independent acceptance

The command register MUST associate every operation (including model getters,
setters, inherited members, enum/collection/helper discovery and APIs without
source tests) with one or more F01–F50 IDs and original acceptance IDs. An API
that is preserve-only maps to inspect/retention/rejection evidence, never disappears
because its type starts with an underscore. Discovery maps to F06/F49 and covers
the entire schema; type/error records are exposed as schema data, not fake editing
commands. The exact JS language/security mappings in section 9.2 and register
M-VALUES through M-CLI apply to every associated member. Documentation drift
resolutions remain explicit evidence, including comment_id/timestamp, scoped
lookup, table_direction, nullable setter differences and native per-axis DPI.

The [owned acceptance procedure](../plans/docx-grammar-refinement.md) separates
this documentary grammar check from later product conformance. The register's
per-command tests, per-member API cases, per-feature independent scenarios and
language-mapping cases are required collectively: parity between two entry points
alone is insufficient. Each case must construct original in-memory assets and
assert semantic/byte/value outcomes independently of the editor. All cases remain
planned until failing original tests, implementation and maintained checks have
actually run. No downloaded document or reference binary is a canonical fixture.

## 7. Configuration and defaults

No environment variables or implicit configuration files are required. Trusted
host options set ceilings; operation/CLI options MAY lower them and MUST NOT
raise them. Invalid, nonfinite, negative, fractional or unsafe-integer limits
MUST fail before processing. Counts requiring nonzero capacity reject zero.

Proposed default ceilings, to be tested against the corpus before readiness:

| Resource                    | Default ceiling                                               |
| --------------------------- | ------------------------------------------------------------- |
| Compressed input            | 64 MiB per document; two-input operations account both        |
| Expanded package            | 256 MiB per document                                          |
| ZIP entries                 | 10,000 per document                                           |
| Individual XML part         | 32 MiB                                                        |
| XML nodes/depth             | 2,000,000 nodes; depth 256                                    |
| Embedded media              | 64 MiB per item, also charged to expanded/retained limits     |
| Retained owned byte buffers | 512 MiB per invocation, including copies and both diff inputs |
| Serialized output           | 256 MiB                                                       |
| Batch operations            | 1,000                                                         |
| Matches/inserted nodes      | 100,000 matches; 1,000,000 new XML nodes                      |
| Table expansion             | 100,000 cells; 10,000 rows; 1,024 columns per table           |
| Ordinary diagnostics        | 64 KiB, with deterministic truncation indication              |

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
surviving prefixes/suffixes retain their properties. The bounded utility exposes
optional `bold` and `italic` boolean overrides (`--bold true|false`,
`--italic true|false`); omission preserves the first matched run property. Other
run properties are inherited without reconstruction. Empty search strings fail.

Unambiguous selection is required. `text replace` MUST require exactly one of `--first`, `--all`, `--occurrence N`,
even when there is only one match. Missing or conflicting cardinality flags are
usage errors. Missing matches fail unless operation option `allowEmpty` or CLI
`--allow-empty` is explicitly selected; this permits a zero-change result, not
ambiguous selection or invalid options. There is no alternate missing-match alias.
Source locations MUST detect stale fingerprints. Broad operations MUST report
all affected locations within bounded structured output or fail admission.

Shared images, headers, footers and other parts require explicit shared-resource
versus one-occurrence intent. Editing one occurrence MUST clone/rebind only the
necessary part instead of accidentally modifying every reference.

Image changes MUST retain original drawing properties unless specifically
changed. Raster format is determined from bytes, not extension. CLI dimensions
use explicit shared physical units and checked half-away rounding; px is not an
accepted unit. This MUST NOT replace the model API native-image size default.

For model `Document.add_picture`, `Run.add_picture` and admitted-image dimension
helpers, absent width and height use pixel width / horizontal DPI and pixel
height / vertical DPI, each multiplied by 914,400 EMU per inch. Each missing DPI
axis independently falls back to 72. Invalid metadata MUST NOT cause division
by zero, nonfinite dimensions or unbounded parsing; characterization reports
invalid/unsupported metadata under the admission contract. A single explicit
dimension scales the native physical aspect ratio; two explicit dimensions set
both extents. Model numeric dimensions are EMUs, not implicit pixels. The CLI
image insertion default without dimensions follows this native sizing too;
the CLI accepts no implicit pixel unit and uses only the shared explicit units. Replacement
preserves existing drawing extents unless resizing is requested. Shared rounding
and safe-range validation apply to all computed extents. These conventions are
API contracts, not ECMA requirements.

Characterization MUST cover PNG, JPEG JFIF/Exif, GIF87a/89a, BMP and both-endian
TIFF using bounded byte signatures and header/metadata traversal. Retain exact
bytes, MIME type, pixel dimensions and per-axis DPI; reject truncated headers,
invalid dimensions and unsafe offsets before mutation. No host decoder is
required. A documented image `sha1` is compatibility metadata only; provenance
and package identity use SHA-256. Linked-only drawings MUST NOT satisfy the
embedded-picture predicate or cause target acquisition; requesting their embedded
image fails with a neutral missing/unsupported-content error.

Dimensions, crop fractions, rotation and coordinates are range-checked according
to their declared schema, without silently clamping admitted values. Unsupported
vector/native formats MUST remain inert and preserve fallback relationships.
Alt text is distinct from filenames and optional decorative status.

For `images add`, `decorative` is an optional boolean, default false; true
conflicts with nonempty alt text. Inline insertion appends a drawing run to a
selected whole paragraph. A selected admitted block container, or the unique
unselected body, instead receives a new trailing paragraph containing that run
(before terminal body section properties). Header/footer and note containers
require an explicit owning selection; the command MUST NOT choose a first
paragraph or one of multiple owners. Run, caret and range targets are rejected;
`--all` is not an image-add option.

Recognized source-path suffixes png, jpg/jpeg, gif, bmp and tif/tiff assert the
corresponding raster type and MUST match byte characterization before mutation.
An absent or unrecognized suffix does not assert a type. Bytes remain the format
authority; caller-declared media types, where admitted, MUST match them too.

Characterization MUST check every header interval, segment length and metadata
offset before traversal, under existing media, entry, work and retained-byte
limits. Duplicate or cyclic metadata directories and conflicting duplicate
metadata are rejected. Pixel dimensions MUST be positive integers within the
format's encoded domain: PNG at most 2^31-1 per axis, JPEG/GIF unsigned 16-bit,
BMP positive signed 32-bit width and absolute nonzero signed 32-bit height, and
TIFF SHORT/LONG dimensions. Computed drawing extents MUST be positive safe
integer EMUs after shared rounding. Header characterization does not allocate
pixel arrays or introduce an implicit decoded-area limit.

Absent density, aspect-only density units and legally unspecified zero density
axes remain null; native sizing independently uses 72 DPI for each null axis.
Positive pixels-per-metre values convert with factor 0.0254; physical inch/cm
densities convert per axis. TIFF/Exif physical resolution requires positive
finite rational values and nonzero denominators. Unsafe offsets, invalid units
and invalid physical resolution are rejected before mutation. Characterization
does not imply full pixel decoding or successful rendering.

**Standalone image model.** `Image.from_blob(blob, context?)` admits owned bytes;
`Image.from_file(image_descriptor, context?)` admits owned bytes, an explicitly
supplied byte-source capability, or a VFS path with its matching explicit
capability. Both factories MUST always return a Promise. The admitted `Image`
is an immutable value independent of a document owner; it grants no package,
relationship, collection or mutation authority. Omitted context supplies only
the documented intrinsic limits and cancellation machinery, never ambient I/O,
network, time, identity or font authority. A supplied byte source exposes
`open(signal): AsyncIterable<Uint8Array>`; acquisition MUST forward cancellation,
copy retained producer fragments before advancing, bound bytes/work/retention
before allocation and await cooperative iterator cleanup on failure. JSON
operations use finite owned base64 or capability-bearing VFS descriptors as
equivalents; live streams MUST NOT be serialized or inferred from filenames.

The model exposes synchronous `blob`, `content_type`, `ext`, `filename`,
`px_width`, `px_height`, `horz_dpi`, `vert_dpi`, `width`, `height`,
`scaled_dimensions(width?, height?)` and `sha1`. Every `blob` access MUST return
an owned copy under the retained-byte/work limits. Bytes and unnamed streams use
`image.<canonical-extension>` with png, jpg, gif, bmp or tiff according to the
characterized MIME type. A VFS input retains its virtual POSIX basename as
`filename`; `ext` is that filename's final suffix without the dot, retaining
case, unknown suffixes and an empty suffix. These filename properties are
metadata, not type authority. Recognized suffix assertions above apply at model
admission too; unknown suffixes do not change `content_type`.

Effective model DPI getters MUST preserve characterized positive fractional
values and independently substitute 72 for null axes. They MUST NOT round
pixels-per-metre conversions or substitute 96. Native `width` and `height`
return shared `Inches` length values from the corresponding pixel/DPI axis.
`scaled_dimensions` returns an immutable two-element shared `Length` tuple:
omitted/undefined/null dimensions use native dimensions; one supplied dimension
preserves the unrounded physical native aspect ratio; two supplied dimensions
are independent. Numeric dimensions denote EMUs; declared shared length units
are accepted without implicit numeric coercion. Final dimensions MUST be positive
safe integer EMUs using shared halfway-away-from-zero rounding. Computing two
explicit dimensions MUST NOT require rounded native extents to be positive.
Invalid types, units, values or unsafe results fail with neutral typed errors.
`sha1` is the lowercase 40-hex digest of the exact owned admitted bytes, computed
within bounded admission work; it is never an authentication or provenance seal.
These value APIs do not qualify image-part, drawing or collection APIs.

Read-only protection and locked controls MUST NOT be silently bypassed. Signed
documents require explicit signature removal before mutation. Field result
updates MUST preserve instructions and MUST NOT execute them; a subsequent Word
recalculation may replace cached values. Page counts read from metadata MUST be
labeled cached, not measured rendered pages.

### 9.1 Public model semantics

These requirements refine F01–F50 without narrowing the shared SDK surface.
Public inherited members, collections, enum values/aliases, helpers, returned
views and documented underscore-prefixed types MUST retain evidence-backed
coverage, including behaviors without a collected source test. The research
register supplies per-member signatures and discrepancy provenance; this format
contract and the shared contracts govern conflicts.

**Tables (F19–F20).** Physical cells and logical grid slots MUST remain distinct.
Leading/trailing omitted slots are reported by `grid_cols_before` and
`grid_cols_after`; they MUST NOT become fabricated empty cells. Horizontal spans
and vertical continuations resolve to their owning cell; repeated logical slots
MUST observe the same edits and owner/node equality, without requiring wrapper
allocation identity. Row access includes horizontal repetition and vertical
continuation resolution. Nested block traversal retains paragraph/table order.
Cell replacement and table insertion MUST retain required terminal paragraphs.
Rectangular merges preserve cell content in reading order and combine defined
widths; nonrectangular or partial-overlap merges reject before mutation. Split
behavior remains an additive format requirement and MUST NOT be inferred from
source merge coverage. `table_direction`, nullable alignment and widths retain
their distinct read/write types; no `direction` alias is introduced.

**Sections and stories (F16–F17).** All default/first/even header and footer
variants are exposed separately. Absent definitions inherit recursively from the
previous section. An initial section with no definition reads as an empty story;
model content access that requires a definition may materialize it as documented.
Unlinking materializes a local definition, while relinking removes the local
binding/definition only when no remaining reference needs it. Such transitions
MUST retain required empty paragraphs and section properties. Editing a linked
model story changes its shared owner; CLI one-occurrence edits instead require
the explicit clone/rebind intent above. Read-only inspection MUST use noncreating
queries and leave package bytes unchanged. First/even display settings do not
delete the corresponding story definitions. Orientation assignment alone MUST
NOT swap page width and height. Section block traversal preserves document order.

**Styles and formatting (F09, F12–F15).** Direct values and inherited absence
MUST remain distinguishable; explicit false is not absence. Base-style chains,
defaults, linked styles and next-paragraph style are retained without flattening
formatting. Resolution MUST be bounded and diagnose cycles. Unknown assignment
names fail; reading a dangling style reference may return the applicable default.
Deleting a definition MUST NOT delete styled content. Styles use string names,
not numeric or enum indexing; deprecated ID fallback remains explicitly described
as such, not an alternate naming algorithm. Built-in names retain spaces and
custom names are exact. `base_style` exists only on the applicable style types;
`priority` retains its spelling. Next-paragraph-style null assignment resets to
the documented self fallback. Defined-style hidden/locked/gallery/unhide flags
reset to false on null assignment; latent overrides retain null/inheritance.
Latent default priority and load count allow their documented null reset.

The complete font flags, language/complex-script/RTL properties, underline
boolean/enum states, RGB/theme/null behavior, tabs/leaders, spacing and pagination
properties MUST remain covered. Tab insertion/movement maintains position order;
a moved handle follows its current node and detached XML views fail as stale.
Line-spacing numbers denote multiples; `Length` values denote physical spacing.
Run text assignment retains run formatting; paragraph text assignment replaces
runs and removes their formatting while retaining paragraph formatting. Both
`w:cr` and line `w:br` read as newlines; new line breaks serialize as `w:br`.
Clear operations retain the documented owning container properties. These
setters MUST NOT be substituted for preserving literal replacement.

**Numbering (F18).** Concrete numbering instances, abstract definitions, levels,
style links and start/restart overrides MUST retain scoped reference integrity.
Restarting one list MUST NOT reset other instances sharing its abstract definition.
Removing one list retains still-referenced definitions and picture-bullet media.
Missing definitions, invalid levels and cycles require bounded diagnostics;
ambiguous edits reject. Low source numbering coverage does not reduce this scope.

**Links and cached breaks (F08, F13, F21–F23).** Paragraph traversal MUST preserve
run/hyperlink order. Hyperlink text, runs, address, fragment, assembled URL and
history flag remain distinct values, including internal fragment-only targets.
No getter follows external targets. Relationship ownership is story-relative.
The model `url` is empty for a fragment-only internal link; otherwise it is
the address, with `#` plus the separate fragment appended when present. The
address itself remains unnormalized data, including any embedded fragment.

The bounded link utility appends new label text to a selected paragraph. Exactly
one of `target` or `bookmark` is required for add/set. `bookmark` here is a string
destination name, not the numeric bookmark selector used by other resources.
Names use ASCII letters or underscore first, then letters/digits/underscore,
at most 40 characters; this permits conventional hidden anchors. References need
not resolve to an existing bookmark, and no bookmark is created implicitly.
Targets allow absolute HTTP, HTTPS and mailto URLs only; no network or host I/O
is performed. Controls, raw whitespace/backslashes, malformed percent escapes,
HTTP URLs without an explicit authority, credentials and empty mailto paths reject.
Percent escapes and target fragments remain stored data, never decoded/normalized
into a replacement address. Set replaces the destination and clears the old
separate anchor/document location while retaining label runs and history.
Remove unwraps those runs without changing formatting, or deletes the complete
link content only with explicit `deleteContent: true`. Only relationships no
longer referenced in the owning XML part may be removed; other owners and
unselected compatibility branches retain their relationships. The bounded editor
accepts direct paragraph hyperlinks and rejects tracked/controlled wrappers,
opaque affected edits, ranges and ambiguous shared header/footer mutation.

The bounded [bookmark range milestone](../plans/docx-bookmarks.md) implements
bookmarks list/add/set/remove. Add uses a nonempty paragraph scalar-range token,
including multi-run and table-cell ranges. Inspection reports duplicate IDs/names,
missing or reversed ends, illegal boundaries, nested overlaps and crossings.
Malformed structures yield document-wide issues and no usable location items.
Rename updates internal anchors and literal simple/complex REF/PAGEREF operands
only with explicit `references: "update"`; `reject` refuses dependent edits.
Removal requires `remove` or `reject`, retains bookmark content, and unwraps
supported simple references under `remove`. Complex-field removal and opaque or
unsafe dependencies reject. Fields are never executed. Existing multi-paragraph
ranges within one admitted container can be renamed/removed; creation is limited
to one paragraph. The bounded profile requires document-wide name/ID uniqueness
and refuses shared-story edits. General field and live-model APIs remain pending.

Rendered page-break objects describe stored layout metadata, not measured pages
or newly requested hard breaks. Presence, order and preceding/following paragraph
fragments MUST be exposed without modifying source content. Missing fragments
at paragraph boundaries return null. Returned fragments are detached paragraphs;
mutating a fragment MUST NOT edit the source document. A cached break inside a hyperlink places
the whole hyperlink in the preceding fragment and starts the following fragment
after it, preserving the documented extraction convention without relocating
source XML. No fragment query recalculates layout. Cached-break metadata MUST
NOT add a visible newline to ordinary paragraph/run text.

**Comments (F25).** Anchors require a nonempty contiguous range at run boundaries
within an admitted story; cross-story, nested-comment and header/footer anchors
reject. Anchoring spans every run between the selected endpoints. Rich comment
bodies retain ordered paragraphs/tables and run content including admitted images.
`comment_id` and `timestamp` remain read-only; lookup by absent ID returns null.
Omitted text means an empty string; null text rejects before mutation. Paragraphs
own `add_run`; comment collections have no `paragraphs` member and comments have
no direct `add_run` alias. Author/initials defaults are empty strings, null initials
removes the attribute, and time comes from explicit context. Modern/threaded
metadata remains preserve-only until separately verified.

### 9.2 JavaScript values and authority

The shared SDK's always-async admission/publication and synchronous admitted
model access MUST apply consistently. Paths require supplied VFS authority;
bytes are owned `Uint8Array` copies. Model names stay neutral snake_case, while
operation options retain shared camelCase. Python sequence protocols map to
`.length`, `Symbol.iterator`, zero-based access and explicit `.at`; negative
indices and `.slice` are supported only by the documented sequence surface.
Keyed styles/relationships keep key semantics; relationships retain `get` and
`items`, with keyed `at` for throwing lookup. No extra spelling aliases arise
from language mapping. Owner/node `.equals` replaces private wrapper identity.

EMU/inch/cm/mm/point/twip helpers MUST use safe integer EMU storage and shared
nearest, halfway-away-from-zero conversion, including negative supported values.
Enum symbols, values, aliases and XML conversions remain typed; unmapped values
fail and documentation typos MUST NOT invent enum members. RGB strings require
exactly six ASCII hex digits, accept either case and serialize uppercase; no
prefix, whitespace or coercion is accepted. Color transforms outside the declared
model remain preserved, without inventing an unlisted luminance setter.

Dates MUST be copied UTC instants, normalized before whole-second serialization;
invalid assignments fail. Missing/invalid stored core dates read null, with
validation diagnostics as applicable. Core string assignments require strings
of at most 255 Unicode code points; revision reads may yield zero but writes
require positive safe integers. Nullable reads MUST NOT imply nullable writes.

Source type/value/index/key failures map to neutral typed input-type,
invalid-value/semantic-validation, bounds and missing-key errors with the shared
operation-context codes; nullable lookups stay null. `.element`, `._drawing` and
`.part` expose owner-bound, bounded XML/package views: tags/namespaces, attributes,
ordered children, text/tail, bytes, content types and scoped relationships with
validated mutation. They MUST NOT expose arbitrary XPath, evaluation, dynamic
method dispatch, host resources or dependency runtime APIs. Private loader/mock
mechanics require an explicit observable-equivalence rationale; public behavior
MUST NOT be excluded merely because its type name begins with an underscore.

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

The [contract reconciliation evidence](../docx/contract-reconciliation.md)
records feature-by-feature original acceptance targets and intentional behavior
differences. Its linked API and test registers retain individual identities and
pending evidence; their counts MUST NOT be presented as implementation coverage.

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

| Requirement                     | Required evidence                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| F01–F05 package/XML/dialects    | Original malformed and valid fixtures; independent OPC/XML assertions; Strict/Transitional and MCE fixtures; bounded ZIP tests.              |
| F06–F15 reading/text/formatting | Exact logical text and JSON output; cross-run Unicode cases; untouched subtree and formatting checks.                                        |
| F16–F24 document structure      | Section/story alias checks; table-grid and numbering invariants; notes/bookmarks/field graphs and stale-location tests.                      |
| F25–F30 review/forms/properties | Annotation/revision range checks; explicit author/time; bound-control synchronization; typed property assertions.                            |
| F31–F40 graphics/math/objects   | Exact media hashes; shared-reference tests; dimensions/crop/anchors; fallback/opaque-part retention; no external activation.                 |
| F41–F46 preservation/security   | Opaque-part round trips; protection/signature refusal and explicit stripping; exact sanitization effects.                                    |
| F47–F50 compound workflows      | Batch failure preservation; semantic diff controls; independent final package validation; safe extract/repack.                               |
| CLI/SDK parity                  | Published type/runtime consumers and actual safe-bash scripts, pipes, redirects, errors, help and cancellation.                              |
| Budgets/publication             | At/over boundary tests, reused chunks, aggregate accounting, sink failures, alias/capability conflicts and cleanup settlement.               |
| Large/image-heavy inputs        | Downloaded corpus plus labeled original stress fixtures; successful edits, not only rejection; measured structure and resource reports.      |
| Visual fidelity                 | Ad hoc CLI screenshots; available document renderer page screenshots and repair-warning checks, separately labeled from structural validity. |

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

- Microsoft extension revisions and schema witnesses are pinned in the standards
  register. Implemented schema/type-level completeness remains unverified;
  unknown extensions remain preserved and affected unsupported edits rejected.
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
