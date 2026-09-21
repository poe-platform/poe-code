# Independent captured Bessel QA

Run this isolated procedure against the candidate with the pinned native profile
in `docs/ssconvert/numeric-current-native-profile.json`. Native executables remain
QA dependencies only. Generated workbooks, scripts and results belong in `out`.

1. Generate J/Y cells using seed 6197301 with orders 0, 0.000001, 0.125,
   0.5, the neighbors of 1, 1.5, the predecessor of 2, 2 and their selected
   negatives. Include both neighbors of x=17 and x=1000000, and 100 additional
   seeded fractional-order/logarithmic-x pairs.
2. Recalculate the original in-memory workbook through the actual evaluator.
   Independently recalculate a native Gnumeric workbook in the isolated pinned
   container with `--recalc` and raw CSV export. Compare binary64 values exactly;
   do not reinterpret close values as passes.
3. Partition cases into direct captured B1, negative reflection of B1 and other
   routes. Check every generated numeric result independently using mpmath
   1.3.0 at 100 decimal digits; retain errors rather than granting tolerance passes.
4. Inject a unique thrown cancellation reason at tick 7 of capturedHankel.
   Verify thrown identity, no subsequent ticks, and a successful unbounded
   control with a finite tick count. This is deterministic work accounting,
   not a wall-clock performance claim.

Initial isolated cohort: 536 cells; 394 exact matches and 142 mismatches.
After original failing regressions and fixes, all 536 exactly match.
Direct B1: 330 cells, all exact matches. Negative B1
reflection: 68 cells, all exact matches. Phase path: 50 cells, all exact matches.
Integral/other routes: 88 cells, all exact matches. Cancellation identity and
tick-stop controls passed; successful BESSELJ(100,1) took 63 ticks.
The largest measured high-precision relative error was approximately
2.308e-13 at BESSELY(19,-0.125), matching native's finite Debye truncation.

Fixes preserve native pi-phase cosine reduction, captured trigonometric
rounding, correctly rounded fourth roots and reflected complex FMA ordering.
The released phase selector, amplitude and paired recurrence now precede
reflection for finite positive x<=1e12; quarter-pi reduction preserves the
source parts and trig combination order. Larger phase inputs remain unverified.
The generalized A3 integral preserves upstream cancellation-safe coshum1,
cosdiff and sinh-minus-u series, derivative and split phase. Acos uses a
160-bit asin recurrence with an exact fixed-point half-angle root, qualified
against independent 100-digit references at the measured primitive inputs.
An additional 12-cell negative-integer cohort initially exposed four J errors
where overflowing Y multiplied by zero must propagate #NUM!; after removing
the scalar sine-zero shortcut all 12 exactly match native. Source inspection confirms
that orders >=2 have a separate upstream phase-domain guard; routing them
unconditionally through Debye B1 would be an incorrect repair. A 30-cell native
libm fourth-power cohort agreed with independent 100-digit rounding; two of
these differed from JavaScript exponentiation. Exact midpoint correction
avoids double rounding rather than replacing pow with two square roots alone.
Fresh independent holdouts: seed 6173304 phase (120 cells), seed 6183305
low-order A3 (120 cells), both all exact. Seed 6183306 high-q A3 (120 cells)
has 73 exact matches and 47 unresolved numerical mismatches. Its original
generic-quadrature run exhausted the 10-million-work budget and was incomplete;
the replacement source A3 run completed. Do not count the original run as a pass.
An isolated primitive trace measured 120 acos and 7496 log1p calls; JavaScript
differed from native at two acos and 46 log1p calls. The source SunPro log1p
port matches 44 of those 46 differing calls; two instances of argument
0.33688260287586475 remain mismatched. Native log1p itself differs from the
correctly rounded 100-digit result at 38 of those 46 calls, so replacing it
unconditionally with a high-precision approximation would change semantics.
These primitives do not yet explain all 47 high-q integration mismatches.

The additional glibc 2.41 primary source was acquired only into `out`;
`out/ssconvert-bessel-glibc-2.41-s_log1p.c` preserves its SunPro license.
Source routing now admits nonphase orders >=2 to B1 when x>=17, nu<x and
g>=6.5, retaining the existing x<=1e6 bound. Seed 6192907 measures 126
large-order B1 cells with q=.92..99 and x=1000..100000: initially 4 exact
matches and 122 mismatches; after routing and source cosine correction all
126 exactly match. Original unit regressions captured BESSELJ(1000,920)
and the independently minimized cosine phase 16.47843003632959 before fixes.
The source cosine correction preserves native FMA contraction order.

Seed 6192908 measures 2048 independent sin/cos calls, including signed zero
and reduction boundaries: 2047 exact matches and one unresolved cosine
mismatch at 137330.13360794372. The same mismatch exists in the earlier
unfused candidate; native agrees with the 100-digit reference. The first
capture lost the negative-zero input sign during JSON serialization; the
corrected capture transports input bits, and the original is retained.
An attempted parallel holdout rerun also exposed a QA driver defect: three
drivers copied workbooks to the same container path. Contaminated captures
are retained separately; unique per-driver paths and isolated reruns restore
the reported exact phase/low-order-A3 results. These harness failures are not
product failures and are not passes.

Final focused unit verification: 252 passes. Maintained workspace lint,
source TypeScript checking and test TypeScript checking passed. These scoped
checks do not establish broad or cross-workspace completion.
Full-domain inputs, other library/locale
profiles, CLI byte formatting, realm boundaries and replay cells were not
measured by this isolated cohort and are not passes.

Transient evidence: `out/ssconvert-bessel-followup-comparison.json`, generation
seed and formulas in `out/ssconvert-bessel-followup.py`, and deterministic
controls in `out/ssconvert-bessel-followup-controls.mjs`. Fresh holdout results
are in `out/ssconvert-bessel-phase-holdout-comparison.json`,
`out/ssconvert-bessel-integral-holdout-comparison.json` and
`out/ssconvert-bessel-integral-highq-comparison.json`.
