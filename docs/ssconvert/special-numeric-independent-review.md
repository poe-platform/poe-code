# Independent error-function and Bessel review

Reviewed `functions/special-numeric.ts` on 2026-09-19 separately from its author.
Procedure: `docs/plans/ssconvert-functions-math-engineering-complex-qa.md`.
Reference Gnumeric 1.12.61 archive SHA-256:
`2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`.
Read upstream `plugins/fn-eng/functions.c`, `src/sf-bessel.c`, and the ERF
interval implementation in `src/sf-dpq.c`. Documentation's negative-order
restrictions do not describe the released runtime's supported continuations.

Native QA used separate container `ssconvert-math-qa-20260919`, executable
`/out/prefix/bin/ssconvert`, `LD_LIBRARY_PATH=/out/prefix/lib`, C locale, UTC,
memory GSettings and `/out/prefix/share/glib-2.0/schemas`. Original XML inputs,
scripts and native/JavaScript captures stayed in `out`. Native conversion
exited zero. It emitted six `sf-bessel: trouble in bessel_k` diagnostic lines;
the current synchronous evaluator does not reproduce those diagnostics.

## Repairs and canonical verification

Twenty-two original small in-memory regressions all failed before repairs and
all pass after repairs, with unchanged relative tolerance 2e-14:

- Negative Bessel orders now use native reflection/continuation relations.
- BESSELY accepts negative x with integer order, as released native does.
- BESSELI preserves native overflow beyond x=709; BESSELK preserves its native
  zero result beyond x=705.342, including lost mathematically nonzero subnormals.
- ERF close endpoints use native's rounded sqrt(2)-scaled endpoints, avoiding
  subtraction cancellation at adjacent values near one.
- Adaptive Gauss-Legendre 16/8 quadrature replaces costly Simpson subdivision.
  Its error criterion includes a sample-magnitude rounding bound. Nodes and
  weights were independently checked with mpmath at 100 decimal digits.
- Dominant integer Y/K recurrences avoid exponentially large integral peaks.
- Large-x J/Y use asymptotic expansions and preserve phase without subtracting
  a rounded multiple of pi from the large argument.

The preexisting invocation work budget of 100000 is unchanged. Every adaptive
rule, interval and recurrence consumes host ticks; cancellation and work-limit
failures are not swallowed. The repaired cases complete with this budget.
All ten original assigned Bessel/ERF cases pass at their original tolerance.
A full twelve-case file run had eleven passes and one unsupported REDUCEPI
failure at that moment; IGAMMA and REDUCEPI belong to root's separate assignment.
The focused ten-case selector reports two excluded cases, not twelve passes.
Scoped ESLint passed. Unit fixtures use the actual workbook evaluator, create
no files, and spawn no native processes. Root owns maintained workspace checks.

## Measured mismatches

Sixty original native cases covered negative arguments/orders, zero, very small
arguments, large orders, large arguments, overflow/underflow, and ERF tails and
close endpoints. Result kinds agree in all sixty. Thirty-nine shared `rendered`
raw cell strings match exactly; twenty-one differ below. This is cell-string
comparison, not a certification of full command output or stderr bytes.
Fifty-eight numerical results match within relative 2e-14; two ERF tail interval
results differ by approximately 2.65e-14. Neither is counted as a tolerance pass.

| Formula | Native raw cell | JavaScript raw cell |
| --- | --- | --- |
| ERF(1.4999999999999998) | 0.9661051464753106 | 0.9661051464753109 |
| ERFC(1.5) | 0.033894853524689274 | 0.033894853524689225 |
| ERF(8,8.0001) | 1.8082597972131393E-32 | 1.808259797213187E-32 |
| ERF(1,0.5) | -0.3222009151366684 | -0.32220091513666826 |
| ERF(-8,-8.0001) | -1.8082597972131393E-32 | -1.808259797213187E-32 |
| ERF(1,1.0000000000000002) | 6.517571512431702E-17 | 6.5175715124317E-17 |
| BESSELJ(1,-1) | -0.4400505857449335 | -0.44005058574493355 |
| BESSELJ(-1,1) | -0.4400505857449335 | -0.44005058574493355 |
| BESSELJ(1,100) | 8.431828789626699E-189 | 8.431828789626747E-189 |
| BESSELY(1,-0.5) | 0.6713967071418031 | 0.6713967071418065 |
| BESSELY(-1,0) | 0.08825696421567698 | 0.08825696421567703 |
| BESSELY(1,100) | -3.775287810110526E+185 | -3.775287810110532E+185 |
| BESSELY(1000,0) | 0.0047159179776228135 | 0.004715917977622813 |
| BESSELI(1,-0.5) | 1.2312002145929675 | 1.2312002145929721 |
| BESSELI(-1,0) | 1.2660658777520084 | 1.2660658777520082 |
| BESSELI(1,100) | 8.47367400813808E-189 | 8.473674008138116E-189 |
| BESSELK(1,-0.5) | 0.4610685044478946 | 0.46106850444789454 |
| BESSELK(1,100) | 5.900333183638617E+185 | 5.900333183638618E+185 |
| BESSELI(700,0) | 1.5295933476718735E+302 | 1.5295933476718737E+302 |
| BESSELJ(12,0) | 0.047689310796833605 | 0.04768931079683345 |
| BESSELJ(12.000000000000002,0) | 0.04768931079683398 | 0.04768931079683382 |

Independent mpmath 1.3.0 at 100 digits, using exact binary64 arguments, gives
ERF's mathematically exact adjacent-one interval approximately
9.2172380266174383E-17; the native smaller value results from rounded scaled
endpoints. For the 8-to-8.0001 interval it gives approximately
1.8082597972219756E-32. Native K(710,0) flushes the mathematically positive
2.1050974555688514E-310 to zero. These independent comparisons separate native
compatibility from mathematical accuracy; they do not replace native evidence.
The first mpmath stdin invocation omitted Docker's `-i` and produced no output;
only the corrected explicit stdin invocation supplies the references above.

Exact final-digit/native-libm equivalence remains unresolved. Exhaustive order
and argument combinations, competing special values, every turning point and
zero, extreme-order domains, signed-zero transport and diagnostic ordering
remain unmeasured here. This review does not claim complete stable-group parity.

## Validated interval and diagnostic follow-up

Two further exact original ERF tail regressions failed before replacing the
interval path with the released Cody normal-tail rational evaluation and
`pnorm2` density bounds. It now uses the independently qualified captured
glibc exponential and preserves rounded sqrt(2)-scaled endpoints. Both exact
tail regressions pass. ERF(1,0.5) and the adjacent-one interval also match raw
native strings after this repair. The preceding twenty-one-row table retains
historical pre-follow-up values: four listed ERF interval mismatches are now
fixed, leaving seventeen exact raw cell-string mismatches. All sixty measured
values match in kind and within relative 2e-14 (60/60); forty-three raw cell
strings match exactly (43/60). The seventeen others remain mismatches.

Twenty-four isolated native invocations qualified Bessel diagnostics separately:
twelve original formulas each ran with and without `--recalc`. Each of
K(-1,0), K(-1,-1), K(-1,-0.5) and K(-1,100) emitted exactly one
`sf-bessel: trouble in bessel_k\n` line normally and two with `--recalc`;
all exited zero and produced #NUM!. Source `sf-bessel.c:720` checks negative x
before reflecting order and invokes the line-14 `ML_WARNING` printing macro.
K(0,0), K(0,-1), K(1e-300,0), K(1,100), K(710,0), I(1,-0.5), K(1,-0.5)
and I(-1,-0.5) emitted no stderr, with either recalculation option. Core
K_bessel's zero/underflow branches set ncalc to the requested count and do not
emit the negative-x warning. No unstable timestamp or GOQuad critical output
is asserted as deterministic compatibility evidence.

The implementation emits the validated negative-K warning through the optional
FunctionHost diagnostic callback. Root's separate bounded, awaited engine
diagnostic integration test passes for normal SDK conversion and ordering.
Native's double evaluation under --recalc remains separate lifecycle evidence;
the formula helper does not fabricate an extra warning to imitate it.
Twenty-four independent special-function tests pass; the ten originally
assigned cases also pass, with IGAMMA/REDUCEPI still separately owned by root.

## Scalar libm and integer recurrence follow-up

Two exact scalar ERF/ERFC regressions failed before adopting the captured SunPro
rational approximation and glibc ARM64 paired-polynomial/FMA profile. All 64
additional ERF/ERFC boundary/domain probes now match native raw cell strings
exactly. The coefficient notice is retained; primary libm sources were acquired
only into `out`. Captured exponential qualification is documented in
`scientific-independent-review.md`.

Double-double Bessel I/J series now preserve integer and half-integer starting
terms, products/divisions and compensated addition. Two exact half-order I/Y
regressions demonstrated failure before the sqrt(pi) high/low repair. Expanded
QA then exposed J(10,100) exhausting the existing work budget and Y(10,2)
losing cancellation; both were reproduced as unchanged-tolerance canonical
regressions before repair. J uses the released positive series-domain boundary.
Y uses captured native rational Y0/Y1 and the native fused forward recurrence.
Five further exact regressions for J(1,2), J(1,5), J(1,100), J(2,2), and Y(1,0)
failed before adding captured small-domain base functions and the native J
forward/backward recurrence, including continued-fraction termination and
rescaling. The captured libm path applies on the upstream integer series domain,
with its original 99999 order boundary. All work loops consume host ticks.
The general Schlaefli integral also compensates its phase product/subtraction.

Independent 100-digit mpmath gives Y(10,2) =
-0.0058680824422086146398031824775454874930448059029733518329091654,
while captured native gives -0.005868082442208625. J(1,100)'s ideal binary64 is
8.431828789626709E-189, while native gives 8.431828789626699E-189; I(700,0)'s
ideal binary64 is 1.5295933476718737E+302, while native gives
1.5295933476718735E+302. Compatibility and ideal mathematical rounding are
therefore reported separately.

All 39 independent special-function tests pass. All 12 original special-numeric
cases, 13 independent scientific cases, 8 original scientific cases and 2
shared numeric-helper cases pass: 74 focused tests total. Focused ESLint and
TypeScript no-emit checks pass; root retains maintained cross-workspace build,
lint and unit verification ownership. The earlier historical tables remain
historical evidence and are superseded by the following final measurements.

The original 60-case cohort now has 54/60 exact raw cell-string matches and
60/60 kind/numerical agreement within the unchanged relative 2e-14 bound.
These remaining 6 exact formatting mismatches are not exact passes:

| Formula | Native raw cell | JavaScript raw cell |
| --- | --- | --- |
| BESSELY(1000,0) | 0.0047159179776228135 | 0.004715917977622813 |
| BESSELK(1,-0.5) | 0.4610685044478946 | 0.46106850444789454 |
| BESSELK(1,100) | 5.900333183638617E+185 | 5.900333183638618E+185 |
| BESSELI(700,0) | 1.5295933476718735E+302 | 1.5295933476718737E+302 |
| BESSELJ(12,0) | 0.047689310796833605 | 0.04768931079683348 |
| BESSELJ(12.000000000000002,0) | 0.04768931079683398 | 0.04768931079683388 |

The independent expanded cohort contains 64 ERF/ERFC probes and 140 Bessel
probes (x = 0.1, 1, 2, 5, 10; orders = 0, 1, 2, 5, 100, 0.5, -0.5;
all four families). It has 171/204 exact raw cell-string matches, with
204/204 kind/numerical agreement within relative 2e-14. Its remaining
33 raw cell-string mismatches follow; none is counted as an exact pass.

| Formula | Native raw cell | JavaScript raw cell |
| --- | --- | --- |
| BESSELK(0.1,0) | 2.427069024702017 | 2.4270690247020164 |
| BESSELK(0.1,100) | 5.915102278090822E+285 | 5.915102278090823E+285 |
| BESSELK(0.1,0.5) | 3.5861668387972596 | 3.58616683879726 |
| BESSELK(0.1,-0.5) | 3.5861668387972596 | 3.58616683879726 |
| BESSELK(1.0,100) | 5.900333183638617E+185 | 5.900333183638618E+185 |
| BESSELK(1.0,0.5) | 0.4610685044478946 | 0.46106850444789454 |
| BESSELK(1.0,-0.5) | 0.4610685044478946 | 0.46106850444789454 |
| BESSELK(2.0,0) | 0.11389387274953346 | 0.11389387274953343 |
| BESSELK(2.0,1) | 0.13986588181652246 | 0.13986588181652243 |
| BESSELK(2.0,2) | 0.25375975456605593 | 0.2537597545660559 |
| BESSELK(2.0,5) | 9.431049100596471 | 9.431049100596468 |
| BESSELK(2.0,100) | 4.61941597760128E+155 | 4.619415977601273E+155 |
| BESSELY(2.0,0.5) | 0.23478571040624846 | 0.23478571040624854 |
| BESSELK(2.0,0.5) | 0.11993777196806146 | 0.11993777196806145 |
| BESSELJ(2.0,-0.5) | -0.23478571040624846 | -0.23478571040624854 |
| BESSELK(2.0,-0.5) | 0.11993777196806146 | 0.11993777196806145 |
| BESSELK(5.0,0) | 0.0036910983340425942 | 0.003691098334042595 |
| BESSELK(5.0,1) | 0.004044613445452164 | 0.004044613445452165 |
| BESSELK(5.0,2) | 0.00530894371222346 | 0.005308943712223461 |
| BESSELK(5.0,5) | 0.03270627371203186 | 0.032706273712031865 |
| BESSELK(5.0,100) | 7.039860193061684E+115 | 7.039860193061681E+115 |
| BESSELY(5.0,0.5) | -0.1012177091851084 | -0.10121770918510833 |
| BESSELK(5.0,0.5) | 0.0037766133746428825 | 0.0037766133746428834 |
| BESSELJ(5.0,-0.5) | 0.1012177091851084 | 0.10121770918510833 |
| BESSELK(5.0,-0.5) | 0.0037766133746428825 | 0.0037766133746428834 |
| BESSELJ(10.0,0) | -0.2459357644513484 | -0.24593576445134824 |
| BESSELY(10.0,0) | 0.055671167283599304 | 0.05567116728359953 |
| BESSELI(10.0,0) | 2815.7166284662553 | 2815.7166284662544 |
| BESSELK(10.0,0) | 1.7780062316167654E-05 | 1.778006231616765E-05 |
| BESSELK(10.0,1) | 1.8648773453825585E-05 | 1.8648773453825592E-05 |
| BESSELK(10.0,5) | 5.754184998531229E-05 | 5.7541849985312295E-05 |
| BESSELY(10.0,0.5) | 0.21170886633139815 | 0.2117088663313981 |
| BESSELJ(10.0,-0.5) | -0.21170886633139815 | -0.2117088663313981 |

These residuals require further source-profile work in general Hankel/integral
J/Y, modified I asymptotics and the native Cody/R K algorithm. The cohorts do
not establish exhaustive exact parity, every special-value combination, every
turning point/zero, all signed-zero transport or full command byte parity.
Unmeasured domains remain unmeasured. The two QA capture sets and independent
reference scripts remained in `out`; this document records their measured
residuals before temporary evidence cleanup by root.

## Final modified K follow-up

Five exact original K starting-value regressions (x = 0.1, 1, 2, 5, 10) failed
before a new independently authored positive-x K numerical implementation.
Two exact high-order K(1,100)/K(2,100) regressions then failed before adopting
the native switch from stable forward recurrence to ratio recurrence. All seven
unchanged exact regressions now pass. Numerical coefficient facts and algorithm
provenance are pinned `src/sf-bessel.c:758`, citing J. B. Campbell, "On Temme's
Algorithm for the Modified Bessel Functions of the Third Kind," TOMS 6(4),
December 1980, pp. 581–586, and the Cody/Stoltz numerical modifications.
The TypeScript implementation has invocation-owned scalar state, consumes ticks
in every loop and uses independently implemented capturedExp/FMA arithmetic;
it does not include a native dependency or fallback. It applies to positive
x > 1e-10; the existing tiny-input path remains separately scoped. This is an
original implementation of mathematical recurrences and coefficient facts;
the upstream R C program and its licensed text remain only in `out`.

The final owned check set passes 81 tests: 46 independent special-function,
12 original special-numeric, 13 independent scientific, 8 original scientific
and 2 shared numeric-arithmetic cases. Final focused ESLint and TypeScript
no-emit checks pass. Root owns final maintained uncached integration checks.

The final 60-case cohort has 56/60 exact raw cell-string matches. The final
204-case expanded cohort has 195/204 exact matches, including all measured K
outputs and all 64 scalar ERF/ERFC probes. Both cohorts match all result kinds
and meet the unchanged relative 2e-14 comparison bound; the following remaining
exact mismatches are explicitly not exact passes. These tables supersede all
prior residual tables in this document.

### Final original cohort

| Formula | Native raw cell | JavaScript raw cell |
| --- | --- | --- |
| BESSELY(1000,0) | 0.0047159179776228135 | 0.004715917977622813 |
| BESSELI(700,0) | 1.5295933476718735E+302 | 1.5295933476718737E+302 |
| BESSELJ(12,0) | 0.047689310796833605 | 0.04768931079683348 |
| BESSELJ(12.000000000000002,0) | 0.04768931079683398 | 0.04768931079683388 |

### Final expanded cohort

| Formula | Native raw cell | JavaScript raw cell |
| --- | --- | --- |
| BESSELY(2.0,0.5) | 0.23478571040624846 | 0.23478571040624854 |
| BESSELJ(2.0,-0.5) | -0.23478571040624846 | -0.23478571040624854 |
| BESSELY(5.0,0.5) | -0.1012177091851084 | -0.10121770918510833 |
| BESSELJ(5.0,-0.5) | 0.1012177091851084 | 0.10121770918510833 |
| BESSELJ(10.0,0) | -0.2459357644513484 | -0.24593576445134824 |
| BESSELY(10.0,0) | 0.055671167283599304 | 0.05567116728359953 |
| BESSELI(10.0,0) | 2815.7166284662553 | 2815.7166284662544 |
| BESSELY(10.0,0.5) | 0.21170886633139815 | 0.2117088663313981 |
| BESSELJ(10.0,-0.5) | -0.21170886633139815 | -0.2117088663313981 |

The remaining measured differences are in general Hankel/half-order J/Y and
modified I paths. Unmeasured turning points, extreme orders, tiny K inputs,
competing errors/special values and full command bytes remain unmeasured.
Owned temporary captures and independently acquired libm QA sources were
purged only after these final measurements were recorded. Shared oracle source
and root-owned container state were preserved.

## Final exact J/Y/I and captured trigonometry follow-up

Six original exact half-order J/Y regressions failed before routing J(x,-0.5)
and Y(x,0.5) through the released quad series relation on x² < 105. This uses
the existing double-double high/low sqrt(pi) anchor, term arithmetic and stopping
criterion, preserving the native relationship rather than a rounded scalar
trigonometric shortcut. All six unchanged exact assertions pass.

Two original exact I0(10)/I0(700) regressions failed before the independently
authored Olver P-sequence and backward normalization in `captured-bessel-i.ts`.
The path retains the upstream significance threshold, optional 2^-900
rescaling, accumulated normalization and captured exponential. It applies to
unscaled I0 where x² >= 100 and x <= 709; the separate native overflow path
and small-domain double-double series remain intact. Each loop consumes ticks.
Both exact assertions pass, including the intentionally non-ideal native
I0(700) final rounding.

An exact Y0(1000) regression failed before the zero-order finite Debye expansion
with the upstream g-dependent truncation and complex phase operation order.
It passes exactly. Four original exact J0/Y0 regressions at 10, 12 and the next
binary64 value above 12 failed before the zero-order steepest-descent Hankel
integral. The independently authored numerical implementation uses the
published cancellation-safe series, upstream range shrinking and transformed
finite trapezoid rule. It retains fused phase multiplication and multiplication
by reciprocal pi; division by pi produced a validated one-ulp J0(10) mismatch.
All four unchanged exact assertions pass. These algorithms cover zero-order
Hankel paths on the measured finite domains, not every nonzero-order turning
point or general complex Hankel branch.

Fresh isolated native conversion replays verify all 60/60 original raw cell
strings and all 140/140 expanded Bessel raw cell strings exactly. All prior
four original and nine expanded residual entries are repaired; their earlier
tables above remain historical evidence. The original 64 scalar ERF/ERFC
boundary probes were qualified exactly in the earlier capture; their code did
not change in this follow-up. This report does not claim a fresh 204-case run
from those previously purged probes.

Another 88 probes cover zero-order Hankel boundaries and neighboring values
from 9 through 1000000, I0 values from 10 through 709, and K at fractional orders
0.1, 0.25, 0.75, 1.25, 1.75, 2.5 and 30.75 with x = 0.1, 1, 2, 5, 10.
Their first run had 87/88 exact matches. The newly validated case
Y0(11.180339887498949) was native -0.19524864120782978 versus JavaScript
-0.19524864120782984. It was added as an original exact canonical regression
and demonstrated failure before repair. It now passes exactly, as do all
88/88 additional raw cell strings. Combined, the freshly replayed 288 probe
occurrences match exactly in kind and raw cell strings. This is not a claim of
full command/stderr byte parity or exhaustive numeric inputs.

The boundary failure was traced in isolated QA against upstream's native
integrand and quadrature. Its ranges matched; three inner sin/cos samples and
the outer cos differed. Native cos(x) was hexadecimal 0x1.7840295167612p-3;
V8's value was 0x1.7840295167613p-3. The native cbrt also differed by one ulp,
but both selected the same power/count, so that difference did not cause the
branch behavior. The initial isolated C trace build lacked a gnm_finite macro
and failed; only its corrected successful build supplies this evidence.

`captured-trigonometry.ts` is an independently authored small/medium-argument
binary64 scalar algorithm using mathematical table/coefficient facts and the
captured glibc 2.36 reduction/profile. Independent 120-digit mpmath generation
reconstructed all 220 sine/cosine high anchors exactly; 18 of the 220 residual
coefficients differed from native at lower precision and were calibrated to
the published numerical coefficient facts. This deliberate precision profile
preserves native behavior instead of silently substituting ideal rounding.
Primary IBM AML/glibc sources and the licensed upstream trace extraction stayed
only in `out`; their code/text was not installed as product code. Mathematical
facts/profile provenance: glibc 2.36 `sysdeps/ieee754/dbl-64/s_sin.c`, `usncs.h`,
`sincostab.c`, and Gnumeric 1.12.61 `src/sf-bessel.c` Matviyenko Hankel algorithms.
The product helper uses scalar reduction and Horner/anchor reconstruction, with
the validated final sine correction FMA; it contains no fixture-keyed patches.

Independent isolated libc qualification now matches 1433/1433 scalar arguments
exactly in both sine and cosine (2866 outputs). This includes 221 k/128 anchors,
1000 deterministic small-domain probes, 200 medium-domain probes and 12
neighbors of cancellation/reduction boundaries. Two initially discovered
one-ulp cosine qualification differences were added as exact helper assertions
before the source-profile final correction FMA repair; both pass. The helper's
captured domain is |x| < 105414336; larger arguments retain the separate existing
Math path and are not certified by this qualification. Non-finite inputs
originally caused an invalid anchor access for NaN; two concrete failing
helper tests preceded the explicit native NaN propagation guard. Those tests
and the signed-zero checks now pass.

Final owned verification passes 98 focused tests: 60 independent special-numeric,
12 original special-numeric, 13 independent scientific, 8 original scientific,
2 shared numeric-arithmetic and 3 captured-trigonometry tests. Final focused
ESLint and TypeScript no-emit checks pass; root retains maintained uncached
workspace and cross-workspace verification ownership. There are no remaining
measured raw mismatches in these freshly replayed cohorts. Nonzero-order general
Hankel domains, unmeasured extreme orders, tiny K inputs, competing special
values/errors, every native locale/profile, and exhaustive signed-zero command
transport remain unmeasured and are not passes. Owned temporary final captures,
trace extraction and primary libm QA sources were purged after recording this
evidence; shared oracle source and root's container state were preserved.
