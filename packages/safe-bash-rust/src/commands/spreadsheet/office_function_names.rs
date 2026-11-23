// Calc CSV function names and SpreadsheetML spellings, independently exported
// with LibreOffice 24.8.7.2. See soffice-function-names-native.json.
// Recognition is independent of the evaluator's implemented functions.
pub(in crate::commands) fn name(name: &str, excel: bool) -> Option<&str> {
    let exported = match name {
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
        "ARRAYTOTEXT" => "_xlfn.ARRAYTOTEXT",
        "PERCENTOF" => "_xlfn.PERCENTOF",
        "VALUETOTEXT" => "_xlfn.VALUETOTEXT",
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
        "BINOM.DIST.RANGE" => "_xlfn.BINOM.DIST.RANGE",
        "BINOM.INV" => "_xlfn.BINOM.INV",
        "BITAND" => "_xlfn.BITAND",
        "BITLSHIFT" => "_xlfn.BITLSHIFT",
        "BITOR" => "_xlfn.BITOR",
        "BITRSHIFT" => "_xlfn.BITRSHIFT",
        "BITXOR" => "_xlfn.BITXOR",
        "CEILING" => "_xlfn.CEILING.MATH",
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
        "DBCS" => "JIS",
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
        "FLOOR" => "_xlfn.FLOOR.MATH",
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
        "LAMBDA" => "_xlfn.LAMBDA",
        "MAP" => "_xlfn.MAP",
        "REDUCE" => "_xlfn.REDUCE",
        "SCAN" => "_xlfn.SCAN",
        "BYROW" => "_xlfn.BYROW",
        "BYCOL" => "_xlfn.BYCOL",
        "MAKEARRAY" => "_xlfn.MAKEARRAY",
        "ISOMITTED" => "_xlfn.ISOMITTED",
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
        "REGEXTEST" | "REGEXMATCH" => "_xlfn.REGEXTEST",
        "REGEXEXTRACT" => "_xlfn.REGEXEXTRACT",
        "REGEXREPLACE" => "_xlfn.REGEXREPLACE",
        "REGEX" => "_xlfn.ORG.LIBREOFFICE.REGEX",
        "ROUNDSIG" => "_xlfn.ORG.LIBREOFFICE.ROUNDSIG",
        "SEC" => "_xlfn.SEC",
        "SECH" => "_xlfn.SECH",
        "TEXTSPLIT" => "_xlfn.TEXTSPLIT",
        "TEXTBEFORE" => "_xlfn.TEXTBEFORE",
        "TEXTAFTER" => "_xlfn.TEXTAFTER",
        "WRAPROWS" => "_xlfn.WRAPROWS",
        "WRAPCOLS" => "_xlfn.WRAPCOLS",
        "TRIMRANGE" => "_xlfn.TRIMRANGE",
        "EXPAND" => "_xlfn.EXPAND",
        "TAKE" => "_xlfn.TAKE",
        "DROP" => "_xlfn.DROP",
        "TOCOL" => "_xlfn.TOCOL",
        "TOROW" => "_xlfn.TOROW",
        "HSTACK" => "_xlfn.HSTACK",
        "VSTACK" => "_xlfn.VSTACK",
        "CHOOSECOLS" => "_xlfn.CHOOSECOLS",
        "CHOOSEROWS" => "_xlfn.CHOOSEROWS",
        "SEQUENCE" => "_xlfn.SEQUENCE",
        "ANCHORARRAY" => "_xlfn.ANCHORARRAY",
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
    if let Some(pair) = name.strip_prefix("_XLFN.").and_then(editor_complex) {
        return Some(pair);
    }
    let alias = match name {
        "EFFECTIVE" => Some("EFFECT"),
        "_XLFN.NETWORKDAYS.INTL" => Some("NETWORKDAYS.INTL"),
        "_XLFN.WORKDAY.INTL" => Some("WORKDAY.INTL"),
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

// Excel 2013 engineering functions require this prefix. Calc's native CSV
// exporter uses bare names, so keep the editor's export mapping separate.
pub(in crate::commands) fn editor_complex(name: &str) -> Option<(&'static str, &'static str)> {
    Some(match name {
        "IMCOSH" => ("IMCOSH", "_xlfn.IMCOSH"),
        "IMCOT" => ("IMCOT", "_xlfn.IMCOT"),
        "IMCSC" => ("IMCSC", "_xlfn.IMCSC"),
        "IMCSCH" => ("IMCSCH", "_xlfn.IMCSCH"),
        "IMSEC" => ("IMSEC", "_xlfn.IMSEC"),
        "IMSECH" => ("IMSECH", "_xlfn.IMSECH"),
        "IMSINH" => ("IMSINH", "_xlfn.IMSINH"),
        "IMTAN" => ("IMTAN", "_xlfn.IMTAN"),
        _ => return None,
    })
}
