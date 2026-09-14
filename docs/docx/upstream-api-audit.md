# DOCX Public API Documentation Audit

Status: Pinned documentation/source reconciliation completed on 2026-09-13;
mapping status reconciled on 2026-09-14; bounded style/formatting model evidence
now recorded separately, full document object model remains incomplete.
Bounded package primitives now have separate evidence in the
[validation profile](validation-profile.md); they do not establish model API coverage.
The later [logical text read milestone](text-extraction.md) also remains a utility
operation; no documented model member or enum is promoted by its passing tests.

The [paragraph operation milestone](paragraph-editing.md) remains utility-level
coverage. Exact paragraph, tab, break and unit mappings, D23 handle drift and the
unchanged pending model/inherited/enum inventory statuses are recorded in the
[bounded task plan](../plans/docx-paragraph-editing.md#standards-and-exact-languagesecurity-mappings).

The [style and heading utility milestone](styles.md) adds named definition/default
operations and heading levels 0–9. The later [style/formatting audit](style-formatting-audit.md)
and [exact scoped case map](style-formatting-case-map.json) record latent mutation,
inherited style interfaces, complete Font flags, tab collections and explicit
language/security mappings. Their original tests are implementation evidence for
that subgraph only; inherited/public underscore-prefixed interfaces remain
accounted for, and unrelated model operations remain pending. The original pinned
inventory is retained as research provenance rather than rewritten as execution
results.

The [section utility milestone](sections-page-settings.md) adds bounded
list/add/set operations and preserves separate section/story ownership. Its
[exact mapping and drift record](../plans/docx-sections-page-settings.md#exact-languagesecurity-mappings-and-documentation-drift)
retains the Section/Sections/Settings and public _Header/_Footer obligations.
No live section owner, inherited interface or enum is promoted by this utility
evidence. The later [header/footer story milestone](../plans/docx-header-footer-stories.md)
implements noncreating utility reads, explicit shared/local binding edits and
removal, with resource/field retention and reused scoped text/paragraph operations.
Its exact language/security table retains every public `_Header`/`_Footer`
inherited member and the creating-getter obligations; full live owners and general
table/image editors remain pending. The pinned inventory stays historical.

The [bounded list utility milestone](../plans/docx-multilevel-lists.md) implements
lists.add/set with scoped numbering graphs, nested levels, style-link resolution
and isolated start/restart overrides. Its exact language/security and drift table
retains every public NumberingPart and `_NumberingStyle` obligation, including
inherited members and returned collections. Advanced level-definition setters
and live numbering owners remain pending; this utility evidence does not promote
the historical model inventory to complete coverage.

The [table construction milestone](../plans/docx-table-construction.md) implements
bounded utility insertion and typed table/row/cell formatting. Its exact mappings
retain Table, _Cell, _Row, _Column, _Rows, _Columns and inherited members, collection
protocols, enum aliases and add_table/iter_inner_content obligations. Those live
owners remain pending; D03 does not introduce a model direction alias. The pinned
inventory remains historical and is not promoted by utility test passes.

The later [bounded table editing milestone](../plans/docx-table-editing.md) adds
logical anchor/span/omission inspection, cell value/formatting changes and explicit
rectangular row/column insertion/deletion. Its exact mapping table retains all
public and inherited table members, zero-based live collections versus 1-based
utility coordinates, nullable properties, enum/helper obligations and D03. Live
owners and full property inventory remain pending; no historical inventory row
is promoted merely by utility execution. The later
[merged-cell milestone](../plans/docx-merged-cells.md) adds explicit utility
merge/split, covered-coordinate write intent and row deletion through spans.
Its exact JS/security mappings preserve all live table, inherited, enum,
collection and public underscore-prefixed obligations as separately pending.

## Sources and baseline

The later [theme/font resource milestone](font-resources.md) adds utility
inventory and embedded-font mutation rejection. Its [exact mapping record](../plans/docx-theme-font-resources.md)
retains the existing Font/ColorFormat/null/enum distinctions and separates
resource-slot resolution from rendering. The pinned inventory remains historical;
this milestone does not promote pending model owners, inherited interfaces or
public underscore-prefixed types to complete coverage.

- [Published API and user guides](https://python-docx.readthedocs.io/en/latest/).
- Pinned source documentation at commit `e45454602b53e8e572b179ccf1c91093ec9f4ed7` in `/tmp/docx-upstream-review/docs`.
- [Reconciled research inventory](upstream-api-inventory.json): schema version 2, preserving all 331 original IDs and expanding to 920 model/support/error records from 39 pinned API/user-guide files. The 262 nested enum values include value aliases; counts are research accounting, not a conformance denominator.
- [Reconciliation evidence and language/security decisions](upstream-api-reconciliation.md): source/getter/setter/constructor evidence, inherited and returned interfaces, prose review, enum aliases and 23 resolved documentation/source discrepancies.
- [Executed test baseline](upstream-test-audit.md) and [full case inventory](upstream-test-inventory.json).
- [Counterpart API audit](../pptx/upstream-api-audit.md).

The inventory now reconciles 59 RST directives with static source declarations,
inherited and built-in protocols, returned interfaces, guide prose and the
corresponding published pages. Separate source getter/setter signatures preserve
asymmetric read/write types. It is not an exact Sphinx build or an exhaustive
certificate: counts include explicitly identified package support and erroneous
documented symbols. The subsequent [public API map](public-api-map.json) records
1,337 proposed member/value/protocol rows with target signatures, CLI routes and
original acceptance contracts. None was implemented by that mapping milestone;
later bounded implementation evidence is linked above. Direct documentation downloads returned
HTTP 403; published pages were read through the web research tool. No new
objects.inv download, reference runtime execution or product test pass is claimed.

## Findings that change the requirements

The public model includes document/paragraph/run/formatting, sections and linked headers/footers, styles and latent styles, tables and logical grid cells, comments, hyperlinks, rendered-page-break fragments, inline shapes, settings, unit/color helpers and enum values. Publicly documented underscore-prefixed types remain in scope.

- Heading level 0 creates a title; levels 1–9 are headings. The earlier matrix needed level 0 added.
- Omitted leading/trailing table cells are different from empty cells. Logical merged-cell access can repeat the same cell across grid positions; nested content traversal preserves paragraph/table order.
- Font formatting includes substantially more than bold/italic: hidden/complex-script/RTL/no-proof/outline/shadow and other flags, with explicit false versus inherited absence.
- Latent styles expose defaults and individual visibility/priority/locking/gallery behavior. Tab-stop add/delete/clear and units including twips need public API coverage, not just XML preservation.
- Comments are rich block containers and can contain paragraphs, tables and run content; restrictions on comment anchors and prohibited nesting/header/footer comments must be retained.
- The user-guide comment example refers to id/date, while the pinned object exposes comment_id/timestamp. The reconciliation keeps explicit documentation-error rows instead of adding accidental aliases. It also resolves obsolete table-direction, style-lookup, style-priority, date and enum examples.
- Public whole-text assignment may discard selected run formatting. Preserve that setter behavior explicitly and keep formatting-preserving literal replacement separate.
- Image creation accepts more than the initial PNG/JPEG subset and defines native-size/DPI behavior. A full API plan must characterize the supported formats and defaults.

Published docs identify version 1.2.0, consistent with the pinned package version.
That label alone does not prove source identity. Source hashes and the documented
shared contracts resolve discrepancies, including source defects in linked-image
predicates, per-axis DPI, and UTC date serialization. Shared rounding and typed
validation differences are explicit in the reconciliation report.

## SDK decision

Use [the shared SDK contract](../specs/office-sdk.md): retain neutral public snake_case method/property spellings as the primary object model and mirror documented behavior. No second blanket camelCase alias layer. Preserve direct property access, live objects, enum symbols and familiar constructors where practical.

JavaScript-specific mappings are explicit: async loading/saving/input admission; iteration and length; zero-based sequences versus keyed collections; null/inheritance; trailing typed keyword options; typed units and UTC dates; neutral errors; capability-scoped paths and supplied metrics/time. Documented private-looking types are not excluded by naming alone. Python dependency internals and unrestricted host access are not part of the mirror.

Every public member needs a row recording target signature/defaults/return/side effects/exception behavior, CLI route and independent original tests, including members without upstream tests. Unsupported public behavior blocks whole-API claims. Source project identities stay in plans/research and required legal notices, never product code/comments/tests/fixtures/output.

## Command ergonomics

[The common CLI contract](../specs/office-cli.md) provides consistent plural resources, text replace, flags, simple scoped selectors, structured results, diff exit behavior, schema/capabilities and direct common operations. CLI operation options remain consistently camelCase in JSON; that operation surface is separate from retained object-model method spelling. Both invoke the same domain behavior.

## Validation status

Current package-engine evidence is recorded separately in the
[bounded validation profile](validation-profile.md). The historical inventory
and counts below concern the model mapping task, not the absence of all utility
code. No model row is promoted by the package-validation milestone.

The pinned inventory/reconciliation task is complete within its declared research
scope; no documented document-object-model API is claimed implemented by that
research task. Existing Python test passes establish only the pinned reference baseline. The subsequent
[test crosswalk](test-case-map.json) maps all 2,259 source cases to original target
acceptance obligations; mapping is not an executed test pass. The
[API map](public-api-map.json) includes 1,337 proposed rows and original guide
contracts, while the [command register](command-coverage.json) records the proposed
operation coverage. Target implementation, executed original user-guide examples,
paired CLI/SDK acceptance and product QA remain pending.

The [original review/check record](../plans/docx-public-api-reconciliation.md)
retains the audit-time state. The [status correction record](../plans/docx-corpus-api-status-reconciliation.md)
documents the later evidence comparison. Corpus acquisition, including the
[gap supplement](corpus-feature-gaps.md), neither changes these mapping rules nor
supplies product conformance evidence.
