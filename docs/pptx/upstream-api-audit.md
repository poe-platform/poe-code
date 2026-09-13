# PPTX Public API Documentation Audit

Status: Pinned documentation/source reconciliation recorded. Historical baseline below; subsequent bounded implementation receipts are linked separately.

Current axis crossing correction: [exact parameter and JS mappings](axis-crossing-evidence.md)
reconcile 14 unit variants and 17 BDD examples. Custom-mode initialization and
null-removal reads are corrected with independent SDK and CLI evidence; this
does not certify remaining chart-family parameter payloads.

Current utility reconciliation: [package, XML and image-codec evidence](utility-reconciliation.md)
links exact parameter ledgers, neutral public mappings and deliberate validation
differences. It supersedes historical utility absence labels only for the tested
behaviors; whole-public-API coverage remains a separate obligation.

Current presentation element/part boundary: [live package-view evidence](live-package-view-evidence.md)
and [exact owner/returned-view mapping](live-owner-surface-map.md) cover bounded
XML traversal/mutation, current package reads, isolated bytes and shared `xml set`
validation. Live slide/drawing/chart graph obligations remain incomplete.

Current public surface additions: [typed input failures](public-input-errors-evidence.md),
[inherited connector formatting](connector-public-surface.md), and
[remaining owner/graph obligations](public-surface-current-gaps.md).
These receipts distinguish passing members from historical inventory labels;
they do not establish complete object-model coverage.

Current text-fitting arguments: [exact null/default and stored-option mappings](text-fit-public-arguments.md)
supplement the existing fitting receipt with original synchronous rejection tests.

Current presentation boundary: [async factory/save and synchronous metadata/canvas](presentation-public-surface-evidence.md)
reuse the existing package, property and canvas engines. Slide and drawing owner
graphs remain outstanding; this is not a completed presentation object model.

Current links: [bounded F47 evidence and language/security mappings](links-evidence.md),
[144-case accounting](links-case-map.json), [50-member API receipt](links-api-map.json)
and [draft usage](links-usage.md). This is a later bounded implementation receipt;
historical baseline statements below do not describe the current package.

Current chart operations: [29-variant expansion and exact mappings](chart-expansion-evidence.md),
[complete retained chart case ledger](chart-expansion-case-map.json), and
[chart public-member ledger](chart-expansion-api-map.json). This expands bounded
creation/data replacement, not the outstanding live chart object graph. All
inherited, underscore-prefixed and untested documented members remain accounted for.

Current image insertion: [bounded byte admission and exact security mappings](image-insertion-admission-evidence.md),
[121-case insertion ledger](image-insertion-case-map.json), and
[draft SDK/CLI usage](image-insertion-usage.md). PNG/JPEG/GIF insertion is available
through `addImage` and `images add`; this does not implement the proposed live
Image/ImagePart/Picture model or complete F31's additional-format obligations.
Inherited and underscore-prefixed public members remain in the API inventory.

Current bounded paths: [64-case accounting](path-case-map.json),
[public member/language mappings and remaining gaps](path-api-map.json), and
[draft usage](paths-usage.md). The direct path operation supports literal
move/line/quadratic/cubic/close commands; it does not complete the freeform builder
model. The focused API receipt adds six missing public source-member obligations
without deleting or reclassifying existing inventory records.

Current text fitting: [implementation and exact JS mappings](text-fitting-evidence.md),
[complete fitting case ledger](text-fitting-case-map.json). The historical
"not implemented" statements below describe the audit checkpoint, not current
package-wide implementation status. Whole-public-API coverage remains partial.

Current bounded workbook data: [implementation, exact mappings and gaps](workbook-evidence.md),
[180-case writer/rewrite ledger](workbook-case-map.json), and
[190-member data-model ledger](workbook-api-map.json). Simple imported category,
XY and bubble sheets have synchronized replacement; detached operation records
do not implement live data builders or full workbook/chart-part APIs.

Current public values: [enum coverage](public-enums-evidence.md),
[unit/color helpers](public-helpers-evidence.md), [live collection protocols](public-collections-evidence.md)
and [font language/error integration](public-values-integration-evidence.md).
All 25 registered enum families are available; absent live slide/placeholder,
chart and freeform collections remain explicitly outstanding. These receipts
supersede the historical not-implemented labels only for their tested members.

Current adjustments and builder members: [exact language/security mappings and
original tests](adjustments-freeform-evidence-20260913.md) cover all registered
preset defaults, numeric guide assignment, returned drawing operations, collection
protocols and live offsets. Two missing public source offset properties are now
appended to the inventory; older unrelated rows keep their historical status.
Owner insertion and shared command integration have separate receipts.

Current bounded chart handle: [live appearance and first-plot type mapping](chart-handle-evidence-20260913.md)
provides `chart_type`, nullable `chart_style`, `has_legend` and bounded XML access
for returned graphic frames. Full titles/axes/series/plots/legend object graphs
remain incomplete. These newer receipts supersede earlier absent-builder/handle
statements only for the tested members; they do not claim whole-public-API parity.

Current chart graph and builders: [integrated SDK/CLI receipt](chart-object-operation-evidence.md)
links exact graph, builder, drawing, font and all-variant ledgers. These supersede
older absent-live-chart/builder labels only for their tested members. The case
ledgers retain fixture-payload uncertainty and explicit language/security mappings;
no complete format or literal source-runtime parity is inferred.

Current media public interfaces: [image/movie/OLE integration receipt](media-public-integration-evidence.md)
links exact metadata, inert-byte insertion and returned-interface mappings.
These supersede historical image-only limitations for their tested members;
whole-public-API coverage remains incomplete.

## Sources and baseline

- [Published API and user guides](https://python-pptx.readthedocs.io/en/latest/).
- Pinned source documentation at commit `278b47b1dedd5b46ee84c286e77cdfb0bf4594be` in `/tmp/pptx-upstream-review/docs`.
- [Reconciled API inventory](upstream-api-inventory.json): all 719 original candidate IDs retained, expanded to 2,407 type/member/constructor/protocol/enum records from 54 pinned API/user-guide files, with documentation and source hashes. The total mixes record kinds and is not a coverage certificate.
- [Reconciliation findings](api-reconciliation.md): source locations and resolutions for documentation drift, inherited/returned graph closure and guide contributions.
- [Language/security mappings](api-language-mappings.md): J01–J10 decisions referenced by inventory rows.
- [Published-page review receipt](published-docs-review.json): all 54 corresponding pages opened through the web reader; direct raw HTTP acquisition denied.
- [Executed test baseline](upstream-test-audit.md) and [full case inventory](upstream-test-inventory.json).
- [Counterpart API audit](../docx/upstream-api-audit.md).

The inventory now expands inherited domain members, returned interfaces, constructors, separate getter/setter signatures, sequence/scalar protocols and enum aliases. Static AST analysis did not execute the reference runtime. It is not an exact Sphinx build or proof of implemented API coverage. Source annotations that are missing remain explicitly absent; incorrect annotations and prose-only promises have evidence-backed dispositions. The subsequent [target API register](public-api-map.json) specifies TypeScript declarations and bounded views; the [command register](command-coverage.json) specifies proposed operation schemas and later route corrections. Compiled exports, executable schemas and passing original tests remain implementation work. Published objects.inv and direct HTML downloads returned HTTP 403; no bypass was attempted. Web-reader access does not establish raw-byte identity with the pinned RST.

## Findings that change the requirements

The public model includes presentation/slides/layouts/masters/notes, shape collections and adjustments, freeform builders, connectors, keyed placeholders, text, tables, chart data builders and full chart object graphs, DrawingML formatting, action/hyperlink objects, images/media/OLE, units and enums.

- Placeholder indexing is sparse key lookup by idx, not sequence position. Rich-content insertion returns a new picture or graphic-frame object and invalidates the previous placeholder handle.
- Chart coverage includes category/date/numeric/hierarchical labels, XY/bubble data, titles, axes, tick labels/gridlines, plots, series, points, markers, legends, data labels and workbook-backed replacement. A few creation commands do not cover this API.
- DrawingML includes gradient stops/angles, patterned fills, color brightness/theme behavior, line formatting and inherited shadows; shapes include adjustment collections and freeform construction.
- Movie/media-format and OLE-format objects are returned through public operations even where top-level API documentation is sparse. Those returned interfaces are explicitly included in reconciliation.
- Images expose bytes, content type, DPI, extension/name, size and a SHA-1 property. That hash is API metadata, not the SHA-256 integrity identity used by the new tools.
- Notes and other missing structures may be created by accessors. Read-only command inspection must avoid creating getters.
- Default property creation in the source inserts source-project identity and wall-clock time. Original metadata and explicit context timestamps are mandatory mappings.
- The RST documents CoreProperties at an old module path; the current public property is served by CorePropertiesPart. The inventory retains the documentation ID and records the resolved source path.
- `add_chart` and `add_movie` have incorrect source return annotations: the actual returned interfaces are GraphicFrame and Movie. The target signatures correct them.
- `follow_master_background` has documented setter behavior but no source setter. The planned write capability remains visible rather than being excluded from the public contract.
- Prose-only `FreeformBuilder.close` and cell `row_idx`/`col_idx` are erroneous references. Existing closure and coordinate-traversal operations supply the corrected recipes. Pattern `PERCENT_40` corrects the source typo; notes-guide `SLIDE_IMAGE` closes an enum-list omission.
- Collections are not interchangeable: table cells/rows/columns and chart points reject negative positions, slide placeholders use sparse keys, and only specific source collections support slices. The inventory records each collection's rules.

Published docs identify version 1.0.0 while the pinned source package identifies 1.0.2. This is recorded version drift, not evidence that one site exhaustively documents the newer code. The API register must reconcile both.

## SDK decision

Use [the shared SDK contract](../specs/office-sdk.md): retain neutral public snake_case method/property spellings as the primary object model and mirror documented behavior. No second blanket camelCase alias layer. Preserve direct property access, live objects, enum symbols and familiar constructors where practical.

JavaScript-specific mappings are explicit: async loading/saving/input admission; iteration and length; zero-based sequences versus keyed collections; null/inheritance; trailing typed keyword options; typed units and UTC dates; neutral errors; capability-scoped paths and supplied metrics/time. Documented private-looking types are not excluded by naming alone. Python dependency internals and unrestricted host access are not part of the mirror.

Every public member needs a row recording target signature/defaults/return/side effects/exception behavior, CLI route and independent original tests, including members without upstream tests. Unsupported public behavior blocks whole-API claims. Source project identities stay in plans/research and required legal notices, never product code/comments/tests/fixtures/output.

## Command ergonomics

[The common CLI contract](../specs/office-cli.md) provides consistent plural resources, text replace, flags, simple scoped selectors, structured results, diff exit behavior, schema/capabilities and direct common operations. CLI operation options remain consistently camelCase in JSON; that operation surface is separate from retained object-model method spelling. Both invoke the same domain behavior.

## Historical validation checkpoint

At the original reconciliation checkpoint, the documented API had been reconciled as research and no JavaScript API had been implemented or tested. Reference-runtime passes established only the pinned reference baseline. The [agent verification plan](../plans/pptx-api-reconciliation.md) records those historical checks. The later implementation receipts linked above record bounded TypeScript SDK and CLI behavior and executed checks; the checkpoint must not be read as current package-wide status.

Whole-public-API coverage remains incomplete. Original user-guide equivalents, live object-model coverage and independent acceptance for every documented member remain required. The [case ledger](test-case-map.json) distinguishes reviewed designs, provisional BDD descriptions, assigned semantic work and deferred public behavior. All inherited, underscore-prefixed and otherwise untested public API obligations remain visible. No corpus bytes were changed or cleaned up during this reconciliation.
