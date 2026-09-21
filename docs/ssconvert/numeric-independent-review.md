# Independent numeric implementation review

Reviewed floating-point, number-theory, and engineering radix implementations on 2026-09-19. This is executed evidence, not a QA procedure. The separate native oracle profile is captured in [numeric-native-profile.json](numeric-native-profile.json); it is not equivalent to historical oracle captures.

## Validated repairs

Original failing in-memory cases reproduced four defects before repairs: DECIMAL with radix 10 incorrectly accepted general numeric strings and rejected the empty string; FLT.NEXTAFTER rejected boolean directions; hexadecimal strings rejected the 0x prefix accepted by upstream g_ascii_strtoll; and BASE outside its destination's ten-digit complement embedded a minus sign instead of the captured ARM64 oracle's zeros. The latter is a profile-specific float-to-unsigned conversion behavior, not a portable C guarantee.

Source evidence: Gnumeric plugins/fn-eng/functions.c val_to_base flags, calls, and guint64 conversion; plugins/fn-flt/functions.c VALUE_IS_NUMBER direction handling; plugins/fn-numtheory/numtheory.c floor versus fake-floor and unsigned shift paths. GOffice 0.10.61 go-math.c confirms one-ulp fake-floor grace and unchanged zero/infinity handling. Binary64 adjacency has an independent exact bit-representation boundary check for signed zero and subnormal-normal transitions. BigInt bit-shift cases establish wrap at 64 bits without JavaScript's 32-bit bitwise operators.

## Executed results

The 24 independent unit cases and 52 original numeric unit cases passed (76 total), using no native processes, disk writes, or external capabilities. The follow-up added two original failing cases for string booleans produced by general format matching; DEC2BIN("TRUE") and BASE("FALSE",2) must return #VALUE!, as confirmed by clean native QA. Scoped ESLint of the repaired implementation files and independent test passed. Root owns maintained package build/typecheck and integration checks.

Two native XML-to-CSV runs used original small fixtures in the owned container's /out. Both exited 0 with empty stdout/stderr after enabling the captured memory GSettings backend. Default-backend exploratory listing emitted GOConf critical messages and was not accepted as clean evidence. The JavaScript workbook recalculation engine plus native-style value rendering matched all 32 measured outputs below. Temporary fixtures and run output were purged after inspection; durable evidence is this table and the captured profile.

| Formula | Native CSV field / JavaScript rendered value | Result |
| --- | --- | --- |
| `=DECIMAL("",10)` | `0` | match |
| `=DECIMAL("1.5",10)` | `#NUM!` | match |
| `=DECIMAL(" 23",10)` | `#NUM!` | match |
| `=DECIMAL("00000000001",10)` | `#NUM!` | match |
| `=DECIMAL(23.7,10)` | `23` | match |
| `=BITLSHIFT(3,63)` | `9.223372036854776E+18` | match |
| `=BITRSHIFT(3,-63)` | `9.223372036854776E+18` | match |
| `=BITLSHIFT(3,-0.1)` | `1` | match |
| `=BITOR("ignored",FALSE)` | `0` | match |
| `=BITAND("ignored")` | `#VALUE!` | match |
| `=NT_PHI(1)` | `1` | match |
| `=NT_D(2.9999999999999996)` | `2` | match |
| `=ISPRIME(-1)` | `FALSE` | match |
| `=BITOR(0.9999999999999999)` | `1` | match |
| `=BIN2DEC(0.9999999999999999)` | `1` | match |
| `=BASE(-4503599627370496,2)` | `0000000000` | match |
| `=BASE(4503599627370496,2)` | `10000000000000000000000000000000000000000000000000000` | match |
| `=BASE(-4503599627370496,16)` | `0000000000` | match |
| `=BASE(3,"2.9")` | `11` | match |
| `=DEC2BIN(-1,"3")` | `1111111111` | match |
| `=DECIMAL("1e2",10)` | `#NUM!` | match |
| `=FLT.NEXTAFTER(1,TRUE)` | `1` | match |
| `=FLT.NEXTAFTER(1,0)` | `0.9999999999999999` | match |
| `=NT_PI(0)` | `0` | match |
| `=NT_MU(1)` | `1` | match |
| `=BASE(-1025,2)` | `0000000000` | match |
| `=BASE(-1099511627777,16)` | `0000000000` | match |
| `=BASE(-1048577,4)` | `0000000000` | match |
| `=FLT.NEXTAFTER(1,FALSE)` | `0.9999999999999999` | match |
| `=FLT.NEXTAFTER(1,A3)` | `#VALUE!` | match |
| `=HEX2DEC("0xF")` | `15` | match |
| `=BASE(4503599627370496,36)` | `18CE53UN18G` | match |

## Limits and remaining measurements

## Bit collection follow-up and fixed descriptor review

Three original failing cases reproduced BITAND/BITOR/BITXOR returning a domain error before a later argument's cell error. Native float_range_function collects argument errors before the bitwise reducer validates domains. Domain failure is now retained until collection completes, preserving the first encountered cell error. Six follow-up native observations exited 0 with empty stdout/stderr: BITAND(-1,1/0) -> #DIV/0!; BITOR(-1,NA()) -> #N/A; BITXOR(4503599627370497,1/0) -> #DIV/0!; the corresponding invalid-domain calls with a trailing ignored string each -> #VALUE!. All six original in-memory regressions pass after repair.

The released inventory still authenticates every one of the 190 source descriptors. Of those, 170 have fixed signatures. Excess/missing-argument checks use the actual shared registry and reject arguments before evaluation. The initial measurement covered 165 fixed kernels and explicitly skipped five unsupported/unmeasured kernels. A subsequent run covered 169 fixed kernels after complex scientific registration; REDUCEPI alone remained explicitly skipped/unmeasured. The test discovers availability and measures kernels automatically when registered. Variadic signatures are outside fixed-arity observations. The final follow-up covers all 170 registered fixed kernels, including REDUCEPI, with no skipped fixed-arity observations. Functional numeric cases total 30 independent plus 52 original (82); the 170 additional fixed-arity observations are separate from numerical parity. The final three scoped suites reported 253 passes and no skipped observations, including the separate complete descriptor inventory check. Scoped ESLint passed for the bit implementation and independent tests.

No remaining mismatch was found in these 32 measured cases. This does not establish complete group parity. Date/currency/locale numeric matching, every ten-character prefix boundary, logarithmic output-length rounding at all integer powers, all overflow architectures, very high ITHPRIME/NT_PI work, worst-case factorization within host budgets, and all multiplicative-function rounding paths are unmeasured. Native formatting here is field formatting only, not complete CSV/CLI diagnostics or namespace acceptance. The broader engineering scientific functions and fn-math/fn-complex were outside this review's ownership. Unsupported/unmeasured cases are not counted as passes.
