# Independent mathematical implementation review

Executed 2026-09-19 against the live working tree by a different agent from the original implementation author. This document records evidence; QA procedures remain in `docs/plans`.

The separate ARM64 Gnumeric 1.12.61/GOffice 0.10.61 oracle is captured in [numeric-native-profile.json](numeric-native-profile.json), including dependencies, plugins, locale, and native binary hash. Official Gnumeric source SHA-256: `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Native execution used the container's `/out/prefix/bin/ssconvert`, `LD_LIBRARY_PATH=/out/prefix/lib`, `LC_ALL=C`, `TZ=UTC`, memory GSettings backend, and the prefix's schema directory. Source and native fixtures stayed in `out`; neither enters the product engine or canonical units.

## Validated repairs

Original in-memory regressions first failed against the current implementation. Repairs preserve source semantics rather than replacing native behavior with mathematically preferable results:

- GCD rejects all-zero or ignored-only arguments and inputs beyond 2^52; LCM rejects zero and ignored-only arguments and applies upstream intermediate limits. Validation follows fake-floor, including GCD(-5e-324,2) = 2.
- FIB uses upstream integer table behavior below 47 and binary64 Binet evaluation above it. Exact BigInt results were incompatible with native; FIB(1476) overflows the native intermediate although the mathematical answer is finite.
- COMBIN and COMBINA floor without fake-floor. Exact integral coefficient accumulation repairs large-coefficient rounding without 32-bit truncation.
- MROUND uses upstream remainder comparison, including MROUND(1.7,.2) = 1.6.
- Decimal rounders skip exact or insignificant decimal places and use the upstream 303 split for large powers; subnormal truncation was captured independently.
- Pi trigonometry reduces to a quarter turn before multiplication, uses the deliberate quarter-turn constant, avoids cancellation in COSPI(1e-20), and preserves internal sinpi negative zero. Cell construction normalizes signed zero, as upstream value.c:117 does.
- FACT accepts nonintegers through gamma(x+1), including negative nonintegers. Integral factorial and double-factorial accumulation retain exact integers until final rounding, repairing FACT(170) and FACTDOUBLE(300).
- DEGREES/RADIANS preserve upstream operation order and intermediate overflow. AGM preserves source iteration, product, and scaling behavior; AGM(1e-300,1e300) returns #NUM!.
- Two-number HYPOT corrects its library estimate using exact binary-rational square comparisons at rounding midpoints; the tiny-input JavaScript estimate was one ulp wrong. More than two remaining arguments follow upstream sum-of-squares overflow/underflow behavior. Outside zeros are removed before selecting the algorithm.

Primary evidence: Gnumeric plugins/fn-math/functions.c descriptors and implementations; src/sf-gamma.c factorial tables; src/mathfunc.c gnm_agm; src/rangefunc.c gnm_range_hypot; GOffice goffice/math/go-math.c reduce_half, do_sinpi, go_sinpi, go_cospi, go_tanpi, go_cotpi.

## Executed results and limits

Canonical unit cases: 32 independent plus 79 original, 111 passed. No native subprocesses, external queries, or file writes occur in these units. Final isolated cohorts matched 31/31 and 108/108 numeric/error results. Initial cohorts reproduced 11 canonical failures and five additional extreme mismatches before repair. Scoped ESLint passed for math.ts and math-independent-review.test.ts. Maintained package lint completed ESLint but initially failed another owner's engineering.ts typecheck; root owns final uncached package build/test/lint and integration checks.

Comparisons inspect actual JavaScript workbook engine results against parsed native raw CSV fields. They establish measured numeric/error parity, not complete output-byte formatting, command diagnostics, arity, SDK/VFS effects, cancellation, or all inputs. The 103-case extreme cohort checks nonzero, cancellation-adjacent, large, tiny, overflow, underflow, and reciprocal-domain inputs for Math-backed functions; it does not certify all binary64 values or platforms. No measured mismatch remains in the final cohorts. Scientific, matrix, criteria, conversion, complex, and other function groups are measured separately; unmeasured cases are not passes.

Independent mpmath 1.3.0 references used 100 decimal digits outside canonical tests. True FIB(78) and FIB(100) deliberately differ from upstream binary64 values. References confirm the exact binomial coefficient, quarter-turn constant, true sqrt(pi) gamma anchor, tiny sinpi cancellation, and correctly rounded tiny two-number hypot:

- `version`: `1.3.0`
- `precisionDigits`: `100`
- `quarterSine`: `0.70710678118654752440084436210484903928483593768847403658833986899536623923105352`
- `tinySinPi`: `0.000000000000000000031415926535897932384626433832795028841966526280971008239720199870566980496995053`
- `fibonacci78`: `8944394323791464.0`
- `fibonacci100`: `354224848179261915075.0`
- `binomial100_30`: `29372339821610944823963760.0`
- `factHalf`: `0.88622692545275801364908374167057259139877472806119356410690389492645564229551609`
- `factNegativeHalf`: `1.7724538509055160272981674833411451827975494561223871282138077898529112845910322`
- `binary64TinyHypot`: `1.4142135623730950842405962583148182184632317501519751564995734761308260749935613e-300`

## Measured native fields

134 distinct original formula inputs; cohort counts retain overlap. Every row matched the engine numeric/error result.

| Formula | Native raw CSV field |
| --- | --- |
| `=MROUND(1.7,.2)` | `1.6` |
| `=MROUND(-1.7,-.2)` | `-1.6` |
| `=COMBIN(2.9999999999999996,2)` | `1` |
| `=COMBINA(2.9999999999999996,2)` | `3` |
| `=COMBIN(1000,300)` | `5.428250046406141E+263` |
| `=COMBIN(1e300,1)` | `1E+300` |
| `=GCD(0,0)` | `#NUM!` |
| `=GCD("skip")` | `#NUM!` |
| `=GCD(4503599627370496,2)` | `2` |
| `=GCD(4503599627370497,2)` | `#NUM!` |
| `=LCM(0,2)` | `#NUM!` |
| `=LCM("skip")` | `#NUM!` |
| `=FIB(78)` | `8944394323791488` |
| `=FIB(100)` | `3.542248481792631E+20` |
| `=FIB(1476)` | `#NUM!` |
| `=COMBIN(100,30)` | `2.9372339821610947E+25` |
| `=SINPI(0.25)` | `0.7071067811865476` |
| `=COSPI(0.25)` | `0.7071067811865476` |
| `=TANPI(0.5)` | `#NUM!` |
| `=COTPI(-0.5)` | `0` |
| `=ROUND(1.2345678901234567,17)` | `1.2345678901234567` |
| `=ROUND(1e-310,320)` | `1E-310` |
| `=ROUNDUP(1e-310,320)` | `1E-310` |
| `=TRUNC(1e-310,320)` | `9.999999999E-311` |
| `=SINPI(1e-20)` | `3.141592653589793E-20` |
| `=COSPI(1e-20)` | `1` |
| `=CSCH(710)` | `8.95257245135026E-309` |
| `=SECH(710)` | `8.95257245135026E-309` |
| `=FACT(.5)` | `0.886226925452758` |
| `=FACT(-.5)` | `1.772453850905516` |
| `=HYPOT(1e308,1e308)` | `1.4142135623730951E+308` |
| `=SIN(1e-20)` | `1E-20` |
| `=SIN(1e100)` | `-0.3806377310050287` |
| `=SIN(1e308)` | `0.4533964905016491` |
| `=COS(1e-20)` | `1` |
| `=COS(1e100)` | `0.9247242387519338` |
| `=COS(1e308)` | `-0.8913089376870335` |
| `=TAN(1e-20)` | `1E-20` |
| `=TAN(1e100)` | `-0.4116229628832498` |
| `=TAN(1e308)` | `-0.5086861259107568` |
| `=ASIN(.9999999999999999)` | `1.5707963118937354` |
| `=ASIN(1e-300)` | `1E-300` |
| `=ASIN(-1)` | `-1.5707963267948966` |
| `=ACOS(.9999999999999999)` | `1.4901161193847656E-08` |
| `=ACOS(-.9999999999999999)` | `3.141592638688632` |
| `=ATAN(1e-300)` | `1E-300` |
| `=ATAN(1e308)` | `1.5707963267948966` |
| `=ACOT(1e-300)` | `1.5707963267948966` |
| `=ACOT(-1e-300)` | `-1.5707963267948966` |
| `=ACOT(-1)` | `-0.7853981633974483` |
| `=SINH(1e-300)` | `1E-300` |
| `=SINH(710)` | `1.1169973830808557E+308` |
| `=SINH(711)` | `#NUM!` |
| `=COSH(1e-20)` | `1` |
| `=COSH(710)` | `1.1169973830808557E+308` |
| `=COSH(711)` | `#NUM!` |
| `=TANH(1e-300)` | `1E-300` |
| `=TANH(20)` | `1` |
| `=ASINH(1e-300)` | `1E-300` |
| `=ASINH(1e308)` | `709.889355822726` |
| `=ACOSH(1.0000000000000002)` | `2.1073424255447017E-08` |
| `=ACOSH(1e308)` | `709.889355822726` |
| `=ATANH(.9999999999999999)` | `18.714973875118524` |
| `=ATANH(-1)` | `#NUM!` |
| `=ATANH(1e-300)` | `1E-300` |
| `=ACOTH(1.0000000000000002)` | `18.36840028483855` |
| `=ACOTH(1e308)` | `1E-308` |
| `=ACOTH(1)` | `#NUM!` |
| `=SEC(1e100)` | `1.0814034693733812` |
| `=SEC(1e308)` | `-1.1219454419418504` |
| `=CSC(1e-300)` | `9.999999999999999E+299` |
| `=CSC(1e100)` | `-2.62716992705799` |
| `=CSC(0)` | `#NUM!` |
| `=COT(1e-300)` | `9.999999999999999E+299` |
| `=COT(1e100)` | `-2.4294077108706733` |
| `=COT(0)` | `#NUM!` |
| `=SECH(711)` | `0` |
| `=CSCH(711)` | `0` |
| `=CSCH(0)` | `#NUM!` |
| `=COTH(1e-300)` | `9.999999999999999E+299` |
| `=COTH(20)` | `1` |
| `=COTH(0)` | `#NUM!` |
| `=EXP(1e-20)` | `1` |
| `=EXP(709)` | `8.218407461554972E+307` |
| `=EXP(-744)` | `1E-323` |
| `=EXP(-746)` | `0` |
| `=EXPM1(1e-20)` | `1E-20` |
| `=EXPM1(-1e-20)` | `-1E-20` |
| `=EXPM1(-746)` | `-1` |
| `=EXPM1(709)` | `8.218407461554972E+307` |
| `=LN(1.0000000000000002)` | `2.2204460492503128E-16` |
| `=LN(1e-300)` | `-690.7755278982137` |
| `=LN1P(1e-20)` | `1E-20` |
| `=LN1P(-1e-20)` | `-1E-20` |
| `=LN1P(-.9999999999999999)` | `-36.7368005696771` |
| `=LOG10(1.0000000000000002)` | `9.64327466553287E-17` |
| `=LOG10(1e-300)` | `-300` |
| `=LOG2(1.0000000000000002)` | `3.203426503814917E-16` |
| `=LOG2(1e-300)` | `-996.5784284662087` |
| `=SQRT(5e-324)` | `2.2227587494850775E-162` |
| `=SQRT(1e308)` | `1E+154` |
| `=SQRTPI(1e308)` | `#NUM!` |
| `=SQRTPI(1e-310)` | `1.7724538509055196E-155` |
| `=DEGREES(1e308)` | `#NUM!` |
| `=DEGREES(1e-310)` | `5.729577951308214E-309` |
| `=RADIANS(1e308)` | `#NUM!` |
| `=RADIANS(1e-310)` | `1.745329251995E-312` |
| `=GD(1e-300)` | `1E-300` |
| `=GD(100)` | `1.5707963267948966` |
| `=SINPI(-.25)` | `-0.7071067811865476` |
| `=SINPI(1000000000000001.5)` | `-1` |
| `=COSPI(-.25)` | `0.7071067811865476` |
| `=COSPI(1000000000000001.5)` | `0` |
| `=TANPI(-.25)` | `-1` |
| `=TANPI(1e-20)` | `3.141592653589793E-20` |
| `=TANPI(1000000000000001.5)` | `#NUM!` |
| `=COTPI(-.25)` | `-1` |
| `=COTPI(1e-20)` | `3.183098861837907E+19` |
| `=COTPI(1000000000000001.5)` | `0` |
| `=COMBINA(0,0)` | `#NUM!` |
| `=COMBINA(0,1)` | `#NUM!` |
| `=HYPOT(1e308,1e308,1e308)` | `#NUM!` |
| `=HYPOT(1e-300,1e-300,1e-300)` | `0` |
| `=GCD(-5e-324,2)` | `2` |
| `=ATAN2(1e308,1e308)` | `0.7853981633974483` |
| `=LOG(1.0000000000000002,1.0000000000000004)` | `0.5000000000000001` |
| `=POWER(1e308,1,2)` | `1E+154` |
| `=FACT(23)` | `2.585201673888498E+22` |
| `=FACT(170)` | `7.257415615307999E+306` |
| `=FACTDOUBLE(300)` | `8.154414069380594E+307` |
| `=HYPOT(1e-300,1e-300)` | `1.414213562373095E-300` |
| `=HYPOT(3,4,12)` | `13` |
| `=AGM(1e-300,1e300)` | `#NUM!` |
| `=AGM(1e308,1e308)` | `1E+308` |
