# Live placeholder ownership

Owned implementation: presentation-model.ts, slide-model.ts, its original tests,
and narrow Table ownership binding. Integrate existing insertion engines under
explicit package context; never use host I/O or network. Root owns exports.

TDD evidence: new sparse lookup, inherited geometry, table return/invalidation,
and duplicate-key tests failed on missing slide-model module before implementation.

Agent QA: run focused model tests, package lint and maintained package tests;
inspect serialized original in-memory slide XML and reopen a saved presentation.
Record final checks and language mappings in docs/pptx.

## Completed

- Added live slide/shape/placeholder ownership and sparse lookup.
- Added inherited coordinate resolution through layout and master type categories.
- Added rich insertion with returned live picture/table/chart handles and atomic
  revision checks for package-backed insertion.
- Integrated shared shape-ID allocator, freeform builder, connectors and nested
  group children; initial group membership rejects foreign and duplicate handles.
- Fixed independent regressions for connector sibling binding, row-count table
  height, nested group ancestor bounds and preservation of group rotation.
- Added owner authority checks using private fields and internal weak identities.

Evidence: docs/pptx/live-placeholder-evidence.md. Twenty-two focused original
cases passed; package TypeScript passed. Root coordinates final maintained checks
and serialized explicit staging. No push or release is authorized.

Remaining model obligations are listed explicitly in the evidence rather than
being removed from the audit inventory. The full live chart graph is not part of this atomic change. Chart insertion now
returns synchronously; workbook archive encoding is deferred to async save after
pure member preparation. Immediate handles, multiple pending workbooks, atomic
invalid data and save/picture flush guards have original regression coverage.

Final signature check: chart insertion accepts the documented numeric enum as its
primary overload, with a typed string convenience overload for command integration.
An original failing-before-fix test covers enum insertion and atomic unsupported
enum rejection.
