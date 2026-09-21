# Independent canonical Gnumeric numeric writer review

This bounded read-only audit compares all190 requested numeric manifest names against released Gnumeric1.12.61's canonical native XML formula writer. It uses the pinned aarch64 dependency/plugin/locale profile in `numeric-native-profile.json`, with C locale, UTC timezone, and memory GSettings backend. Source archive SHA-256 is `2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12`. An original minimal workbook contains one zero-argument call for each authenticated descriptor, in manifest order. The native XML-to-XML conversion exited0 with empty stdout and stderr; all190 formula cell fields were measured.

Before repair, canonical `serializeExpression(document, gnumericGrammar, false, true)` matches0/190 native formula fields. All190 released writer fields exactly equal the source descriptor's literal function name followed by empty parentheses. Every measured numeric descriptor spelling is lowercase; `G_PRODUCT` becomes `g_product` exactly as its descriptor states, with no additional alias exception. Zero arguments are intentionally writer-only probes and provide no numeric calculation parity claim.

## Source provenance

Released `src/parse-util.c` function `std_expr_func_handler` at1311 retrieves `gnm_func_get_name` and appends the returned name verbatim before serializing arguments. Released `src/func.c` function `gnm_func_get_name` at1099 returns `func->name` when localized names are disabled. The captured profile uses nonlocalized C-locale conventions. Descriptor names are authenticated in `function-coverage.json` with each plugin manifest and descriptor source SHA-256.

A scoped numeric canonical-export map can therefore derive all190 released spellings directly from the numeric source descriptors. This evidence does not require changing prior canonical conventions for unrelated logical/text/lookup functions. Unknown placeholders, localized names, aliases outside these190 descriptors, nonzero argument lexical behavior, and other grammar writers are outside this audit. Unsupported or unmeasured behavior is not a pass.

| Manifest name | Descriptor name | Native formula field | Initial JavaScript field | Initial outcome |
| --- | --- | --- | --- | --- |
| `COMPLEX` | `complex` | `=complex()` | `=COMPLEX()` | mismatch |
| `IMABS` | `imabs` | `=imabs()` | `=IMABS()` | mismatch |
| `IMAGINARY` | `imaginary` | `=imaginary()` | `=IMAGINARY()` | mismatch |
| `IMARGUMENT` | `imargument` | `=imargument()` | `=IMARGUMENT()` | mismatch |
| `IMCONJUGATE` | `imconjugate` | `=imconjugate()` | `=IMCONJUGATE()` | mismatch |
| `IMFACT` | `imfact` | `=imfact()` | `=IMFACT()` | mismatch |
| `IMGAMMA` | `imgamma` | `=imgamma()` | `=IMGAMMA()` | mismatch |
| `IMIGAMMA` | `imigamma` | `=imigamma()` | `=IMIGAMMA()` | mismatch |
| `IMINV` | `iminv` | `=iminv()` | `=IMINV()` | mismatch |
| `IMNEG` | `imneg` | `=imneg()` | `=IMNEG()` | mismatch |
| `IMCOS` | `imcos` | `=imcos()` | `=IMCOS()` | mismatch |
| `IMTAN` | `imtan` | `=imtan()` | `=IMTAN()` | mismatch |
| `IMSEC` | `imsec` | `=imsec()` | `=IMSEC()` | mismatch |
| `IMCSC` | `imcsc` | `=imcsc()` | `=IMCSC()` | mismatch |
| `IMCOT` | `imcot` | `=imcot()` | `=IMCOT()` | mismatch |
| `IMARCSIN` | `imarcsin` | `=imarcsin()` | `=IMARCSIN()` | mismatch |
| `IMARCCOS` | `imarccos` | `=imarccos()` | `=IMARCCOS()` | mismatch |
| `IMARCTAN` | `imarctan` | `=imarctan()` | `=IMARCTAN()` | mismatch |
| `IMARCSEC` | `imarcsec` | `=imarcsec()` | `=IMARCSEC()` | mismatch |
| `IMARCCSC` | `imarccsc` | `=imarccsc()` | `=IMARCCSC()` | mismatch |
| `IMARCCOT` | `imarccot` | `=imarccot()` | `=IMARCCOT()` | mismatch |
| `IMARCSINH` | `imarcsinh` | `=imarcsinh()` | `=IMARCSINH()` | mismatch |
| `IMARCCOSH` | `imarccosh` | `=imarccosh()` | `=IMARCCOSH()` | mismatch |
| `IMARCTANH` | `imarctanh` | `=imarctanh()` | `=IMARCTANH()` | mismatch |
| `IMARCSECH` | `imarcsech` | `=imarcsech()` | `=IMARCSECH()` | mismatch |
| `IMARCCSCH` | `imarccsch` | `=imarccsch()` | `=IMARCCSCH()` | mismatch |
| `IMARCCOTH` | `imarccoth` | `=imarccoth()` | `=IMARCCOTH()` | mismatch |
| `IMSINH` | `imsinh` | `=imsinh()` | `=IMSINH()` | mismatch |
| `IMCOSH` | `imcosh` | `=imcosh()` | `=IMCOSH()` | mismatch |
| `IMTANH` | `imtanh` | `=imtanh()` | `=IMTANH()` | mismatch |
| `IMSECH` | `imsech` | `=imsech()` | `=IMSECH()` | mismatch |
| `IMCSCH` | `imcsch` | `=imcsch()` | `=IMCSCH()` | mismatch |
| `IMCOTH` | `imcoth` | `=imcoth()` | `=IMCOTH()` | mismatch |
| `IMDIV` | `imdiv` | `=imdiv()` | `=IMDIV()` | mismatch |
| `IMEXP` | `imexp` | `=imexp()` | `=IMEXP()` | mismatch |
| `IMLN` | `imln` | `=imln()` | `=IMLN()` | mismatch |
| `IMLOG10` | `imlog10` | `=imlog10()` | `=IMLOG10()` | mismatch |
| `IMLOG2` | `imlog2` | `=imlog2()` | `=IMLOG2()` | mismatch |
| `IMPOWER` | `impower` | `=impower()` | `=IMPOWER()` | mismatch |
| `IMPRODUCT` | `improduct` | `=improduct()` | `=IMPRODUCT()` | mismatch |
| `IMREAL` | `imreal` | `=imreal()` | `=IMREAL()` | mismatch |
| `IMSIN` | `imsin` | `=imsin()` | `=IMSIN()` | mismatch |
| `IMSQRT` | `imsqrt` | `=imsqrt()` | `=IMSQRT()` | mismatch |
| `IMSUB` | `imsub` | `=imsub()` | `=IMSUB()` | mismatch |
| `IMSUM` | `imsum` | `=imsum()` | `=IMSUM()` | mismatch |
| `BASE` | `base` | `=base()` | `=BASE()` | mismatch |
| `BESSELI` | `besseli` | `=besseli()` | `=BESSELI()` | mismatch |
| `BESSELK` | `besselk` | `=besselk()` | `=BESSELK()` | mismatch |
| `BESSELJ` | `besselj` | `=besselj()` | `=BESSELJ()` | mismatch |
| `BESSELY` | `bessely` | `=bessely()` | `=BESSELY()` | mismatch |
| `BIN2DEC` | `bin2dec` | `=bin2dec()` | `=BIN2DEC()` | mismatch |
| `BIN2HEX` | `bin2hex` | `=bin2hex()` | `=BIN2HEX()` | mismatch |
| `BIN2OCT` | `bin2oct` | `=bin2oct()` | `=BIN2OCT()` | mismatch |
| `CONVERT` | `convert` | `=convert()` | `=CONVERT()` | mismatch |
| `DEC2BIN` | `dec2bin` | `=dec2bin()` | `=DEC2BIN()` | mismatch |
| `DEC2OCT` | `dec2oct` | `=dec2oct()` | `=DEC2OCT()` | mismatch |
| `DEC2HEX` | `dec2hex` | `=dec2hex()` | `=DEC2HEX()` | mismatch |
| `DECIMAL` | `decimal` | `=decimal()` | `=DECIMAL()` | mismatch |
| `DELTA` | `delta` | `=delta()` | `=DELTA()` | mismatch |
| `ERF` | `erf` | `=erf()` | `=ERF()` | mismatch |
| `ERFC` | `erfc` | `=erfc()` | `=ERFC()` | mismatch |
| `GESTEP` | `gestep` | `=gestep()` | `=GESTEP()` | mismatch |
| `HEX2BIN` | `hex2bin` | `=hex2bin()` | `=HEX2BIN()` | mismatch |
| `HEX2DEC` | `hex2dec` | `=hex2dec()` | `=HEX2DEC()` | mismatch |
| `HEX2OCT` | `hex2oct` | `=hex2oct()` | `=HEX2OCT()` | mismatch |
| `HEXREP` | `hexrep` | `=hexrep()` | `=HEXREP()` | mismatch |
| `INVSUMINV` | `invsuminv` | `=invsuminv()` | `=INVSUMINV()` | mismatch |
| `OCT2BIN` | `oct2bin` | `=oct2bin()` | `=OCT2BIN()` | mismatch |
| `OCT2DEC` | `oct2dec` | `=oct2dec()` | `=OCT2DEC()` | mismatch |
| `OCT2HEX` | `oct2hex` | `=oct2hex()` | `=OCT2HEX()` | mismatch |
| `FLT.MAX` | `flt.max` | `=flt.max()` | `=FLT.MAX()` | mismatch |
| `FLT.MIN` | `flt.min` | `=flt.min()` | `=FLT.MIN()` | mismatch |
| `FLT.NEXTAFTER` | `flt.nextafter` | `=flt.nextafter()` | `=FLT.NEXTAFTER()` | mismatch |
| `FLT.RADIX` | `flt.radix` | `=flt.radix()` | `=FLT.RADIX()` | mismatch |
| `ABS` | `abs` | `=abs()` | `=ABS()` | mismatch |
| `ACOS` | `acos` | `=acos()` | `=ACOS()` | mismatch |
| `ACOSH` | `acosh` | `=acosh()` | `=ACOSH()` | mismatch |
| `ACOT` | `acot` | `=acot()` | `=ACOT()` | mismatch |
| `ACOTH` | `acoth` | `=acoth()` | `=ACOTH()` | mismatch |
| `AGM` | `agm` | `=agm()` | `=AGM()` | mismatch |
| `ARABIC` | `arabic` | `=arabic()` | `=ARABIC()` | mismatch |
| `ASIN` | `asin` | `=asin()` | `=ASIN()` | mismatch |
| `ASINH` | `asinh` | `=asinh()` | `=ASINH()` | mismatch |
| `ATAN` | `atan` | `=atan()` | `=ATAN()` | mismatch |
| `ATAN2` | `atan2` | `=atan2()` | `=ATAN2()` | mismatch |
| `ATANH` | `atanh` | `=atanh()` | `=ATANH()` | mismatch |
| `AVERAGEIF` | `averageif` | `=averageif()` | `=AVERAGEIF()` | mismatch |
| `AVERAGEIFS` | `averageifs` | `=averageifs()` | `=AVERAGEIFS()` | mismatch |
| `BETA` | `beta` | `=beta()` | `=BETA()` | mismatch |
| `BETALN` | `betaln` | `=betaln()` | `=BETALN()` | mismatch |
| `CEIL` | `ceil` | `=ceil()` | `=CEIL()` | mismatch |
| `CEILING` | `ceiling` | `=ceiling()` | `=CEILING()` | mismatch |
| `CHOLESKY` | `cholesky` | `=cholesky()` | `=CHOLESKY()` | mismatch |
| `COMBIN` | `combin` | `=combin()` | `=COMBIN()` | mismatch |
| `COMBINA` | `combina` | `=combina()` | `=COMBINA()` | mismatch |
| `COS` | `cos` | `=cos()` | `=COS()` | mismatch |
| `COSH` | `cosh` | `=cosh()` | `=COSH()` | mismatch |
| `COSPI` | `cospi` | `=cospi()` | `=COSPI()` | mismatch |
| `COT` | `cot` | `=cot()` | `=COT()` | mismatch |
| `COTH` | `coth` | `=coth()` | `=COTH()` | mismatch |
| `COTPI` | `cotpi` | `=cotpi()` | `=COTPI()` | mismatch |
| `COUNTIF` | `countif` | `=countif()` | `=COUNTIF()` | mismatch |
| `COUNTIFS` | `countifs` | `=countifs()` | `=COUNTIFS()` | mismatch |
| `CSC` | `csc` | `=csc()` | `=CSC()` | mismatch |
| `CSCH` | `csch` | `=csch()` | `=CSCH()` | mismatch |
| `DEGREES` | `degrees` | `=degrees()` | `=DEGREES()` | mismatch |
| `DIGAMMA` | `digamma` | `=digamma()` | `=DIGAMMA()` | mismatch |
| `EIGEN` | `eigen` | `=eigen()` | `=EIGEN()` | mismatch |
| `EVEN` | `even` | `=even()` | `=EVEN()` | mismatch |
| `EXP` | `exp` | `=exp()` | `=EXP()` | mismatch |
| `EXPM1` | `expm1` | `=expm1()` | `=EXPM1()` | mismatch |
| `FACT` | `fact` | `=fact()` | `=FACT()` | mismatch |
| `FACTDOUBLE` | `factdouble` | `=factdouble()` | `=FACTDOUBLE()` | mismatch |
| `FIB` | `fib` | `=fib()` | `=FIB()` | mismatch |
| `FLOOR` | `floor` | `=floor()` | `=FLOOR()` | mismatch |
| `G_PRODUCT` | `g_product` | `=g_product()` | `=G_PRODUCT()` | mismatch |
| `GAMMA` | `gamma` | `=gamma()` | `=GAMMA()` | mismatch |
| `GAMMALN` | `gammaln` | `=gammaln()` | `=GAMMALN()` | mismatch |
| `GCD` | `gcd` | `=gcd()` | `=GCD()` | mismatch |
| `GD` | `gd` | `=gd()` | `=GD()` | mismatch |
| `HYPOT` | `hypot` | `=hypot()` | `=HYPOT()` | mismatch |
| `IGAMMA` | `igamma` | `=igamma()` | `=IGAMMA()` | mismatch |
| `ILOG` | `ilog` | `=ilog()` | `=ILOG()` | mismatch |
| `INT` | `int` | `=int()` | `=INT()` | mismatch |
| `LAMBERTW` | `lambertw` | `=lambertw()` | `=LAMBERTW()` | mismatch |
| `LCM` | `lcm` | `=lcm()` | `=LCM()` | mismatch |
| `LINSOLVE` | `linsolve` | `=linsolve()` | `=LINSOLVE()` | mismatch |
| `LN` | `ln` | `=ln()` | `=LN()` | mismatch |
| `LN1P` | `ln1p` | `=ln1p()` | `=LN1P()` | mismatch |
| `LOG` | `log` | `=log()` | `=LOG()` | mismatch |
| `LOG10` | `log10` | `=log10()` | `=LOG10()` | mismatch |
| `LOG2` | `log2` | `=log2()` | `=LOG2()` | mismatch |
| `MAXIFS` | `maxifs` | `=maxifs()` | `=MAXIFS()` | mismatch |
| `MDETERM` | `mdeterm` | `=mdeterm()` | `=MDETERM()` | mismatch |
| `MINIFS` | `minifs` | `=minifs()` | `=MINIFS()` | mismatch |
| `MINVERSE` | `minverse` | `=minverse()` | `=MINVERSE()` | mismatch |
| `MMULT` | `mmult` | `=mmult()` | `=MMULT()` | mismatch |
| `MOD` | `mod` | `=mod()` | `=MOD()` | mismatch |
| `MPSEUDOINVERSE` | `mpseudoinverse` | `=mpseudoinverse()` | `=MPSEUDOINVERSE()` | mismatch |
| `MROUND` | `mround` | `=mround()` | `=MROUND()` | mismatch |
| `MULTINOMIAL` | `multinomial` | `=multinomial()` | `=MULTINOMIAL()` | mismatch |
| `MUNIT` | `munit` | `=munit()` | `=MUNIT()` | mismatch |
| `ODD` | `odd` | `=odd()` | `=ODD()` | mismatch |
| `ODF.SUMPRODUCT` | `odf.sumproduct` | `=odf.sumproduct()` | `=ODF.SUMPRODUCT()` | mismatch |
| `PI` | `pi` | `=pi()` | `=PI()` | mismatch |
| `POCHHAMMER` | `pochhammer` | `=pochhammer()` | `=POCHHAMMER()` | mismatch |
| `POWER` | `power` | `=power()` | `=POWER()` | mismatch |
| `QUOTIENT` | `quotient` | `=quotient()` | `=QUOTIENT()` | mismatch |
| `RADIANS` | `radians` | `=radians()` | `=RADIANS()` | mismatch |
| `REDUCEPI` | `reducepi` | `=reducepi()` | `=REDUCEPI()` | mismatch |
| `ROMAN` | `roman` | `=roman()` | `=ROMAN()` | mismatch |
| `ROUND` | `round` | `=round()` | `=ROUND()` | mismatch |
| `ROUNDDOWN` | `rounddown` | `=rounddown()` | `=ROUNDDOWN()` | mismatch |
| `ROUNDUP` | `roundup` | `=roundup()` | `=ROUNDUP()` | mismatch |
| `SEC` | `sec` | `=sec()` | `=SEC()` | mismatch |
| `SECH` | `sech` | `=sech()` | `=SECH()` | mismatch |
| `SERIESSUM` | `seriessum` | `=seriessum()` | `=SERIESSUM()` | mismatch |
| `SIGN` | `sign` | `=sign()` | `=SIGN()` | mismatch |
| `SIN` | `sin` | `=sin()` | `=SIN()` | mismatch |
| `SINH` | `sinh` | `=sinh()` | `=SINH()` | mismatch |
| `SINPI` | `sinpi` | `=sinpi()` | `=SINPI()` | mismatch |
| `SQRT` | `sqrt` | `=sqrt()` | `=SQRT()` | mismatch |
| `SQRTPI` | `sqrtpi` | `=sqrtpi()` | `=SQRTPI()` | mismatch |
| `SUMA` | `suma` | `=suma()` | `=SUMA()` | mismatch |
| `SUMIF` | `sumif` | `=sumif()` | `=SUMIF()` | mismatch |
| `SUMIFS` | `sumifs` | `=sumifs()` | `=SUMIFS()` | mismatch |
| `SUMPRODUCT` | `sumproduct` | `=sumproduct()` | `=SUMPRODUCT()` | mismatch |
| `SUMSQ` | `sumsq` | `=sumsq()` | `=SUMSQ()` | mismatch |
| `SUMX2MY2` | `sumx2my2` | `=sumx2my2()` | `=SUMX2MY2()` | mismatch |
| `SUMX2PY2` | `sumx2py2` | `=sumx2py2()` | `=SUMX2PY2()` | mismatch |
| `SUMXMY2` | `sumxmy2` | `=sumxmy2()` | `=SUMXMY2()` | mismatch |
| `TAN` | `tan` | `=tan()` | `=TAN()` | mismatch |
| `TANH` | `tanh` | `=tanh()` | `=TANH()` | mismatch |
| `TANPI` | `tanpi` | `=tanpi()` | `=TANPI()` | mismatch |
| `TRUNC` | `trunc` | `=trunc()` | `=TRUNC()` | mismatch |
| `ISPRIME` | `isprime` | `=isprime()` | `=ISPRIME()` | mismatch |
| `ITHPRIME` | `ithprime` | `=ithprime()` | `=ITHPRIME()` | mismatch |
| `NT_D` | `nt_d` | `=nt_d()` | `=NT_D()` | mismatch |
| `NT_MU` | `nt_mu` | `=nt_mu()` | `=NT_MU()` | mismatch |
| `NT_OMEGA` | `nt_omega` | `=nt_omega()` | `=NT_OMEGA()` | mismatch |
| `NT_PHI` | `nt_phi` | `=nt_phi()` | `=NT_PHI()` | mismatch |
| `NT_PI` | `nt_pi` | `=nt_pi()` | `=NT_PI()` | mismatch |
| `NT_RADICAL` | `nt_radical` | `=nt_radical()` | `=NT_RADICAL()` | mismatch |
| `NT_SIGMA` | `nt_sigma` | `=nt_sigma()` | `=NT_SIGMA()` | mismatch |
| `PFACTOR` | `pfactor` | `=pfactor()` | `=PFACTOR()` | mismatch |
| `BITAND` | `bitand` | `=bitand()` | `=BITAND()` | mismatch |
| `BITLSHIFT` | `bitlshift` | `=bitlshift()` | `=BITLSHIFT()` | mismatch |
| `BITOR` | `bitor` | `=bitor()` | `=BITOR()` | mismatch |
| `BITRSHIFT` | `bitrshift` | `=bitrshift()` | `=BITRSHIFT()` | mismatch |
| `BITXOR` | `bitxor` | `=bitxor()` | `=BITXOR()` | mismatch |

Source writer files SHA-256:

- `src/parse-util.c`: `5b80ccf63a53cac53112c2f1f690ee3c1380c22fce9183313f7780f95de6e6d7`
- `src/func.c`: `9f04a2f60159c44dae2fb88f99023f755d5eed01e230b5467e427ef834b68082`

## Post-repair independent measurement

The integration owner's scoped canonical native-writer repair was independently replayed against every190 native expected field in the table above. **190/190 fields now match exactly**, with zero observed mismatches. The initial table remains labelled as the before-repair observation. The implementation restricts descriptor-derived numeric spelling to canonical serialization in grammar `gnumeric`.

Six independent preservation controls also passed: mixed-case numeric source-preserving serialization; mixed-case noncanonical reconstruction; unknown canonical function spelling; unrelated logical canonical spelling; Excel numeric prefixed canonical export; and ODF numeric prefixed canonical export. The retained controls produced `=sInPi(0.25)`, `=SiNpI(0.25)`, `=NEVER_KNOWN(1)`, `=AND(TRUE,FALSE)`, `=_xlfngnumeric.SINPI(0.25)`, and `of:=ORG.GNUMERIC.SINPI(0.25)` respectively. These controls establish the measured boundary of this repair; other unmeasured grammars and unknown/localized alias scenarios are not claimed as passes.

All44 focused maintained cases pass: seven native numeric writer regressions, fifteen numeric XLSX cases, and twenty-two numeric ODF cases. The measured numeric casing difference reported by the earlier integration review is resolved for all190 descriptor names. No global change to unrelated canonical function spelling was made. The temporary independent replay artifact was purged after recording these outcomes.
