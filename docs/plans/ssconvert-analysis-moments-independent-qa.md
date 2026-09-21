# Independent regression and moments stress QA

Independent agent review of the current working tree, September 21, 2026. This is a scoped source/command review, not release certification. Primary source is the separately acquired Gnumeric 1.12.61 tree under `out/ssconvert-lifecycle/gnumeric-1.12.61`; root owns archive hash verification and native dependency/plugin/locale profile capture.

## Procedure and verified coverage

Execute `npx vitest run packages/ssconvert/src/analysis/moments-stress.test.ts`. All nine cases execute the actual `runCommand` engine with repeated `--tool-test` arguments, original small in-memory workbooks, injected memfs byte I/O, cancellation signal and captured stderr; they assert exit status zero and empty diagnostics. No native process, LLM query or disk fixture writes occur in these unit cases.

- Single-factor ANOVA unlabeled column/row numbering: source `analysis-tools.c` 1154 passes `index+1`; reproduced current `Column 5` versus expected `Column 1`, repaired numbering, verified both grouping modes.
- Simple row-grouped regression response/independent variable labels: reproduced `Row 1` versus expected `Row 2`; repaired row-coordinate labels.
- Original nonperfect affine regression: x=(1,2,3,4), y=(2,5,5,8), independently derived slope 1.8, intercept 0.5, R² 0.9, SSE 1.8 and first residual -0.3. No-intercept slope and SSE are both 59/30. Floating results are measured to twelve decimal places, not asserted bit-identical to native.
- Source-defined residual table from `analysis-regression.c` 750–859: reproduced absent leverage/studentization/p-value headers. Added headers, linked response header, LEVERAGE multirow array, internally/externally studentized formulas and formats. First observation leverage=0.7, internal residual=-1/sqrt(3), external residual=-0.3/sqrt(1.71*0.3). Released source deliberately computes external variance `(SSE-residual²)/(df-1)`; no alternative textbook correction is substituted.
- Root's native QA located residual header row 19 for one independent variable. Reproduced wrong row 20 against that differential evidence; fixed residual output offset. Independently failing array-layout test reproduced missing residual design/header/response groups; now verifies linked/transposed header and native input/response multirow arrays.
- Labeled row correlation and labeled column covariance with numeric pairs separated by strings: verifies linked label/data formulas, pairwise missing behavior (correlation 1, population covariance 4.5).
- Descriptive summary disabled, confidence 90%, kth-largest 2 and kth-smallest 3: verifies selected section spacing, labels, ranks and calculated-value output.
- PCA on ((1,1),(2,-1),(-1,2),(-2,-2)): independently derived sample covariance [[10/3,1/3],[1/3,10/3]], eigenvalues 11/3 and 3, first trace proportion 0.55.

## Remaining unmeasured cases and limitations

These nine cases do not establish full tool parity. Root owns native differential capture, analysis dispatch/exports, safe-bash integration and maintained workspace checks. This worker did not change ANOVA2 or verify its replication behavior.

Still unmeasured here: singular/collinear regression; unequal x/y lengths and all missing/error data; multiple-y simple regressions; area/bin grouping; label-only and empty ranges; eigenvector sign/order in repeated-eigenvalue PCA; numeric extreme stability; all styles, comments and formatting; confidence endpoints 0/1; individual sheets/operations/cells budgets and pre-aborted invocation namespace effects. Native per-cell array formula grouping for regression statistics/coefficients and PCA formula serialization remain to be compared by root. Unsupported or unmeasured cases are not passes.

## Final candidate holdout review

A second independent review after root's subsequent source/layout repairs added three previously unseen actual-command fixtures. All twelve stress cases pass. No new mismatch was validated, so this second review changed tests/evidence only.

- Two labeled predictors: constant=3, coefficients=(2,-0.5), residual=(1,-2,0,2,-1), SSE=10 and residual df=2. Orthogonal predictor/residual vectors derive those results independently; checks also verify linked residual header, prediction/residual and a five-by-two design array region.
- Simple `multiple-y:yes`: two responses share an explicitly absolute predictor, with independently specified slopes/intercepts (2,3) and (-3,4). Checks preserve response ordering and native Independent Variable header.
- Labeled area-grouped PCA: first row removed as the label/header row, remaining rectangle flattened into one four-observation variable; independently derived sample variance/eigenvalue=5/3, trace proportion=1 and native two-by-one eigen array group.

This supersedes the earlier blanket statement that multiple-y and area grouping were unmeasured: these precise cases are now measured, while other combinations remain unmeasured. Earlier residual/PCA array gaps were addressed by root and the native array shapes above were independently checked. Bit-exact floating native equality, all numeric extremes/degeneracies, budgets/cancellation effects and complete style/comment serialization remain outside this worker's evidence. Root retains native QA, integration, maintained workspace checks and delivery ownership.

Final scoped verification: `npx vitest run packages/ssconvert/src/analysis` passed 74 tests across seven files, and focused ESLint of `statistical.ts` plus `moments-stress.test.ts` exited zero with no diagnostics. These fresh scoped commands do not substitute for root's maintained cross-workspace checks.

## Final linked-formula rereview

After the final SUMPRODUCT/absolute residual links and native TRUE/FALSE formula serialization repairs, reran all holdouts and added a thirteenth command case for no-intercept residual output. All thirteen stress tests pass. The added case independently checks first prediction=59/30, first residual=1/30 and first leverage=1/30, and asserts native linked prediction `sumproduct($B$17:$B$18,transpose(A21:B21))` plus FALSE/TRUE LINEST flags. The existing two-predictor orthogonal fixture still verifies coefficient-to-predictor ordering through SUMPRODUCT. Source review confirms the absolute coefficient range includes constant followed by each predictor and absolute variance/df links preserve the tested studentization results. No additional runtime issue was validated or repaired in this rereview; remaining gaps above still apply.

## Current PCA trace and loading candidate review

Independent agent reviewed the current candidate after the absolute PCA trace denominator and loading serialization repairs. The authenticated-source handler `src/tools/analysis-principal-components.c` lines 176–210 constructs sample-corrected population covariance, an `(n+1)`-by-`n` EIGEN array, an absolute shared eigenvalue range in the trace denominator, and `MMULT(MMULT(SQRT(1/variance)*MUNIT(n),eigenvectors),SQRT(eigenvalues)*MUNIT(n))` loadings. Current output matches these measured formula and array choices. This review made no product-code changes.

New original actual-command holdout: six centered observations on three orthogonal axes, `(±3,0,0)`, `(0,±2,0)`, `(0,0,±1)`. Independently derived sample eigenvalues are `(18,8,2)/5`, trace proportions `(9,4,1)/14`, and squared standardized loadings form the identity matrix. Checks use squared loadings so arbitrary eigenvector signs do not masquerade as mathematical failures. All three trace formulas retain the same absolute `$B$11:$D$11` denominator and percent formatting. The loading anchor matches the source-derived linked expression. A separate invocation of the same fixture with `formulas:no` retains calculated trace values while removing formula cells and array membership. Both invocations execute repeated `--tool-test` options through the shared command/SDK engine with injected memfs bytes; no disk fixture writes or native utility spawns occur.

Fresh verification: fourteen command holdouts pass in `moments-stress.test.ts`; the complete current analysis directory passes 79 tests across seven files. Procedure: execute `npx vitest run packages/ssconvert/src/analysis`, then `npx eslint packages/ssconvert/src/analysis/moments-stress.test.ts packages/ssconvert/src/analysis/statistical.ts`. These scoped checks are supplemental; root owns maintained build/test/lint routes and cross-workspace integration.

No failing or skipped cases in this scoped run. This diagonal fixture does not verify repeated-eigenvalue ordering, native eigenvector signs, numeric extremes, all style/comment boundaries, or full source-runtime matrix parity. Those remain unmeasured, not passes. Native QA/profile capture, CLI screenshots, realm/checkpoint/replay integration and exact-revision gate ownership remain with root. Earlier budget and cancellation tests executed as part of the 79-test scoped run; this review added no new boundary guarantees.

## Final alpha serialization independent holdouts

After root validated and repaired three native formula-constant spelling differences, independently reviewed `analysisFloat` against `value.c` lines 1126–1140, which selects precision-controlled `%g` output for formula constants. Added five original alpha holdouts (`0`, `1`, `0.0001`, `0.00001`, `0.0000001`), each executing the actual command for single-factor ANOVA and both replicated/nonreplicated ANOVA2, totaling fifteen new command runs. Checks verify independent df values, shared error-df references, endpoint-zero `#NUM!` calculated results and exact scientific strings `1.0000000000000001e-05` and `9.9999999999999995e-08`. Replication uses two levels of two observations per level, two factor-B levels and error df=4. These are deterministic semantic checks, not performance measurements.

All nineteen command holdouts and all 86 current analysis tests across seven files pass. Focused ESLint of `moments-stress.test.ts` and `statistical.ts` exited zero without diagnostics. No failing, skipped or incomplete scoped cases. No additional statistical product defect was validated and this independent review edited only tests and this evidence.

Investigated signed-zero as a negative control: JavaScript formatting could lose its sign, but root's separate native oracle run confirms `alpha:-0` normalizes to `0` in the source tool path. Thus this is not a validated mismatch and no unnecessary fix was made. Root additionally reports eight native alpha spellings matching the candidate; native acquisition/profile/receipt and exact-revision integration gates remain root-owned. Extremely subnormal alpha, every binary64 transition and all native statistical result matrices remain unmeasured by this worker; no exhaustive formatter or full tool-parity claim is made.
