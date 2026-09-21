# Statistics independent review QA

Use the checksum-verified Gnumeric 1.12.61 source and separately captured native
oracle profile described in the statistics task QA document. Product code never
loads or executes the oracle. All compilation and temporary observations belong
in `out`; unit fixtures are in-memory and exercise the actual workbook engine.

1. Evaluate horizontal and rectangular `LINEST` inputs with omitted predictors,
   and horizontal `TREND` without predictors. Inspect `gnm_reg_data_collect`:
   omitted predictors select rectangular mode and sequential values. Three
   regressions failed before repair and pass after repair.
2. Compare zero-scale Laplace, logistic, Rayleigh and Rayleigh-tail domain guards
   with `gnm-random.c`. Replay the Laplace draw sequence `[0.5, 0]`: rejection
   applies to the transformed draw, and uniform zero is accepted. Five cases
   failed before repair. Validate malformed source results, cancellation after
   one rejected draw, and bounded work for an indefinitely rejected midpoint.
3. Evaluate `FTEST({0;1e-10;2e-10},{0;1;2})`: degrees of freedom are 2 and 2,
   so the analytic result is `2e-20/(1+1e-20)`. Original code returned zero.
   Follow the upstream `pf` coordinate selection and evaluate the smaller tail
   directly. The repaired test uses relative accuracy, without serialized values.
4. Evaluate the central Student-t displacement at `x=1e-10`, degrees of freedom
   1: `(CDF(x)-0.5)/x` approaches `1/pi`. The original beta coordinate rounded
   to one and returned zero displacement. Source `pt` selects the complementary
   beta coordinate near the center; the repaired assertion allows `1e-6` error
   after division, reflecting binary64 subtraction of probabilities near 0.5.
5. Evaluate skew-normal `x=-10`, shape 1: native reports probability zero and
   log probability `#NUM!`. The prior adaptive Owen quadrature both diverged
   from source cancellation and exhausted a million-work limit in the unit
   profile. Port all upstream Patefield/Tandy regions and six bounded methods,
   including the shape-one identity. Check both released results. This is
   parity with the observed release, not a mathematical tail-accuracy claim.
6. Evaluate `AVERAGE({1;2},{3;4})` with a two-cell calculation-array budget.
   Original code admitted each argument separately and grew the aggregate past
   the limit. Verify admission before accumulated-array extension.
7. Compare `PST(-20,10,3)` with native using the raw numeric value. Inspect
   recurrence intermediates with a C helper linked to the oracle's
   `libspreadsheet`, compiling the same helper at `-O0` and `-O2`. Do not make
   native execution or results part of a unit mock.

8. Reproduce nested subtotal and hidden-row exclusion using actual range cells.
   A cell whose parsed expression contains `SUBTOTAL` is excluded, even under
   addition or another call. Ordinary hidden rows remain included for code 9,
   and are excluded for code 109. Bound accumulated SUM/PRODUCT inputs across
   argument boundaries. Four regressions failed before these repairs and pass.
   The workbook contract has no filtered-row state; filtered-row exclusions
   cannot be verified or represented through that contract.

9. Compare the skew-normal density source branches at nonzero location: nonlog
   uses `pnorm(shape*x,location/shape,scale)` while log uses
   `pnorm(shape*x,shape*location,scale)`. Preserve the released distinction.
10. Compare captured skew-normal negative-scale CDF/quantile and invalid Tukey
   quantiles. Port the actual `sf-dpq.c` continuous inverter, including its
   100-step bracketing, Newton attempts, NaN behavior and retained near-hit.
   The observed enormous negative quantile and invalid Tukey result 1 arise from
   this algorithm; no boundary result is hardcoded into the implementation.
11. Compare nonpositive beta parameters with captured source `pbeta`: it has
   no positive-parameter guard and delegates to Ian/DJMSmith binomial arithmetic.
   Some released results exceed one. Generalize the actual small-parameter
   binomial CF rather than replacing those outcomes with mathematical CDF rules.

12. Check source beta zero-shape density/quantile limits and analytic arcsine
   small-shape CDF. The quantile uses the source initial approximation and the
   captured generic inverter. Port `pbeta_smalla` with logfbit derivative
   corrections, compensated log1pmx, accelerated lgamma1p and the bounded
   compbfunc recurrence. Preserve injected host cancellation/work accounting.

Verified focused result: the independent test file contains 52 cases, all pass.
There are no
native processes, filesystem writes or LLM calls in these units. The other two
focused statistics files pass 70 cases; all three files pass 122 cases. Root owns maintained
workspace and integration checks; this result is not a substitute for those gates.

The initial measured mismatch in `PST(-20,10,3)` was reduced and then repaired:
native and current product are exactly `9.1723503792273675e-16`, without changing
the regression's expected value or equality assertion. The C helper's `-O0` result is
`9.1776358648182343e-16`; its `-O2` result exactly matches the native observation.
The final recurrence base changes from `8.6412341574711385e-05` to
`8.6412341574710857e-05`, and product/native Student-t intermediates also differ
by several ulps in the original implementation. Repair required source
half-integer Stirling errors, shifted atan, captured FMA contraction, the actual
Ian/DJMSmith beta path, and the source binomial normalization's exact operation
grouping. The independent suite preserves exact native equality alongside an
analytic zero-abscissa recurrence check. It also verifies logarithmic Student-t
tails remain finite after ordinary probability underflow. A passing scalar does
not establish whole-domain bit equality or universal numerical accuracy.

This review did not measure every Owen region against native, random distribution
quality, seed-stream equality, every upstream accuracy vector, all interpolation
layouts, or queueing asymptotics. Those cases are unmeasured by this review and
must not be counted as passes.

Follow-up advanced-tail review added measured logarithmic inverter cases for
skew-t, skew-normal and Tukey. Skew-t intentionally drops the log flag in the
released source; the generic source inverter must call that same path. Tukey
uses the source centered-normal erf term, endpoint-density interval clamps,
quadrature FMA contractions and preserved multiplication grouping. For
`PTUKEY(1000000,3,10,1)`, a per-node native C trace isolated a one-ulp host
logarithm discrepancy at u=0.48320390029847898. A compensated atanh logarithm
reduction repairs the measured upper residual exactly, including both log
forms: 8.881784197001252e-16, -8.881784197001256e-16 and
-34.657359027997266. These three exact regressions do not establish universal
bit equality for Tukey or host transcendental routines.

`QTUKEY(-1000,3,10,1,TRUE,TRUE)` retains the measured value
7.186959238596909e-108 within the stated relative tolerance. The quadrature
cache is created only inside that inverse call, stores no host/workbook state,
is bounded by the cell limit, and preserves cancellation/work ticks. Skipping
exact zero contributions retains the source sum. Runtime for this fixture fell
from 8.7 seconds before caching to approximately 2.7 seconds; no timeout or
assertion was relaxed. Root owns the separate 480-case tails cohort and durable
native profile/evidence. This review's uncached focused tests, scoped ESLint and
both package/test TypeScript checks pass.

Two warmed-cache tests assert work exhaustion and cancellation still interrupt
node evaluation after four injected ticks, without altering or extending the
warmed map.

Final focused invocation:
`npx vitest run packages/ssconvert/src/formulas/statistics-independent-review.test.ts packages/ssconvert/src/formulas/statistics-functions.test.ts packages/ssconvert/src/formulas/statistics-random.test.ts`
passed all 122 cases; the inverse fixture took 2.697 seconds. One earlier
invocation while ESLint, both TypeScript checks and root gates competed for
CPU timed out at 5.922 seconds. This failed measurement is retained; the
normal sequential final invocation and root maintained package units pass.
The fixture remains relatively expensive, and runtime under heavy contention
is a remaining performance limitation. No timeout was increased.

Root's final separate tails comparison reports 411/480 exact and all 480 within
the declared tolerance, with no outside-tolerance cases. Numerical closeness
of the remaining 69 cases is not reported as exact parity.
