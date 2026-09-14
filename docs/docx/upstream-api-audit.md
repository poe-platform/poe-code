# DOCX Public API Documentation Audit

Status: Documentation and source reviewed; SDK implementation not started.

## Sources and baseline

- [Published API and user guides](https://python-docx.readthedocs.io/en/latest/).
- Pinned source documentation at commit `e45454602b53e8e572b179ccf1c91093ec9f4ed7` in `/tmp/docx-upstream-review/docs`.
- [Candidate API inventory](upstream-api-inventory.json): 331 member/type/protocol records from 39 pinned API/user-guide files, with hashes.
- [Executed test baseline](upstream-test-audit.md) and [full case inventory](upstream-test-inventory.json).
- [Counterpart API audit](../pptx/upstream-api-audit.md).

The inventory expands local RST directives and source members; returned interfaces and protocols were supplemented during review. It is intentionally labeled a candidate inventory. It is not an exact Sphinx build and does not prove inherited/prose-only/alias closure is complete. The implementation plan requires reconciliation of every public member and an evidence-backed target signature. Published objects.inv downloads returned HTTP 403; no bypass was attempted.

## Findings that change the requirements

The public model includes document/paragraph/run/formatting, sections and linked headers/footers, styles and latent styles, tables and logical grid cells, comments, hyperlinks, rendered-page-break fragments, inline shapes, settings, unit/color helpers and enum values. Publicly documented underscore-prefixed types remain in scope.

- Heading level 0 creates a title; levels 1–9 are headings. The earlier matrix needed level 0 added.
- Omitted leading/trailing table cells are different from empty cells. Logical merged-cell access can repeat the same cell across grid positions; nested content traversal preserves paragraph/table order.
- Font formatting includes substantially more than bold/italic: hidden/complex-script/RTL/no-proof/outline/shadow and other flags, with explicit false versus inherited absence.
- Latent styles expose defaults and individual visibility/priority/locking/gallery behavior. Tab-stop add/delete/clear and units including twips need public API coverage, not just XML preservation.
- Comments are rich block containers and can contain paragraphs, tables and run content; restrictions on comment anchors and prohibited nesting/header/footer comments must be retained.
- The user-guide comment example refers to id/date, while the verified current object exposes comment_id/timestamp. Record this as documentation drift instead of adding accidental aliases.
- Public whole-text assignment may discard selected run formatting. Preserve that setter behavior explicitly and keep formatting-preserving literal replacement separate.
- Image creation accepts more than the initial PNG/JPEG subset and defines native-size/DPI behavior. A full API plan must characterize the supported formats and defaults.

Published docs identify version 1.2.0, consistent with the pinned package version. The review uses the actual pinned source to resolve guide inconsistencies.

## SDK decision

Use [the shared SDK contract](../specs/office-sdk.md): retain neutral public snake_case method/property spellings as the primary object model and mirror documented behavior. No second blanket camelCase alias layer. Preserve direct property access, live objects, enum symbols and familiar constructors where practical.

JavaScript-specific mappings are explicit: async loading/saving/input admission; iteration and length; zero-based sequences versus keyed collections; null/inheritance; trailing typed keyword options; typed units and UTC dates; neutral errors; capability-scoped paths and supplied metrics/time. Documented private-looking types are not excluded by naming alone. Python dependency internals and unrestricted host access are not part of the mirror.

Every public member needs a row recording target signature/defaults/return/side effects/exception behavior, CLI route and independent original tests, including members without upstream tests. Unsupported public behavior blocks whole-API claims. Source project identities stay in plans/research and required legal notices, never product code/comments/tests/fixtures/output.

## Command ergonomics

[The common CLI contract](../specs/office-cli.md) provides consistent plural resources, text replace, flags, simple scoped selectors, structured results, diff exit behavior, schema/capabilities and direct common operations. CLI operation options remain consistently camelCase in JSON; that operation surface is separate from retained object-model method spelling. Both invoke the same domain behavior.

## Validation status

The documented API has been reviewed and candidate inventory recorded; no JavaScript API has been implemented or tested. Existing Python test passes establish only the pinned reference baseline. The plans now include complete API/feature/command mapping, original user-guide equivalents and paired command acceptance.
