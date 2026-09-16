# DOCX bounded validation profile

The `packages/docx` utility exports `validateDocumentArchive(archive, options?, budget?)`,
`documentValidationProfile`, `SemanticValidationError`, and
`writeDocumentArchive(archive, sink, options, context)`. This records the bounded
package-semantic-validation milestone, with the later
[hostile-input review](../plans/docx-malformed-input-adversarial-review.md).
The implemented `validateDocument(input, context, options?)` utility and
`docx validate` command consume these same checks. Live document owners, whole
public API coverage and rendering remain incomplete.

## Entry points and limits

Validation is synchronous over decoded, caller-owned archive members. Its result
contains `valid`, `profile: "core-v1"`, `checks`, `diagnostics`, and `warnings`.
It does not modify input, repair invalid markup, execute fields, fetch relationship
targets or consult host files, fonts, identity or time. Raw container integrity
must first be established by `readArchive` or `readDocumentArchive`.

Options are closed: `profile` (only `core-v1`), `maxParts` (4096), `maxBytes`
(33554432 aggregate member bytes), `maxNodes` (200000 aggregate XML elements),
and `maxDiagnostics` (1000). Numeric limits must be positive safe integers within
the trusted invocation ceilings described in [resource accounting](resource-limits.md).
Unknown keys/profiles and invalid values are `usage`; exceeding a ceiling is
`limit-exceeded`, not an invalid-document diagnostic or a successful truncated
report. XML parsing also retains its existing depth, attributes, text and work
ceilings. Metadata and dialect checks may parse the same part a bounded number
of times. The validator's local element allowance covers unique parts; the
invocation ledger additionally charges every parse, including retained attributes
and text/comment nodes, without resetting between phases.
Definition and relationship lookups use maps; style and numbering dependency
walks memoize completed chains.

`DocumentArchiveEditor.snapshot()` validates a staged package when it contains
`[Content_Types].xml`, before returning the snapshot. Internal XML encoding is
necessary to inspect the candidate; invalid bytes never escape as a document
snapshot. Low-level standalone XML editing and generic `writeArchive` remain
codec APIs, not document publication APIs. `writeDocumentArchive` validates
before ZIP serialization or any sink call. Creation uses that entry point.
The writer uses explicit archive limits/cancellation, limits semantic admission
to the smaller archive/default part and byte ceilings, and reserves 32 times
payload bytes plus 65536 bytes for validation before parsing. The existing ZIP
writer charges its serialization phase to the same invocation ledger. Sink writes are not a VFS
transaction; explicit VFS staging and destination publication are recorded in
[file publication evidence](file-publication.md).

`SemanticValidationError` extends `InvalidPackageError` and uses the shared
`invalid-package` code, carrying the detailed diagnostics. Valid unsupported
MCE requirements or container profiles throw `unsupported-profile`. No native
runtime, network, shell tool or downloaded fixture is a product dependency.

## Implemented checks

Semantic reference checks cover the main part and its directly related styles,
numbering, headers, footers, notes and comments. Other parts still undergo the
applicable XML/OPC/root checks; separate glossary and orphan definition scopes
remain unvalidated, rather than being incorrectly resolved against main styles.

| Check | Verified subset |
| --- | --- |
| Required parts and roots | Content-types and package relationships; exactly one internal fragment-free main relation; DOCX/DOTX main root and one active body; declared known WordprocessingML roots and dialect consistency |
| OPC | Existing safe part names, content-type declarations, owners, duplicate IDs and internal target existence; metadata failures carry their part and traversal location |
| Relationship agreement | Known WordprocessingML relationship/content types; owner-relative `r:id`, `r:embed`, `r:link` existence; hyperlink/header/footer/image usage types; internal image MIME family |
| Styles | Defined IDs, reference existence, paragraph/character/table usage types, bounded basedOn cycle detection |
| Numbering | Concrete/abstract IDs, required instance-to-abstract link, level IDs 0–8 and duplicates, selected concrete levels including explicit overrides and numbering-style indirection, dependency cycles; numId 0 removes numbering |
| Notes and comments | Numeric unique definition IDs within each part; references use definitions linked from the main document; note separator IDs -1/0 are admitted; individual note/comment/text-box field and bookmark scopes are isolated; paired comment ranges |
| Bookmarks and revisions | Numeric bookmark IDs, unique starts/names, preceding starts and matching ends per story, crossing bookmark ranges; nonnegative unique IDs for supported insertion/deletion/move and property-change elements; move/custom-XML revision range IDs and paired endpoints per story |
| Drawings | Document-wide `wp:docPr` IDs in unsigned 32-bit range, including duplicates across stories |
| Fields | Nested begin/separate/end balance per story and independently within simple-field containers, at most one separator per field; native simple instruction attribute required; instruction text belongs to an open pre-separator complex field and has no child elements; no evaluation or instruction-language parsing |
| Tables | One nonempty direct grid, positive horizontal spans, leading/trailing omissions, row/grid width agreement, vertical restart/continuation span agreement; nested table grids are independent |

Definition IDs use exact strings for styles and canonical numeric values for
numeric IDs (`01` and `1` collide). General numeric IDs in this profile use the
nonnegative signed-32-bit range; notes additionally admit -1. Drawing IDs use
0–4294967295. These are explicit bounded profile choices, not a claim to cover
all schema number types or all application extension ID conventions.

Stable diagnostic codes include `required-part`, `main-part`, `part-root`,
`package-structure`, `invalid-xml`, `relationship-dialect`,
`relationship-content-type`, `relationship-reference`, `relationship-type`,
`style-id`, `style-reference`, `style-type`, `style-cycle`, `num-id`,
`abstractNum-id`, `numbering-reference`, `numbering-level`, `numbering-cycle`,
`footnote-id`, `endnote-id`, `comment-id`, `note-reference`, `comment-reference`,
`comment-range`, `bookmark-range`, `revision-id`, `drawing-id`, `field-balance`, `field-instruction`,
and `table-grid`. Diagnostics identify canonical part names and structural
traversal paths. `/` denotes a package/root failure. Paths are diagnostic labels,
not XPath or stale-safe editing selectors; no API resolves edits through them.

The exported namespace list includes the Strict/Transitional w, r, a, wp, pic,
m, ep, cus and vt pairs, shared ct/pr/cp/mc/xml, and Dublin Core elements/terms.
MCE control processing handles mc directly; the XML compatibility implementation
also recognizes the empty namespace internally. Selected branches alone take
part in semantic checks. Unselected or opaque extension payloads are preserved.
Recognizing these namespaces does not assert complete validation of their schemas.

## Explicit coverage limits

`container`, `protection`, `signatures`, and `extension-coverage` are reported
`unvalidated` by the decoded-member validator. XML and semantic checks are scoped;
no XSD validator is embedded. Checks not completed after a malformed package
failure remain `unvalidated`. Every report warns against full-conformance claims.

Unvalidated semantics include protection enforcement, signature cryptography,
modern comment threads, arbitrary extensions, DrawingML IDs other than
`wp:docPr`, move source/destination correspondence, full revision metadata/grammar, field instruction
references, bookmark hyperlink anchors, full style inheritance/type rules,
implicit numbering inheritance, glossary definition scopes, legacy hMerge
semantics, table layout/width units, full cell-content grammar, all schema child
ordering/cardinalities and rendering. Unknown extension semantics do not become
malformed merely because this profile does not implement them. Later feature
editors must refuse affected unsupported operations; this milestone does not
claim that any arbitrary package edit is safe.

## Evidence and language mapping

`src/validation.test.ts` contains original small regressions for each implemented
family, valid boundary cases, explicit resource failures, unsupported MCE,
original fixture coverage, staged rejection and untouched memfs sinks.
Successful staged output is decoded with the independent ZIP32/CRC/decompression
helper and checked using the Saxes-based package/reference assertions in
`tests/assertions.ts`. These assertions do not invoke the product validator.
They have their own declared limits and are not independent full conformance,
rendering or repair-warning verification. No downloads or native reference build
were used for this milestone.

The JS mapping is synchronous validation of `Uint8Array` members, readonly typed
result arrays, neutral typed errors, and always-async publication through an
explicit sink and cancellation/limits context. Omitted options use documented
bounds; null is not a profile/options alias. XML/package views retain their
existing neutral spellings; no Python runtime, unrestricted XML evaluator or
ambient filesystem authority is introduced. The research API inventory still
tracks inherited members, enums, collections, helpers and public underscore-named
views as pending model work. No model row becomes implemented merely because
these package primitives now exist.
