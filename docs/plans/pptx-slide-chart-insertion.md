# Synchronous slide chart insertion

Implement `SlideShapes.add_chart(chart_type, x, y, cx, cy, chart_data)` with a
live `GraphicFrame` result, using the existing format-package chart admission
and mutation engine. Leave the explicit grouped insertion gap visible.

Original TDD / agent QA procedure:

1. Reproduce missing method through public exports with an original category
   builder, then use the same state insertion helper as CLI chart creation.
2. Keep builder/geometry conversion synchronous. Record generated workbook
   members for explicit async save. Test chart replacement before first save.
3. Verify live chart edits, independent successive chart/workbook allocations,
   and save/reopen. Compare cache data through memfs-backed `charts add`.
4. Reject invalid geometry and grouped insertion before changing the package.
5. Run focused model/command regressions and the maintained package lint route.

Red: method absent in both initial original cases. Green: first two cases pass;
expanded regression and maintained checks recorded in the evidence receipt.

Validation checkpoint: 3 insertion tests pass (221 ms); seven focused suites
passed 35 tests. Package lint passed ESLint/production types; concurrently red
layout tests temporarily blocked test-type completion. Evidence records this.
