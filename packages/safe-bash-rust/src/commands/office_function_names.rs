// Calc CSV function names and SpreadsheetML spellings, independently exported
// with LibreOffice 24.8.7.2. See soffice-function-names-native.json.
// Recognition is independent of the evaluator's implemented functions.
pub(in crate::commands) fn name(name: &str, excel: bool) -> Option<&str> {
    let exported = match name {
        "GD" | "SINPI" | "COSPI" | "TANPI" | "COTPI" | "LOG2" | "EXPM1" | "LN1P" | "CEIL"
        | "ODF.SUMPRODUCT" => name,
        // Retained production functions extend the native Calc names.
        "COLUMNNUMBER"
        | "OPT_BS"
        | "OPT_BS_DELTA"
        | "OPT_BS_RHO"
        | "OPT_BS_THETA"
        | "OPT_BS_GAMMA"
        | "OPT_BS_VEGA"
        | "OPT_BS_CARRYCOST"
        | "OPT_GARMAN_KOHLHAGEN"
        | "OPT_FRENCH"
        | "OPT_JUMP_DIFF"
        | "OPT_EXEC"
        | "OPT_FORWARD_START"
        | "OPT_SIMPLE_CHOOSER"
        | "OPT_SPREAD_APPROX"
        | "OPT_FLOAT_STRK_LKBK"
        | "OPT_FIXED_STRK_LKBK"
        | "OPT_TIME_SWITCH"
        | "CUM_BIV_NORM_DIST"
        | "OPT_EXTENDIBLE_WRITER"
        | "OPT_COMPLEX_CHOOSER"
        | "OPT_RGW"
        | "OPT_BJER_STENS"
        | "OPT_BAW_AMER"
        | "OPT_MILTERSEN_SCHWARTZ"
        | "OPT_ON_OPTIONS"
        | "OPT_2_ASSET_CORRELATION"
        | "OPT_EURO_EXCHANGE"
        | "OPT_AMER_EXCHANGE"
        | "OPT_BINOMIAL" => name,
        "ABS" | "ACCRINT" | "ACCRINTM" | "ACOS" | "ACOSH" | "ADDRESS" | "AMORDEGRC"
        | "AMORLINC" | "AND" | "AREAS" | "ASC" | "ASIN" | "ASINH" | "ATAN" | "ATAN2" | "ATANH"
        | "AVEDEV" | "AVERAGE" | "AVERAGEA" | "AVERAGEIF" | "AVERAGEIFS" | "B" | "BESSELI"
        | "BESSELJ" | "BESSELK" | "BESSELY" | "BETADIST" | "BETAINV" | "BIN2DEC" | "BIN2HEX"
        | "BIN2OCT" | "BINOMDIST" | "CELL" | "CHAR" | "CHIDIST" | "CHIINV" | "CHISQDIST"
        | "CHISQINV" | "CHITEST" | "CHOOSE" | "CLEAN" | "CODE" | "COLUMN" | "COLUMNS"
        | "COMBIN" | "COMPLEX" | "CONCATENATE" | "CONFIDENCE" | "CONVERT" | "CORREL" | "COS"
        | "COSH" | "COUNT" | "COUNTA" | "COUNTBLANK" | "COUNTIF" | "COUNTIFS" | "COUPDAYBS"
        | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPNUM" | "COUPPCD" | "COVAR" | "CRITBINOM"
        | "CUMIPMT" | "CUMPRINC" | "DATE" | "DATEDIF" | "DATEVALUE" | "DAVERAGE" | "DAY"
        | "DAYS360" | "DAYSINMONTH" | "DAYSINYEAR" | "DB" | "DCOUNT" | "DCOUNTA" | "DDB"
        | "DDE" | "DEC2BIN" | "DEC2HEX" | "DEC2OCT" | "DEGREES" | "DELTA" | "DEVSQ" | "DGET"
        | "DISC" | "DMAX" | "DMIN" | "DOLLAR" | "DOLLARDE" | "DOLLARFR" | "DPRODUCT" | "DSTDEV"
        | "DSTDEVP" | "DSUM" | "DURATION" | "DVAR" | "DVARP" | "EDATE" | "EFFECT" | "EOMONTH"
        | "ERF" | "ERFC" | "ERROR.TYPE" | "EUROCONVERT" | "EVEN" | "EXACT" | "EXP"
        | "EXPONDIST" | "FACT" | "FACTDOUBLE" | "FALSE" | "FDIST" | "FIND" | "FINDB" | "FINV"
        | "FISHER" | "FISHERINV" | "FIXED" | "FORECAST" | "FREQUENCY" | "FTEST" | "FV"
        | "FVSCHEDULE" | "GAMMADIST" | "GAMMAINV" | "GAMMALN" | "GCD" | "GEOMEAN" | "GESTEP"
        | "GETPIVOTDATA" | "GROWTH" | "HARMEAN" | "HEX2BIN" | "HEX2DEC" | "HEX2OCT" | "HLOOKUP"
        | "HOUR" | "HYPERLINK" | "IF" | "IFERROR" | "IMABS" | "IMAGINARY" | "IMARGUMENT"
        | "IMCONJUGATE" | "IMCOS" | "IMCOSH" | "IMCOT" | "IMCSC" | "IMCSCH" | "IMDIV" | "IMEXP"
        | "IMLN" | "IMLOG10" | "IMLOG2" | "IMPOWER" | "IMPRODUCT" | "IMREAL" | "IMSEC"
        | "IMSECH" | "IMSIN" | "IMSINH" | "IMSQRT" | "IMSUB" | "IMSUM" | "IMTAN" | "INDEX"
        | "INDIRECT" | "INFO" | "INT" | "INTERCEPT" | "INTRATE" | "IPMT" | "IRR" | "ISBLANK"
        | "ISERR" | "ISERROR" | "ISEVEN" | "ISLEAPYEAR" | "ISLOGICAL" | "ISNA" | "ISNONTEXT"
        | "ISNUMBER" | "ISO.CEILING" | "ISODD" | "ISPMT" | "ISREF" | "ISTEXT" | "JIS" | "KURT"
        | "LARGE" | "LCM" | "LEFT" | "LEFTB" | "LEN" | "LENB" | "LINEST" | "LN" | "LOG"
        | "LOG10" | "LOGEST" | "LOGINV" | "LOGNORMDIST" | "LOOKUP" | "LOWER" | "MATCH" | "MAX"
        | "MAXA" | "MDETERM" | "MDURATION" | "MEDIAN" | "MID" | "MIDB" | "MIN" | "MINA"
        | "MINUTE" | "MINVERSE" | "MIRR" | "MMULT" | "MOD" | "MODE" | "MONTH" | "MONTHS"
        | "MROUND" | "MULTINOMIAL" | "MVALUE" | "N" | "NA" | "NEG" | "NEGBINOMDIST"
        | "NETWORKDAYS" | "NETWORKDAYS.INTL" | "NOMINAL" | "NORMDIST" | "NORMINV" | "NORMSDIST"
        | "NORMSINV" | "NOT" | "NOW" | "NPER" | "NPV" | "OCT2BIN" | "OCT2DEC" | "OCT2HEX"
        | "ODD" | "ODDFPRICE" | "ODDFYIELD" | "ODDLPRICE" | "ODDLYIELD" | "OFFSET"
        | "OPT_BARRIER" | "OPT_PROB_HIT" | "OPT_PROB_INMONEY" | "OPT_TOUCH" | "OR" | "PEARSON"
        | "PERCENTILE" | "PERCENTRANK" | "PERMUT" | "PI" | "PMT" | "POISSON" | "POWER" | "PPMT"
        | "PRICE" | "PRICEDISC" | "PRICEMAT" | "PROB" | "PRODUCT" | "PROPER" | "PV"
        | "QUARTILE" | "QUOTIENT" | "RADIANS" | "RAND" | "RANDBETWEEN" | "RANK" | "RATE"
        | "RECEIVED" | "REPLACE" | "REPLACEB" | "REPT" | "RIGHT" | "RIGHTB" | "ROMAN" | "ROT13"
        | "ROUND" | "ROUNDDOWN" | "ROUNDUP" | "ROW" | "ROWS" | "RSQ" | "SEARCH" | "SEARCHB"
        | "SECOND" | "SERIESSUM" | "SIGN" | "SIN" | "SINH" | "SKEW" | "SLN" | "SLOPE" | "SMALL"
        | "SQRT" | "SQRTPI" | "STANDARDIZE" | "STDEV" | "STDEVA" | "STDEVP" | "STDEVPA"
        | "STEYX" | "SUBSTITUTE" | "SUBTOTAL" | "SUM" | "SUMIF" | "SUMIFS" | "SUMPRODUCT"
        | "SUMSQ" | "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" | "SYD" | "T" | "TAN" | "TANH"
        | "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" | "TDIST" | "TEXT" | "TIME" | "TIMEVALUE"
        | "TINV" | "TODAY" | "TRANSPOSE" | "TREND" | "TRIM" | "TRIMMEAN" | "TRUE" | "TRUNC"
        | "TTEST" | "TYPE" | "UPPER" | "VALUE" | "VAR" | "VARA" | "VARP" | "VARPA" | "VDB"
        | "VLOOKUP" | "WEEKDAY" | "WEEKNUM" | "WEEKS" | "WEEKSINYEAR" | "WEIBULL" | "WORKDAY"
        | "WORKDAY.INTL" | "XIRR" | "XNPV" | "YEAR" | "YEARFRAC" | "YEARS" | "YIELD"
        | "YIELDDISC" | "YIELDMAT" | "ZTEST" => name,
        "RRI" => "_xlfn.RRI",
        "MULTIPLE.OPERATIONS" => "TABLE",
        "GCD_EXCEL2003" => "GCD",
        "LCM_EXCEL2003" => "LCM",
        "WEEKNUM_EXCEL2003" => "WEEKNUM",
        "NETWORKDAYS_EXCEL2003" => "NETWORKDAYS",
        "ACOT" => "_xlfn.ACOT",
        "ACOTH" => "_xlfn.ACOTH",
        "AGGREGATE" => "_xlfn.AGGREGATE",
        "ARABIC" => "_xlfn.ARABIC",
        "BAHTTEXT" => "_xlfn.BAHTTEXT",
        "BASE" => "_xlfn.BASE",
        "BETA.DIST" => "_xlfn.BETA.DIST",
        "BETA.INV" => "_xlfn.BETA.INV",
        "BINOM.DIST" => "_xlfn.BINOM.DIST",
        "BINOM.INV" => "_xlfn.BINOM.INV",
        "BITAND" => "_xlfn.BITAND",
        "BITLSHIFT" => "_xlfn.BITLSHIFT",
        "BITOR" => "_xlfn.BITOR",
        "BITRSHIFT" => "_xlfn.BITRSHIFT",
        "BITXOR" => "_xlfn.BITXOR",
        "CEILING" => "CEILING",
        "CEILING.MATH" => "_xlfn.CEILING.MATH",
        "CEILING.PRECISE" => "_xlfn.CEILING.PRECISE",
        "CEILING.XCL" => "CEILING",
        "CHISQ.DIST" => "_xlfn.CHISQ.DIST",
        "CHISQ.DIST.RT" => "_xlfn.CHISQ.DIST.RT",
        "CHISQ.INV" => "_xlfn.CHISQ.INV",
        "CHISQ.INV.RT" => "_xlfn.CHISQ.INV.RT",
        "CHISQ.TEST" => "_xlfn.CHISQ.TEST",
        "COLOR" => "_xlfn.ORG.LIBREOFFICE.COLOR",
        "COMBINA" => "_xlfn.COMBINA",
        "CONCAT" => "_xlfn.CONCAT",
        "CONFIDENCE.NORM" => "_xlfn.CONFIDENCE.NORM",
        "CONFIDENCE.T" => "_xlfn.CONFIDENCE.T",
        "CONVERT_OOO" => "_xlfn.ORG.OPENOFFICE.CONVERT",
        "COT" => "_xlfn.COT",
        "COTH" => "_xlfn.COTH",
        "COVARIANCE.P" => "_xlfn.COVARIANCE.P",
        "COVARIANCE.S" => "_xlfn.COVARIANCE.S",
        "CSC" => "_xlfn.CSC",
        "CSCH" => "_xlfn.CSCH",
        "CUMIPMT_ADD" => "CUMIPMT",
        "CUMPRINC_ADD" => "CUMPRINC",
        "CURRENT" => "_xlfn.ORG.OPENOFFICE.CURRENT",
        "DAYS" => "_xlfn.DAYS",
        "DECIMAL" => "_xlfn.DECIMAL",
        "EASTERSUNDAY" => "_xlfn.ORG.OPENOFFICE.EASTERSUNDAY",
        "EFFECT_ADD" => "EFFECT",
        "ENCODEURL" => "_xlfn.ENCODEURL",
        "ERF.PRECISE" => "_xlfn.ERF.PRECISE",
        "ERFC.PRECISE" => "_xlfn.ERFC.PRECISE",
        "ERRORTYPE" => "_xlfn.ORG.OPENOFFICE.ERRORTYPE",
        "EXPON.DIST" => "_xlfn.EXPON.DIST",
        "F.DIST" => "_xlfn.F.DIST",
        "F.DIST.RT" => "_xlfn.F.DIST.RT",
        "F.INV" => "_xlfn.F.INV",
        "F.INV.RT" => "_xlfn.F.INV.RT",
        "F.TEST" => "_xlfn.F.TEST",
        "FILTER" => "_xlfn._xlws.FILTER",
        "FILTERXML" => "_xlfn.FILTERXML",
        "FLOOR" => "FLOOR",
        "FLOOR.MATH" => "_xlfn.FLOOR.MATH",
        "FLOOR.PRECISE" => "_xlfn.FLOOR.PRECISE",
        "FLOOR.XCL" => "FLOOR",
        "FORECAST.ETS.ADD" => "_xlfn.FORECAST.ETS",
        "FORECAST.ETS.MULT" => "_xlfn.ORG.LIBREOFFICE.FORECAST.ETS.MULT",
        "FORECAST.ETS.PI.ADD" => "_xlfn.FORECAST.ETS.CONFINT",
        "FORECAST.ETS.PI.MULT" => "_xlfn.ORG.LIBREOFFICE.FORECAST.ETS.PI.MULT",
        "FORECAST.ETS.SEASONALITY" => "_xlfn.FORECAST.ETS.SEASONALITY",
        "FORECAST.ETS.STAT.ADD" => "_xlfn.FORECAST.ETS.STAT",
        "FORECAST.ETS.STAT.MULT" => "_xlfn.ORG.LIBREOFFICE.FORECAST.ETS.STAT.MULT",
        "FORECAST.LINEAR" => "_xlfn.FORECAST.LINEAR",
        "FORMULA" => "_xlfn.FORMULATEXT",
        "FOURIER" => "_xlfn.ORG.LIBREOFFICE.FOURIER",
        "GAMMA" => "_xlfn.GAMMA",
        "GAMMA.DIST" => "_xlfn.GAMMA.DIST",
        "GAMMA.INV" => "_xlfn.GAMMA.INV",
        "GAMMALN.PRECISE" => "_xlfn.GAMMALN.PRECISE",
        "GAUSS" => "_xlfn.GAUSS",
        "GOALSEEK" => "_xlfn.ORG.OPENOFFICE.GOALSEEK",
        "HYPGEOM.DIST" => "_xlfn.HYPGEOM.DIST",
        "HYPGEOMDIST" => "_xlfn.HYPGEOM.DIST",
        "IFNA" => "_xlfn.IFNA",
        "IFS" => "_xlfn.IFS",
        "ISEVEN_ADD" => "ISEVEN",
        "ISFORMULA" => "_xlfn.ISFORMULA",
        "ISODD_ADD" => "ISODD",
        "ISOWEEKNUM" => "_xlfn.ISOWEEKNUM",
        "LET" => "_xlfn.LET",
        "LOGNORM.DIST" => "_xlfn.LOGNORM.DIST",
        "LOGNORM.INV" => "_xlfn.LOGNORM.INV",
        "MAXIFS" => "_xlfn.MAXIFS",
        "MINIFS" => "_xlfn.MINIFS",
        "MODE.MULT" => "_xlfn.MODE.MULT",
        "MODE.SNGL" => "_xlfn.MODE.SNGL",
        "MULTIRANGE" => "_xlfn.ORG.OPENOFFICE.MULTIRANGE",
        "MUNIT" => "_xlfn.MUNIT",
        "NEGBINOM.DIST" => "_xlfn.NEGBINOM.DIST",
        "NOMINAL_ADD" => "NOMINAL",
        "NORM.DIST" => "_xlfn.NORM.DIST",
        "NORM.INV" => "_xlfn.NORM.INV",
        "NORM.S.DIST" => "_xlfn.NORM.S.DIST",
        "NORM.S.INV" => "_xlfn.NORM.S.INV",
        "NUMBERVALUE" => "_xlfn.NUMBERVALUE",
        "PDURATION" => "_xlfn.PDURATION",
        "PERCENTILE.EXC" => "_xlfn.PERCENTILE.EXC",
        "PERCENTILE.INC" => "_xlfn.PERCENTILE.INC",
        "PERCENTRANK.EXC" => "_xlfn.PERCENTRANK.EXC",
        "PERCENTRANK.INC" => "_xlfn.PERCENTRANK.INC",
        "PERMUTATIONA" => "_xlfn.PERMUTATIONA",
        "PHI" => "_xlfn.PHI",
        "POISSON.DIST" => "_xlfn.POISSON.DIST",
        "QUARTILE.EXC" => "_xlfn.QUARTILE.EXC",
        "QUARTILE.INC" => "_xlfn.QUARTILE.INC",
        "RAND.NV" => "_xlfn.ORG.LIBREOFFICE.RAND.NV",
        "RANDARRAY" => "_xlfn.RANDARRAY",
        "RANDBETWEEN.NV" => "_xlfn.ORG.LIBREOFFICE.RANDBETWEEN.NV",
        "RANK.AVG" => "_xlfn.RANK.AVG",
        "RANK.EQ" => "_xlfn.RANK.EQ",
        "RAWSUBTRACT" => "_xlfn.ORG.LIBREOFFICE.RAWSUBTRACT",
        "REGEX" => "_xlfn.ORG.LIBREOFFICE.REGEX",
        "ROUNDSIG" => "_xlfn.ORG.LIBREOFFICE.ROUNDSIG",
        "SEC" => "_xlfn.SEC",
        "SECH" => "_xlfn.SECH",
        "SEQUENCE" => "_xlfn.SEQUENCE",
        "SHEET" => "_xlfn.SHEET",
        "SHEETS" => "_xlfn.SHEETS",
        "SKEWP" => "_xlfn.SKEW.P",
        "SORT" => "_xlfn._xlws.SORT",
        "SORTBY" => "_xlfn.SORTBY",
        "STDEV.P" => "_xlfn.STDEV.P",
        "STDEV.S" => "_xlfn.STDEV.S",
        "STYLE" => "_xlfn.ORG.OPENOFFICE.STYLE",
        "SWITCH" => "_xlfn.SWITCH",
        "T.DIST" => "_xlfn.T.DIST",
        "T.DIST.2T" => "_xlfn.T.DIST.2T",
        "T.DIST.RT" => "_xlfn.T.DIST.RT",
        "T.INV" => "_xlfn.T.INV",
        "T.INV.2T" => "_xlfn.T.INV.2T",
        "T.TEST" => "_xlfn.T.TEST",
        "TEXTJOIN" => "_xlfn.TEXTJOIN",
        "UNICHAR" => "_xlfn.UNICHAR",
        "UNICODE" => "_xlfn.UNICODE",
        "UNIQUE" => "_xlfn.UNIQUE",
        "VAR.P" => "_xlfn.VAR.P",
        "VAR.S" => "_xlfn.VAR.S",
        "WEBSERVICE" => "_xlfn.WEBSERVICE",
        "WEEKNUM_OOO" => "_xlfn.ORG.LIBREOFFICE.WEEKNUM_OOO",
        "WEIBULL.DIST" => "_xlfn.WEIBULL.DIST",
        "XLOOKUP" => "_xlfn.XLOOKUP",
        "XMATCH" => "_xlfn.XMATCH",
        "XOR" => "_xlfn.XOR",
        "Z.TEST" => "_xlfn.Z.TEST",
        _ => return None,
    };
    Some(if excel { exported } else { name })
}

pub(in crate::commands) fn unknown(name: &str) -> String {
    let lowered = name.to_lowercase();
    if !name.contains('İ') {
        return lowered;
    }
    // Calc keeps dotted capital I in unknown names. Preserve the contextual
    // lowercase conversion (including final sigma) for every other character.
    let mut chars = lowered.chars();
    let mut output = String::with_capacity(lowered.len());
    for c in name.chars() {
        for lower in c.to_lowercase() {
            let value = chars.next().unwrap();
            if c != 'İ' {
                output.push(value);
            } else if lower == 'i' {
                output.push(c);
            }
        }
    }
    output
}

// SpreadsheetML imports use a different namespace from Calc's UI. The seven
// legacy aliases are accepted by LibreOffice's OOXML compiler, but not by CSV.
pub(in crate::commands) fn imported(name: &str) -> Option<(&str, &str)> {
    if name == "_XLFNGNUMERIC.CEIL" {
        return Some(("CEIL", "_xlfngnumeric.CEIL"));
    }
    let alias = match name {
        "EFFECTIVE" => Some("EFFECT"),
        "IFNA" | "XOR" => Some(name),
        "CEILING" => Some("CEILING.XCL"),
        "FLOOR" => Some("FLOOR.XCL"),
        "ERRORTYPE" | "MULTIRANGE" | "GOALSEEK" | "EASTERSUNDAY" | "CURRENT" | "STYLE"
        | "HYPGEOMDIST" => Some(name),
        // Retained Gnumeric extensions are evaluated by the existing importer.
        "TABLE" => return Some(("MULTIPLE.OPERATIONS", "TABLE")),
        "COLUMNNUMBER" | "ARRAY" | "FLIP" => return Some((name, name)),
        _ => None,
    };
    if let Some(alias) = alias {
        return Some((alias, self::name(alias, true)?));
    }
    if let Some(exported) = self::name(name, true)
        && exported.eq_ignore_ascii_case(name)
    {
        return Some((name, exported));
    }
    let qualified = name.strip_prefix("_XLFN.")?;
    let candidate = ["_XLWS.", "ORG.OPENOFFICE.", "ORG.LIBREOFFICE."]
        .iter()
        .find_map(|prefix| qualified.strip_prefix(prefix))
        .unwrap_or(qualified);
    let candidate = match candidate {
        "CONVERT" if qualified == "ORG.OPENOFFICE.CONVERT" => "CONVERT_OOO",
        "FORECAST.ETS" => "FORECAST.ETS.ADD",
        "FORECAST.ETS.CONFINT" => "FORECAST.ETS.PI.ADD",
        "FORECAST.ETS.STAT" => "FORECAST.ETS.STAT.ADD",
        "FORMULATEXT" => "FORMULA",
        "SKEW.P" => "SKEWP",
        _ => candidate,
    };
    let exported = self::name(candidate, true)?;
    exported
        .eq_ignore_ascii_case(name)
        .then_some((candidate, exported))
}

// ODS namespace spellings differ from the UI and from SpreadsheetML. The
// canonical names and programmatic add-in names were checked against native
// imports in soffice-ods-function-names-native.json.
#[path = "office_ods_function_names.rs"]
mod ods;

pub(in crate::commands) fn imported_ods(name: &str, legacy: bool, microsoft: bool) -> Option<&str> {
    if !microsoft {
        match name {
            "ORG.GNUMERIC.FLOOR" => return Some("FLOOR.XCL"),
            "ORG.GNUMERIC.CEILING" => return Some("CEILING.XCL"),
            _ => {}
        }
    }
    let name = if microsoft {
        name
    } else {
        if let Some(name) = name.strip_prefix("ORG.GNUMERIC.") {
            return Some(name);
        }
        name
    };
    if microsoft
        && matches!(
            name,
            "CURRENT" | "EASTERSUNDAY" | "ERRORTYPE" | "GOALSEEK" | "MULTIRANGE" | "STYLE"
        )
    {
        return Some(name);
    }
    if !legacy && !microsoft {
        match name {
            "B" | "COLOR" | "EASTERSUNDAY" | "GOALSEEK" | "TDIST" => return Some(name),
            "ZGZ" => return Some("RRI"),
            "COM.MICROSOFT.F.DIST" => return Some("F.DIST"),
            "COM.MICROSOFT.F.INV" => return Some("F.INV"),
            _ => {}
        }
    } else if legacy && name == "EFFECT" {
        return Some(name);
    }
    for &(ui, odf, old, ms) in ods::NAMES {
        if !name.is_empty()
            && name
                == if microsoft {
                    ms
                } else if legacy {
                    old
                } else {
                    odf
                }
            || !legacy && !microsoft && old.starts_with("COM.SUN.STAR.") && name == old
        {
            return Some(ui);
        }
    }
    if ods::NAMES.iter().any(|&(ui, _, _, _)| name == ui) {
        return None;
    }
    self::name(name, false)
}

pub(in crate::commands) fn openformula(name: &str) -> &str {
    ods::NAMES
        .iter()
        .find(|&&(ui, _, _, _)| ui == name)
        .map_or(name, |&(_, odf, _, _)| odf)
}

// ODS compilation lowercases functions it does not recognize. The public
// grammar still resolves those names case-insensitively, including extensions.
pub(in crate::commands) fn public_odf(name: &str) -> String {
    let upper = name.to_uppercase();
    if let Some(tail) = upper.strip_prefix("ORG.GNUMERIC.") {
        return tail.to_owned();
    }
    let name = upper.strip_prefix("COM.MICROSOFT.").unwrap_or(&upper);
    match name {
        "TIME" if name == upper => "ODF.TIME",
        "PDURATION" if name == upper => "G_DURATION",
        "SUMPRODUCT" if name == upper => "ODF.SUMPRODUCT",
        "FORMULA" if name == upper => "GET.FORMULA",
        "B" => "BINOM.DIST.RANGE",
        "CHISQINV" => "R.QCHISQ",
        "LEGACY.CHIDIST" => "CHIDIST",
        "LEGACY.CHIINV" => "CHIINV",
        "LEGACY.CHITEST" => "CHITEST",
        "LEGACY.FDIST" => "FDIST",
        "LEGACY.FINV" => "FINV",
        "LEGACY.NORMSDIST" => "NORMSDIST",
        "LEGACY.NORMSINV" => "NORMSINV",
        "LEGACY.TDIST" => "TDIST",
        "PHI" => "NORMDIST",
        "BETA.INV" => "BETAINV",
        "BINOM.DIST" => "BINOMDIST",
        "BINOM.INV" => "CRITBINOM",
        "CHISQ.DIST" => "R.PCHISQ",
        "CHISQ.DIST.RT" => "CHIDIST",
        "CHISQ.INV" => "R.QCHISQ",
        "CHISQ.INV.RT" => "CHIINV",
        "CHISQ.TEST" => "CHITEST",
        "CONFIDENCE.NORM" => "CONFIDENCE",
        "COVARIANCE.P" => "COVAR",
        "EXPON.DIST" => "EXPONDIST",
        "F.DIST.RT" => "FDIST",
        "F.INV.RT" => "FINV",
        "F.TEST" => "FTEST",
        "GAMMA.DIST" => "GAMMADIST",
        "GAMMA.INV" => "GAMMAINV",
        "HYPGEOM.DIST" => "HYPGEOMDIST",
        "LOGNORM.INV" => "LOGINV",
        "MODE.SNGL" => "MODE",
        "NORM.DIST" => "NORMDIST",
        "NORM.INV" => "NORMINV",
        "NORM.S.INV" => "NORMSINV",
        "PERCENTILE.INC" => "PERCENTILE",
        "PERCENTRANK.INC" => "PERCENTRANK",
        "POISSON.DIST" => "POISSON",
        "QUARTILE.INC" => "QUARTILE",
        "RANK.EQ" => "RANK",
        "STDEV.S" => "STDEV",
        "STDEV.P" => "STDEVP",
        "T.INV" => "R.QT",
        "T.INV.2T" => "TINV",
        "T.TEST" => "TTEST",
        "VAR.S" => "VAR",
        "VAR.P" => "VARP",
        "WEIBULL.DIST" => "WEIBULL",
        "Z.TEST" => "ZTEST",
        "ERRORTYPE" if name == upper => "ERROR.TYPE",
        _ => name,
    }
    .to_owned()
}

// Public spreadsheet-engine XLSX function aliases. Unlisted names retain their identity.
pub(in crate::commands) fn production_xlsx(name: &str) -> &str {
    match name {
        "UNIX2DATE" => "_xlfngnumeric.UNIX2DATE",
        "DATE2UNIX" => "_xlfngnumeric.DATE2UNIX",
        "ISOWEEKNUM" => "_xlfngnumeric.ISOWEEKNUM",
        "ISOYEAR" => "_xlfngnumeric.ISOYEAR",
        "DAYS" => "_xlfngnumeric.DAYS",
        "EURO" => "_xlfngnumeric.EURO",
        "G_DURATION" => "_xlfngnumeric.G_DURATION",
        "OPT_BS" => "_xlfngnumeric.OPT_BS",
        "OPT_BS_DELTA" => "_xlfngnumeric.OPT_BS_DELTA",
        "OPT_BS_RHO" => "_xlfngnumeric.OPT_BS_RHO",
        "OPT_BS_THETA" => "_xlfngnumeric.OPT_BS_THETA",
        "OPT_BS_GAMMA" => "_xlfngnumeric.OPT_BS_GAMMA",
        "OPT_BS_VEGA" => "_xlfngnumeric.OPT_BS_VEGA",
        "OPT_BS_CARRYCOST" => "_xlfngnumeric.OPT_BS_CARRYCOST",
        "CUM_BIV_NORM_DIST" => "_xlfngnumeric.CUM_BIV_NORM_DIST",
        "OPT_GARMAN_KOHLHAGEN" => "_xlfngnumeric.OPT_GARMAN_KOHLHAGEN",
        "OPT_FRENCH" => "_xlfngnumeric.OPT_FRENCH",
        "OPT_JUMP_DIFF" => "_xlfngnumeric.OPT_JUMP_DIFF",
        "OPT_EXEC" => "_xlfngnumeric.OPT_EXEC",
        "OPT_BJER_STENS" => "_xlfngnumeric.OPT_BJER_STENS",
        "OPT_MILTERSEN_SCHWARTZ" => "_xlfngnumeric.OPT_MILTERSEN_SCHWARTZ",
        "OPT_BAW_AMER" => "_xlfngnumeric.OPT_BAW_AMER",
        "OPT_RGW" => "_xlfngnumeric.OPT_RGW",
        "OPT_FORWARD_START" => "_xlfngnumeric.OPT_FORWARD_START",
        "OPT_TIME_SWITCH" => "_xlfngnumeric.OPT_TIME_SWITCH",
        "OPT_SIMPLE_CHOOSER" => "_xlfngnumeric.OPT_SIMPLE_CHOOSER",
        "OPT_COMPLEX_CHOOSER" => "_xlfngnumeric.OPT_COMPLEX_CHOOSER",
        "OPT_ON_OPTIONS" => "_xlfngnumeric.OPT_ON_OPTIONS",
        "OPT_EXTENDIBLE_WRITER" => "_xlfngnumeric.OPT_EXTENDIBLE_WRITER",
        "OPT_2_ASSET_CORRELATION" => "_xlfngnumeric.OPT_2_ASSET_CORRELATION",
        "OPT_EURO_EXCHANGE" => "_xlfngnumeric.OPT_EURO_EXCHANGE",
        "OPT_AMER_EXCHANGE" => "_xlfngnumeric.OPT_AMER_EXCHANGE",
        "OPT_SPREAD_APPROX" => "_xlfngnumeric.OPT_SPREAD_APPROX",
        "OPT_FLOAT_STRK_LKBK" => "_xlfngnumeric.OPT_FLOAT_STRK_LKBK",
        "OPT_FIXED_STRK_LKBK" => "_xlfngnumeric.OPT_FIXED_STRK_LKBK",
        "OPT_BINOMIAL" => "_xlfngnumeric.OPT_BINOMIAL",
        "ASCENSIONTHURSDAY" => "_xlfngnumeric.ASCENSIONTHURSDAY",
        "ASHWEDNESDAY" => "_xlfngnumeric.ASHWEDNESDAY",
        "EASTERSUNDAY" => "_xlfngnumeric.EASTERSUNDAY",
        "GOODFRIDAY" => "_xlfngnumeric.GOODFRIDAY",
        "PENTECOSTSUNDAY" => "_xlfngnumeric.PENTECOSTSUNDAY",
        "HDATE" => "_xlfngnumeric.HDATE",
        "HDATE_HEB" => "_xlfngnumeric.HDATE_HEB",
        "HDATE_DAY" => "_xlfngnumeric.HDATE_DAY",
        "HDATE_MONTH" => "_xlfngnumeric.HDATE_MONTH",
        "HDATE_YEAR" => "_xlfngnumeric.HDATE_YEAR",
        "HDATE_JULIAN" => "_xlfngnumeric.HDATE_JULIAN",
        "DATE2HDATE" => "_xlfngnumeric.DATE2HDATE",
        "DATE2HDATE_HEB" => "_xlfngnumeric.DATE2HDATE_HEB",
        "DATE2JULIAN" => "_xlfngnumeric.DATE2JULIAN",
        "PROBBLOCK" => "_xlfngnumeric.PROBBLOCK",
        "OFFTRAF" => "_xlfngnumeric.OFFTRAF",
        "DIMCIRC" => "_xlfngnumeric.DIMCIRC",
        "OFFCAP" => "_xlfngnumeric.OFFCAP",
        "R.DBETA" => "_xlfngnumeric.R.DBETA",
        "R.DBINOM" => "_xlfngnumeric.R.DBINOM",
        "R.DCAUCHY" => "_xlfngnumeric.R.DCAUCHY",
        "R.DCHISQ" => "_xlfngnumeric.R.DCHISQ",
        "R.DEXP" => "_xlfngnumeric.R.DEXP",
        "R.DF" => "_xlfngnumeric.R.DF",
        "R.DGAMMA" => "_xlfngnumeric.R.DGAMMA",
        "R.DGEOM" => "_xlfngnumeric.R.DGEOM",
        "R.DGUMBEL" => "_xlfngnumeric.R.DGUMBEL",
        "R.DHYPER" => "_xlfngnumeric.R.DHYPER",
        "R.DLNORM" => "_xlfngnumeric.R.DLNORM",
        "R.DNBINOM" => "_xlfngnumeric.R.DNBINOM",
        "R.DNORM" => "_xlfngnumeric.R.DNORM",
        "R.DPOIS" => "_xlfngnumeric.R.DPOIS",
        "R.DRAYLEIGH" => "_xlfngnumeric.R.DRAYLEIGH",
        "R.DSNORM" => "_xlfngnumeric.R.DSNORM",
        "R.DST" => "_xlfngnumeric.R.DST",
        "R.DT" => "_xlfngnumeric.R.DT",
        "R.DWEIBULL" => "_xlfngnumeric.R.DWEIBULL",
        "R.PBETA" => "_xlfngnumeric.R.PBETA",
        "R.PBINOM" => "_xlfngnumeric.R.PBINOM",
        "R.PCAUCHY" => "_xlfngnumeric.R.PCAUCHY",
        "R.PCHISQ" => "_xlfngnumeric.R.PCHISQ",
        "R.PEXP" => "_xlfngnumeric.R.PEXP",
        "R.PF" => "_xlfngnumeric.R.PF",
        "R.PGAMMA" => "_xlfngnumeric.R.PGAMMA",
        "R.PGEOM" => "_xlfngnumeric.R.PGEOM",
        "R.PGUMBEL" => "_xlfngnumeric.R.PGUMBEL",
        "R.PHYPER" => "_xlfngnumeric.R.PHYPER",
        "R.PLNORM" => "_xlfngnumeric.R.PLNORM",
        "R.PNBINOM" => "_xlfngnumeric.R.PNBINOM",
        "R.PNORM" => "_xlfngnumeric.R.PNORM",
        "R.PPOIS" => "_xlfngnumeric.R.PPOIS",
        "R.PRAYLEIGH" => "_xlfngnumeric.R.PRAYLEIGH",
        "R.PSNORM" => "_xlfngnumeric.R.PSNORM",
        "R.PST" => "_xlfngnumeric.R.PST",
        "R.PT" => "_xlfngnumeric.R.PT",
        "R.PTUKEY" => "_xlfngnumeric.R.PTUKEY",
        "R.PWEIBULL" => "_xlfngnumeric.R.PWEIBULL",
        "R.QBETA" => "_xlfngnumeric.R.QBETA",
        "R.QBINOM" => "_xlfngnumeric.R.QBINOM",
        "R.QCAUCHY" => "_xlfngnumeric.R.QCAUCHY",
        "R.QCHISQ" => "_xlfn.CHISQ.INV",
        "R.QEXP" => "_xlfngnumeric.R.QEXP",
        "R.QF" => "_xlfn.F.INV",
        "R.QGAMMA" => "_xlfngnumeric.R.QGAMMA",
        "R.QGEOM" => "_xlfngnumeric.R.QGEOM",
        "R.QGUMBEL" => "_xlfngnumeric.R.QGUMBEL",
        "R.QHYPER" => "_xlfngnumeric.R.QHYPER",
        "R.QLNORM" => "_xlfngnumeric.R.QLNORM",
        "R.QNBINOM" => "_xlfngnumeric.R.QNBINOM",
        "R.QNORM" => "_xlfngnumeric.R.QNORM",
        "R.QPOIS" => "_xlfngnumeric.R.QPOIS",
        "R.QRAYLEIGH" => "_xlfngnumeric.R.QRAYLEIGH",
        "R.QSNORM" => "_xlfngnumeric.R.QSNORM",
        "R.QST" => "_xlfngnumeric.R.QST",
        "R.QT" => "_xlfn.T.INV",
        "R.QTUKEY" => "_xlfngnumeric.R.QTUKEY",
        "R.QWEIBULL" => "_xlfngnumeric.R.QWEIBULL",
        "RANDBERNOULLI" => "_xlfngnumeric.RANDBERNOULLI",
        "RANDBETA" => "_xlfngnumeric.RANDBETA",
        "RANDBINOM" => "_xlfngnumeric.RANDBINOM",
        "RANDCAUCHY" => "_xlfngnumeric.RANDCAUCHY",
        "RANDCHISQ" => "_xlfngnumeric.RANDCHISQ",
        "RANDDISCRETE" => "_xlfngnumeric.RANDDISCRETE",
        "RANDEXP" => "_xlfngnumeric.RANDEXP",
        "RANDEXPPOW" => "_xlfngnumeric.RANDEXPPOW",
        "RANDFDIST" => "_xlfngnumeric.RANDFDIST",
        "RANDGAMMA" => "_xlfngnumeric.RANDGAMMA",
        "RANDNORM" => "_xlfngnumeric.RANDNORM",
        "RANDNORMTAIL" => "_xlfngnumeric.RANDNORMTAIL",
        "RANDGEOM" => "_xlfngnumeric.RANDGEOM",
        "RANDGUMBEL" => "_xlfngnumeric.RANDGUMBEL",
        "RANDHYPERG" => "_xlfngnumeric.RANDHYPERG",
        "RANDLANDAU" => "_xlfngnumeric.RANDLANDAU",
        "RANDLAPLACE" => "_xlfngnumeric.RANDLAPLACE",
        "RANDLEVY" => "_xlfngnumeric.RANDLEVY",
        "RANDLOG" => "_xlfngnumeric.RANDLOG",
        "RANDLOGISTIC" => "_xlfngnumeric.RANDLOGISTIC",
        "RANDLOGNORM" => "_xlfngnumeric.RANDLOGNORM",
        "RANDNEGBINOM" => "_xlfngnumeric.RANDNEGBINOM",
        "RANDPARETO" => "_xlfngnumeric.RANDPARETO",
        "RANDPOISSON" => "_xlfngnumeric.RANDPOISSON",
        "RANDRAYLEIGH" => "_xlfngnumeric.RANDRAYLEIGH",
        "RANDRAYLEIGHTAIL" => "_xlfngnumeric.RANDRAYLEIGHTAIL",
        "RANDSNORM" => "_xlfngnumeric.RANDSNORM",
        "RANDSTDIST" => "_xlfngnumeric.RANDSTDIST",
        "RANDTDIST" => "_xlfngnumeric.RANDTDIST",
        "RANDUNIFORM" => "_xlfngnumeric.RANDUNIFORM",
        "RANDWEIBULL" => "_xlfngnumeric.RANDWEIBULL",
        "SIMTABLE" => "_xlfngnumeric.SIMTABLE",
        "ADTEST" => "_xlfngnumeric.ADTEST",
        "BETAINV" => "_xlfn.BETA.INV",
        "BINOM.DIST.RANGE" => "_xlfngnumeric.BINOM.DIST.RANGE",
        "BINOMDIST" => "_xlfn.BINOM.DIST",
        "CHIDIST" => "_xlfn.CHISQ.DIST.RT",
        "CHIINV" => "_xlfn.CHISQ.INV.RT",
        "CHITEST" => "_xlfn.CHISQ.TEST",
        "CONFIDENCE" => "_xlfn.CONFIDENCE.NORM",
        "COVAR" => "_xlfn.COVARIANCE.P",
        "CRONBACH" => "_xlfngnumeric.CRONBACH",
        "CVMTEST" => "_xlfngnumeric.CVMTEST",
        "EXPONDIST" => "_xlfn.EXPON.DIST",
        "EXPPOWDIST" => "_xlfngnumeric.EXPPOWDIST",
        "FDIST" => "_xlfn.F.DIST.RT",
        "FINV" => "_xlfn.F.INV.RT",
        "FORECAST" => "_xlfn.FORECAST.LINEAR",
        "FTEST" => "_xlfn.F.TEST",
        "GAMMADIST" => "_xlfn.GAMMA.DIST",
        "GAMMAINV" => "_xlfn.GAMMA.INV",
        "GEOMDIST" => "_xlfngnumeric.GEOMDIST",
        "HYPGEOMDIST" => "_xlfn.HYPGEOM.DIST",
        "KURTP" => "_xlfngnumeric.KURTP",
        "LANDAU" => "_xlfngnumeric.LANDAU",
        "LAPLACE" => "_xlfngnumeric.LAPLACE",
        "LEVERAGE" => "_xlfngnumeric.LEVERAGE",
        "LKSTEST" => "_xlfngnumeric.LKSTEST",
        "LOGFIT" => "_xlfngnumeric.LOGFIT",
        "LOGINV" => "_xlfn.LOGNORM.INV",
        "LOGISTIC" => "_xlfngnumeric.LOGISTIC",
        "LOGREG" => "_xlfngnumeric.LOGREG",
        "MODE" => "_xlfn.MODE.SNGL",
        "NORMDIST" => "_xlfn.NORM.DIST",
        "NORMINV" => "_xlfn.NORM.INV",
        "SNORM.DIST.RANGE" => "_xlfngnumeric.SNORM.DIST.RANGE",
        "NORMSINV" => "_xlfn.NORM.S.INV",
        "OWENT" => "_xlfngnumeric.OWENT",
        "PARETO" => "_xlfngnumeric.PARETO",
        "PERCENTILE" => "_xlfn.PERCENTILE.INC",
        "PERCENTRANK" => "_xlfn.PERCENTRANK.INC",
        "POISSON" => "_xlfn.POISSON.DIST",
        "QUARTILE" => "_xlfn.QUARTILE.INC",
        "RANK" => "_xlfn.RANK.EQ",
        "RAYLEIGH" => "_xlfngnumeric.RAYLEIGH",
        "RAYLEIGHTAIL" => "_xlfngnumeric.RAYLEIGHTAIL",
        "SFTEST" => "_xlfngnumeric.SFTEST",
        "SKEWP" => "_xlfn.SKEW.P",
        "SSMEDIAN" => "_xlfngnumeric.SSMEDIAN",
        "STDEV" => "_xlfn.STDEV.S",
        "STDEVP" => "_xlfn.STDEV.P",
        "TINV" => "_xlfn.T.INV.2T",
        "TTEST" => "_xlfn.T.TEST",
        "VAR" => "_xlfn.VAR.S",
        "VARP" => "_xlfn.VAR.P",
        "WEIBULL" => "_xlfn.WEIBULL.DIST",
        "ZTEST" => "_xlfn.Z.TEST",
        "IMFACT" => "_xlfngnumeric.IMFACT",
        "IMGAMMA" => "_xlfngnumeric.IMGAMMA",
        "IMIGAMMA" => "_xlfngnumeric.IMIGAMMA",
        "IMINV" => "_xlfngnumeric.IMINV",
        "BASE" => "_xlfngnumeric.BASE",
        "DECIMAL" => "_xlfngnumeric.DECIMAL",
        "HEXREP" => "_xlfngnumeric.HEXREP",
        "INVSUMINV" => "_xlfngnumeric.INVSUMINV",
        "FLT.MAX" => "_xlfngnumeric.FLT.MAX",
        "FLT.MIN" => "_xlfngnumeric.FLT.MIN",
        "FLT.NEXTAFTER" => "_xlfngnumeric.FLT.NEXTAFTER",
        "FLT.RADIX" => "_xlfngnumeric.FLT.RADIX",
        "AGM" => "_xlfngnumeric.AGM",
        "BETA" => "_xlfngnumeric.BETA",
        "BETALN" => "_xlfngnumeric.BETALN",
        "CEIL" => "_xlfngnumeric.CEIL",
        "CHOLESKY" => "_xlfngnumeric.CHOLESKY",
        "COSPI" => "_xlfngnumeric.COSPI",
        "CSC" => "_xlfngnumeric.CSC",
        "CSCH" => "_xlfngnumeric.CSCH",
        "DIGAMMA" => "_xlfngnumeric.DIGAMMA",
        "EIGEN" => "_xlfngnumeric.EIGEN",
        "EXPM1" => "_xlfngnumeric.EXPM1",
        "GAMMA" => "_xlfngnumeric.GAMMA",
        "HYPOT" => "_xlfngnumeric.HYPOT",
        "IGAMMA" => "_xlfngnumeric.IGAMMA",
        "ILOG" => "_xlfngnumeric.ILOG",
        "LINSOLVE" => "_xlfngnumeric.LINSOLVE",
        "LN1P" => "_xlfngnumeric.LN1P",
        "MPSEUDOINVERSE" => "_xlfngnumeric.MPSEUDOINVERSE",
        "POCHHAMMER" => "_xlfngnumeric.POCHHAMMER",
        "REDUCEPI" => "_xlfngnumeric.REDUCEPI",
        "SEC" => "_xlfngnumeric.SEC",
        "SECH" => "_xlfngnumeric.SECH",
        "SINPI" => "_xlfngnumeric.SINPI",
        "ISPRIME" => "_xlfngnumeric.ISPRIME",
        "ITHPRIME" => "_xlfngnumeric.ITHPRIME",
        "NT_D" => "_xlfngnumeric.NT_D",
        "NT_MU" => "_xlfngnumeric.NT_MU",
        "NT_OMEGA" => "_xlfngnumeric.NT_OMEGA",
        "NT_PHI" => "_xlfngnumeric.NT_PHI",
        "NT_PI" => "_xlfngnumeric.NT_PI",
        "NT_RADICAL" => "_xlfngnumeric.NT_RADICAL",
        "NT_SIGMA" => "_xlfngnumeric.NT_SIGMA",
        "PFACTOR" => "_xlfngnumeric.PFACTOR",
        "BITAND" => "_xlfngnumeric.BITAND",
        "BITLSHIFT" => "_xlfngnumeric.BITLSHIFT",
        "BITOR" => "_xlfngnumeric.BITOR",
        "BITRSHIFT" => "_xlfngnumeric.BITRSHIFT",
        "BITXOR" => "_xlfngnumeric.BITXOR",
        "ERF" => "_xlfn.ERF.PRECISE",
        "ERFC" => "_xlfn.ERFC.PRECISE",
        "GAMMALN" => "_xlfn.GAMMALN.PRECISE",
        _ => name,
    }
}

// Canonical native spelling from the public numeric, date/finance and statistics descriptors.
pub(in crate::commands) fn public_native(name: &str) -> String {
    if matches!(
        name,
        "ABS"
            | "ACCRINT"
            | "ACCRINTM"
            | "ACOS"
            | "ACOSH"
            | "ACOT"
            | "ACOTH"
            | "ADTEST"
            | "AGM"
            | "AMORDEGRC"
            | "AMORLINC"
            | "ARABIC"
            | "ASCENSIONTHURSDAY"
            | "ASHWEDNESDAY"
            | "ASIN"
            | "ASINH"
            | "ATAN"
            | "ATAN2"
            | "ATANH"
            | "AVEDEV"
            | "AVERAGE"
            | "AVERAGEA"
            | "AVERAGEIF"
            | "AVERAGEIFS"
            | "BASE"
            | "BERNOULLI"
            | "BESSELI"
            | "BESSELJ"
            | "BESSELK"
            | "BESSELY"
            | "BETA"
            | "BETA.DIST"
            | "BETADIST"
            | "BETAINV"
            | "BETALN"
            | "BIN2DEC"
            | "BIN2HEX"
            | "BIN2OCT"
            | "BINOM.DIST.RANGE"
            | "BINOMDIST"
            | "BITAND"
            | "BITLSHIFT"
            | "BITOR"
            | "BITRSHIFT"
            | "BITXOR"
            | "CAUCHY"
            | "CEIL"
            | "CEILING"
            | "CHIDIST"
            | "CHIINV"
            | "CHITEST"
            | "CHOLESKY"
            | "COMBIN"
            | "COMBINA"
            | "COMPLEX"
            | "CONFIDENCE"
            | "CONFIDENCE.T"
            | "CONVERT"
            | "CORREL"
            | "COS"
            | "COSH"
            | "COSPI"
            | "COT"
            | "COTH"
            | "COTPI"
            | "COUNT"
            | "COUNTA"
            | "COUNTIF"
            | "COUNTIFS"
            | "COUPDAYBS"
            | "COUPDAYS"
            | "COUPDAYSNC"
            | "COUPNCD"
            | "COUPNUM"
            | "COUPPCD"
            | "COVAR"
            | "COVARIANCE.S"
            | "CRITBINOM"
            | "CRONBACH"
            | "CSC"
            | "CSCH"
            | "CUMIPMT"
            | "CUMPRINC"
            | "CUM_BIV_NORM_DIST"
            | "CVMTEST"
            | "DATE"
            | "DATE2HDATE"
            | "DATE2HDATE_HEB"
            | "DATE2JULIAN"
            | "DATE2UNIX"
            | "DATEDIF"
            | "DATEVALUE"
            | "DAY"
            | "DAYS"
            | "DAYS360"
            | "DB"
            | "DDB"
            | "DEC2BIN"
            | "DEC2HEX"
            | "DEC2OCT"
            | "DECIMAL"
            | "DEGREES"
            | "DELTA"
            | "DEVSQ"
            | "DIGAMMA"
            | "DIMCIRC"
            | "DISC"
            | "DOLLARDE"
            | "DOLLARFR"
            | "DURATION"
            | "EASTERSUNDAY"
            | "EDATE"
            | "EFFECT"
            | "EIGEN"
            | "EOMONTH"
            | "ERF"
            | "ERFC"
            | "EURO"
            | "EUROCONVERT"
            | "EVEN"
            | "EXP"
            | "EXPM1"
            | "EXPONDIST"
            | "EXPPOWDIST"
            | "FACT"
            | "FACTDOUBLE"
            | "FDIST"
            | "FIB"
            | "FINV"
            | "FISHER"
            | "FISHERINV"
            | "FLOOR"
            | "FLT.MAX"
            | "FLT.MIN"
            | "FLT.NEXTAFTER"
            | "FLT.RADIX"
            | "FORECAST"
            | "FOURIER"
            | "FREQUENCY"
            | "FTEST"
            | "FV"
            | "FVSCHEDULE"
            | "GAMMA"
            | "GAMMADIST"
            | "GAMMAINV"
            | "GAMMALN"
            | "GCD"
            | "GD"
            | "GEOMDIST"
            | "GEOMEAN"
            | "GESTEP"
            | "GOODFRIDAY"
            | "GROWTH"
            | "G_DURATION"
            | "G_PRODUCT"
            | "HARMEAN"
            | "HDATE"
            | "HDATE_DAY"
            | "HDATE_HEB"
            | "HDATE_JULIAN"
            | "HDATE_MONTH"
            | "HDATE_YEAR"
            | "HEX2BIN"
            | "HEX2DEC"
            | "HEX2OCT"
            | "HEXREP"
            | "HOUR"
            | "HPFILTER"
            | "HYPGEOMDIST"
            | "HYPOT"
            | "IGAMMA"
            | "ILOG"
            | "IMABS"
            | "IMAGINARY"
            | "IMARCCOS"
            | "IMARCCOSH"
            | "IMARCCOT"
            | "IMARCCOTH"
            | "IMARCCSC"
            | "IMARCCSCH"
            | "IMARCSEC"
            | "IMARCSECH"
            | "IMARCSIN"
            | "IMARCSINH"
            | "IMARCTAN"
            | "IMARCTANH"
            | "IMARGUMENT"
            | "IMCONJUGATE"
            | "IMCOS"
            | "IMCOSH"
            | "IMCOT"
            | "IMCOTH"
            | "IMCSC"
            | "IMCSCH"
            | "IMDIV"
            | "IMEXP"
            | "IMFACT"
            | "IMGAMMA"
            | "IMIGAMMA"
            | "IMINV"
            | "IMLN"
            | "IMLOG10"
            | "IMLOG2"
            | "IMNEG"
            | "IMPOWER"
            | "IMPRODUCT"
            | "IMREAL"
            | "IMSEC"
            | "IMSECH"
            | "IMSIN"
            | "IMSINH"
            | "IMSQRT"
            | "IMSUB"
            | "IMSUM"
            | "IMTAN"
            | "IMTANH"
            | "INT"
            | "INTERCEPT"
            | "INTERPOLATION"
            | "INTRATE"
            | "INVSUMINV"
            | "IPMT"
            | "IRR"
            | "ISOWEEKNUM"
            | "ISOYEAR"
            | "ISPMT"
            | "ISPRIME"
            | "ITHPRIME"
            | "KURT"
            | "KURTP"
            | "LAMBERTW"
            | "LANDAU"
            | "LAPLACE"
            | "LARGE"
            | "LCM"
            | "LEVERAGE"
            | "LINEST"
            | "LINSOLVE"
            | "LKSTEST"
            | "LN"
            | "LN1P"
            | "LOG"
            | "LOG10"
            | "LOG2"
            | "LOGEST"
            | "LOGFIT"
            | "LOGINV"
            | "LOGISTIC"
            | "LOGNORMDIST"
            | "LOGREG"
            | "MAX"
            | "MAXA"
            | "MAXIFS"
            | "MDETERM"
            | "MDURATION"
            | "MEDIAN"
            | "MIN"
            | "MINA"
            | "MINIFS"
            | "MINUTE"
            | "MINVERSE"
            | "MIRR"
            | "MMULT"
            | "MOD"
            | "MODE"
            | "MODE.MULT"
            | "MONTH"
            | "MPSEUDOINVERSE"
            | "MROUND"
            | "MULTINOMIAL"
            | "MUNIT"
            | "NEGBINOMDIST"
            | "NETWORKDAYS"
            | "NOMINAL"
            | "NORMDIST"
            | "NORMINV"
            | "NORMSDIST"
            | "NORMSINV"
            | "NOW"
            | "NPER"
            | "NPV"
            | "NT_D"
            | "NT_MU"
            | "NT_OMEGA"
            | "NT_PHI"
            | "NT_PI"
            | "NT_RADICAL"
            | "NT_SIGMA"
            | "OCT2BIN"
            | "OCT2DEC"
            | "OCT2HEX"
            | "ODD"
            | "ODDFPRICE"
            | "ODDFYIELD"
            | "ODDLPRICE"
            | "ODDLYIELD"
            | "ODF.SUMPRODUCT"
            | "ODF.TIME"
            | "OFFCAP"
            | "OFFTRAF"
            | "OPT_2_ASSET_CORRELATION"
            | "OPT_AMER_EXCHANGE"
            | "OPT_BAW_AMER"
            | "OPT_BINOMIAL"
            | "OPT_BJER_STENS"
            | "OPT_BS"
            | "OPT_BS_CARRYCOST"
            | "OPT_BS_DELTA"
            | "OPT_BS_GAMMA"
            | "OPT_BS_RHO"
            | "OPT_BS_THETA"
            | "OPT_BS_VEGA"
            | "OPT_COMPLEX_CHOOSER"
            | "OPT_EURO_EXCHANGE"
            | "OPT_EXEC"
            | "OPT_EXTENDIBLE_WRITER"
            | "OPT_FIXED_STRK_LKBK"
            | "OPT_FLOAT_STRK_LKBK"
            | "OPT_FORWARD_START"
            | "OPT_FRENCH"
            | "OPT_GARMAN_KOHLHAGEN"
            | "OPT_JUMP_DIFF"
            | "OPT_MILTERSEN_SCHWARTZ"
            | "OPT_ON_OPTIONS"
            | "OPT_RGW"
            | "OPT_SIMPLE_CHOOSER"
            | "OPT_SPREAD_APPROX"
            | "OPT_TIME_SWITCH"
            | "OWENT"
            | "PARETO"
            | "PEARSON"
            | "PENTECOSTSUNDAY"
            | "PERCENTILE"
            | "PERCENTILE.EXC"
            | "PERCENTRANK"
            | "PERCENTRANK.EXC"
            | "PERIODOGRAM"
            | "PERMUT"
            | "PERMUTATIONA"
            | "PFACTOR"
            | "PI"
            | "PMT"
            | "POCHHAMMER"
            | "POISSON"
            | "POWER"
            | "PPMT"
            | "PRICE"
            | "PRICEDISC"
            | "PRICEMAT"
            | "PROB"
            | "PROBBLOCK"
            | "PV"
            | "QUARTILE"
            | "QUARTILE.EXC"
            | "QUOTIENT"
            | "R.DBETA"
            | "R.DBINOM"
            | "R.DCAUCHY"
            | "R.DCHISQ"
            | "R.DEXP"
            | "R.DF"
            | "R.DGAMMA"
            | "R.DGEOM"
            | "R.DGUMBEL"
            | "R.DHYPER"
            | "R.DLNORM"
            | "R.DNBINOM"
            | "R.DNORM"
            | "R.DPOIS"
            | "R.DRAYLEIGH"
            | "R.DSNORM"
            | "R.DST"
            | "R.DT"
            | "R.DWEIBULL"
            | "R.PBETA"
            | "R.PBINOM"
            | "R.PCAUCHY"
            | "R.PCHISQ"
            | "R.PEXP"
            | "R.PF"
            | "R.PGAMMA"
            | "R.PGEOM"
            | "R.PGUMBEL"
            | "R.PHYPER"
            | "R.PLNORM"
            | "R.PNBINOM"
            | "R.PNORM"
            | "R.PPOIS"
            | "R.PRAYLEIGH"
            | "R.PSNORM"
            | "R.PST"
            | "R.PT"
            | "R.PTUKEY"
            | "R.PWEIBULL"
            | "R.QBETA"
            | "R.QBINOM"
            | "R.QCAUCHY"
            | "R.QCHISQ"
            | "R.QEXP"
            | "R.QF"
            | "R.QGAMMA"
            | "R.QGEOM"
            | "R.QGUMBEL"
            | "R.QHYPER"
            | "R.QLNORM"
            | "R.QNBINOM"
            | "R.QNORM"
            | "R.QPOIS"
            | "R.QRAYLEIGH"
            | "R.QSNORM"
            | "R.QST"
            | "R.QT"
            | "R.QTUKEY"
            | "R.QWEIBULL"
            | "RADIANS"
            | "RAND"
            | "RANDBERNOULLI"
            | "RANDBETA"
            | "RANDBETWEEN"
            | "RANDBINOM"
            | "RANDCAUCHY"
            | "RANDCHISQ"
            | "RANDDISCRETE"
            | "RANDEXP"
            | "RANDEXPPOW"
            | "RANDFDIST"
            | "RANDGAMMA"
            | "RANDGEOM"
            | "RANDGUMBEL"
            | "RANDHYPERG"
            | "RANDLANDAU"
            | "RANDLAPLACE"
            | "RANDLEVY"
            | "RANDLOG"
            | "RANDLOGISTIC"
            | "RANDLOGNORM"
            | "RANDNEGBINOM"
            | "RANDNORM"
            | "RANDNORMTAIL"
            | "RANDPARETO"
            | "RANDPOISSON"
            | "RANDRAYLEIGH"
            | "RANDRAYLEIGHTAIL"
            | "RANDSNORM"
            | "RANDSTDIST"
            | "RANDTDIST"
            | "RANDUNIFORM"
            | "RANDWEIBULL"
            | "RANK"
            | "RANK.AVG"
            | "RATE"
            | "RAYLEIGH"
            | "RAYLEIGHTAIL"
            | "RECEIVED"
            | "REDUCEPI"
            | "ROMAN"
            | "ROUND"
            | "ROUNDDOWN"
            | "ROUNDUP"
            | "RRI"
            | "RSQ"
            | "SEC"
            | "SECH"
            | "SECOND"
            | "SERIESSUM"
            | "SFTEST"
            | "SIGN"
            | "SIMTABLE"
            | "SIN"
            | "SINH"
            | "SINPI"
            | "SKEW"
            | "SKEWP"
            | "SLN"
            | "SLOPE"
            | "SMALL"
            | "SNORM.DIST.RANGE"
            | "SQRT"
            | "SQRTPI"
            | "SSMEDIAN"
            | "STANDARDIZE"
            | "STDEV"
            | "STDEVA"
            | "STDEVP"
            | "STDEVPA"
            | "STEYX"
            | "SUBTOTAL"
            | "SUMA"
            | "SUMIF"
            | "SUMIFS"
            | "SUMPRODUCT"
            | "SUMSQ"
            | "SUMX2MY2"
            | "SUMX2PY2"
            | "SUMXMY2"
            | "SYD"
            | "TAN"
            | "TANH"
            | "TANPI"
            | "TBILLEQ"
            | "TBILLPRICE"
            | "TBILLYIELD"
            | "TDIST"
            | "TIME"
            | "TIMEVALUE"
            | "TINV"
            | "TODAY"
            | "TREND"
            | "TRIMMEAN"
            | "TRUNC"
            | "TTEST"
            | "UNIX2DATE"
            | "VAR"
            | "VARA"
            | "VARP"
            | "VARPA"
            | "VDB"
            | "WEEKDAY"
            | "WEEKNUM"
            | "WEIBULL"
            | "WORKDAY"
            | "XIRR"
            | "XNPV"
            | "YEAR"
            | "YEARFRAC"
            | "YIELD"
            | "YIELDDISC"
            | "YIELDMAT"
            | "ZTEST"
    ) {
        name.to_ascii_lowercase()
    } else {
        name.to_owned()
    }
}
