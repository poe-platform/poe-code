# Independent engineering extra review

Executed 2026-09-19 for CONVERT, HEXREP, and INVSUMINV against the separate [native oracle profile](numeric-native-profile.json). This is measured evidence, not a QA procedure.

## Validated repairs

Four original failing conversion cases reproduced incorrect cubic Pica/Picapt factors. Upstream C evaluates each repeated multiplication left to right, producing 112265.99999999997; the initial declarative facts had 112266.00000000001. Native CONVERT confirmed the source result for all four aliases before repair.

Three further original failing cases reproduced INVSUMINV error ordering: a negative value before a later cell error returned #VALUE!, while native collection propagates the cell error before the range operation checks domain values. The implementation now delays the negative-domain result until all arguments have been collected.

## Complete declarative fact audit

All 162 facts in 14 ordered arrays (12 unit groups and the decimal/binary prefix arrays) were checked against pinned plugins/fn-eng/functions.c. Isolated QA extracted the original declarations/macros into a temporary C executable, retaining expression order; GCC 14.2.0 with -O2 compiled it with status 0 and empty diagnostics. Its decimal outputs used 17 significant digits to preserve binary64 values. Comparison with the JavaScript declarative arrays found exactly the four cubic Pica discrepancies above. After repair, every key, binary64 factor, group order, and prefix order matched.

Pinned fn-eng/functions.c SHA-256: a5d95d74ab0625dd0a83561bd9c4efc871f4958dcc4deaf05b67c9dd52c239a9. Temporary extracted fact executable source SHA-256: bac0a9d7f30ed024e158bef8e596f384d3ce7bad290a5f6325adb12cec759d18. Primary source and extracted QA material stayed in out; no native capability or facts compiler is a product dependency.

Source review also verified direct-unit matching before first matching prefix, short-circuiting on a recognized source group even when its destination fails, temperature conversion through kelvin and rejection below zero kelvin, exact arithmetic order in general conversion and reciprocal accumulation, numeric-only reciprocal collection, and HEXREP's binary-radix printf %a behavior. Upstream src/value.c value_new_float canonicalizes negative zero before HEXREP, matching the original -0 fixture's positive-zero representation.

## Executed results

27 independent unit cases and six original engineering cases passed (33 total). Tests used only original in-memory fixtures. Scoped ESLint passed for both implementation modules and the independent tests; root owns maintained build/typecheck/integration checks.

The native batch exited 0 with empty stdout/stderr under the captured C locale, UTC timezone, and memory GSettings backend. Actual JavaScript workbook recalculation and native-style field rendering matched all 28 owned native observations below.

| Formula | Native field / JavaScript rendered field | Result |
| --- | --- | --- |
| `=CONVERT(0,"m","g")` | `#NUM!` | match |
| `=CONVERT(1,"unknown","m")` | `#N/A` | match |
| `=CONVERT(1,"byte","Yibyte")` | `#NUM!` | match |
| `=CONVERT(1,"Yibyte","byte")` | `1.2089258196146292E+24` | match |
| `=CONVERT(-1,"K","K")` | `#NUM!` | match |
| `=CONVERT(-273.15,"C","K")` | `0` | match |
| `=CONVERT(1,"m","dam")` | `#NUM!` | match |
| `=CONVERT(1,"em","m")` | `10` | match |
| `=CONVERT(1,"m","m2")` | `#NUM!` | match |
| `=CONVERT(1e308,"Ym","Ym")` | `#NUM!` | match |
| `=HEXREP(FLT.NEXTAFTER(0,"+"))` | `0x0.0000000000001p-1022` | match |
| `=HEXREP(FLT.MIN()/2)` | `0x0.8p-1022` | match |
| `=HEXREP(-FLT.NEXTAFTER(0,"+"))` | `-0x0.0000000000001p-1022` | match |
| `=HEXREP(-0)` | `0x0p+0` | match |
| `=HEXREP(1/0)` | `#DIV/0!` | match |
| `=INVSUMINV()` | `#VALUE!` | match |
| `=INVSUMINV("12",TRUE)` | `#VALUE!` | match |
| `=INVSUMINV(0,-1)` | `#VALUE!` | match |
| `=INVSUMINV(1,1/0)` | `#DIV/0!` | match |
| `=INVSUMINV(1e308,1e308)` | `5E+307` | match |
| `=INVSUMINV(FLT.NEXTAFTER(0,"+"))` | `0` | match |
| `=CONVERT(1,"tsp","Pica3")` | `112265.99999999997` | match |
| `=CONVERT(1,"tsp","Pica^3")` | `112265.99999999997` | match |
| `=CONVERT(1,"tsp","Picapt3")` | `112265.99999999997` | match |
| `=CONVERT(1,"tsp","Picapt^3")` | `112265.99999999997` | match |
| `=INVSUMINV(-1,1/0)` | `#DIV/0!` | match |
| `=INVSUMINV(0,-1,1/0)` | `#DIV/0!` | match |
| `=INVSUMINV(-1,NA())` | `#N/A` | match |

## Remaining limits

No mismatch remains in these owned observations. The complete fact/order audit verifies definitions, not all combinations or numeric inputs. Other temperature cancellation boundaries, every pair/prefix combination, all formatting exponents, non-C locales, reciprocal rounding after many arguments, all matrix/range collection orders, direct injected nonfinite cells, and CLI diagnostics/namespace effects are unmeasured and are not counted as passes.

One additional observation outside this review's initial authorized source ownership found BITAND(-1,1/0): native #DIV/0! versus JavaScript #VALUE!. Root subsequently authorized a separate validated BITAND/BITOR/BITXOR collection repair; its failing regressions and final evidence are recorded in numeric-independent-review.md. This is not counted as an engineering-extra pass.

Temporary owned fixtures, run output, and fact compilation material were purged after preserving this evidence.
