# Independent numeric integration review

Reviewed the asynchronous diagnostic drain, synchronous evaluator callback, and numeric OpenFormula import/export changes against the shared engine. Runtime files remain owned by the integration author; this review reports executed evidence and validated defects without editing them.

## Diagnostic delivery

The three maintained numeric diagnostic tests pass through `createEngine`: warnings settle in formula order before bytes publish; callback rejection and callback-triggered cancellation preserve their exact supplied reason identity and prevent serialization/output. Additional original in-memory observations exercised `recalculateWithDiagnostics` directly:

| Scenario | Observed outcome |
| --- | --- |
| A negative Bessel K warning followed by RAND without a random capability | The warning is admitted and asynchronously settles once; the original `capability-denied` calculation error then propagates. |
| Two warnings with a 40-byte diagnostic queue limit | Only the first warning is admitted and settles; the second admission throws `resource-limit`. |
| Manual calculation workbook containing a negative Bessel K formula | No warnings are emitted and no recalculation runs. |

The queue caps allocation before insertion; the engine separately enforces the cumulative operation diagnostic-byte budget, snapshots notices, and checks cancellation before and after awaiting the external diagnostic capability. `finally` intentionally settles admitted notices on calculation failure. An external callback rejection or cancellation can supersede that pending calculation failure, matching the operation's external-capability reason semantics. No concrete defect was reproduced in the measured diagnostic paths. Concurrent disposal races and the entire command diagnostic prefix/status surface are outside these observations.

## Validated OpenFormula edge defects

Native observations use the pinned Gnumeric 1.12.61 aarch64 profile in `numeric-native-profile.json`, with C locale, UTC timezone and memory GSettings backend. Both original minimal workbook conversions exited zero with empty stdout and stderr; output formulas were inspected from ODS `content.xml` and native Gnumeric XML.

| Input | Released output | Initial JavaScript output |
| --- | --- | --- |
| Native `=FLOOR()` exported to ODS | `of:=floor(floor()` | `of:=FLOOR()` |
| Native `=CEILING()` exported to ODS | `of:=ceiling(ceiling()` | `of:=CEILING()` |
| ODS `of:=FLOOR()` imported to native grammar | `=ODF.FLOOR()` | `=FLOOR()` |
| ODS `of:=CEILING()` imported to native grammar | `=ODF.CEILING()` | `=CEILING()` |
| ODS `of:=FLOOR(1;1;0;1)` imported to native grammar | `=ODF.FLOOR(1,1,0,1)` | `=FLOOR(1,1,0,1)` |
| ODS `of:=CEILING(1;1;0;1)` imported to native grammar | `=ODF.CEILING(1,1,0,1)` | `=CEILING(1,1,0,1)` |

Released `plugins/openoffice/openoffice-write.c` function `odf_func_floor_ceiling_handler` at2191 deliberately emits its malformed literal zero-argument form. The import handlers at12896 and12983 decline zero and greater-than-three arguments; the fallback aliases at13451 and13455 map those names to `ODF.CEILING` and `ODF.FLOOR`. Prefixed `ORG.GNUMERIC` calls bypass this remapping. These six validated defects were reported to the integration author for original failing regressions and repair.

The released writer also discards extra arguments in native `=FLOOR(1,1,0)`, emitting `of:=floor(1;1;1)` while retaining a cached `#N/A` value. JavaScript already follows that source operation; changing it to preserve the third argument would introduce a mismatch.

The original15 maintained numeric ODF regressions pass. This does not establish complete OpenFormula namespace equivalence. The final complex power phase change was independently remeasured: all21 previously captured clean complex-scientific fields remain exact and all28 focused unit cases pass.

Owned temporary native ODS/XML and isolated replay artifacts were purged after recording evidence. No native utility is used by unit cases or the implementation.

## XLSX numeric writer follow-up

The integration owner added fifteen original failing numeric XLSX regressions before implementing prefix-specific aliases, Unique-to-Gnumeric name prefixes, the three precise-function renames, FLOOR's one-argument ROUNDDOWN handler, and ERF's non-one-argument override. An independent original in-memory source workbook enumerated all190 numeric manifest names with zero arguments, then the pinned native writer exported XLSX. Status was zero with empty stdout/stderr. Every190 ZIP worksheet formula field matches the final JavaScript serializer exactly. This authenticates name/prefix dispatch and zero-arity handler boundaries; it does not establish every nonzero argument expression's lexical export parity.

| Native input name | Released/JavaScript XLSX field | Outcome |
| --- | --- | --- |
| `=COMPLEX()` | `=COMPLEX()` | match |
| `=IMABS()` | `=IMABS()` | match |
| `=IMAGINARY()` | `=IMAGINARY()` | match |
| `=IMARGUMENT()` | `=IMARGUMENT()` | match |
| `=IMCONJUGATE()` | `=IMCONJUGATE()` | match |
| `=IMFACT()` | `=_xlfngnumeric.IMFACT()` | match |
| `=IMGAMMA()` | `=_xlfngnumeric.IMGAMMA()` | match |
| `=IMIGAMMA()` | `=_xlfngnumeric.IMIGAMMA()` | match |
| `=IMINV()` | `=_xlfngnumeric.IMINV()` | match |
| `=IMNEG()` | `=IMNEG()` | match |
| `=IMCOS()` | `=IMCOS()` | match |
| `=IMTAN()` | `=IMTAN()` | match |
| `=IMSEC()` | `=IMSEC()` | match |
| `=IMCSC()` | `=IMCSC()` | match |
| `=IMCOT()` | `=IMCOT()` | match |
| `=IMARCSIN()` | `=IMARCSIN()` | match |
| `=IMARCCOS()` | `=IMARCCOS()` | match |
| `=IMARCTAN()` | `=IMARCTAN()` | match |
| `=IMARCSEC()` | `=IMARCSEC()` | match |
| `=IMARCCSC()` | `=IMARCCSC()` | match |
| `=IMARCCOT()` | `=IMARCCOT()` | match |
| `=IMARCSINH()` | `=IMARCSINH()` | match |
| `=IMARCCOSH()` | `=IMARCCOSH()` | match |
| `=IMARCTANH()` | `=IMARCTANH()` | match |
| `=IMARCSECH()` | `=IMARCSECH()` | match |
| `=IMARCCSCH()` | `=IMARCCSCH()` | match |
| `=IMARCCOTH()` | `=IMARCCOTH()` | match |
| `=IMSINH()` | `=IMSINH()` | match |
| `=IMCOSH()` | `=IMCOSH()` | match |
| `=IMTANH()` | `=IMTANH()` | match |
| `=IMSECH()` | `=IMSECH()` | match |
| `=IMCSCH()` | `=IMCSCH()` | match |
| `=IMCOTH()` | `=IMCOTH()` | match |
| `=IMDIV()` | `=IMDIV()` | match |
| `=IMEXP()` | `=IMEXP()` | match |
| `=IMLN()` | `=IMLN()` | match |
| `=IMLOG10()` | `=IMLOG10()` | match |
| `=IMLOG2()` | `=IMLOG2()` | match |
| `=IMPOWER()` | `=IMPOWER()` | match |
| `=IMPRODUCT()` | `=IMPRODUCT()` | match |
| `=IMREAL()` | `=IMREAL()` | match |
| `=IMSIN()` | `=IMSIN()` | match |
| `=IMSQRT()` | `=IMSQRT()` | match |
| `=IMSUB()` | `=IMSUB()` | match |
| `=IMSUM()` | `=IMSUM()` | match |
| `=BASE()` | `=_xlfngnumeric.BASE()` | match |
| `=BESSELI()` | `=BESSELI()` | match |
| `=BESSELK()` | `=BESSELK()` | match |
| `=BESSELJ()` | `=BESSELJ()` | match |
| `=BESSELY()` | `=BESSELY()` | match |
| `=BIN2DEC()` | `=BIN2DEC()` | match |
| `=BIN2HEX()` | `=BIN2HEX()` | match |
| `=BIN2OCT()` | `=BIN2OCT()` | match |
| `=CONVERT()` | `=CONVERT()` | match |
| `=DEC2BIN()` | `=DEC2BIN()` | match |
| `=DEC2OCT()` | `=DEC2OCT()` | match |
| `=DEC2HEX()` | `=DEC2HEX()` | match |
| `=DECIMAL()` | `=_xlfngnumeric.DECIMAL()` | match |
| `=DELTA()` | `=DELTA()` | match |
| `=ERF()` | `=ERF()` | match |
| `=ERFC()` | `=_xlfn.ERFC.PRECISE()` | match |
| `=GESTEP()` | `=GESTEP()` | match |
| `=HEX2BIN()` | `=HEX2BIN()` | match |
| `=HEX2DEC()` | `=HEX2DEC()` | match |
| `=HEX2OCT()` | `=HEX2OCT()` | match |
| `=HEXREP()` | `=_xlfngnumeric.HEXREP()` | match |
| `=INVSUMINV()` | `=_xlfngnumeric.INVSUMINV()` | match |
| `=OCT2BIN()` | `=OCT2BIN()` | match |
| `=OCT2DEC()` | `=OCT2DEC()` | match |
| `=OCT2HEX()` | `=OCT2HEX()` | match |
| `=FLT.MAX()` | `=_xlfngnumeric.FLT.MAX()` | match |
| `=FLT.MIN()` | `=_xlfngnumeric.FLT.MIN()` | match |
| `=FLT.NEXTAFTER()` | `=_xlfngnumeric.FLT.NEXTAFTER()` | match |
| `=FLT.RADIX()` | `=_xlfngnumeric.FLT.RADIX()` | match |
| `=ABS()` | `=ABS()` | match |
| `=ACOS()` | `=ACOS()` | match |
| `=ACOSH()` | `=ACOSH()` | match |
| `=ACOT()` | `=ACOT()` | match |
| `=ACOTH()` | `=ACOTH()` | match |
| `=AGM()` | `=_xlfngnumeric.AGM()` | match |
| `=ARABIC()` | `=ARABIC()` | match |
| `=ASIN()` | `=ASIN()` | match |
| `=ASINH()` | `=ASINH()` | match |
| `=ATAN()` | `=ATAN()` | match |
| `=ATAN2()` | `=ATAN2()` | match |
| `=ATANH()` | `=ATANH()` | match |
| `=AVERAGEIF()` | `=AVERAGEIF()` | match |
| `=AVERAGEIFS()` | `=AVERAGEIFS()` | match |
| `=BETA()` | `=_xlfngnumeric.BETA()` | match |
| `=BETALN()` | `=_xlfngnumeric.BETALN()` | match |
| `=CEIL()` | `=_xlfngnumeric.CEIL()` | match |
| `=CEILING()` | `=CEILING()` | match |
| `=CHOLESKY()` | `=_xlfngnumeric.CHOLESKY()` | match |
| `=COMBIN()` | `=COMBIN()` | match |
| `=COMBINA()` | `=COMBINA()` | match |
| `=COS()` | `=COS()` | match |
| `=COSH()` | `=COSH()` | match |
| `=COSPI()` | `=_xlfngnumeric.COSPI()` | match |
| `=COT()` | `=COT()` | match |
| `=COTH()` | `=COTH()` | match |
| `=COTPI()` | `=COTPI()` | match |
| `=COUNTIF()` | `=COUNTIF()` | match |
| `=COUNTIFS()` | `=COUNTIFS()` | match |
| `=CSC()` | `=_xlfngnumeric.CSC()` | match |
| `=CSCH()` | `=_xlfngnumeric.CSCH()` | match |
| `=DEGREES()` | `=DEGREES()` | match |
| `=DIGAMMA()` | `=_xlfngnumeric.DIGAMMA()` | match |
| `=EIGEN()` | `=_xlfngnumeric.EIGEN()` | match |
| `=EVEN()` | `=EVEN()` | match |
| `=EXP()` | `=EXP()` | match |
| `=EXPM1()` | `=_xlfngnumeric.EXPM1()` | match |
| `=FACT()` | `=FACT()` | match |
| `=FACTDOUBLE()` | `=FACTDOUBLE()` | match |
| `=FIB()` | `=FIB()` | match |
| `=FLOOR()` | `=FLOOR()` | match |
| `=G_PRODUCT()` | `=G_PRODUCT()` | match |
| `=GAMMA()` | `=_xlfngnumeric.GAMMA()` | match |
| `=GAMMALN()` | `=_xlfn.GAMMALN.PRECISE()` | match |
| `=GCD()` | `=GCD()` | match |
| `=GD()` | `=GD()` | match |
| `=HYPOT()` | `=_xlfngnumeric.HYPOT()` | match |
| `=IGAMMA()` | `=_xlfngnumeric.IGAMMA()` | match |
| `=ILOG()` | `=_xlfngnumeric.ILOG()` | match |
| `=INT()` | `=INT()` | match |
| `=LAMBERTW()` | `=LAMBERTW()` | match |
| `=LCM()` | `=LCM()` | match |
| `=LINSOLVE()` | `=_xlfngnumeric.LINSOLVE()` | match |
| `=LN()` | `=LN()` | match |
| `=LN1P()` | `=_xlfngnumeric.LN1P()` | match |
| `=LOG()` | `=LOG()` | match |
| `=LOG10()` | `=LOG10()` | match |
| `=LOG2()` | `=LOG2()` | match |
| `=MAXIFS()` | `=MAXIFS()` | match |
| `=MDETERM()` | `=MDETERM()` | match |
| `=MINIFS()` | `=MINIFS()` | match |
| `=MINVERSE()` | `=MINVERSE()` | match |
| `=MMULT()` | `=MMULT()` | match |
| `=MOD()` | `=MOD()` | match |
| `=MPSEUDOINVERSE()` | `=_xlfngnumeric.MPSEUDOINVERSE()` | match |
| `=MROUND()` | `=MROUND()` | match |
| `=MULTINOMIAL()` | `=MULTINOMIAL()` | match |
| `=MUNIT()` | `=MUNIT()` | match |
| `=ODD()` | `=ODD()` | match |
| `=ODF.SUMPRODUCT()` | `=ODF.SUMPRODUCT()` | match |
| `=PI()` | `=PI()` | match |
| `=POCHHAMMER()` | `=_xlfngnumeric.POCHHAMMER()` | match |
| `=POWER()` | `=POWER()` | match |
| `=QUOTIENT()` | `=QUOTIENT()` | match |
| `=RADIANS()` | `=RADIANS()` | match |
| `=REDUCEPI()` | `=_xlfngnumeric.REDUCEPI()` | match |
| `=ROMAN()` | `=ROMAN()` | match |
| `=ROUND()` | `=ROUND()` | match |
| `=ROUNDDOWN()` | `=ROUNDDOWN()` | match |
| `=ROUNDUP()` | `=ROUNDUP()` | match |
| `=SEC()` | `=_xlfngnumeric.SEC()` | match |
| `=SECH()` | `=_xlfngnumeric.SECH()` | match |
| `=SERIESSUM()` | `=SERIESSUM()` | match |
| `=SIGN()` | `=SIGN()` | match |
| `=SIN()` | `=SIN()` | match |
| `=SINH()` | `=SINH()` | match |
| `=SINPI()` | `=_xlfngnumeric.SINPI()` | match |
| `=SQRT()` | `=SQRT()` | match |
| `=SQRTPI()` | `=SQRTPI()` | match |
| `=SUMA()` | `=SUMA()` | match |
| `=SUMIF()` | `=SUMIF()` | match |
| `=SUMIFS()` | `=SUMIFS()` | match |
| `=SUMPRODUCT()` | `=SUMPRODUCT()` | match |
| `=SUMSQ()` | `=SUMSQ()` | match |
| `=SUMX2MY2()` | `=SUMX2MY2()` | match |
| `=SUMX2PY2()` | `=SUMX2PY2()` | match |
| `=SUMXMY2()` | `=SUMXMY2()` | match |
| `=TAN()` | `=TAN()` | match |
| `=TANH()` | `=TANH()` | match |
| `=TANPI()` | `=TANPI()` | match |
| `=TRUNC()` | `=TRUNC()` | match |
| `=ISPRIME()` | `=_xlfngnumeric.ISPRIME()` | match |
| `=ITHPRIME()` | `=_xlfngnumeric.ITHPRIME()` | match |
| `=NT_D()` | `=_xlfngnumeric.NT_D()` | match |
| `=NT_MU()` | `=_xlfngnumeric.NT_MU()` | match |
| `=NT_OMEGA()` | `=_xlfngnumeric.NT_OMEGA()` | match |
| `=NT_PHI()` | `=_xlfngnumeric.NT_PHI()` | match |
| `=NT_PI()` | `=_xlfngnumeric.NT_PI()` | match |
| `=NT_RADICAL()` | `=_xlfngnumeric.NT_RADICAL()` | match |
| `=NT_SIGMA()` | `=_xlfngnumeric.NT_SIGMA()` | match |
| `=PFACTOR()` | `=_xlfngnumeric.PFACTOR()` | match |
| `=BITAND()` | `=_xlfngnumeric.BITAND()` | match |
| `=BITLSHIFT()` | `=_xlfngnumeric.BITLSHIFT()` | match |
| `=BITOR()` | `=_xlfngnumeric.BITOR()` | match |
| `=BITRSHIFT()` | `=_xlfngnumeric.BITRSHIFT()` | match |
| `=BITXOR()` | `=_xlfngnumeric.BITXOR()` | match |

Independent mixed-case/prefix reader probes also exited zero with empty diagnostics. `_XlFn.eRf.PrEcIsE(1)` maps to ERF; `_xlfnodf.ERF.PRECISE(1)`, `_xlfngnumeric.ERF.PRECISE(1)`, and bare `ERF.PRECISE(1)` preserve the placeholder name. `_xlfn.ERF.PRECISE(1,2)` and `_xlfn.ERFC.PRECISE()` map regardless of invalid arity; `_xlfn.GAMMALN.PRECISE(2)` maps to GAMMALN. Mixed-case `_XLFNGNUMERIC.nt_phi(36)` maps to NT_PHI and `_xlfnodf.SUMPRODUCT` maps to native SUMPRODUCT. Reader comparisons here measure semantic names, not exact Gnumeric XML spelling: the released native XML writer lowercases registered function names such as erf and nt_phi, while the existing JavaScript canonical grammar uppercases them. That broader lexical writer distinction is outside this focused numeric XLSX repair and is not counted as an exact reader pass.

The integration owner repaired all six previously reported OpenFormula edge cases with original failing regressions. The additional source writer behavior and parser lexical deduplication are covered by the final22 maintained ODF cases. Native writer/reader temporary archives and replay output were purged after this evidence was recorded.

Source provenance for the numeric XLSX map is released `plugins/excel/xlsx-utils.c`: writer dispatch and `GNM_FUNC_IMPL_STATUS_UNIQUE_TO_GNUMERIC` prefix selection at140–205; FLOOR/ERF output handlers at475–501; precise-function rename facts in the xlfn rename table at606–653. Unique status facts come from the authenticated source descriptors for all190 functions, not an inferred OpenFormula prefix. The independent190-name native ZIP observation validates the resulting static map against emitted writer behavior.

**Remaining lexical mismatch:** in the measured native XLSX-to-Gnumeric XML probes, registered calls serialize as lowercase `=erf(1)`, `=erfc()`, `=gammaln(2)`, `=nt_phi(36)`, and `=sumproduct(...)`; JavaScript canonical Gnumeric serialization uses uppercase names. This is a concrete measured spelling difference for those probes. Its full extent across all canonical Gnumeric exports remains unverified. The focused prefix/alias tests are semantic-name checks and are not represented as exact native Gnumeric writer lexical parity. No prior canonical convention or unrelated logical-function tests were rewritten for this numeric task.

The final maintained focused suites pass40/40: fifteen numeric XLSX cases, twenty-two numeric ODF cases, and three diagnostic cases.

## Numeric native casing repair verification

The scoped canonical numeric native-writer repair resolves the earlier measured numeric casing mismatch. Independent replay against the complete190-name native XML writer table now matches190/190 exactly; six source-preservation, unknown, unrelated logical, Excel, and ODF controls pass. See `numeric-gnumeric-writer-independent-review.md` for the complete before-repair native table and post-repair outcomes. Canonical spelling of unrelated function groups remains outside this numerical repair and unmeasured here.
