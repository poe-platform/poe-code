# Independent complex scientific review

The pinned oracle is released Gnumeric 1.12.61 on the aarch64 dependency/plugin/locale profile in `numeric-native-profile.json`. The official source archive SHA-256 is `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. Source and native QA artifacts were isolated under `out`; neither the unit tests nor the product spawn the oracle.

## Validated repairs

Original small in-memory regressions demonstrated missing upper incomplete-gamma asymptotics, negative-real continuation, factorial operation-order differences, and cancellation near the positive gamma mean. The implementation now follows the released upper asymptotic recurrence and continuation, uses `gamma(z) * z` for complex factorial, mirrors the released denormalized-lower fixup marker behavior, applies a cancellation-resistant positive prefactor with compensated series summation, and computes tiny shape-one tails through `expm1`. Exact `IGAMMA(1000,1000)` now gives `0.5042052441802155`; `IGAMMA(1,1e-20)` gives `1E-20`.

The shared complex power kernel supplies deliberate guard-precision arithmetic and cancellation ticks. The native ARM library's `go_complex_mul` disassembly confirms `fmul` followed by `fnmsub` for the real coordinate and `fmadd` for the imaginary coordinate; these are single-rounding operations. Five exact native field regressions were added before the shared arithmetic integration. Their final result is reported below.

## Source fact authentication

The thirteen numerator and thirteen denominator coefficients of the released rational Lanczos approximation were extracted in isolated QA through GCC `-O2` and compared with the TypeScript AST literals: all 26 binary64 values matched. The Lanczos shift `808618867 / 134217728` is an exactly representable binary rational. The source `src/sf-gamma.c` SHA-256 is `c547063bd22c65e923ab6771e739549e36d3d26905d2be4c2f736aff964be4f0`; the extracted coefficient QA C SHA-256 is `5efab53cd1067f12bc55f85660ee138d80096eecb8444ee819223c052d753097`.

Relevant released source descriptors are `src/sf-gamma.c` (Lanczos 1216–1294, factorial1297, lower continued fraction1431, upper asymptotic1446, real continuation1499, final fixups1531), `plugins/fn-complex/functions.c` (second-argument complex unit selection1120), and `plugins/fn-math/functions.c` (real/imaginary `IGAMMA` selection1101). Positive-shape statistical gamma in `src/mathfunc.c` also has dedicated Poisson asymptotics; the implemented positive series is measured here only for the captured cases, not claimed equivalent for all extreme shapes.

## Independent high-precision references

Isolated mpmath 1.3.0 calculations at 100 decimal digits provide mathematical references. These are separate from the released binary64 operation order and formatting oracle:

- upperRegularized: `(-0.000000000000000000000361022580057267805696531388076101242105086642919384927377480526835437666343567386353234847939830314 - 0.00000000000000000000003326553293976446905959319154240375009637822745409731740047949849522723023323858022421406955468756437j)`
- negativeRealLowerRegularized: `(0.0 + 417947233357151804674.5751194836982686183371572420402962367687626566385507178676993173171329090971369j)`
- complexFactorial: `(0.6529654964201667278386462479460846971488426196669750231585232317973191019271204735208458707621336522 + 0.3430658398165453575887359869783114867570833155083251626267626781995974989448433954949431378032075107j)`
- largePositiveLower: `0.504205244180215508503777843602118799189241188704881710672303005919871901184466451338377709719846312`
- smallPositiveLower: `0.000000000000000000009999999999999999999950000000000000000000166666666666666666666250000000000000000000833333333333333333`

## Native observations

Each formula ran in an isolated original single-cell workbook under `LC_ALL=C`, `TZ=UTC`, `GSETTINGS_BACKEND=memory`, and the captured schema directory. A clean pass requires status zero, empty diagnostics, and an exact rendered field match. The diagnostic row is excluded from clean passes even when its field matches. This cohort covers arguments, units, poles, lower/upper and normalized/unnormalized flags, small tails, and a positive-shape mean; unmeasured domains are not passes.

The original captured comparison had 14/21 clean exact fields and seven mismatches. After the shared fused arithmetic repair, **21/21 clean fields match exactly**; one diagnostic row remains excluded. All 28 focused original and independent unit cases pass, including five exact-field regressions that failed before the repair.

| Formula | Released field | JavaScript field | Outcome |
| --- | --- | --- | --- |
| `=IMIGAMMA("1+i","50+i",FALSE,TRUE)` | `-3.6102258005726786E-22-3.326553293976447E-23i` | `-3.6102258005726786E-22-3.326553293976447E-23i` | match |
| `=IMIGAMMA("1+i","50+i",TRUE,TRUE)` | `1+3.326553293976447E-23i` | `1+3.326553293976447E-23i` | match |
| `=IMIGAMMA(0.5,-50,TRUE,TRUE)` | `4.179472333571517E+20i` | `4.179472333571517E+20i` | match |
| `=IGAMMA(0.5,-50,TRUE,TRUE,FALSE)` | `4.179472333571517E+20` | `4.179472333571517E+20` | match |
| `=IMIGAMMA("1+j","2+i",TRUE,FALSE)` | `#NUM!` | `#NUM!` | match |
| `=IMIGAMMA("1+i",0)` | `#NUM!` | `#NUM!` | diagnostics, excluded |
| `=IMFACT("1+i")` | `0.6529654964201668+0.3430658398165455i` | `0.6529654964201668+0.3430658398165455i` | match |
| `=IMGAMMA("-1+i")` | `-0.17153291990827269+0.3264827482100833i` | `-0.17153291990827269+0.3264827482100833i` | match |
| `=IMGAMMA(0)` | `#NUM!` | `#NUM!` | match |
| `=IMFACT(-1)` | `#NUM!` | `#NUM!` | match |
| `=IGAMMA(-1,1,TRUE,FALSE)` | `#NUM!` | `#NUM!` | match |
| `=IGAMMA(-1,1,FALSE,FALSE)` | `#NUM!` | `#NUM!` | match |
| `=IGAMMA(2,0,TRUE,FALSE)` | `0` | `0` | match |
| `=IGAMMA(2,0,FALSE,FALSE)` | `1` | `1` | match |
| `=IGAMMA(1000,1000)` | `0.5042052441802155` | `0.5042052441802155` | match |
| `=IGAMMA(1,1e-20)` | `1E-20` | `1E-20` | match |
| `=IMIGAMMA("1+j","50+i",FALSE,TRUE)` | `-3.6102258005726786E-22-3.326553293976447E-23i` | `-3.6102258005726786E-22-3.326553293976447E-23i` | match |
| `=IMIGAMMA("1+i","50+j",FALSE,TRUE)` | `-3.6102258005726786E-22-3.326553293976447E-23j` | `-3.6102258005726786E-22-3.326553293976447E-23j` | match |
| `=IMIGAMMA("1+i","50+i",TRUE,FALSE)` | `1-3.9373630180640355E-23i` | `1-3.9373630180640355E-23i` | match |
| `=IGAMMA(0,0)` | `1` | `1` | match |
| `=IGAMMA(1,1e-20,FALSE,TRUE)` | `1` | `1` | match |
| `=IGAMMA(1000,1000,FALSE,TRUE)` | `0.4957947558197845` | `0.4957947558197845` | match |

`IMIGAMMA("1+i",0)` emitted four native critical messages `go_quad_agm_internal: assertion 'SUFFIX(fabs) (x->h) <= 1' failed`, despite exit status zero and `#NUM!` output. Exact diagnostic propagation is owned by the shared command layer; this numerical cohort does not count it as a clean field pass.

Scoped ESLint passed for the repaired complex scientific implementation and independent cases. Subsequent shared-arithmetic checks passed 27 matrix cases, 27 engineering independent cases, 252 numeric cases, and the descriptor inventories. Root owns the maintained uncached package/workspace build, test, lint, and integration gates. Owned temporary fixtures, extraction executables, and replay output were purged after durable evidence was recorded.
