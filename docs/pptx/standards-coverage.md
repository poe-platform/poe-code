# PPTX standards coverage register

Status: Standards acquisition and feature-level mapping complete; product implementation and behavioral validation not started.

This research register covers the first `pin-standards` task in
[the pipeline](../plans/pptx-typescript-safe-bash.md). It does not close API
reconciliation, test adaptation, command design, schema validation or fidelity QA.
The [format specification](../specs/pptx.md), [shared CLI](../specs/office-cli.md)
and [shared SDK](../specs/office-sdk.md) remain authoritative product contracts.

## Pinned sources and hashes

[The acquisition receipt](standards-sources.json) records URLs, byte lengths,
SHA-256 hashes, archive member paths, schema target namespaces, imports and the
hashes of the supplied test/API/corpus inventories. Retrieved 2026-09-13 UTC.
Source downloads remain disposable research inputs under `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/pptx-standards-qm__6fsd/sources`;
none are product dependencies or canonical fixtures.

| Key | Authoritative publication                                                                                                    | Pinned edition/revision      | Acquired schema evidence                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------- |
| P1  | [ECMA-376 Part 1](https://ecma-international.org/wp-content/uploads/ECMA-376-1_5th_edition_december_2016.zip)                | Fifth edition, December 2016 | 21 exact XSD members in `OfficeOpenXML-XMLSchema-Strict.zip`; normative Annex A       |
| P2  | [ECMA-376 Part 2](https://ecma-international.org/wp-content/uploads/ECMA-376-2_5th_edition_december_2021.zip)                | Fifth edition, December 2021 | Four exact XSD members in `OpenPackagingConventions-XMLSchema.zip`; normative Annex C |
| P3  | [ECMA-376 Part 3](https://ecma-international.org/wp-content/uploads/ECMA-376-3_5th_edition_december_2015.zip)                | Fifth edition, December 2015 | PDF; distribution contains no separate XSD; clauses 7–9 govern MCE processing         |
| P4  | [ECMA-376 Part 4](https://ecma-international.org/wp-content/uploads/ECMA-376-4_5th_edition_december_2016.zip)                | Fifth edition, December 2016 | 26 exact XSD members in `OfficeOpenXML-XMLSchema-Transitional.zip`; normative Annex A |
| PX  | [MS-PPTX](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/efd8bb2d-d888-4e2e-af25-cad476730c9f)         | 25.0, August 20, 2024        | PDF plus all 20 online Appendix A schema blocks, sections 5.1–5.20                    |
| DX  | [MS-ODRAWXML](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/06cff208-c6e1-4db7-bb68-665135e5f0de) | 34.0, February 17, 2026      | PDF plus all 42 online Appendix A schema blocks, sections 5.1–5.42                    |

The [Ecma publication index](https://ecma-international.org/publications-and-standards/standards/ecma-376/)
confirms these separate editions. Do not apply the 2021 Part 2 clause numbers to
older OPC editions: physical ZIP mapping is now 7.3, ZIP constraints are Annex B,
core properties are clause 8, and signatures are clause 10.

Each ECMA XSD hash is over its uncompressed archive-member bytes. Microsoft schema
hashes are over the HTML `pre` schema block decoded by `HTMLParser`, with nonbreaking
spaces replaced by ordinary spaces and UTF-8 encoding, without trimming. Each
response also has a separate raw HTML hash. These are independently pinned online
snapshots, not claims of byte identity with PDF typesetting. PDF footers identify
`v20240820` for PX and `v20260217` for DX. Revision tables were checked against their
publication pages. The online DX chartEx schema includes `CT_FeatureExtension` and
`ST_ExtensionDropMode`, matching the new revision's documented additions.

All 113 acquired XSD blocks parse as XML. This is **not** successful XSD compilation:
imports still require explicit local resolution, namespace binding and validation.
No import may be fetched by the product. Filenames such as `oartbasetypes.xsd` in
extension imports are not necessarily names used by the ECMA distribution; the
resolver must use the recorded namespace and reviewed type compatibility, not
assume equal filenames. External XML Signature, Dublin Core and XML vocabulary
imports need a separately pinned dependency closure before schema-validator claims.
RELAX NG bundles and preset geometry archives have container/member hashes in the
receipt where supplied; this task does not import their contents into product code.

## Dialects, namespaces and schema ownership

Prefixes below are explanatory aliases. Runtime identity is the expanded name,
never the literal prefix. P1 and P4 schema files of the same filename are distinct
and independently hashed. P4 clauses 11–13 amend presentation, drawing and shared
part rules; its clauses 16–18 amend presentation/drawing markup; clause 19 defines VML. No automatic
Strict-to-Transitional rewriting is permitted.

| Family                               | Strict namespace                                          | Transitional namespace                                                | Schema entry                                               |
| ------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| Presentation (`p`)                   | `http://purl.oclc.org/ooxml/presentationml/main`          | `http://schemas.openxmlformats.org/presentationml/2006/main`          | `pml.xsd`                                                  |
| Drawing (`a`)                        | `http://purl.oclc.org/ooxml/drawingml/main`               | `http://schemas.openxmlformats.org/drawingml/2006/main`               | `dml-main.xsd`                                             |
| Chart (`c`)                          | `http://purl.oclc.org/ooxml/drawingml/chart`              | `http://schemas.openxmlformats.org/drawingml/2006/chart`              | `dml-chart.xsd`                                            |
| Chart drawing                        | `http://purl.oclc.org/ooxml/drawingml/chartDrawing`       | `http://schemas.openxmlformats.org/drawingml/2006/chartDrawing`       | `dml-chartDrawing.xsd`                                     |
| Diagram                              | `http://purl.oclc.org/ooxml/drawingml/diagram`            | `http://schemas.openxmlformats.org/drawingml/2006/diagram`            | `dml-diagram.xsd`                                          |
| Picture                              | `http://purl.oclc.org/ooxml/drawingml/picture`            | `http://schemas.openxmlformats.org/drawingml/2006/picture`            | `dml-picture.xsd`; slide picture container is in `pml.xsd` |
| Office relationship attributes (`r`) | `http://purl.oclc.org/ooxml/officeDocument/relationships` | `http://schemas.openxmlformats.org/officeDocument/2006/relationships` | `shared-relationshipReference.xsd`                         |
| Math (`m`)                           | `http://purl.oclc.org/ooxml/officeDocument/math`          | `http://schemas.openxmlformats.org/officeDocument/2006/math`          | `shared-math.xsd`                                          |
| Workbook                             | `http://purl.oclc.org/ooxml/spreadsheetml/main`           | `http://schemas.openxmlformats.org/spreadsheetml/2006/main`           | `sml.xsd`, for simple embedded chart data                  |

OPC namespaces do not follow the above Strict replacement rule:
`http://schemas.openxmlformats.org/package/2006/content-types`,
`http://schemas.openxmlformats.org/package/2006/relationships`,
`http://schemas.openxmlformats.org/package/2006/metadata/core-properties` and
`http://schemas.openxmlformats.org/package/2006/digital-signature` belong to P2.
MCE uses `http://schemas.openxmlformats.org/markup-compatibility/2006` in either
dialect. P3 processing requires understood namespaces, `Ignorable`,
`ProcessContent`, `MustUnderstand` and ordered Choice/Fallback selection. Retaining
unselected markup for later save is a product preservation requirement, distinct
from the standard's processed view.

Both extension appendices explicitly bind their base OOXML references to
Transitional schemas. An extension namespace inside a Strict package therefore
requires a deliberate compatibility decision; importing the extension schema
must not silently convert the deck or prove that all mixed graphs are valid.

| Extension family                               | Namespace suffix after `http://schemas.microsoft.com/office/`                                              | Governing reference / schema section              | Target behavior; current evidence                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Presentation media, sections, timing additions | `powerpoint/2010/main`                                                                                     | PX 2.2.4–2.2.5, 2.3; 5.1                          | Read supported references; edit only declared subset; preserve remainder. Not implemented |
| Later presentation additions                   | `powerpoint/2012/main`                                                                                     | PX 2.4; 5.2                                       | Preserve unknown payloads; no blanket edit support                                        |
| Morph                                          | `powerpoint/2015/09/main`                                                                                  | PX 2.6.1.1; 5.4                                   | Preserve; reject unsupported retargeting                                                  |
| Caption tracks                                 | `powerpoint/2017/3/main`                                                                                   | PX 2.13.3.1–2.13.3.3; 5.12                        | Inventory and retain track relationship graph; no playback proof                          |
| Modern comments                                | `powerpoint/2018/8/main`                                                                                   | PX 2.1.5–2.1.6, 2.16; 5.14                        | Preserve author/comment/thread graph; semantic editing unsupported                        |
| Comment-related later additions                | `powerpoint/2020/02/main`, `powerpoint/2022/03/main`, `powerpoint/2022/08/main`, `powerpoint/2023/02/main` | PX 2.17, 2.21, 2.20, 2.22; 5.16, 5.17, 5.19, 5.20 | Retain extensions; do not collapse to legacy comments                                     |
| Drawing additions                              | `drawing/2010/main`, `drawing/2014/main`                                                                   | DX 5.1, 5.23                                      | Per-subfeature read/edit/preserve decisions, not namespace-wide support                   |
| Theme additions                                | `thememl/2012/main`                                                                                        | DX 5.17                                           | Retain; resolve only reviewed inheritance semantics                                       |
| Extended charts                                | `drawing/2014/chartex`                                                                                     | DX 2.24; 5.22                                     | Preserve with dependencies; no conversion to basic charts                                 |
| Chart styles and later chart additions         | `drawing/2012/chartStyle`, `drawing/2014/chart`, `drawing/2015/06/chart`, `drawing/2017/03/chart`          | DX 5.15, 5.20, 5.42, 5.31                         | Preserve unsupported structures and relationships                                         |
| SVG references                                 | `drawing/2016/SVG/main`                                                                                    | DX 5.24 (`CT_SVGBlip`)                            | Explicit raster fallback plus validated SVG relation; never execute SVG                   |
| Decorative flag                                | `drawing/2017/decorative`                                                                                  | DX 5.32                                           | Planned explicit accessibility edit; no certification claim                               |
| Hyperlink color                                | `drawing/2018/hyperlinkcolor`                                                                              | DX 5.33                                           | Preserve unrelated edits; semantic support requires original tests                        |
| Drawing animation and 3D animation             | `drawing/2018/animation`, `drawing/2018/animation/model3d`                                                 | DX 5.35, 5.34                                     | Preserve; no playback or 3D editing                                                       |
| 3D, live feed, script links                    | `drawing/2017/model3d`, `drawing/2021/livefeed`, `drawing/2021/scriptlink`                                 | DX 5.29, 5.40, 5.39                               | Opaque preservation, no activation/network/script execution                               |

All remaining appendix schemas, including command-moniker/zoom/ink/diagram and
other Office application namespaces, remain explicitly pinned in the receipt.
Their presence is dependency research, not a promise to implement every vocabulary.

The receipt also accounts for every one of the 29 namespace strings recorded in
the supplied corpus manifest. Mac DrawingML, information-protection metadata,
SharePoint/content-type metadata and unrecognized UUID namespaces remain opaque
where no acquired schema identifies them. An empty namespace is recorded as such,
not assigned a fictitious standard. Namespaces alone do not establish active
features or safety; unresolved incoming references must block affected graph edits.

## F01–F60 requirement and evidence map

Every row below has current status **not implemented**, with no passing product
tests, schema validation, render or playback evidence. `E` means the target is
edit/read/preserve; `P` means read/inventory where possible and byte-preserve;
`X` means explicit rejection of the named unsupported action. These describe
requirements, never measured capability. The evidence column identifies original
acceptance obligations, not tests that already exist. All edits additionally need
unchanged-part hashes, result-graph validation, resource limits and atomic failure.

P1/P2/P3/P4 and PX/DX refer to the exact publications above. Clause references map
the represented format; CLI algorithms, transaction policies, diff and template
binding are product rules and do not acquire invented OOXML clauses.

| ID  | Governing clauses; schema entry or representative type               | Target boundary                                                                           | Original evidence still required                                                          |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| F01 | P2 7.3, Annex B; binary ZIP, no XSD                                  | E stored/deflated and bounded ZIP64 read; X encryption/multi-disk/unsafe archive          | Tiny independent CRC, descriptor, size, duplicate-name and truncation cases               |
| F02 | P2 6.2–6.5, 7.2.3; `opc-contentTypes.xsd`, `opc-relationships.xsd`   | E canonical part identities and local relationship graphs                                 | Encoded-name collision, cycles, dangling edge, external target retained without fetch     |
| F03 | P1 13.3.6; P4 11.2.6; P3 7–9; `pml.xsd`                              | E macro-free presentation/template/show in admitted dialect; X silent conversion          | Each kind's main content type and Strict/Transitional round trips                         |
| F04 | P2 6.2.5; P3 7–9; XML plus MCE processing                            | E namespace-aware edits; P unknown markup; X entities and unsupported required vocabulary | Prefix rebinding, fallback retention, unknown attributes, whitespace and DTD denial       |
| F05 | P1 13.3, 19.2–19.5; P2 6.5; `pml.xsd`                                | E inspection only, without creating getters                                               | Ordered parts/features/selectors with no mutation; explicit unknowns                      |
| F06 | P1 13.3.6, 19.2.1.26, 19.3.1; `CT_Presentation`                      | E original minimal deck and supplied templates                                            | Independently authored graph, explicit size/time and original metadata                    |
| F07 | P1 19.2.1.33–19.2.1.34, 19.3.1.38; `CT_Slide`                        | E lifecycle; X edits with unresolved incoming references                                  | Reorder with shuffled filenames; stable IDs, notes, links and deletion policies           |
| F08 | P1 13.3; P2 6.5; P3 8; `pml.xsd`                                     | E graph import with source-theme default; X unsafe opaque retargeting                     | Colliding IDs/media/masters, shared closures and deterministic remap                      |
| F09 | P1 19.2.1.5–19.2.1.7; PX 2.3.3.24–2.3.3.27; PX 5.1                   | E custom-show/section membership; P unrelated extensions                                  | Deleted/reordered slide membership and section IDs remain coherent                        |
| F10 | P1 19.2.1.26, 19.2.1.30, 19.2.1.39, 19.2.2; `pml.xsd`                | E declared settings; P other view/print settings                                          | Exact units, size/orientation and unchanged nonselected settings                          |
| F11 | P1 13.3.10, 19.3.1.42; `CT_SlideMaster`                              | E explicit shared-master edits                                                            | Shared-scope admission and affected-slide report                                          |
| F12 | P1 13.3.9, 19.3.1.36, 19.3.1.39; `CT_SlideLayout`, `CT_Placeholder`  | E layouts/keyed placeholders; X ambiguous mapping                                         | Sparse placeholder keys, inherited overrides and invalidated insertion handles            |
| F13 | P1 14.2.7–14.2.8, 20.1.6, 19.3.1.52; `dml-main.xsd`                  | E reviewed theme resolution; P unsupported additions                                      | Explicit/inherited provenance without flattening; DX theme payload retention              |
| F14 | P1 19.3.1.1–19.3.1.3, 20.1.8; `pml.xsd`, `dml-main.xsd`              | E solid/gradient/picture backgrounds; P other effects                                     | Slide/layout/master isolation and unchanged inherited appearance graph                    |
| F15 | P1 19.3.1.51, 21.1.2; `CT_TextBody`                                  | E structural text extraction, explicit notes/master scopes                                | Paragraph/run/break/field order and Unicode; no visual-order assertion                    |
| F16 | P1 21.1.2.2–21.1.2.3; `CT_TextParagraph`                             | E preserving literal replacement; X implicit field/paragraph crossing                     | Cross-run matches, first/all/occurrence, unaffected hyperlink/style spans                 |
| F17 | P1 21.1.2.3, 20.1.2.3; `CT_TextCharacterProperties`                  | E declared character style properties; P unsupported values                               | Null/false/zero distinctions, highlight/color and inherited overrides                     |
| F18 | P1 21.1.2.2, 21.1.2.4; `CT_TextParagraphProperties`                  | E paragraphs/lists/tabs/direction                                                         | Level bounds, bullet inheritance, spacing units and empty paragraphs                      |
| F19 | P1 21.1.2.1, 21.1.2.5; `CT_TextBodyProperties`                       | E frame settings and bounded supplied-metrics fit; X host font discovery                  | Wrapping/insets/autofit separated from computed fit; missing metrics fails                |
| F20 | P1 21.1.2.2–21.1.2.3, 21.1.2.5; `dml-main.xsd`                       | E Unicode/RTL/CJK metadata; P shaping/fallback attributes                                 | Combining marks, astral text and vertical/complex-script metadata                         |
| F21 | P1 21.1.2.2, 19.3.1.25; `dml-main.xsd`, `pml.xsd`                    | E fields with explicit cached-value policy; X implicit date evaluation                    | Explicit supplied dates, untouched fields and inherited footer/header settings            |
| F22 | P1 19.3.1.43–19.3.1.46, 20.1.9; `CT_Shape`                           | E declared presets/text boxes and nonvisual properties                                    | Original geometry, unique local IDs, locks, names and alt text                            |
| F23 | P1 20.1.9; `CT_CustomGeometry2D`                                     | E bounded authored paths; P arbitrary geometry; X unsupported formulas                    | Freeform/adjustment behavior, path bounds and lossless unknown formulas                   |
| F24 | P1 19.3.1.22–19.3.1.23, 20.1.7; `CT_GroupTransform2D`                | E transforms/grouping only within explicit geometric tolerance                            | Nested world-coordinate assertions, rotation/flips and lossy-operation denial             |
| F25 | P1 19.3.1.45, 20.1.7; `pml.xsd`                                      | E deterministic order/alignment/duplication                                               | Stable untouched order; exact EMUs; target links/timing remain valid                      |
| F26 | P1 19.3.1, 20.1.9; `CT_Connector`                                    | E endpoints/sites/style; X implicit detach policy                                         | Target deletion and explicit detach/remove; nested-group endpoints                        |
| F27 | P1 20.1.8, 20.1.5; `dml-main.xsd`                                    | E declared fills/lines/alpha/shadows; P advanced/3D effects                               | Style changes preserve unrelated effect list and inherited shadow                         |
| F28 | P1 21.1.3, 20.1.4; `CT_Table`                                        | E grids/text/style/borders/fills/sizes                                                    | Independent table XML/grid expectations, theme retention                                  |
| F29 | P1 21.1.3; `CT_TableCell`                                            | E spans/splits with explicit insertion/deletion conflicts                                 | Rectangular merges, covered-cell aliasing and rejected partial overlaps                   |
| F30 | P1 15.2.14, 19.3.1.37; `CT_Picture`                                  | E occurrence versus media inventory                                                       | Shared resource hashes, distinct geometry and inherited occurrence scope                  |
| F31 | P1 15.2.14, 20.1.8; `dml-main.xsd`                                   | E admitted image formats; decoder details are separate binary-format obligations          | Original PNG/JPEG/GIF/BMP/TIFF headers, dimensions/DPI, default size and bounds           |
| F32 | P1 19.3.1.37; P2 6.5; `CT_Picture`                                   | E occurrence replacement; shared edit explicit                                            | Two occurrences sharing bytes; only selected relation rebound                             |
| F33 | P1 20.1.7–20.1.8; `dml-main.xsd`                                     | E crop/fit/rotation/flips/opacity/borders                                                 | Negative and over-one source crop cases, visible-extent validation, one-time EMU rounding |
| F34 | P1 15.2.14; P3 7–9; DX 5.24                                          | E SVG plus supplied raster fallback; P vectors/animation; X implicit transcoding          | MCE/relationship checks and exact retained bytes; no SVG execution                        |
| F35 | P1 15.2.14; P2 6.2.2; binary payload                                 | E bounded extraction with safe names; X active content execution                          | Original-byte equality, collisions, explicit dedup and bounded manifest                   |
| F36 | P1 14.2.1, 21.2; `CT_ChartSpace`                                     | E chart inventory; distinguish cache/data source                                          | Independently expected types, axes, categories, series and workbook relations             |
| F37 | P1 21.2; `dml-chart.xsd`                                             | E required category/XY/bubble families and declared variants                              | Every applicable chart test variant; no picture-only substitution                         |
| F38 | P1 15.2.11, 18.2–18.4, 18.8, 18.17, 21.2; `sml.xsd`, `dml-chart.xsd` | E simple workbook/cache synchronization; X arbitrary calculation/refresh                  | Exact cells, strings, styles/date systems, formula ranges and caches agree                |
| F39 | P1 21.2; DX 2.24, 5.22; `CT_ChartSpace` in chartEx namespace         | P advanced/combination/3D/extended charts; X unsupported edits                            | Unknown subtree and workbook/resource graph hashes survive unrelated edit                 |
| F40 | P1 14.2.3–14.2.6, 21.4; `dml-diagram.xsd`                            | P diagram graph; X full semantic layout editing                                           | Data/layout/style/color/fallback relationships retained together                          |
| F41 | P1 22.1; `shared-math.xsd`                                           | E validated authored math insertion and extraction; P other math                          | Original OMML with namespace checks; no typesetting claim                                 |
| F42 | P1 15.2.2, 15.2.17, 20.1.3, 19.5; PX 2.1.1, 2.2.4, 5.1               | E admitted local media/posters; P playback settings; X transcoding                        | Tiny authored media, poster/relations, trim/volume retention; separate playback QA        |
| F43 | PX 2.13.3.1–2.13.3.3, 5.12                                           | P captions/tracks; X unreviewed semantic edits                                            | Track parts, labels and relationship closure preserved                                    |
| F44 | P1 19.3.1.50, 19.5; PX 2.6.1.1                                       | E cut/fade/push/wipe and advance timing; P Morph/others                                   | Exact transition settings; unsupported transition unchanged                               |
| F45 | P1 19.3.1.48, 19.5; `pml.xsd`                                        | E timing inventory only; no execution                                                     | Bounded timing traversal, targets/triggers/sequences and cycles                           |
| F46 | P1 19.5; DX 5.34–5.35                                                | E declared basic animation subset; P complex/3D; X unsafe retarget                        | Exact target remap and unsupported-graph denial; independent playback remains required    |
| F47 | P1 20.1.2.2; P2 6.5; `dml-main.xsd`                                  | E ordinary URLs/intra-deck links; P unsupported actions; no execution                     | Target rewrite, hover/click distinction and no external requests                          |
| F48 | P1 13.3.4–13.3.5, 19.3.1.26–19.3.1.28; `CT_NotesSlide`               | E notes creation/text/shapes/master                                                       | Correct slide association and noncreating inspection versus creating getter               |
| F49 | P1 13.3.3, 19.3.1.24, 19.2.1.22, 19.2.2; `CT_HandoutMaster`          | P handout/print/view; E explicitly scoped supported master text                           | Notes size/view unchanged; shared edits report affected scope                             |
| F50 | P1 19.4; PX 2.16–2.17, 5.14, 5.16                                    | E legacy comments; P modern threads/reactions/mentions                                    | Explicit author/time/position and stable IDs; modern graph remains intact                 |
| F51 | P2 8; P1 22.2–22.5, 19.3.3; property XSDs                            | E core/custom properties/tags; P unknown values/custom XML                                | Typed values, explicit time, original defaults and opaque payload retention               |
| F52 | P1 20.1.2.2, 19.3.1.45; DX 5.32                                      | E alt text/decorative/order checks; no accessibility certification                        | Independent alt-text/flag values and duplicate-title report                               |
| F53 | P1 15.2.9–15.2.11, 19.3.2; DX 5.29, 5.40                             | E explicit OLE bytes/icon/program metadata; P other embeddings; X activation              | Correct return interface and graph; opaque bytes retained; no recursive execution         |
| F54 | P1 15.2.13, 19.2.1.9–19.2.1.13; `pml.xsd`                            | P font declarations/parts; X installation/rendering                                       | Exact embedded font bytes and declarations; no ambient lookup                             |
| F55 | P2 10; P1 15.2.7–15.2.8; `opc-digSig.xsd`                            | E detection/explicit signature removal; X signed/protected/macro mutation by default      | Whole signature graph removal; content-based macro detection; no bypass                   |
| F56 | Product policy; P2 6.5, P1 19.4, 22.2–22.5                           | E explicit sanitization list; no blanket clean-file claim                                 | Exact removed/remaining effects and inaccessible/opaque content reported                  |
| F57 | Product binding rules over P1 19.3, 21.1                             | E typed bindings/repeated slides; X executable expressions                                | Missing/unknown bindings fail before mutation; original data/assets                       |
| F58 | Product transaction contract; P2 6.5 graph invariants                | E ordered atomic batch and dry-run; X unsupported publication                             | Cumulative budgets, cancellation, stale handles and no partial writes                     |
| F59 | Product comparison contract; P2 6.5 and P1 object graphs             | E structural/text/media/relationship diff; no visual equivalence                          | Deterministic changes, effective/raw distinction, diff exit 0/1/2/130                     |
| F60 | P2 6–7, Annex B; P3 7–9; applicable part XSDs                        | E bounded validate/extract/pack/XML replacement                                           | Unsafe path/graph/content-type failures and original-byte preservation                    |

## Coverage that remains open

The test inventory still contains exactly 2,700 collected unit variants and 973
expanded BDD examples, all `unmapped_not_implemented`. The API candidate inventory
still contains 719 records, all unimplemented; inherited members, aliases,
protocols and untested public behavior must still be reconciled. No source case
has been reclassified as private, architecture-only, passed or out of scope here.
Feature-level citations are not a many-to-one test equivalence disposition.
The ordered `map-every-upstream-case` task must retain every source row and assign
original tests or individually reviewed semantic mappings. Public deferrals block
parity claims even if the standards permit preservation.

The register does not finalize chart variants, animation effects/path formula
subsets, decoder profiles, default limits or complete command/API schemas. Those
remain explicit downstream design and implementation obligations. In particular,
OOXML's image-part clauses do not specify every binary image decoder, and schemas
do not define transaction safety, cancellation, or geometric rendering fidelity.
Additional binary-format/security standards must be pinned with those tasks.

Shared plural resources, `text replace`, schema/capability discovery, selectors,
JSON envelopes and exit statuses come from the shared CLI contract. Neutral SDK
snake_case spelling, always-async admission/save, keyed collections, null/inheritance,
UTC dates, explicit capabilities and supplied metrics come from the shared SDK
contract. Standards citation does not waive any of these requirements.

All 12 corpus documents retain their existing `not_run_product_not_implemented`
status. Their ZIP/XML census does not establish schema validity, editable feature
support, visual fidelity or playback. No corpus document was edited or deleted
in this task; no meaningful product finding exists to reduce yet. Preserve all
source fixtures while the planned QA campaign still needs them.

[The existing standalone MIT notice](upstream-license-notice.txt) remains intact.
This task copies no source tests, code or reference assets into the product. Any
future substantial derived material needs its required standalone notice; neutral
names alone do not remove attribution duties. Acquired standards have their own
publisher terms and are not relabeled as MIT material.

## Verification evidence

Acquisition checked ZIP members by reading their bytes (including CRC checks),
recorded SHA-256 values, parsed every recorded XSD block as XML and compared
namespace ownership with the supplied corpus inventory. PDF text extraction used
Poppler `pdftotext -layout`; clause anchors above were checked against the pinned
text. Poppler emitted `Can't get Fields array` during extraction; no form fields
were being read or edited, and all six text outputs were available. This is not
PDF visual-layout or form validation evidence.

Documentation validation checks all 60 unique feature IDs, acquisition hashes,
complete 20/42 extension section sets, baseline inventory hashes, relative links,
plan parsing and formatting. Passing results are recorded with the task completion
in the pipeline; none count as product behavior tests.
No code, runtime tests, screenshots or README changes are part of this task.
