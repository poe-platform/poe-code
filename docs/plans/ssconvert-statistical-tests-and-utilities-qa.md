# Statistical tests and utilities QA

Preserve the dirty main checkout and all unrelated work. Do not edit README files, push, or publish. Native ssconvert is a separate QA oracle, never a product dependency. Unit fixtures are original in-memory workbooks with memfs and injected byte I/O.

## Procedure

1. Authenticate the official archive in `out/ssconvert-lifecycle` against SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Bind relevant archive members and oracle dependency/plugin/C-locale/UTC identities to the existing `docs/ssconvert/analysis-tool-profile.json` profile. Keep acquired source and generated captures in `out/ssconvert-tests-utilities`.
2. Read `src/ssconvert.c` and each requested handler. Inventory every accepted `run_tool_test` name independently of GUI availability. Audit properties, grouping, labels, range semantics, warning/failure paths, paired/equal/unequal variance, censoring, series modes, criteria, generated sheets/formulas/array groups/styles.
3. Reproduce absent implementations with failing actual-command memfs regressions before adding code. Test independent numerical expectations, source-specific formula links and ownership. Keep CLI and SDK on the same package engine with cancellation and separate cell/sheet/work budgets.
4. Run original small XML workbooks through the isolated Colima `ssconvert-statistics-qa` oracle and the TypeScript command. Compare statuses/channels, generated namespaces, values with tolerance 1e-12, formulas and array ranges separately. Record all mismatches; unmeasured cases are not passes.
5. After implementation, have a different agent stress/fix the tools. Execute `ssconvert-statistical-tests-independent-qa.md`; root retains exports/integration/Git ownership. Retain strict regressions for validated repairs.
6. Run uncached maintained build closures for ssconvert and safe-bash, ssconvert workspace test/lint routes, and the existing safe-bash ssconvert integration cohort. A global evaluator repair requires the complete ssconvert unit suite. Do not claim root-wide gates from scoped checks.
7. Capture and inspect actual generated CLI CSV output screenshots through the shared engine. Keep evidence under `out`; summarize verified coverage and remaining mismatches here, then purge only task-owned scratch.

## Accepted command inventory

The 31 accepted names are: regression, moving-average, anova, anova2, chi-squared-test, descriptive-statistics, correlation, covariance, fourier-analysis, sampling, ranking, exponential-smoothing, histogram, sign-test, frequency-tables, principal-components, auto-expression, normality-test, one-mean-test, wilcoxon-signed-rank-test, wilcoxon-signed-rank-test-two-samples, advanced-filter, wilcoxon-mann-whitney, sign-test-two-samples, f-test, t-test-paired, t-test-equal-variances, t-test-unequal-variances, kaplan-meier, z-test, fill-series.

`consolidate`, `random-generator`, and `random-generator-cor` are explicitly unsupported by released `run_tool_test`. GUI presence does not establish command support. Kaplan-Meier GUI grouping cannot be populated by this command: its group list and third range are not writable GObject properties.

## Verification record

Implementation and scoped verification complete. Initial actual-command regressions failed for unsupported requested tools, then passed after implementation. Independent review found direct pair-label/axis, sign two-tail array ownership and chi-squared warning formatting mismatches and repaired them with strict regressions. A separate failing chi-squared title-value regression exposed scalar collapse in matrix function arguments; the evaluator now admits non-scalar arguments through the descriptor-driven function path. A final strict regression repaired extra parentheses in uncensored Kaplan-Meier death expressions.

The permanent receipt is `docs/ssconvert/statistical-tests-utilities-verification.json`. The official archive, 12 relevant source members, 74 oracle bindings and 523 dependency/version pairs were authenticated. C locale and UTC were selected. The captured reference plugin profile was reused; current active plugins and inherited HOME/XDG paths were not independently re-inventoried.

Thirty default formula/materialized captures cover all 15 requested tools: 678 native coordinates with zero formula/value differences. Eleven additional native variants cover growth, implicit step, explicit step flag override, day/weekday/month/year dates, censored survival with standard error/median/logrank, no-match/invalid criteria and chi shape failure: 77 coordinates with zero differences, matching statuses and channels. Chi shape failure exits 1 with `Analysis tool failed\n` and produces no output. Numeric tolerance is absolute/relative 1e-12. Empty native string cells may correspond to absent product cells; this is not a full workbook identity claim. Two default Mann-Whitney captures emit native shutdown `Leaking string` diagnostics that JavaScript does not emit; this diagnostic mismatch remains recorded.

Maintained uncached builds passed for the ssconvert closure (4 workspaces) and Safe Bash closure (18). The latest small expression repair was rebuilt through ssconvert afterward. Latest ssconvert lint passed; all 6,124 unit tests in 299 files passed in a quiet full run with the existing timeout unchanged. All 98 Safe Bash ssconvert integration tests passed without skips; the all-tool case compares CLI/SDK bytes, replay and namespace effects for the complete 31-name inventory. Safe Bash typecheck exited 2 before compilation because the public SafeFS export identity was undefined instead of `./packages/safe-js/dist/safe-fs.js`; this gate did not pass. Root metadata was preserved.

Different-agent stress review and fixes are recorded in `ssconvert-statistical-tests-independent-qa.md`, including 14 warning-comment serialization cases and four native ties-to-even alpha captures. All 15 generated CSV output screenshots were inspected. No native utility is used by unit tests or the product. No commits, README edits, push or publication were performed. Task-owned generated captures/logs were purged after retaining the receipt; the pre-existing archive/source and unrelated output were preserved.

## Source-specific audit

- `RANGE_LIST_ARG` wraps one parsed range in this command; GUI multiple-range/group capabilities are not inferred. Pair labels refer directly to the original top-left cell; rows are trimmed only when height exceeds width, otherwise columns are trimmed. Generic grouping/labels and paired/equal/unequal variance formulas have independent regressions.
- z-test constructs duplicated ranges before label mutation and retains relative reference axes. Kaplan-Meier also retains relative axes and ignores labels, starts at zero, excludes negative times and emits only the input-row-count time rows. Censor marks are inclusive; the source standard error is `P*sqrt((1-P)/risk)`. Accessible single-group logrank retains df=0. Graph data links/default styles and warning comments are retained.
- Sign-test single-sample two-tail results may exceed one; they are not clamped. Signed-rank tests retain array ownership and normal-approximation warning comments. Alpha warning formatting follows C fixed-decimal ties-to-even.
- Advanced-filter uses shared parsed database criteria. Invalid criteria and no matches create successful message sheets. Absent source cells bypass conditions; numeric fields can address outside database width. Record ordering and unique filtering are tested.
- Fill-series implements numeric linear/growth and day/weekday/month/year modes, preserves source count/weekday quirks and captured date format `[$-f8f2]m/d/yy`, and obeys explicit property override ordering.

## Remaining qualification limits

Complete blank/style-region geometry, custom graph fonts/themes/geometry, pixel exports, every exporter profile, browser/workerd execution, packed consumers and full repository gates are unqualified. Explicit sheet spans, clipping/resource extremes, all alpha/missing/group combinations and exhaustive behavior of the other 16 tools are unmeasured. Blank criteria headers, extreme invalid date serials, zero-step non-day dates and native integer overflow/undefined/crash paths are unsupported or unmeasured. None are counted as passes.
