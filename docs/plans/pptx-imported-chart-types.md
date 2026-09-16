# Imported chart type classification

Owner: drawing-format delegated follow-up. Own only chart-type-model.ts,
chart-type-model.test.ts and this plan/evidence. Chart-object delegation wires
Chart.chart_type; root owns public exports and command integration.

1. Enumerate every XL_CHART_TYPE inventory member and read retained analysis.
2. Write original XML unit examples for all variants, verify complete enum set.
3. Implement read-only imported classification separately from the bounded data
   reconstruction classifier. Preserve creation limits and unsupported payloads.
4. Reconcile surface documentation drift against authoritative OOXML descriptions.
5. Run focused tests/lint; root runs maintained package checks before commit.

Agent QA: inspect original in-memory XML cases in both dialects. Verify 73 names,
series/plot discriminator precedence, combined stock-volume shape and namespace
lookalikes. Do not execute reference binaries or copy external decks. This is a
non-rendering classifier; chart rendering and data replacement are separate QA.

Final root verification: maintained `npm test --workspace=pptx` passed 6,292 tests in 236 files; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. No push or release.
