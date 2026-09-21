# Independent complex implementation review

Executed 2026-09-19 against the live working tree by an agent distinct from the initial complex implementation author. This is evidence, not a QA procedure; procedures belong in `docs/plans`.

Reference: [numeric-native-profile.json](numeric-native-profile.json), ARM64 Gnumeric 1.12.61/GOffice 0.10.61, pinned official source SHA-256 `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. The profile captures plugin/dependency/binary hashes and locale. Isolated source and original native XML fixtures remained in `out`; native ssconvert is a separate oracle only. Execution used `/out/prefix/bin/ssconvert`, `LD_LIBRARY_PATH=/out/prefix/lib`, `LC_ALL=C`, `TZ=UTC`, `GSETTINGS_BACKEND=memory`, and the prefix schema directory.

## Validated repairs

Original failing canonical cases reproduced current defects before each repair. The initial native cohort had 31 mismatches among 70 cases. Canonical units never spawn native processes, query external capabilities, or write files.

- Parsing follows primary Gnumeric src/complex.c rather than GOffice's different parser: Unicode separator whitespace, rejection of BOM as whitespace, outer sign followed by a strto sign, string subnormal/range failures, and source zero-sign subtraction semantics. Numeric and boolean arguments retain their separate path; IMREAL(TRUE) returns the original boolean. Numeric inputs can represent subnormals even though ordinary decimal strings trigger native ERANGE.
- Hull crossover formulas and explicit real branch cuts replace naive complex inverse formulas. Tiny real parts survive inverse hyperbolic cancellation; native overflow behavior is retained, including IMARCTAN(1e308+i), whose native result differs from the mathematical high-precision reference.
- Tangent and hyperbolic tangent use upstream stable formulas rather than dividing overflowing sine/cosine pairs. Huge imaginary tangent and huge real tanh/coth converge to finite results.
- Division follows primary GOffice power-of-two scaling and special real/pure-imaginary denominators. Explicit product-residual evaluation preserves the captured ARM64 fused-expression residuals, including native imaginary residue in IMDIV(z,z). This is profile-specific native numerical behavior; its mathematically exact imaginary component is zero.
- Square root follows upstream polar/pi reduction and negative-axis transformation, repairing large-component rounding without intermediate overflow.
- Logarithm scales multiply by upstream reciprocals; the deliberately rounded inverse-log(10) constant differs from computing 1/Math.LN10 in JavaScript.
- Power emits the second argument's unit, handles nonnegative real bases through real power, and reduces fractional real exponent phases in pi units. Exact quarter turns match native constants.
- Reciprocal inverse functions use the GSL product sequence and captured native hypot evaluation; the separate GOffice complex division path remains distinct. Captured FMA ordering is explicit in source compound square expressions.

Primary files inspected: Gnumeric src/complex.c, src/complex.h, src/sf-trig.c, plugins/fn-complex/functions.c, plugins/fn-complex/gsl-complex.c, and GOffice goffice/math/go-complex.c. Internal complex kernel exports were added for root-owned scientific composition; the public SDK/export surface remains root-owned.

## Executed results and limits

56 independent canonical cases plus 37 original cases passed (93 total). Scoped ESLint passed for complex.ts and complex-independent-review.test.ts. Root owns final maintained uncached package build/test/lint and integration checks.

The final first isolated cohort matched 70/70 native fields. The broader elementary cohort initially matched 69/99, then 92/99, and finally 99/99 after deliberate numerical repairs. The original seven residuals below are resolved. A new 35-case power extreme cohort initially had nine mismatches and finally matched 35/35. Five additional multiplication cases finally matched 5/5. No measured mismatch remains in these current cohorts. Matching does not imply all-input compatibility. Comparisons use the actual workbook SDK calculation engine: complex string fields compare exactly; real and boolean fields compare parsed native values. This does not prove complete CLI output-byte formatting, command diagnostics, arity, VFS effects, cancellation, or whole-profile portability.

Unmeasured scope includes complete binary64 accuracy/extreme ranges, every Unicode/strto errno edge, all branch-adjacent inputs, fused-expression tie/subnormal cases, complex special/scientific functions owned separately, all collection/range semantics, and command-level interactions. The product has no native fallback. Unsupported or unmeasured cases are not passes.

Independent mpmath 1.3.0 at 100 decimal digits checks mathematical branches, cancellation, overflow-safe limiting behavior, square root, reciprocal, and complex power. It deliberately does not replace source-specific native results:

- `asin(2)`: `(1.5707963267948966192313216916397514420985846996875529104874722961539082031431045 - 1.316957896924816708625046347307968444026981971467516479768472256920460185416444j)`
- `atanh(2)`: `(0.54930614433405484569762261846126285232374527891137472586734716681874714660930448 - 1.5707963267948966192313216916397514420985846996875529104874722961539082031431045j)`
- `asin(1+i)`: `(0.66623943249251525510400489597779272066749013872594784283147384280397898937905928 + 1.0612750619050356520330189162135734858067854989386336963972102815128608617116421j)`
- `asinh(1e-20+i)`: `(0.00000000010000000000000000000008333333333333333333314583333333333333333277529761904761905 + 1.5707963266948966192313216916398347754319180330208864313208056294872415359184021j)`
- `atan(1e308+i)`: `(1.5707963267948966192313216916397514420985846996875529104874722961539082031431045 + 0.0j)`
- `tan(1+1000i)`: `(4.6856748788152697691450504333010982561299694894317744051195276247940482519237778e-869 + 1.0j)`
- `sqrt(1e308+1e308i)`: `(1.0986841134678099660398011952406783785443931209271577437444115788428750535552848e+154 + 4.5508986056222734130435775782246856962019037848315009258825956949080020323344829e+153j)`
- `power(1+i,.5+.5i)`: `(0.67777250524043462766295689664296444219833891668348741045343682629021253091434746 + 0.43060227011683753278117282891354284463265304228149618246137648758624205655785415j)`
- `reciprocal(-2-.25i)`: `(-0.49230769230769230769230769230769230769230769230769230769230769230769230769230769 + 0.061538461538461538461538461538461538461538461538461538461538461538461538461538462j)`

## Historical seven residuals, now resolved

| Formula | Native field | Engine field before final repair |
| --- | --- | --- |
| `=IMARCSEC(".5+.25j")` | `0.5352384153948206+1.2321615351709956j` | `0.5352384153948206+1.2321615351709958j` |
| `=IMARCCSC(".5+.25j")` | `1.0355579114000761-1.2321615351709956j` | `1.0355579114000761-1.2321615351709958j` |
| `=IMARCCOT(".5+.25j")` | `1.0865418364649302-0.20058661813123432j` | `1.0865418364649304-0.20058661813123432j` |
| `=IMARCCOT("-2-.25i")` | `-0.4586849928070674+0.049544232145937186i` | `-0.45868499280706737+0.049544232145937186i` |
| `=IMARCSECH(".5+.25j")` | `1.2321615351709956-0.5352384153948206j` | `1.2321615351709958-0.5352384153948206j` |
| `=IMARCCOTH(".5+.25j")` | `0.500370000052531-1.25639818358718j` | `0.5003700000525311-1.25639818358718j` |
| `=IMPOWER("1+i",".5+.5j")` | `0.6777725052404346+0.43060227011683755j` | `0.6777725052404345+0.4306022701168375j` |

## Final numerical repairs

The captured ARM64 glibc hypot profile is intentionally not always correctly rounded: independent mpmath confirmed some native norm intermediates are one ulp below the nearest mathematical result. A separate source/reference capture of glibc2.41 hypot and native C intermediate observations identified the norm identity and fused evaluation order. Invocation-local binary scaling plus sqrt(fma(2*min,max,(max-min)^2)) or sqrt(fma(max,max,min^2)) reproduce these measured intermediates without a native dependency. The reference primary source stayed in out; no library implementation was vendored.

An original bounded BigInt fixed-binary kernel calculates atan, log, exp, sine and cosine with guard precision before final rounding. Correctly rounded atan2 fixes the remaining arc-cotangent case. All series/Newton loops are bounded and charged to the injected host work/cancellation hook; no shared arithmetic buffers or caches exist. The shared power kernel is internally exported for scientific composition. It uses the independently verified 2048-bit pi constant rather than a duplicated decimal approximation.

Power normalizes the radius before its logarithm, preserves negative extreme-exponent underflow, and retains the upstream double-double phase division/quantization sequence before turn reduction. This preserves native loss of tiny corrections near the imaginary axis and exact quarter-turn zeros, rather than inventing spurious residual components. The source fractional-power sqrt1pm1 intermediate overflow remains #NUM! even where the exact mathematical result is finite. The robust shared exact BigInt FMA primitive replaces the earlier splitter estimate; complex multiplication follows independently confirmed native ARM64 fused instruction ordering. All previously recorded residuals have strict exact canonical expectations; assertions/tolerances/timeouts were not weakened.

These remain sampled profile checks, not an exhaustive proof over all binary64 inputs. The numerical algorithm's whole-domain accuracy, every upstream double-double rounding detail, and all rare phase/error boundaries remain unmeasured beyond the explicit cohort. Root owns broader build/test/integration verification.

## Complete final measured cohort

208 distinct original formula inputs, with overlapping cohort inputs retained in each cohort count. Every native field matched the final engine numeric/error/string/boolean result.

| Formula | Native field | Result |
| --- | --- | --- |
| `=IMREAL(" 2 + 3 i ")` | `2` | match |
| `=IMREAL("2+3i")` | `#NUM!` | match |
| `=IMREAL("2+﻿3i")` | `#NUM!` | match |
| `=IMREAL("--2")` | `2` | match |
| `=IMREAL("2+-3i")` | `2` | match |
| `=IMREAL("0x1p2+0x1p1i")` | `#NUM!` | match |
| `=IMREAL("1e-310+i")` | `#NUM!` | match |
| `=IMREAL("1e-400+i")` | `#NUM!` | match |
| `=IMREAL(TRUE)` | `TRUE` | match |
| `=IMSUM(TRUE,"j")` | `1+j` | match |
| `=IMSUM("j",2)` | `2+j` | match |
| `=IMSUB("j",2)` | `-2+i` | match |
| `=IMDIV("j",2)` | `0.5i` | match |
| `=IMPOWER("j",2)` | `-1` | match |
| `=IMPOWER("j",3)` | `-i` | match |
| `=IMPOWER(0,2)` | `0` | match |
| `=IMPOWER(0,-1)` | `#NUM!` | match |
| `=IMINV(0)` | `#NUM!` | match |
| `=IMARGUMENT(0)` | `0` | match |
| `=IMLN(0)` | `#NUM!` | match |
| `=IMREAL("inf+i")` | `#NUM!` | match |
| `=IMREAL("nan+i")` | `#NUM!` | match |
| `=IMARCSIN("2")` | `1.5707963267948966-1.3169578969248166i` | match |
| `=IMARCSIN("-2")` | `-1.5707963267948966+1.3169578969248166i` | match |
| `=IMARCSIN("1+i")` | `0.6662394324925152+1.0612750619050357i` | match |
| `=IMARCSIN("1e-20+i")` | `7.071067811865475E-21+0.881373587019543i` | match |
| `=IMARCSIN("1e308+i")` | `#NUM!` | match |
| `=IMARCCOS("2")` | `1.3169578969248166i` | match |
| `=IMARCCOS("-2")` | `3.141592653589793-1.3169578969248166i` | match |
| `=IMARCCOS("1+i")` | `0.9045568943023814-1.0612750619050357i` | match |
| `=IMARCCOS("1e-20+i")` | `1.5707963267948966-0.881373587019543i` | match |
| `=IMARCCOS("1e308+i")` | `#NUM!` | match |
| `=IMARCTAN("2")` | `1.1071487177940904` | match |
| `=IMARCTAN("-2")` | `-1.1071487177940904` | match |
| `=IMARCTAN("1+i")` | `1.0172219678978514+0.4023594781085251i` | match |
| `=IMARCTAN("1e-20+i")` | `0.7853981633974483+23.37242452022043i` | match |
| `=IMARCTAN("1e308+i")` | `1.1780972450961724` | match |
| `=IMARCSINH("2")` | `1.4436354751788103` | match |
| `=IMARCSINH("-2")` | `-1.4436354751788103` | match |
| `=IMARCSINH("1+i")` | `1.0612750619050357+0.6662394324925152i` | match |
| `=IMARCSINH("1e-20+i")` | `1E-10+1.5707963266948965i` | match |
| `=IMARCSINH("1e308+i")` | `#NUM!` | match |
| `=IMARCCOSH("2")` | `1.3169578969248166` | match |
| `=IMARCCOSH("-2")` | `1.3169578969248166+3.141592653589793i` | match |
| `=IMARCCOSH("1+i")` | `1.0612750619050357+0.9045568943023814i` | match |
| `=IMARCCOSH("1e-20+i")` | `0.881373587019543+1.5707963267948966i` | match |
| `=IMARCCOSH("1e308+i")` | `#NUM!` | match |
| `=IMARCTANH("2")` | `0.5493061443340549-1.5707963267948966i` | match |
| `=IMARCTANH("-2")` | `-0.5493061443340549+1.5707963267948966i` | match |
| `=IMARCTANH("1+i")` | `0.4023594781085251+1.0172219678978514i` | match |
| `=IMARCTANH("1e-20+i")` | `5E-21+0.7853981633974483i` | match |
| `=IMARCTANH("1e308+i")` | `1.5707963267948966i` | match |
| `=IMTAN("1+1000i")` | `i` | match |
| `=IMTAN("1-1000i")` | `-i` | match |
| `=IMTANH("1000+i")` | `1` | match |
| `=IMCOT("1+1000i")` | `-i` | match |
| `=IMCOTH("1000+i")` | `1` | match |
| `=IMSEC("1+1000i")` | `#NUM!` | match |
| `=IMSECH("1000+i")` | `#NUM!` | match |
| `=IMDIV("1e308+1e308i","1e308+1e308i")` | `1-1.8408708050260598E-17i` | match |
| `=IMDIV("1e-300+1e-300i","1e-300+1e-300i")` | `1+1.4239941048649493E-17i` | match |
| `=IMDIV("1e308+1e308i",".9+.9i")` | `1.1111111111111112E+308-1.0933546727278559E+291i` | match |
| `=IMPRODUCT("1e308+i","1+i")` | `1E+308+1E+308i` | match |
| `=IMLN("1e308+1e308i")` | `709.542782232446+0.7853981633974483i` | match |
| `=IMSQRT("1e308+1e308i")` | `1.09868411346781E+154+4.5508986056222734E+153i` | match |
| `=COMPLEX(1e-7,1e20)` | `1E-07+1E+20i` | match |
| `=COMPLEX(1e-5,1e21)` | `1E-05+1E+21i` | match |
| `=IMEXP("1+i")` | `1.4686939399158851+2.2873552871788423i` | match |
| `=IMSIN("1+i")` | `1.2984575814159773+0.6349639147847361i` | match |
| `=IMCOS("1+i")` | `0.8337300251311491-0.9888977057628651i` | match |
| `=IMLN(".5+.25j")` | `-0.5815754049028404+0.4636476090008061j` | match |
| `=IMLN("-2-.25i")` | `0.7008992738279279-3.017237659043032i` | match |
| `=IMLN("1e-20+1e-20i")` | `-45.70512826960094+0.7853981633974483i` | match |
| `=IMLOG2(".5+.25j")` | `-0.8390359525563188+0.6689021062254881j` | match |
| `=IMLOG2("-2-.25i")` | `1.0111839065142272-4.352953807884807i` | match |
| `=IMLOG2("1e-20+1e-20i")` | `-65.93856189774725+1.1330900354567983i` | match |
| `=IMLOG10(".5+.25j")` | `-0.25257498915995297+0.20135959813668655j` | match |
| `=IMLOG10("-2-.25i")` | `0.3043966869934654-1.310369665913074i` | match |
| `=IMLOG10("1e-20+1e-20i")` | `-19.84948500216801+0.3410940884604603i` | match |
| `=IMEXP(".5+.25j")` | `1.5974665191199127+0.4079001700783598j` | match |
| `=IMEXP("-2-.25i")` | `0.13112803702368245-0.03348248489957025i` | match |
| `=IMEXP("1e-20+1e-20i")` | `1+1E-20i` | match |
| `=IMSQRT(".5+.25j")` | `0.7276733451126774+0.17178037486125622j` | match |
| `=IMSQRT("-2-.25i")` | `0.08821688351624482-1.4169623207895539i` | match |
| `=IMSQRT("1e-20+1e-20i")` | `1.09868411346781E-10+4.550898605622273E-11i` | match |
| `=IMSIN(".5+.25j")` | `0.494485780933195+0.22168816414957482j` | match |
| `=IMSIN("-2-.25i")` | `-0.9378612777147958+0.10512381651256378i` | match |
| `=IMSIN("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMCOS(".5+.25j")` | `0.9051501505596068-0.12110879604381165j` | match |
| `=IMCOS("-2-.25i")` | `-0.4292192986881662-0.22969972965814137i` | match |
| `=IMCOS("1e-20+1e-20i")` | `1-1E-40i` | match |
| `=IMTAN(".5+.25j")` | `0.504500702698564+0.3124206925025888j` | match |
| `=IMTAN("-2-.25i")` | `1.5966892107707558-1.0993981352117788i` | match |
| `=IMTAN("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMSEC(".5+.25j")` | `1.085358604751614+0.14522062866143562j` | match |
| `=IMSEC("-2-.25i")` | `-1.811119354174798+0.9692332737694965i` | match |
| `=IMSEC("1e-20+1e-20i")` | `1+1E-40i` | match |
| `=IMCSC(".5+.25j")` | `1.683861268215723-0.7549097014050444j` | match |
| `=IMCSC("-2-.25i")` | `-1.0530256453589317-0.11803246104313495i` | match |
| `=IMCSC("1e-20+1e-20i")` | `5E+19-5E+19i` | match |
| `=IMCOT(".5+.25j")` | `1.4327210753879938-0.8872370407840958j` | match |
| `=IMCOT("-2-.25i")` | `0.4248669046091212+0.2925415162134092i` | match |
| `=IMCOT("1e-20+1e-20i")` | `5E+19-5E+19i` | match |
| `=IMSINH(".5+.25j")` | `0.504895714387995+0.2789791283502615j` | match |
| `=IMSINH("-2-.25i")` | `-3.514110100973512-0.9307821094643965i` | match |
| `=IMSINH("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMCOSH(".5+.25j")` | `1.0925708047319176+0.12892104172809826j` | match |
| `=IMCOSH("-2-.25i")` | `3.645238137997194+0.8972996245648264i` | match |
| `=IMCOSH("1e-20+1e-20i")` | `1+1E-40i` | match |
| `=IMTANH(".5+.25j")` | `0.4854872810241353+0.19805544995134955j` | match |
| `=IMTANH("-2-.25i")` | `-0.968214572183509-0.017009461384601497i` | match |
| `=IMTANH("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMSECH(".5+.25j")` | `0.9027036939453982-0.10651712464877595j` | match |
| `=IMSECH("-2-.25i")` | `0.2586576323257902-0.06367029741005555i` | match |
| `=IMSECH("1e-20+1e-20i")` | `1-1E-40i` | match |
| `=IMCSCH(".5+.25j")` | `1.51734688627714-0.8384070208472441j` | match |
| `=IMCSCH("-2-.25i")` | `-0.265911739932755+0.070432024926422i` | match |
| `=IMCSCH("1e-20+1e-20i")` | `5E+19-5E+19i` | match |
| `=IMCOTH(".5+.25j")` | `1.7658972151170622-0.7204010922182279j` | match |
| `=IMCOTH("-2-.25i")` | `-1.0325102452678891+0.018138998989121708i` | match |
| `=IMCOTH("1e-20+1e-20i")` | `5E+19-5E+19i` | match |
| `=IMARCSIN(".5+.25j")` | `0.5016088532755009+0.2813960562452928j` | match |
| `=IMARCSIN("-2-.25i")` | `-1.427924144520526-1.3287633703408077i` | match |
| `=IMARCSIN("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMARCCOS(".5+.25j")` | `1.0691874735193958-0.2813960562452928j` | match |
| `=IMARCCOS("-2-.25i")` | `2.9987204713154223+1.3287633703408077i` | match |
| `=IMARCCOS("1e-20+1e-20i")` | `1.5707963267948966-1E-20i` | match |
| `=IMARCTAN(".5+.25j")` | `0.4842544903299662+0.2005866181312343j` | match |
| `=IMARCTAN("-2-.25i")` | `-1.1121113339878292-0.049544232145937186i` | match |
| `=IMARCTAN("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMARCSINH(".5+.25j")` | `0.4926756834207706+0.22432845263466752j` | match |
| `=IMARCSINH("-2-.25i")` | `-1.4492081522551188-0.11147792536848175i` | match |
| `=IMARCSINH("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMARCCOSH(".5+.25j")` | `0.2813960562452928+1.0691874735193958j` | match |
| `=IMARCCOSH("-2-.25i")` | `1.3287633703408077-2.9987204713154223i` | match |
| `=IMARCCOSH("1e-20+1e-20i")` | `1E-20+1.5707963267948966i` | match |
| `=IMARCTANH(".5+.25j")` | `0.500370000052531+0.3143981432077165j` | match |
| `=IMARCTANH("-2-.25i")` | `-0.5358800995910896-1.489877611175685i` | match |
| `=IMARCTANH("1e-20+1e-20i")` | `1E-20+1E-20i` | match |
| `=IMARCSEC(".5+.25j")` | `0.5352384153948206+1.2321615351709956j` | match |
| `=IMARCSEC("-2-.25i")` | `2.084129843877413-0.0705849181672375i` | match |
| `=IMARCSEC("1e-20+1e-20i")` | `0.7853981633974483+46.39827545016089i` | match |
| `=IMARCCSC(".5+.25j")` | `1.0355579114000761-1.2321615351709956j` | match |
| `=IMARCCSC("-2-.25i")` | `-0.5133335170825165+0.0705849181672375i` | match |
| `=IMARCCSC("1e-20+1e-20i")` | `0.7853981633974483-46.39827545016089i` | match |
| `=IMARCCOT(".5+.25j")` | `1.0865418364649302-0.20058661813123432j` | match |
| `=IMARCCOT("-2-.25i")` | `-0.4586849928070674+0.049544232145937186i` | match |
| `=IMARCCOT("1e-20+1e-20i")` | `1.5707963267948966-1E-20i` | match |
| `=IMARCSECH(".5+.25j")` | `1.2321615351709956-0.5352384153948206j` | match |
| `=IMARCSECH("-2-.25i")` | `0.0705849181672375+2.084129843877413i` | match |
| `=IMARCSECH("1e-20+1e-20i")` | `46.39827545016089-0.7853981633974483i` | match |
| `=IMARCCSCH(".5+.25j")` | `1.3229331645947173-0.40926341563152235j` | match |
| `=IMARCCSCH("-2-.25i")` | `-0.4749952630322718+0.0552221166748876i` | match |
| `=IMARCCSCH("1e-20+1e-20i")` | `46.39827545016089-0.7853981633974483i` | match |
| `=IMARCCOTH(".5+.25j")` | `0.500370000052531-1.25639818358718j` | match |
| `=IMARCCOTH("-2-.25i")` | `-0.5358800995910896+0.08091871561921149i` | match |
| `=IMARCCOTH("1e-20+1e-20i")` | `1E-20-1.5707963267948966i` | match |
| `=IMDIV(".5+.25j",".25+.5i")` | `0.8-0.6i` | match |
| `=IMSUB("i","j")` | `0` | match |
| `=IMSUM("j",TRUE)` | `1+j` | match |
| `=IMPRODUCT("j",TRUE)` | `j` | match |
| `=IMPOWER("j",.5)` | `0.7071067811865476+0.7071067811865476i` | match |
| `=IMPOWER("1+i",".5+.5j")` | `0.6777725052404346+0.43060227011683755j` | match |
| `=IMCONJUGATE("1e21+1e-7j")` | `1E+21-1E-07j` | match |
| `=IMARGUMENT("-1-0i")` | `3.141592653589793` | match |
| `=IMARGUMENT("-1+0i")` | `3.141592653589793` | match |
| `=IMREAL("2+ 3i")` | `2` | match |
| `=IMREAL("2 + 3 i ")` | `2` | match |
| `=IMPOWER("1e-300+1e-300i",".5")` | `1.09868411346781E-150+4.5508986056222734E-151i` | match |
| `=IMPOWER("1e-300+1e-300i","-.5")` | `7.768869870150186E+149-3.217971264527913E+149i` | match |
| `=IMPOWER("1e-300+1e-300i","1+i")` | `4.121849025825564E-302+6.434750879112213E-301i` | match |
| `=IMPOWER("1e-300+1e-300i","1e308")` | `0` | match |
| `=IMPOWER("1e-300+1e-300i","1e-300")` | `1+7.853981633974484E-301i` | match |
| `=IMPOWER("5e-324i",".5")` | `#NUM!` | match |
| `=IMPOWER("5e-324i","-.5")` | `#NUM!` | match |
| `=IMPOWER("5e-324i","1+i")` | `#NUM!` | match |
| `=IMPOWER("5e-324i","1e308")` | `#NUM!` | match |
| `=IMPOWER("5e-324i","1e-300")` | `#NUM!` | match |
| `=IMPOWER("1e308+1e308i",".5")` | `1.09868411346781E+154+4.5508986056222734E+153i` | match |
| `=IMPOWER("1e308+1e308i","-.5")` | `7.768869870150187E-155-3.217971264527913E-155i` | match |
| `=IMPOWER("1e308+1e308i","1+i")` | `6.103689658455644E+307+2.0786745352300842E+307i` | match |
| `=IMPOWER("1e308+1e308i","1e308")` | `#NUM!` | match |
| `=IMPOWER("1e308+1e308i","1e-300")` | `#NUM!` | match |
| `=IMPOWER("1e-300+i",".5")` | `0.7071067811865476+0.7071067811865476i` | match |
| `=IMPOWER("1e-300+i","-.5")` | `0.7071067811865476-0.7071067811865476i` | match |
| `=IMPOWER("1e-300+i","1+i")` | `0.2078795763507619i` | match |
| `=IMPOWER("1e-300+i","1e308")` | `1` | match |
| `=IMPOWER("1e-300+i","1e-300")` | `1+1.5707963267948968E-300i` | match |
| `=IMPOWER("1+1e-300i",".5")` | `1+5E-301i` | match |
| `=IMPOWER("1+1e-300i","-.5")` | `1-5E-301i` | match |
| `=IMPOWER("1+1e-300i","1+i")` | `1+1E-300i` | match |
| `=IMPOWER("1+1e-300i","1e308")` | `-0.36338509271314534+0.9316390258001533i` | match |
| `=IMPOWER("1+1e-300i","1e-300")` | `1` | match |
| `=IMPOWER("-4",".5")` | `2i` | match |
| `=IMPOWER("-4","-.5")` | `-0.5i` | match |
| `=IMPOWER("-4","1+i")` | `-0.03171157884590387-0.16992192170060885i` | match |
| `=IMPOWER("-4","1e308")` | `#NUM!` | match |
| `=IMPOWER("-4","1e-300")` | `1+3.1415926535897936E-300i` | match |
| `=IMPOWER("i",".5")` | `0.7071067811865476+0.7071067811865476i` | match |
| `=IMPOWER("i","-.5")` | `0.7071067811865476-0.7071067811865476i` | match |
| `=IMPOWER("i","1+i")` | `0.2078795763507619i` | match |
| `=IMPOWER("i","1e308")` | `1` | match |
| `=IMPOWER("i","1e-300")` | `1+1.5707963267948968E-300i` | match |
| `=IMPRODUCT(".1+.2i",".3+.4i")` | `-0.05000000000000002+0.1i` | match |
| `=IMPRODUCT("1.0000000000000002+i","1.0000000000000002-i")` | `2.0000000000000004` | match |
| `=IMPRODUCT("1.0000000000000002+i","1.0000000000000002+i")` | `4.440892098500626E-16+2.0000000000000004i` | match |
| `=IMPOWER(".1+.2i",2)` | `-0.030000000000000006+0.04000000000000001i` | match |
| `=IMPRODUCT("1e100+1e100i","1e-100-1e-100i")` | `2-3.58947909123628E-17i` | match |
