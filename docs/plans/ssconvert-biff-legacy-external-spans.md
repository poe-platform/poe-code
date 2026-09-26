# BIFF5/7 external sheet spans

Status: source investigation complete; semantics-preserving export remains open
under hey-boss #1748. No family is resolved by this format limitation.

LibreOffice at `bce0998afefdbc355585ca324285661a2170ba77` has token-writing
call sites for external references, but its BIFF5 external sheet lookup, external
cache storage and external-name insertion are explicitly unimplemented. Its import
path binds positive external indexes to one sheet. These paths cannot serve as
proof that multi-sheet external export works.

OpenOffice Excel File Format 1.42 sections 3.9.15, 3.9.16 and 4.10.2 distinguish
negative internal 3D references from positive external links. External links carry
one workbook URL and one sheet name. Their following 12 bytes are unused; the
first/last sheet indexes are meaningful only for internal 3D references. SheetJS
also skips these bytes. Exact source URLs and SHA-256 receipts are stored under
`reference.biffExternalIdentity.legacySourceInvestigation` in the gap ledger.

1. Preserve the current explicit refusal while investigating a representation
   that keeps the full reference semantics; writing BIFF8-style sheet indexes into
   reserved bytes is not a valid implementation.
2. Define how an explicit host can supply external sheet order without implicit
   file access or inventing intermediate sheets from endpoint names.
3. Determine which consuming formulas can safely lower a sheet span to separate
   external references. Preserve ordering, reference-valued behavior, empty sheets,
   error propagation and host resolution; do not generalize a SUM-only rewrite.
4. Validate a concrete supported lowering against original records and an
   independent consumer before implementing it with targeted regression tests.
   Continue source-led work on other token/version gaps in parallel with release
   monitoring; do not replace the remaining family scope with this one limitation.
