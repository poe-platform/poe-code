# DOCX proposed contract reconciliation evidence

Reviewed 2026-09-14. Research/documentation only; no product conformance claim.
The authoritative proposal is [docx.md](../specs/docx.md), with shared
[CLI](../specs/office-cli.md) and [SDK](../specs/office-sdk.md) contracts.
The owned procedure and pending task extensions are in
[the plan](../plans/docx-contract-reconciliation.md).

## Evidence and scope

The [DOCX test audit](upstream-test-audit.md) and
[counterpart test audit](../pptx/upstream-test-audit.md) establish pinned historical
baselines only. Their shared OPC/XML/image behavior informs original cases;
neither suite proves bounded ZIP/XML admission, capability-safe publication or
unknown-markup fidelity. DOCX format-specific headers and counterpart decoder/WMF
paths are not interchangeable format claims, and their pass totals are not added.
No source suite, decoder or native document runtime was executed in this review.
Missing raw historical artifacts remain the limitations recorded in the audits.

The [test inventory](upstream-test-inventory.json) and
[test map](test-case-map.json) retain 1,609 unit variants and 650 expanded BDD
examples. The [API inventory](upstream-api-inventory.json),
[API audit](upstream-api-audit.md), [API reconciliation](upstream-api-reconciliation.md),
[API map](public-api-map.json) and [command coverage](command-coverage.json) retain
920 inventory IDs and 1,337 expanded API rows, including inherited members,
collections, helpers, enum values/aliases, returned views and guide workflows.
These distinct denominators do not measure implementation coverage. The
[counterpart API audit](../pptx/upstream-api-audit.md) supplies shared-boundary
comparison, not authority to erase format-specific semantics.

Exact JS signatures, read/write asymmetry, defaults, errors, ownership and routes
remain in each API-map row and its mapping-rule references. The 16 shared mapping
rules remain unchanged. In particular: async factory/save/admission, synchronous
owned model access; source-spelled neutral members versus camelCase operation
options; zero-based sequence access versus keyed lookup; explicit negative/slice
support; safe integer/finite values, half-away units, UTC copied dates, owned byte
copies; typed enum/color/null behavior; bounded XML/part views and neutral errors.
Relationships retain `get`, `items` and keyed `at`, not extra getOrNull/entries
aliases. Reserved argument binding `package` maps to `owner_package`, not a member
rename. Public underscore-prefixed types are not private by spelling.

Private wrapper identity maps to same owner/node equality and alias-visible
mutation: a repeated merged grid cell must reflect an edit through either handle.
That preserves the observable invariant without duplicating Python allocation or
mock invocation structure. Pure loader/mock mechanics still need a row-specific
rationale; absent public behavior remains a gap.

No downloaded documents or cloned binary fixtures were changed, shipped, copied
into canonical tests or deleted. Future cases below use original prose and
technical in-memory XML/image bytes, with memfs for file mutations. Preserve the
[standalone MIT notice](upstream-license-notice.txt) for substantial derived
material. Research identities stay in plans/research/legal notices, never product
source, comments, tests, assets, identifiers or output.

## Confirmed wording drift

Before edits, four documentary assertions failed (exit 1): section 1 prohibited
suite-derived behavior; section 9 still used allowMissing; it did not require
exactly one cardinality flag for every text replacement; detailed public-model
semantics were absent. These are not failing product tests. The amended section 1
permits original behavioral adaptation under section 11. Section 9 uses only
allowEmpty/--allow-empty and requires first/all/occurrence even for one match.
Explicit CLI pixel values use 9,525 EMU/pixel; native model dimensions use each
image DPI axis, independently falling back to 72. One explicit model dimension
preserves native physical aspect ratio; two specify both. Numeric model dimensions
remain EMUs. Replacement retains original extents unless explicitly resized.

Source inspection additionally confirmed detached page-break fragments and the
hyperlink URL assembly convention in `src/docx/text/pagebreak.py` and
`src/docx/text/hyperlink.py` at the pinned revision. Internal fragment-only links
have an empty URL; separate address/fragment fields remain unnormalized. No
unrequested URL-normalization rule was added. Fragment edits cannot edit source
content; a break within a hyperlink assigns the whole hyperlink to the preceding
fragment without moving source XML.

## F01–F50 assessment and original acceptance targets

Every row is a proposed, unwritten acceptance requirement. The existing command
register supplies all associated API row IDs and operation routes. Its feature
associations are accounting links, not proof that broad package-view APIs cover
every behavior of that feature. Rows with no source tests still require the
independent case below; preserve-only subfeatures still require retention and
rejection evidence. Detailed task additions are in the owned plan.

The command register has 18 cross-cutting factory/workflow/error rows with empty
feature arrays. This review does not discard them: the receipt's explicit
`supplemental_api_features` assigns each to the applicable families. The remaining
1,319 rows retain their existing feature associations. Grammar finalization must
carry these supplemental associations into the command register; this is a
pending documentary handoff, not an implemented route or hidden public API.

| Feature | Reconciliation / original acceptance target                                                                                                                                                       | Pending owner                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| F01     | Relative part URI and cyclic graph cases retained; original archive with a shared target plus external edge must enumerate once without acquisition, and a bad CRC must reject.                   | `opc-package-graph`, `shared-zip-read`                       |
| F02     | Additive dialect contract; equivalent original Strict/Transitional paragraphs retain their dialect after edit.                                                                                    | `strict-transitional-dialects`                               |
| F03     | Additive template contract; macro-free template creation sets the correct kind; macro-enabled mutation rejects.                                                                                   | `create-documents-and-templates`                             |
| F04     | XML descriptor mechanics map to observable ordered attributes/children/text; an edit retains an unknown sibling, comment and PI.                                                                  | `loss-preserving-xml-write`                                  |
| F05     | Additive MCE contract; edit selected content while retaining unselected fallback bytes/semantics and rejecting unknown mandatory markup.                                                          | `markup-compatibility`                                       |
| F06     | Inventory retained; nonstandard main-part name, shared story and opaque object produce deterministic counts without getter-created parts.                                                         | `inspect-and-validate-commands`                              |
| F07     | Public XML views added explicitly; foreign-owner mutation and stale detached node reject; bounded raw/pretty views preserve namespace meaning.                                                    | `sdk-xml-package-views`, `xml-part-access`                   |
| F08     | Add cached-break/traversal contract; mixed paragraph, table, hyperlink and break content extracts in logical order without phantom newlines.                                                      | `story-text-extraction`                                      |
| F09     | Complete font/language API retained; combining marks and RTL logical text survive an unrelated formatting edit unchanged.                                                                         | `run-formatting`                                             |
| F10     | Fix exact cardinality and allowEmpty; two cross-run matches replace only occurrence 2, and omitted/conflicting selectors reject even with one match.                                              | `run-aware-replacement`                                      |
| F11     | Factory capability/determinism retained; two creations with the same supplied context yield equivalent original minimal documents.                                                                | `create-documents-and-templates`                             |
| F12     | Complete flags/color/underline scope added; true, false and inherited absence round-trip distinctly with unrelated run properties retained.                                                       | `run-formatting`                                             |
| F13     | Typed spacing, tabs and cached/hard-break distinctions added; move a tab, observe its current XML view, reject the detached one.                                                                  | `paragraph-formatting`                                       |
| F14     | Define inheritance/latent differences; a three-style chain resolves boundedly, a cycle diagnoses, null defined flags read false and latent overrides remain null.                                 | `sdk-style-and-format-api`                                   |
| F15     | Title 0 and heading 1–9 retained; original custom style collision is not overwritten and invalid heading levels reject.                                                                           | `styles-and-headings`                                        |
| F16     | All section properties/traversal retained; orientation alone keeps width/height, and section creation preserves previous content boundaries.                                                      | `sections-and-page-settings`                                 |
| F17     | Recursive linkage and getter side effects added; third section inherits first through second, unlink/relink affects only intended ownership; read-only inspection creates nothing.                | `headers-and-footers`                                        |
| F18     | Expand beyond eight source rows; two concrete lists share one abstract definition, restarting one preserves the other and picture-bullet references.                                              | `multilevel-numbering`                                       |
| F19     | Omitted cells and nested traversal added; a row with one omitted leading slot and a nested table has no fabricated cell and retains block order.                                                  | `table-construction`, `table-cell-updates`                   |
| F20     | Logical aliasing/merge validation added; a 2-by-2 merge exposes one owner across four slots, retains ordered text/width, and rejects partial overlap atomically; split gets independent coverage. | `merged-cell-operations`                                     |
| F21     | Hyperlink component and cached-break semantics added; internal anchor URL is empty, external address plus separate fragment assembles literally, and no read dereferences a target.               | `hyperlinks`, `bookmarks-and-locations`                      |
| F22     | Field preservation remains additive; update a nested field result without altering instructions or evaluating a field, and keep cached-break metadata separate.                                   | `field-structure-and-results`                                |
| F23     | Cached pagination remains honest; create a caption/TOC reference with cached page values and never report recalculated pages.                                                                     | `toc-captions-and-crossrefs`                                 |
| F24     | Additive note graph; remove one of two references only under explicit policy and retain required separators and remaining note IDs.                                                               | `footnotes-and-endnotes`                                     |
| F25     | Rich bodies/anchor rules added; annotate three contiguous runs and retain a table/image body; reject null text and header anchors without mutation.                                               | `classic-comments`                                           |
| F26     | Additive revision editing; final/original text differs predictably, and accept/reject preserves unselected ranges.                                                                                | `revision-read-views`, `accept-reject-revisions`             |
| F27     | Preserve/reject retained; unrelated edit keeps move/table revision markup, affected unsupported edit rejects.                                                                                     | `accept-reject-revisions`                                    |
| F28     | Additive controls; locked original control rejects fill, supported unlocked typed value preserves control identity.                                                                               | `content-control-values`                                     |
| F29     | Additive binding/repetition; two repeated records synchronize supported bindings, over-limit expansion leaves all output unchanged.                                                               | `repeat-controls-and-bindings`                               |
| F30     | Typed/null/date asymmetry added; 255 Unicode code points accepted, 256 rejected, offset instant serializes UTC, revision zero reads but cannot be assigned.                                       | `typed-document-properties`                                  |
| F31     | Embedded predicate and metadata added; embedded and linked-only drawings inventory separately, with no linked acquisition and exact owned bytes.                                                  | `image-inventory-extraction`                                 |
| F32     | All characterized formats/native axes retained; 144-by-72 pixels at 144/72 DPI yields a 1-inch square; 96 explicit CLI pixels yields 914,400 EMU regardless of metadata.                          | `raster-image-insertion`, `sdk-image-format-api`             |
| F33     | Floating editing remains additive to inline constructors; anchor coordinate edit retains wrap, crop and unrelated layout fields without claiming rendered placement.                              | `floating-image-layout`                                      |
| F34     | Other-format extraction retained independently of raster admission; original inert EMF/WMF/WDP bytes and relationships remain exact without decoding.                                             | `image-inventory-extraction`                                 |
| F35     | Preserve SVG fallbacks; insertion requires admitted SVG and supplied raster fallback, rejects scripts/external references and never invokes rasterization.                                        | `svg-and-image-fallbacks`                                    |
| F36     | Shape/text-box contract remains additive; edit supported text-box content while retaining opaque shape geometry and story boundaries.                                                             | `shapes-and-text-boxes`                                      |
| F37     | Chart/workbook contract retained, not inferred from image tests; inspect and preserve chart relationships and embedded workbook on unrelated text edit.                                           | `charts-and-workbooks`                                       |
| F38     | Diagram preserve/reject retained; opaque diagram graph survives round trip, unsupported semantic edit rejects.                                                                                    | `smartart-and-diagrams`                                      |
| F39     | Equation contract retained; opaque mathematical structure survives nearby text replacement and explicit bounded OMML replacement validates without evaluation.                                    | `omml-equations`                                             |
| F40     | Embedded-object contract retained; bytes remain exact and never activate a host application or external relationship.                                                                             | `embedded-objects`                                           |
| F41     | Custom XML/glossary contract retained; unrelated edit preserves opaque parts and reference graph.                                                                                                 | `custom-xml-and-glossary`                                    |
| F42     | Settings/fonts/protection retained; protection blocks edits, noncreating reads preserve bytes, and embedded fonts stay inert without installation/discovery.                                      | `settings-and-protection`                                    |
| F43     | Additive signature policy; signed mutation rejects until explicit stripping removes the complete signature graph.                                                                                 | `signatures-and-explicit-removal`                            |
| F44     | Removal constraints retained; delete selected block while retaining required empty container and still-shared media.                                                                              | `range-and-structure-removal`                                |
| F45     | Additive deterministic replacement; same supplied seed and selected visible ranges yield identical output with excluded stories unchanged.                                                        | `deterministic-dummy-text`                                   |
| F46     | Additive exact sanitization; remove requested comment/property classes and report them without claiming full anonymization.                                                                       | `explicit-sanitization`                                      |
| F47     | Additive batch/template atomicity; second operation failure prevents first operation publication and record expansion remains bounded.                                                            | `ordered-batch-operations`, `data-driven-template-expansion` |
| F48     | Additive diff contract; XML prefix-only serialization differs at payload level but not semantically, with equal/different as data.                                                                | `semantic-document-diff`                                     |
| F49     | Additive diagnostics; missing numbering target and illegal cell span produce scoped diagnostics rather than a whole-standard certification.                                                       | `package-semantic-validation`                                |
| F50     | Additive extraction/packing; traversal entry and destination alias reject before publication; reconstructed package validates under explicit VFS capabilities.                                    | `safe-docx-extraction`, `validated-docx-packing`             |

## Original discrepancy acceptance targets

D01–D23 refer to the pinned evidence in
[the existing discrepancy table](upstream-api-reconciliation.md#source-and-documentation-discrepancies).
These targets expressly preserve differences; none is implemented or passing.
No copied fixture or source-project identifier belongs in the eventual test name.

| Decision | Original acceptance target                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01      | Create an original comment and read comment_id/timestamp; id/date are absent from the declared API.                                                 |
| D02      | Add a run through a comment paragraph; reject null text without allocating a comment; omitted text creates an empty body.                           |
| D03      | Assign table_direction, reset null, and reject the nonexistent direction field through closed batch schema.                                         |
| D04      | Verify documented enum aliases, underline inheritance and break value 11 aliases; nonexistent theme member has no invented value.                   |
| D05      | Set priority on a paragraph style and base_style only on permitted types; misspelled/obsolete guide fields do not appear in schema.                 |
| D06      | Lookup a style by exact string name; numeric/enum keys reject and iteration remains ordered.                                                        |
| D07      | Use an original list paragraph with the built-in name List Bullet and a spaced table-style name; compact ID fallback is not name normalization.     |
| D08      | Assigning an absent style fails, a dangling read uses documented fallback, and deleting a definition retains paragraph text.                        |
| D09      | Edit a header through admitted bytes and an explicit output sink; an ambient path string grants no authority.                                       |
| D10      | Serialize an offset date representing 2031-02-03T04:05:06Z as that UTC second; invalid assigned date rejects and missing stored date reads null.    |
| D11      | Traverse an embedded drawing to image metadata and its bounded XML view, without a host XML-library object.                                         |
| D12      | A linked-only original drawing returns false for embedded-picture presence and image access errors without network/VFS reads.                       |
| D13      | A 144-by-72 image at 144 horizontal/72 vertical DPI is 914,400 EMU on each axis, including image-part default height.                               |
| D14      | Read cr/br as line breaks, serialize new breaks as br, retain run formatting on run text assignment and remove it on paragraph text assignment.     |
| D15      | Positive/negative permitted half-EMU conversions round away from zero; unsafe/nonfinite input rejects before mutation.                              |
| D16      | Public creation/load/save uses JS capabilities without Python/native dependencies; historical installation prose creates no SDK operation.          |
| D17      | Set orientation without changing width/height; traverse all six header/footer variants without treating a guide example section count as a default. |
| D18      | Change RGB/theme through listed fields and retain unknown color transforms; no invented brightness setter appears.                                  |
| D19      | Both add_picture methods create inline shapes; floating editing has separate additive acceptance and capability reporting.                          |
| D20      | Parse a1B2c3 as A1B2C3; reject five/seven digits, whitespace, prefixes, signs and nonhex.                                                           |
| D21      | Accept 255 supplementary Unicode code points, reject 256 and nonstrings; stored missing revision reads zero but zero/negative assignment rejects.   |
| D22      | Reset defined hidden/locked/quick_style/unhide_when_used to null and read false; reset latent override and read null.                               |
| D23      | Move a tab from one position to another; its handle and element agree, and an earlier detached view fails as stale.                                 |

Additional original cases cover a DPI axis absent independently of the other,
all malformed image-header variants, one/two explicit dimension scaling, frozen
input copies, and cached breaks before/after content and inside hyperlinks.
The shared 96-DPI CLI conversion does not override native model defaults.

## Result and limitations

The [verification receipt](contract-reconciliation-verification.json) records the
reviewed inputs and identity accounting. This closes only proposed-contract
reconciliation. Existing target tests remain unwritten/unrun; original failing
tests must precede implementation in each owner task. No source baseline rerun,
new published-documentation survey, release, runtime schema or visual QA is
claimed. Detailed grammar finalization and all later tasks remain pending.
