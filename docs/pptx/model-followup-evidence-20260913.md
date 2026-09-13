# Chart builder numeric lookup evidence

## Validated issue and correction

The shared SDK contract §4 maps ordinary numeric lookup to zero-based positions
and negative indexing to explicit `.at(index)`. Previously the chart builder
proxy forwarded negative bracket keys to `.at`, returning an unrelated from-end
member for a negative positional lookup. The existing collection implementation
now rejects that access with `IndexError` (`index-out-of-range`, phase `select`).
Nonnegative lookup retains the same checked `.at` implementation.

Original public-export tests cover category, XY and bubble chart data, the
documented `ChartData` alias, returned category collections, and all three
returned builder series/point collections. They preserve membership and identity,
negative `.at`, supported negative slice bounds, and first-member indexing.
Both access forms reject fractions, nonfinite/unsafe numbers, excessive indexes
and empty bounds. These are in-memory model tests with no filesystem admission;
there is no host I/O to mock or fixture file to create.

## Exact language and security mapping

This receipt refines J03 for these source inventory identities:

| Inventory source member | JS numeric result |
| --- | --- |
| `pptx.chart.data.CategoryChartData.__getitem__` | `CategorySeriesData` |
| `pptx.chart.data.ChartData.__getitem__` | `CategorySeriesData` |
| `pptx.chart.data.XyChartData.__getitem__` | `XySeriesData` |
| `pptx.chart.data.BubbleChartData.__getitem__` | `BubbleSeriesData` |
| `pptx.chart.data.Categories.__getitem__` | `Category` |
| `pptx.chart.data.CategorySeriesData.__getitem__` | `CategoryDataPoint` |
| `pptx.chart.data.XySeriesData.__getitem__` | `XyDataPoint` |
| `pptx.chart.data.BubbleSeriesData.__getitem__` | `BubbleDataPoint` |

For each, `[index]` accepts safe integers from zero through `length - 1`;
`.at(index)` additionally permits `-length` through `-1`. Unsupported positions
raise the neutral typed `IndexError`. Slice mapping and immutable sequence entry
rules are unchanged. Inherited `_BaseChartData` and `_BaseSeriesData` member
obligations remain public through their returned/exported concrete types. This
does not change live chart `Points` collections, table positions or keyed slide
placeholders: their distinct negative/key rules remain separate obligations.

No new authority, network or native capability is admitted. No binary fixture,
publisher document, downloaded asset or copied reference test was needed.
JavaScript bracket syntax has no honest CLI equivalent; no dynamic invocation
operation is added. Existing typed chart CLI command cases exercise integration
through the shared engine, while these new tests verify the JS protocol itself.

The pinned API/test inventories and both upstream audit documents were reviewed.
This original JS mapping test adds coverage beyond source-language test mechanics;
it does not claim any complete upstream parameter-family adaptation. Historical
`not_implemented` inventory/audit language is superseded only for this bounded
tested lookup behavior. No source identities or private-looking public APIs were
removed from accounting. Whole-public-API conformance remains incomplete.

## Validation

- Before correction: `npx vitest run packages/pptx/src/chart-data-indexing.test.ts`
  failed 1 of 2 tests because a negative bracket lookup did not throw.
- After correction: the new test and `chart-data-model`, `chart-model-objects`,
  `command-charts` suites passed 58 tests across four files.
- Existing typed `command-charts-editing.test.ts` acceptance passed 16 tests.
- `npm run lint --workspace=pptx` passed ESLint, production TypeScript and test
  TypeScript validation.

No CLI rendering changes, commits, pushes or releases were performed by this
delegated work item.
