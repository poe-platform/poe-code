# XML utility reconciliation

Scope: original parser, namespaces, descriptor and scalar utilities; counterpart namespace/XML helper cases. OPC content types/relationships/serialization are owned by the package reconciliation. Domain-specific DrawingML, tables and shapes remain with their feature ledgers. No full pipeline, network product behavior, README changes, pushes or releases.

## Procedure

1. Read the shared contracts and audit, compare all selected inventory identities with pinned source fixtures.
2. Replace descriptor, metaclass and mocked conversion call assertions with immutable QName inspection, explicit scalar admission, ordered child editing and byte preservation.
3. Reproduce missing universal coordinate and percentage reads, malformed lexical acceptance and command behavior with original in-memory/memfs tests before changes.
4. Route only coordinate-union offsets through unit conversion; extents, IDs and rotations use integer lexical parsing. Keep immutable snapshots and exact unknown markup.
5. Run focused original tests, maintained package lint/test routes and root-owned command screenshot QA. Record executed checks separately from inventory accounting.

## Results

Initial scalar run: 19 failures among 37 tests demonstrated missing six unit conversions, six percentage literal reads and seven malformed-token acceptances. Following small codec integration, these 37 passed. The SDK/CLI test then reproduced a separate raw shape attribute reader failure; the same codec resolved it. A negative extent test first failed, then passed after restricting extents to integer tokens. A null integer test first exposed a native error and passed after neutral typed failure mapping.

The reconciliation receipt and exact ledger are in `docs/pptx/xml-utility-reconciliation.md` and `docs/pptx/xml-utility-reconciliation.json`. Tests use original XML strings and memfs, never reference binaries. No QA corpus downloads were needed for these lexical scalar and tree invariants.

Command QA: use the memfs setup in `packages/pptx/src/command-xml-scalars.test.ts`, run `shapes get /measured.pptx --slide 1 --shape Measured --json`, and verify stored left/top and first geometry corner are 1097280 and -533400. Root owns screenshot and maintained package check recording.

Focused validation: eight XML/scalar/color/shape files passed 327 tests before the final eight qualified-attribute/successor assertions; the final focused utility file passed all 87. Root inspected the successful command screenshot and is running final maintained package verification.

Final review reproduced valid surrounding XML whitespace rejection (five failing cases) and unit/percent internal-gap acceptance (two failing cases). Numeric admission now trims only outer XML space/tab/CR/LF and rejects internal/non-XML whitespace. Final scalar tests include all 64 variants.

Final root verification: maintained pptx workspace tests passed 6,654 cases in
250 files; workspace lint and selected workspace build closure passed. Five
focused actual safe-bash cases passed. Only explicitly owned files enter the
local atomic commit; no push or release.
