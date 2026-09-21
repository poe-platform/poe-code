# Logical, text, information, lookup and database verification

The [current follow-up review](functions-logical-text-lookup-current-review.md) records independently reproduced search, ISODD and Unicode delimiter repairs, candidate input hashes and fresh verification. The captures below remain historical evidence.

## Result and qualification

All 113 function names in the released fn-logical (10), fn-string (41), fn-info (24), fn-lookup (25) and fn-database (13) manifests have TypeScript ESM implementations in `packages/ssconvert`. The public SDK and safe-bash virtual command use the same calculation engine and injected byte I/O. This is source-backed implementation evidence, **not full native parity or task completion**. Remaining unsupported and unmeasured contracts stay blockers in `function-coverage.json`; none are counted as successful `#NAME?` results.

The inventory contains all 651 plugin manifest entries and seven builtin descriptors (658 total). Five active builtins retain source-backed coverage. NUMBER_MATCH and DERIV are registered only under the testsuite debug flag in `src/func-builtin.c`, so their absence from the captured stable profile is separately classified. Outside-task plugins are unmeasured, not implementation passes. All recorded manifest/descriptor source hashes were reverified against the authenticated archive.

## Reference binding

- Gnumeric 1.12.61 archive SHA-256: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
- Primary source stays in `out/ssconvert-lifecycle`; no source archive, native executable or native dependency was added to the product.
- Captured dependency/plugin/locale profile: `calculation-current-native-profile.json`. It binds libgsf 1.14.53, GOffice 0.10.61, GLib/GObject 2.84.4, GTK 3.24.49, libxml2 2.9.14, C locale and UTC, including executable and installed-plugin hashes. Installed manifests alone do not establish function runtime parity.
- A fresh native differential could not run in this environment: no installed native ssconvert and no available Docker socket/application. Historical captures are retained unchanged. Every target function has `nativeVerification: unmeasured`.

## Implemented contracts

Declarative source signatures drive fixed arity, coercion and array iteration. Invalid fixed arity rejects before argument evaluation, including RAND draws. Scalar boolean strings accept boolean names; numeric descriptors and iterated boolean descriptors use formatted number matching. VALUE and N preserve matched boolean types; NUMBERVALUE skips leading whitespace before matching. Tests distinguish string conditions from range cells from parser-normalized array constants.

Logical tests cover lazy IF/IFS/SWITCH/CHOOSE branches, eager precomputed arguments, error ordering and array dimensions. Text tests cover Unicode code points, simple case mappings, normalization, UTF-8 byte boundaries, wildcards, supported number/date/time/fraction formatting, missing arguments and domain errors. Unsupported formatting and uncaptured locales reject explicitly.

Information and lookup functions retain function-owned reference rules. ISREF and AREAS request references. CHOOSE scalar-evaluates its selected branch even under a reference consumer. INDEX scalar-evaluates its first expression, with source-specific differences between direct cells, explicit singleton ranges, syntactic unions and named unions; its own node callback returns #VALUE! for invalid arity. Explicit range/reference results can participate in colon/intersection operations. Dynamic INDIRECT/OFFSET/INDEX/CHOOSE dependencies persist across checkpoints, replace obsolete invocation links and preserve imported declared links; array dependency ranges cover the entire formula group.

Database criteria distinguish boolean, numeric, text and blank values, including parsed string boolean targets that match only actual boolean cells. Tests cover criteria AND/OR composition, field/header errors, missing/extra arguments, empty aggregates and error-valued records. Missing-field DCOUNT/DCOUNTA materialize sparse first-column cells before criteria, preserving cell order, budgets and observable later calculations. DGET retains the first matching result. GOAccumulator/GOQuad high-low arithmetic covers constant-overflow means and cancellation-sensitive variance, including `[1e16, 1e16+2]` population variance 1 and sample variance 2.

All 113 source OpenFormula output names are captured. Input aliases include INDIRECT_XL, ADDRESS_XL, ERRORTYPE, FORMULA and USDOLLAR. Legacy OpenOffice ADDRESS inserts the A1-mode argument. Formula metadata uses parsed, budgeted canonical serialization while preserving stored formulas. Excel output renaming remains unmeasured.

## Regression and independent review

Implementation began with failing source-backed regressions. Independent agents subsequently reproduced and repaired logical/information, text/formatting, reference/lookup and database contract errors; root retained shared evaluator, integration, export and Git ownership.

The final boolean repair began with five failing cases in a seven-case contract addition. The red run reported 5 failed / 39 passed; its reduced log SHA-256 is `a36183faf31a9ab6d7ffa1878e83f3f570493e55b4bc1fcca8bf04bee6ad2ca0`. Independent follow-up reproduced eight database boolean-criteria failures before repairing them, then passed 110 focused tests and maintained package lint/typechecks. One review fixture omitted NUMBERVALUE's required separator and was corrected against the released descriptor; it was not reported as a product repair.

Unit fixtures are original small in-memory workbooks; file workflows use memfs or the injected virtual filesystem. Added unit tests do not spawn native utilities, query LLMs or write host files. Independent suites cover every target name with normal and edge/domain cases; table-driven aggregate tests cover names without literal call fixtures. Literal fixture lists in coverage are evidence pointers, not exhaustive coercion or native measurements.

## Maintained checks

- Final maintained ssconvert unit route: 68 files, 1,639 tests passed, fresh execution. The expanded five-row string-range IF assertion also passed in a final 44-case contract rerun. After the broad-run termination, a fresh maintained follow-up again passed all 68 files / 1,639 tests.
- Maintained ssconvert lint: ESLint, source typecheck and test typecheck passed after independent boolean repairs and again after the broad-run termination.
- Selected uncached ssconvert build passed. Final uncached safe-bash dependency build closure passed (18 builds, derived from maintained declarations).
- Public SDK / virtual-command integration: 32 tests passed against the final compiled engine (zero failures, skips or TODOs), including a fresh follow-up after the broad-run termination.
- Repository-wide lint passed (log SHA-256 `5f80f85ac7837734e9386ec078eedb18afa87f2f3fdcd0063d9441d4e90a0ba8`); subsequent focused runtime changes received maintained package lint/typechecks.
- Maintained safe-bash unit route inside the full run settled with zero failures: 44,080 passes, 831 skips, two TODO blockers (44,913 total). Skips/TODOs are excluded from compatibility passes.
- Repository-wide `npm test -- --no-cache` **exited 1**: `Workspace test:unit failed: @poe-code/safe-js (SIGTERM)`. SafeJS reported 302 passing files before termination and no assertion failure or final suite summary. The maintained runner has no task deadline explaining this signal; its cause is unmeasured. Remaining declared workspace tasks did not finish, so this is not a completed broad verification. No timeout, assertion, supported version, runner membership or isolation guard was changed. Reduced full-run log SHA-256: `24f313f461a4903d2b657d3ffcc1567acb03b23a3eb80a47face31390bce25da`. Skips and TODO blockers are not passes.
- The separate safe-bash public-consumer typecheck **failed before compilation**: `Public SafeFS must preserve shared SafeJS runtime identity`, actual export undefined, expected `./packages/safe-js/dist/safe-fs.js`. Consumer checking was not performed. The current unrelated export topology and the realm guard were preserved. Failure log SHA-256: `81efc1086d481dec7e35d40fc010527998994eff25152930cfb0df9daa6a51e3`.

## Visual evidence

The repository screenshot tool rendered the actual virtual command using an injected fixture codec. The screenshot was inspected: labels and Unicode were legible, stdout order was correct and stderr was empty. It displayed Logic `safe`, Unicode `École Σchool`, Information `4`, Lookup `b`, and Formatting `2024-01-01 12:00:00`. Inspected PNG SHA-256: `feadb81231c9fd8b41fb186c68cb029b9e73324fd4a7595033b2964fa1358f1c`. This validates fixture-codec CLI output, not native CSV serialization or workbook import/export parity. Task-owned temporary evidence is removed after reduction; historical source and oracle evidence remain intact.

## Remaining blockers

Coverage retains fresh native differential, non-C locale, full coercion/shape/reference cross-products, native workbook persistence and automatic import recalculation as unmeasured. Function-specific gaps include complete number/date matching and format grammar, complex fraction literals and binary64 boundaries; Unicode casefold offset behavior; canonical native sheet quoting; external named INDIRECT extraction; uncalculated computed-input cache links; UNIQUE hash-collision behavior; imported styles/hyperlinks/font metrics; and extreme quad overflow/subnormal/native arithmetic.

Optional error-valued blank distinctions apply to builtin IF; no target plugin descriptor has optional E arguments. AUTO_SECOND/AUTO_UNITLESS style propagation and nested SET matrix expansion are unmeasured. OpenFormula range CONCATENATE imports to ODF.CONCATENATE outside these target plugins and remains a distinct blocker. INFO operating identity requires explicit injection. These limitations are not hidden by fabricated values or native fallback.

Executable QA instructions are in `docs/plans/ssconvert-functions-logical-text-lookup-qa.md`. No README was edited and nothing was committed, pushed or published for this task.
