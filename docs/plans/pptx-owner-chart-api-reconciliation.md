# Owner/chart public register reconciliation

Apply the completed original owner/chart evidence to the existing central API
register without changing its inventory denominator or promoting aliases by name.

1. Read exact source declarations and target signatures for Slide.part,
   Shape.part, GroupShape.part, GraphicFrame.part and SlideShapes.add_chart.
2. Match the actual exported/returned concrete interfaces to executed tests.
3. Replace proposed routes with the tested xml.get/charts.add equivalents; retain
   historical proposed batch routes separately so they are not executable claims.
4. Mark GroupShapes.add_chart explicitly unsupported despite the callable method
   name; its typed rejection is not successful behavior coverage.
5. Recompute the three disjoint register partitions and validate source-ID
   preservation against the preceding committed register.

Agent QA: run focused original tests; inspect exact changed JSON rows, confirm
public spellings, argument types, source-return correction, async boundary and
no implicit I/O; parse the complete JSON and compare IDs/counts. No new unit test
is needed for this documentation-only register edit.
