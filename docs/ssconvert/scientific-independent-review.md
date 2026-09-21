# Independent scientific review

Reviewed the live TypeScript implementation on 2026-09-19, separately from its
initial author. This is a scoped numerical review, not full function parity.
The QA procedure is in `docs/plans/ssconvert-functions-math-engineering-complex-qa.md`.

Reference: released Gnumeric 1.12.61, source archive SHA-256
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`;
isolated `ssconvert-math-qa-20260919` container, `/out/prefix/bin/ssconvert`,
`LD_LIBRARY_PATH=/out/prefix/lib`, `LC_ALL=C`, `TZ=UTC`, memory GSettings backend,
`GSETTINGS_SCHEMA_DIR=/out/prefix/share/glib-2.0/schemas`. Native conversion used
`--recalc -T Gnumeric_stf:stf_assistant -O 'format=raw separator=,'`.
Temporary original XML inputs and captures stayed in `out`.

## Validated repairs

Eight independently selected in-memory regression cases ran before repairs:
six failed and two passed. Six failures exposed four defects:

- GAMMA half-integer recurrence omitted its final factor at 1.5 and 2.5.
- GAMMA reflection divided by an overflowing positive gamma, losing nonzero
  subnormal values at -171.5 and -172.5. Logarithmic reflection preserves them.
- POCHHAMMER(1e20,0.5) subtracted huge nearly equal logarithms and returned 1.
  The positive large-argument ratio now uses `log1p` and Stirling corrections.
- POCHHAMMER(-3,0.5) returned an error instead of the native zero. Upstream
  `src/sf-gamma.c` explicitly defines this noninteger increment at a pole.

Three further native error-kind regressions failed before the next repairs:
BETA(1,1e300) and both enormous/tiny Lambert W branches returned finite values
where released Gnumeric returns #NUM!. BETA now observes upstream qfactf's
signed-int exponent bound, preserving the small-increment exception. Lambert W
uses the released 20-step Halley iteration, including its intermediate
overflow/underflow. The half-integer anchor uses the independently verified
binary64 value 1.772453850905516 instead of the one-ulp-low Math.sqrt(Math.PI).

After repairs, all eleven review cases and all eight original scientific cases
passed (19/19). Unit tests use the actual workbook evaluator and original small
fixtures; they do not spawn native processes or create files. Focused ESLint on
the owned source and test exited zero. Root owns maintained workspace checks.

## Differential evidence and remaining mismatches

Twenty original native QA formulas covered half-integers, fractions, negative
subnormals, GAMMALN sign restrictions, extreme beta ratios, digamma reflection
and reciprocal growth, rising-factorial cancellation and poles, and Lambert W
small, enormous and near-branchpoint inputs. Eighteen matched result kind and
numeric value within relative tolerance 2e-11; two did not. This tolerance does
not establish exact binary values or identical formatted output.

| Formula | Native | JavaScript | Independent reference |
| --- | --- | --- | --- |
| BETA(1,1e300) | #NUM! | #NUM! | 1e-300 |
| LAMBERTW(1e300) | #NUM! | #NUM! | 684.2472086297608492396 |
| LAMBERTW(-1e-300,-1) | #NUM! | #NUM! | -697.3227762954601609954 |
| LAMBERTW(-0.3678794411714423) | -0.9999999845821744 | -0.9999999881839771 | -0.9999999846957458715 |
| LAMBERTW(-0.3678794411714423,-1) | -1.0000000122398298 | -1.0000000143999743 | -1.0000000153042542846 |

Independent references used isolated mpmath at 80 decimal digits, except beta
at 400 digits to avoid loss of the unit increment beside 1e300. Branchpoint
references used the exact binary64 input converted to mpmath, rather than its
printed decimal spelling. Both native and JavaScript branchpoint results differ
from the independent reference. Native overflowing Lambert iteration and beta
failure are reproduced for behavioral compatibility; they are not mathematical
accuracy passes.

BETALN(1,1e300) remains approximately 2.4e-12 away from native; finite GAMMA
fractions also differ in final digits. Native formatting is not certified by
these numerical checks. IGAMMA and REDUCEPI were outside this review assignment.
Exhaustive poles, parameter combinations, signed-zero transport, cancellation,
all complex branches, and every extreme input remain unmeasured here.

## Validated branchpoint follow-up

Two exact original near-branchpoint regressions reproduced the remaining
Lambert W discrepancies before the next repair. The reference build is ARM64
with GCC `-O2`: compiler contraction evaluates its residual and denominator
with fused multiply-add. An isolated Python/libm FMA reconstruction reproduced
both native results exactly; unfused reconstruction did not. V8 Math.exp also
differed by one ulp from glibc in ten contracted iteration samples. Independent
mpmath at 100 digits showed glibc correctly rounded nine of those ten, but the
tenth requires its specific polynomial profile rather than ideal rounding.

`numeric-arithmetic.ts` now supplies bounded exact binary64 fused multiply-add
and the captured glibc 2.36 ARM64 exponential reduction/polynomial. Exponential
anchors and residuals were independently generated at 120 decimal digits;
all 128 pairs match the upstream numerical table exactly. Additional libm QA
matched all 423 original exp inputs, including normal, subnormal, underflow and
overflow regions. Upstream glibc source/data stayed in `out`; no native product
dependency was introduced.

Both exact Lambert W regressions now pass with -0.9999999845821744 and
-1.0000000122398298 respectively. The prior table retains pre-follow-up values
as historical mismatch evidence. The twenty scientific QA cases now agree in
kind and relative 2e-11 tolerance (20/20); remaining final-digit differences
in gamma/beta/digamma/rising factorial are not exact formatting passes.
Thirteen independent scientific regressions, eight original fixtures and two
numeric-arithmetic tests pass (23/23). This does not certify every libm input.
