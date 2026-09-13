# Live chart handle for rich insertion

Owner: delegated model agent; placeholder delegate integrates GraphicFrame.chart.
Root owns explicit-file commit and export. No push or release.

1. Add original tests for chart type, nullable style, legend state, bounded XML
   view, invalid input and invalidated ownership; first run fails absent module.
2. Reuse chart-editing classification and appearance updates in a Chart handle.
3. Correct exploded pie/doughnut classification while retaining existing typed
   data replacement restrictions on combination charts.
4. Run focused chart regression tests, then shared maintained checks.

Agent QA: obtain GraphicFrame from original chart placeholder insertion, mutate
`.chart.chart_style` and `.chart.has_legend`, save/reopen with admitted in-memory
bytes, verify the updated chart. No reference deck/runtime is needed. Follow-up
whole chart object graph work remains explicitly open.

Synchronous insertion correction:

- Confirm `insert_chart` is model-only and must synchronously return GraphicFrame.
- Extract pure workbook member preparation and staged shared chart assembly.
- Defer only workbook ZIP serialization to existing async save/publication; reserve
  pending part names and flush before image snapshot operations.
- Validate chart XML, original workbook XML, cancellation and member/archive byte
  budgets before committing model changes; retain atomic stage maps.
- Add original synchronous-return, multiple-pending-workbook, save/reopen,
  intervening-edit and image-after-chart regressions through the live owner.
- Run original workbook creation/replacement preservation checks after extraction.
