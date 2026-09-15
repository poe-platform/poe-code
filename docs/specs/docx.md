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
`edit` adds output/inPlace/force/dryRun/allowEmpty to read; `selectedEdit` adds
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
| `images add`            | selectedEdit | `file!`: VfsInput; `width?`: Length (explicit emu/in/cm/mm/pt); `height?`: Length (explicit emu/in/cm/mm/pt); `fit?`: contain / cover / stretch; `placement?`: inline / floating; `fallback?`: VfsInput; `alt?`: string                                                                                                                                                                                                                                                                                                                                                                                    | MutationData     | F06, F08, F11, F12, F31, F32, F35                                                                  |
| `images replace`        | selectedEdit | `file!`: VfsInput; `shared?`: boolean; `width?`: Length (explicit emu/in/cm/mm/pt); `height?`: Length (explicit emu/in/cm/mm/pt); `fit?`: contain / cover / stretch; `fallback?`: VfsInput                                                                                                                                                                                                                                                                                                                                                                                                                 | MutationData     | F32, F35                                                                                           |
| `images set`            | selectedEdit | `x?`: Length (explicit emu/in/cm/mm/pt); `y?`: Length (explicit emu/in/cm/mm/pt); `relativeTo?`: page / margin / column / paragraph / character; `wrap?`: none / square / tight / through / top-bottom; `zOrder?`: safe integer; `cropLeft?`: fraction 0..1; `cropRight?`: fraction 0..1; `cropTop?`: fraction 0..1; `cropBottom?`: fraction 0..1; `rotation?`: finite degrees; `flipHorizontal?`: boolean; `flipVertical?`: boolean; `alt?`: string; `decorative?`: boolean; `width?`: Length (explicit emu/in/cm/mm/pt); `height?`: Length (explicit emu/in/cm/mm/pt); `fit?`: contain / cover / stretch | MutationData     | F33                                                                                                |
| `images extract`        | extract      | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ExtractionData   | F31, F34                                                                                           |
| `shapes list`           | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F36                                                                                                |
| `charts list`           | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F37                                                                                                |
| `diagrams list`         | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F38                                                                                                |
| `equations list`        | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F39                                                                                                |
| `objects list`          | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F40                                                                                                |
| `signatures list`       | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F43                                                                                                |
| `settings list`         | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F42                                                                                                |
| `fonts list`            | selectedRead | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F42                                                                                                |
| `custom-xml list`       | read         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F41                                                                                                |
| `glossary list`         | read         | none                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | ResourceListData | F41                                                                                                |
| `shapes set`            | selectedEdit | `text!`: string                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | MutationData     | F36                                                                                                |
| `equations add`         | selectedEdit | `file!`: VfsInput                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MutationData     | F39                                                                                                |
| `equations replace`     | selectedEdit | `file!`: VfsInput                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | MutationData     | F39                                                                                                |
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
  anchors at x=0/y=0 relative to paragraph, wrap square, zOrder=0, no crop/rotation/
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
  Decorative true with nonempty alt conflicts. Shapes set edits supported text
  boxes only. Charts/diagrams/fonts/custom-XML/glossary expose inventory/preserve,
  not invented semantic editing commands. Equations add/replace require one
  bounded OMML math root, reject arbitrary surrounding WordprocessingML. Objects
  extract emits inert admitted bytes only, never activation.
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
  entries: {
    path: string;
    part: string;
    bytes: number;
    sha256: string;
    locations: Location[];
    published: boolean;
  }[];
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
      mime: string;
      sha256: string | null;
      pixelWidth: number | null;
      pixelHeight: number | null;
      widthEmu: number;
      heightEmu: number;
      placement: "inline" | "floating";
      crop: { left: number; right: number; top: number; bottom: number };
      rotation: number;
      owners: Location[];
      fallbackPart: string | null;
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
  | {
      kind: "charts";
      chartType: string;
      series: { name: string | null; cachedValues: (string | number | null)[] }[];
      workbookParts: string[];
    }
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
        | "diagrams"
        | "equations"
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
