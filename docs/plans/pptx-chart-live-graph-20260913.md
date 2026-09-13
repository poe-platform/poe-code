# Live chart object graph

Owner: chart_objects subagent. Scope: chart-model.ts, chart-model-core.ts,
chart-model-axes.ts, chart-model-series.ts, original chart-model-objects.test.ts,
and the shared text-frame parser's chart txPr admission.

Implement owner-bound chart titles, legend, axes, gridlines, tick labels,
plot/series/point/data-label/marker objects with shared drawing/text formatting.
Keep chart data/cache replacement behind the package owner's explicit callback.
Use original in-memory XML cases, never downloaded decks as committed fixtures.

Completed implementation stages:

- Reproduced missing graph access with four failing original tests.
- Added shared XML binding, scalar validation, drawing/text adapters, and live
  graph classes retaining documented neutral property names.
- Added all sixteen chart XML plot families, strict and transitional shared
  formatting, and imported-type classifier integration owned by drawing_format.
- Reproduced and fixed title resurrection, noncreating point/gridline reads,
  duplicate cache indexes, stale shifted series, collection value equality,
  numeric indexing, shared fill sentinels and bounded gradient XML edits.
- Routed chart part and replacement through explicit owner callbacks.
- Focused 32 graph tests pass, plus 10 independent review cases. Package-wide
  maintained checks and atomic commit are owned by the root coordinator.

## Agent QA procedure

1. Run the maintained pptx workspace unit and lint routes through the root agent.
2. Inspect graph mutation through SDK-backed charts set commands. Verify original
   text/cache/extension content and embedded workbook ownership remain intact.
3. Inspect JSON command output using the repository screenshot command when the
   root's new CLI fields affect displayed schema/help.
4. Read the exact member ledger and test reconciliation status before reporting
   coverage; distinguish original behavior coverage from absent fixture payloads.
5. Stage only owned implementation/tests and relevant plan/evidence. Do not push.

- Final ownership review moved graph binding and descendant creation capabilities
  off returned instances into internal module helpers and private WeakMap state.
- Reconciled nullable legend/bubble setters and bounded inherited index searches
  against the retained target-signature register, adding original negative tests.
