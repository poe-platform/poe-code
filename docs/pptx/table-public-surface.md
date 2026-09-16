# Table public surface evidence

This bounded receipt supplements upstream-api-audit.md and the pinned API/test
inventories; it is not a whole-public-API completion claim.

| Public source behavior                          | JavaScript destination                                                                                                                           | Evidence                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Cell equality                                   | `TableCell.equals(other: unknown): boolean` compares live owner and physical coordinates; foreign/non-cell values are false; stale handles throw | table-public-surface.test.ts identity and invalidation cases          |
| Cell fill                                       | `TableCell.fill: FillFormat` uses the existing drawing format model on the live cell; absent tcPr is created                                     | live fill, creating-getter and lock cases                             |
| Cell text frame and destructive text assignment | Cached `TextFrame`, `parent === cell`; whole-cell text assignment invalidates prior paragraph/run handles through the same frame setter          | frame ownership/destructive-setter case                               |
| Fill and nested colors/gradient stops           | Existing `FillFormat`, `ShapeColorFormat`, `GradientStops` types retain neutral property/method spelling                                         | solid RGB, gradient angle/stop color, pattern defaults, no-fill cases |
| Row/column/cell collection protocols            | Existing zero-based numeric lookup, `.length`, `Symbol.iterator`; negative/fractional/out-of-range rejected                                      | tables-model.test.ts                                                  |

Cell equality is logical identity within the owning Table, not JS wrapper identity.
Merged continuation cells retain distinct physical identities. Structural row or
column changes invalidate existing coordinate handles, including nested fill views.
Merge/split retains coordinates. Table cell lookups share live cell owners until a
structural row/column edit invalidates and clears that owner cache. Each cell
retains its TextFrame and FillFormat; `cell.text = value` uses the destructive
TextFrame setter so old paragraph/run descendants cannot retarget replacement text. Read-only table records do not invoke `cell.fill`;
accessing that public model getter creates absent tcPr by design. Cell property
creation and fill mutation validate the same table/ancestor locks as command
operations. Extended fill transformations reuse the existing XML-preserving
FillFormat implementation rather than a competing editor.

Language/security: operations are synchronous over admitted XML; no filesystem,
native process, network, font discovery, clock, or reference-template dependency.
JS `equals` maps the source equality protocol explicitly. Getter-created properties
use namespace-aware merges; nested formats are live and owner checked. Tests use
small original byte/XML values entirely in memory, requiring no file fixtures.

Documentation drift: prose `row_idx` and `col_idx` remain erroneous references as
recorded by the main API audit; physical row/column traversal supplies coordinates.
Underscore-prefixed Cell/Row/Column/Collection types remain public obligations.

Remaining gaps: table and returned members' inherited `.part` require a real
presentation/package owner binding; no detached placeholder is introduced. The
higher-level presentation/graphic-frame table object graph remains outside this
bounded change. Typed batch/direct CLI routes for extended model fills and generic
public XML/package capabilities are not completed here. Existing collection bounds still require reconciliation with the final shared
error-class register; stale coordinates now throw `InvalidHandleError` with
`invalid-handle` code. No complete source-test ledger adaptation is claimed.

Validation: initial new tests failed on absent equals/fill; six original new tests and 126 existing table tests pass (132 total across four
files); the preceding fill change passed 153 tests across six table/drawing files. Maintained package validation
is recorded by the integrating task after all owned slices are ready.

Coordinator follow-up: original cell-frame XML limit test failed against the old
hardcoded child limits and passed after using the admitted owner's subtree view.
This seventh original table surface test prevents child XML APIs from raising
resource ceilings. The parent table still validates final mutation publication.
