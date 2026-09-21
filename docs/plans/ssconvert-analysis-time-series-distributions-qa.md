# Time series and distributions analysis QA

Preserve existing edits and READMEs. Do not push or publish. Primary source and temporary evidence stay in `out`; native Gnumeric is a separate oracle only. Unit changes use original in-memory fixtures and memfs, with random supplied by the engine.

## Procedure

1. Authenticate the official 1.12.61 archive against `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Inspect source classes, property handlers, defaults and the nine applicable native tests. Use the retained dependency/plugin/locale profile in `docs/ssconvert/analysis-tool-profile.json`, and record what was freshly verified.
2. Add failing actual-command cases before implementation. Compare formulas, array ownership, sheet names, placement, values, styles and materialization. Check grouping, labels, bin bounds, smoothing initialization, sampling traversal/ties and domain errors. Verify random sampling with injected reproducible random separately from native stochastic QA.
3. Run released native and shared JavaScript commands on original small XML workbooks. Compare every measured nonempty output cell and formula, preserving diagnostics/status. Record all differences; native skipped tests and unsupported/unmeasured modes are not passes.
4. Have a different agent stress/fix the implemented tools. Root retains Git/export/integration ownership. Stress budgets, cancellation, labels, reference edits and malformed data with original memfs fixtures.
5. Run uncached maintained ssconvert and Safe Bash build closures, workspace ssconvert tests/lint and the maintained Safe Bash ssconvert integration cohort. Run actual-command screenshots and inspect them. Reduce owned scratch evidence into the coverage receipt and purge it after use.

## Native test and class audit

| Native test | Source class | Required coverage |
| --- | --- | --- |
| t7202 | GnmMovingAverageTool, analysis-tools.c | SMA, cumulative, weighted, Spencer, adjacent-window central SMA; interval/offset/df, standard error, graph |
| t7206 | GnmExpSmoothingTool, analysis-exp-smoothing.c | Historical/current SES, Holt trend, additive/multiplicative Holt-Winters; three damp factors, period, df, errors, graph |
| t7207 | GnmHistogramTool, analysis-histogram.c | Generated/predetermined bins, boundary/infinity bit flags, cumulative, percentages, numeric filtering, charts |
| t7208 | GnmFrequencyTool, analysis-frequency.c | Native normal run explicitly skips; generated categories remain blank in source, predetermined categories, exact/percentage/chart |
| t7209 | GnmFourierTool, analysis-tools.c | Forward/inverse, next-power-of-two padding, real/imaginary array and merges |
| t7210 | GnmSamplingTool, analysis-tools.c | Random with replacement; periodic, offset default=period, number/size, alternating row/column traversal |
| t7211 | GnmRankingTool, analysis-tools.c | Descending LARGE arrays, first MATCH for ties, rank/average ties, ten-digit percentile, four columns per group |
| t7213 | GnmAutoExpressionTool, analysis-auto-expression.c | Required function, below/side placement, multiple aggregate links |
| t7214 | GnmNormalityTool, analysis-normality.c | AD/CVM/LKS/SF three-row array, alpha links, conclusions and graph; domain size errors |

Other t720x/t721x families cover regression, ANOVA, descriptive moments, correlation/covariance, PCA, sign/Wilcoxon/chi-squared/fill-series/one-mean tools. They do not exercise this task's nine classes; their existing implementation/evidence is preserved.

The writable property/default inventory is the existing source-authenticated `analysis/catalog.ts` and `docs/ssconvert/analysis-tool-profile.json`. CLI repeated hidden arguments and SDK `toolTest` share preparation and engine execution. Generic data is a range, row/column grouping splits it, area/bin retains a rectangle; leading labels advance the appropriate axis. Source graph flags are accepted writable properties even when output remains unsupported. Predetermined bin storage has no writable range property in these source classes and `ssconvert.c` does not initialize it; do not invent a `bins` property.

All nine inherit `labels=false` and `group-by=col` (row=0, col=1, area=2, bin=3). Remaining writable defaults:

| Tool | Properties and defaults |
| --- | --- |
| moving-average | interval=1, std-error-flag=0, df=0, offset=0, show-graph=false, ma-type=0; int modes 0…10 accepted, named source modes 0…4 |
| exponential-smoothing | damp-fact=0.5, g-damp-fact=0.5, s-damp-fact=0.5, s-period=1, std-error-flag=0, df=0, show-graph=false, es-type=0; int modes 0…10 accepted, named source modes 0…4 |
| histogram | predetermined=false, bin-type=0 (int 0…100), max-given=false, min-given=false, max=0, min=0, n=1, percentage=false, cumulative=false, only-numbers=false, chart=none (histogram=1, bar=2, column=3) |
| frequency-tables | predetermined=false, max=0, min=0, n=1, percentage=false, exact=false, chart=none (bar=1, column=2); max/min are stored but unused by the generated-category calculation |
| fourier-analysis | inverse=false |
| sampling | periodic=false, row-major=false, offset=0, size=0, period=0, number=0; all four counts are uint32 |
| ranking | av-ties=false |
| normality-test | alpha=0.05, type=andersondarling (cramervonmises=1, lilliefors=2, shapirofrancia=3), graph=false |
| auto-expression | multiple=false, below=false, function=null; a function is required to execute |

Interval/season period/n have minimum1; df/offset are nonnegative signed ints, standard-error flags are int0…1, damp factors/alpha are doubles0…1. Histogram/frequency min/max accept finite binary64. The protocol retains defaults and emits a warning for invalid numeric/enum values; boolean spelling is the released case-sensitive yes/y/true/1 conversion. Invalid enum nicknames fail preparation. Unknown `bins`/`chart-type` arguments have no writable property and are not invented as alternate APIs.

## Measured coverage and remaining gaps

The official archive digest, fifteen mapped source/test members, 74 oracle binary/source/library bindings and all 523 dependency entries were freshly authenticated. C/UTC and the retained explicit GSettings configuration were used. Plugin inventory is retained captured profile evidence, not a fresh enumeration.

Twenty-four original 8×2 formula fixtures and their twenty-four values-only counterparts match every compared nonempty generated output coordinate, formula text, cell type and array-anchor size. Numerical values use absolute/relative tolerance1e-12. This is not complete workbook/style identity. Eight further standard-error formula cohorts cover all five smoothing modes, cumulative/weighted/central moving modes; native differences first failed command assertions before repair. Native output never enters a unit test or a product fallback.

Two native random runs measured 2,000 draws in each column per run. All eight source values occurred, with replacement, and counts changed between runs. Uniform Pearson statistics were 10.912/9.24 and4.736/3.024 for seven degrees of freedom. These describe observed stochastic behavior, not proof of every distribution/seed/replay property. Product unit/integration sampling uses explicitly injected reproducible random.

Independent stress validated and repaired area/bin sampling labels (retain the full rectangle and increment periodic offset) and auto-expression labels (retain full prepared input). Final independent whole-analysis run passed137 cases in nine files, with focused source lint. Native spelling repairs covered histogram multiplication parentheses, degenerate standard-error windows and single-bin last-write behavior. Existing clipping assertions reproduced an introduced default moving-average budget regression; repaired the extra weighted-term preflight without changing existing default clipping behavior.

Remaining measured mismatches:

- All five chart switches are accepted by the protocol. Native histogram/frequency/moving/smoothing/normality chart modes exit0 and create linked graph objects; product execution currently exits1 with an explicit unsupported diagnostic. Chart construction is unfinished.
- Native predetermined histogram bins exit139 because no bin range is initialized by this hidden command. Predetermined frequency bins did not yield a measured completed native exit within the capture boundary; the captured warning output hit the subprocess output cap. Product rejects both with exit1 and an unsupported diagnostic. Neither is a compatibility pass, and no undocumented bin-range option is synthesized.
- Native invalid numeric property diagnostics include GLib classification, PID/time and formatting. Product preserves the existing structured warning message/default behavior; raw native stderr bytes are different. Native n=0 retains n=1, and the product now preserves the single final maximum-bound write without duplicate coordinates.
- Native normality sample-size comments, full styled blank-cell regions, seasonal clipping/fallback commentary, graph geometry and complete per-exporter style propagation remain unqualified or absent. Tested italic headings, selected formats/merges/arrays do not establish full style-region identity.

Nine additional original in-memory cases edit input values, rename the input sheet and reorder sheets through the exported SDK helpers. All nine generated tools retain rewritten live references and recalculate the expected numeric results (normality asserts a changed numerical p-value). These cases preserve the original workbook. This verifies SDK reference updates; native structural-edit comparisons and row/column insertion/deletion remain unmeasured.

Unmeasured cases remain: comma-separated range lists, analysis sheet spans (explicit unsupported), every area/bin/label combination, every invalid/error/text/blank combination, all numeric extremes and smoothing endpoints/periods, Spencer long-window numerical/reference cases, all stochastic cancellation timings, output clipping of multi-cell arrays, arbitrary host realms and packed/browser consumers. Unsupported/unmeasured cases and the skipped native t7208 test are not passes.

The actual shared-command CSV screenshot for all nine tools was generated and visually inspected. Headings and measured output are readable; native numeric-only CSV retains long floating-point strings. This is ad hoc visual validation, not a screenshot test or chart-rendering qualification. Source archives and unrelated output remain preserved; owned scratch evidence is reduced into the coverage receipt before cleanup.

## Final checks

- `npm run build:workspaces -- --workspace=@poe-code/ssconvert --no-cache`: passed the declared four-build dependency closure.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`: final candidate passed the declared eighteen-build closure and native postbuild, including the ssconvert closure. Source was stable before this final build.
- `npm test --workspace=@poe-code/ssconvert -- --maxWorkers=1`: passed 6013 tests in 296 files, fresh complete workspace execution. Nine subsequently added SDK edit/rename/reorder cases also passed; the focused final distributions file passed 28 cases. No unit subprocess or disk fixture writes were added.
- `npm run lint --workspace=@poe-code/ssconvert`: final run passed ESLint and production/test TypeScript, including the reference-update additions.
- `node --import tsx --test --test-concurrency=1 packages/safe-bash/tests/commands/ssconvert*.test.ts`: final compiled candidate passed98 cases, no skips. All nine added tools share SDK/virtual-command bytes and memfs checkpoint/replay namespace assertions.
- Independent final source review:137 whole-analysis cases passed; focused source lint passed. Reference-update additions are root verification, separately reported.
- `npm run typecheck --workspace=@poe-platform/safe-bash`: exit2 before compilation, `Public SafeFS must preserve shared SafeJS runtime identity`, actual undefined, expected `./packages/safe-js/dist/safe-fs.js`. Preserved the existing root metadata edits; this gate remains failed, not a pass.

Earlier concurrent workspace checks timed out in the unchanged advanced-distribution Tukey inverter case. The same assertion passed in isolation and in the final full suite run after builds completed. Neither assertions nor timeouts were weakened. Earlier runs also included deliberately failing TDD cases and the default clipping regression; all recorded failures remain failed historical runs, while the final pass covers repaired source.

The permanent coverage/profile/candidate receipt is `docs/ssconvert/analysis-time-series-distributions-verification.json`. Owned scratch logs, captures, screenshot and comparison helpers were reduced into this document and the receipt, then purged from `out/ssconvert-distributions`. Existing primary archives and unrelated output were preserved. Root-wide lint/test, packed/browser consumers and successful publication are not claimed. No README changes, commits, push or publication were performed.
