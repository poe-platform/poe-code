# Table public surface

Ownership: table model and original table-public-surface tests; coordinated narrow
FillFormat owner binding in shapes.ts. No publication or README changes.

1. Reconcile the existing table collections and model against the pinned API and
   test inventories. Numeric indexing, length, iteration, dimensions, spans,
   margins, anchors and text already exist; do not duplicate those editors.
2. Write failing original in-memory cases for missing cell equality and fill.
3. Bind the existing FillFormat to cell properties, preserving creating-getter
   behavior, live ownership, table lock validation and structural invalidation.
4. Run focused table/drawing regressions and maintained package lint/test checks.
5. Record mappings, validation and remaining gaps in docs/pptx.

Agent QA procedure: inspect serialized cell XML after solid, gradient and pattern
changes; verify adjacent cells remain unchanged, absent tcPr is created only by
fill access, locked writes leave bytes untouched, whole-cell assignment invalidates
retained text descendants, and retained handles reject
post-structure access. These are model-only changes with no CLI visual changes.

Progress: original red tests reproduced missing equals/fill. Live implementation
and six new cases pass with the existing table/drawing regressions. No external
fixtures, reference runtime, host I/O or network are involved in the product/tests.
