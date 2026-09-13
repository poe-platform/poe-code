# Presentation full-inventory audit

The audit accounts for every pinned source row, but **complete test/API parity
remains unproven**. The [machine-readable receipt](full-inventory-audit-20260913.json)
partitions all 3,673 ledger rows by disposition and retains input hashes.
The [procedure and remaining QA](../plans/pptx-full-inventory-audit-20260913.md)
are separate from this evidence report.

## Test dispositions

| Central-ledger disposition          |  Rows |
| ----------------------------------- | ----: |
| Recorded original TypeScript passes |    43 |
| Semantic review required            | 2,585 |
| Specified, not implemented          |   167 |
| Proposed design, not implemented    |   877 |
| Deferred public behavior            |     1 |
| Total                               | 3,673 |

All 2,700 unit variants and 973 expanded BDD examples resolve exactly once by
inventory pointer, source identity, file, line and revision. All unit behavior,
fixture and helper pointers resolve; expanded BDD steps remain recorded. The
2,057 parameterized and 643 unparameterized unit rows remain separate.
Every row retains its own evidence, rationale and gap. This verifies accounting
and traceability, not the semantic sufficiency of provisional original designs.

The 43 passes cover 12 byte-reader rows and 31 axis-crossing rows. Their retained
original tests and execution receipts exist; the fresh package run below exercises
the package tests again. The crossing table distinguishes modes, null removal,
positive/negative numeric values and the crossed axis; independent XML assertions
check state and preservation. Byte-reader mappings replace private delegation
with owned bytes, presence, absence and relationship observations. Their declared
language/security differences remain part of equivalence, not literal runtime
compatibility. Many-to-one mappings require the row-specific assertions in these
receipts; a shared test filename alone is insufficient.

No architecture-only exclusions are approved. The 3,630 remaining rows cannot be
counted as passing adaptations. Later family receipts may support individual
promotions after exact payload review; this audit does not promote them by name
matching. Graphic-frame shadow remains a central-ledger public deferral, including
an unimplemented rejection design; this is not a new claim that every later
shadow implementation is absent. Whole-public-API parity stays blocked.

## API and command reconciliation

All 2,409 inventory records join into 2,426 target obligations, including 17 bounded
view additions and 425 records with underscore-prefixed path components. No member
is excluded because of its name or absence from upstream tests.

The command register omitted `FreeformBuilder.shape_offset_x` and
`shape_offset_y`. It now retains both SDK obligations, exact read-only `Length`
signatures, mapping rules and original command acceptance designs. Registered
bindings remain empty: the proposed `shapes.freeform.shape_offset_x.get` and
`shapes.freeform.shape_offset_y.get` routes are not registered operations. There
are still 1,933 operation declarations; the register contains 6,323 planned
acceptance entries. These totals do not describe implemented commands.

[J01–J10](api-language-mappings.md) retain neutral model spellings, synchronous
owned properties, always-async admission/save, explicit VFS/bytes/sinks, supplied
metrics/time, zero-based sequences versus keyed placeholders, safe EMU rounding,
null inheritance, UTC dates and neutral typed errors. Public XML/part views remain
bounded. Model text assignment differs from preserving `text replace`. The shared
CLI contract governs plural resources, one-based scoped selectors, version-1 JSON,
common flags, schema/capabilities and ordinary/diff exit statuses. Empty bindings
are visible contract gaps, not permission for dynamic property invocation.

## Standards, corpus and security

All F01–F60 IDs occur in the format specification, standards table and command
register. The receipt preserves each standards row and command pointer. Declared
edit/read/preserve/reject levels are requirements; neither source passes nor
statement coverage establishes their conformance.

The corpus manifest lists 14 decks totaling 643,143,571 bytes. Its acquisition
flags are historical, not current product-support labels. Earlier targeted
structural operations are recorded in
[the documentation receipt](documentation-reconciliation-20260913.md); no corpus
operation, download or visual check ran in this audit. The acquisition receipt
still leaves real-world Strict, signatures, SmartArt, modern comments, RTL,
audio/captions, advanced charts and hundreds-of-slides coverage open. Structural
preservation cannot establish rendering or playback.

Eight small original regression designs remain in
[the corpus gap register](corpus-gap-regressions.json). They are not executable
passes. No publisher asset was copied into a unit fixture. Future regression
reduction and visual procedures remain under docs/plans.

The fresh run includes 18 original security-admission cases: macro/signature
markers, protection, classification labels, encryption flags, ordinary-label
retention and inert orphan-byte preservation. These supplement F55 and do not
close upstream cases. They establish bounded rejection/preservation, not
cryptographic verification, full rights interpretation, universal mutation
admission or complete signature removal.

## Executed measurements

Node 22.23.2 / Vitest 4.1.11 with V8; maintained package unit route:
**6,809 tests passed in 259 files**, with no failures or skips reported. Package
lint passed ESLint and both TypeScript checks.

| Measurement                          | Covered / total | Percent |
| ------------------------------------ | --------------: | ------: |
| Target statements                    | 21,469 / 23,605 |  90.95% |
| Target branches                      | 22,566 / 25,870 |  87.22% |
| Pinned source statements, historical | 11,246 / 11,508 |  97.72% |
| Pinned source branches, historical   |   1,327 / 1,466 |  90.52% |

Target coverage includes packages/pptx/src/\*_/_.ts and excludes test files. It
excludes safe-bash adapters and other packages. Instrumentation and denominators
differ from the source runtime; these percentages are not comparable parity
scores or OOXML conformance. The run used the existing working tree, including
unrelated uncommitted changes fingerprinted in the receipt. The documentation
commit alone does not reproduce that product-tree snapshot.

Derived research remains covered by the standalone
[case notice](test-case-map-notice.txt), [API notice](public-api-map-notice.txt)
and [baseline notice](upstream-license-notice.txt). No product code, tests, README,
fixture, native runtime or product network changes belong to this audit.
