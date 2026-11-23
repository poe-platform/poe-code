// Adapted from IronCalc base/src/functions/math_and_trigonometry/mathematical.rs
// and base/src/arithmetic.rs, revision f93662006b8fb1c401dc870bbda26c5d60ac6037.
// Copyright 2023 EqualTo GmbH; 2023–Present IronCalc contributors;
// 2026–Present IronCalc GmbH. MIT license: LICENSE.IronCalc.
// FISHER/FISHERINV follow statistical/fisher.rs at the same revision. Reuse
// atanh/tanh to retain tiny correlations and avoid exponential overflow.
// DELTA/GESTEP adapt engineering/misc.rs at that revision: compare 16
// significant digits, reject booleans, and default the second argument to zero.
use super::{Value, lookup::number};
use std::f64::consts::PI;

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "PI" => (0, 0),
        "MROUND" | "ATAN2" | "POWER" | "QUOTIENT" | "FLOOR" | "FLOOR.XCL" | "CEILING"
        | "CEILING.XCL" | "ECMA.CEILING" => (2, 2),
        "FLOOR.MATH" | "CEILING.MATH" => (1, 3),
        "FLOOR.PRECISE" | "CEILING.PRECISE" | "ISO.CEILING" => (1, 2),
        "LOG" | "DELTA" | "GESTEP" => (1, 2),
        "LN" | "LOG10" | "SIN" | "COS" | "TAN" | "SINH" | "COSH" | "TANH" | "ASIN" | "ACOS"
        | "ATAN" | "ASINH" | "ACOSH" | "ATANH" | "SQRTPI" | "ACOT" | "ACOTH" | "COT" | "COTH"
        | "CSC" | "CSCH" | "SEC" | "SECH" | "EXP" | "SIGN" | "DEGREES" | "RADIANS" | "ODD"
        | "EVEN" | "FACTDOUBLE" | "FISHER" | "FISHERINV" => (1, 1),
        _ => return None,
    })
}

pub(super) fn calculate(name: &str, args: &[&Value], date1904: bool, excel: bool) -> Value {
    let threshold = matches!(name, "DELTA" | "GESTEP");
    let mut numbers = [
        0.,
        if name == "LOG" {
            10.
        } else if threshold {
            0.
        } else {
            1.
        },
        0.,
    ];
    for (i, arg) in args.iter().enumerate() {
        if let Value::Error(error) | Value::LiteralError(error) = arg {
            return Value::Error(error);
        }
        if (name == "MROUND" || threshold) && matches!(arg, Value::Bool(_)) {
            return Value::Error("#VALUE!");
        }
        numbers[i] = match arg {
            Value::Text(s) | Value::UninternedText(s) => {
                if (threshold || matches!(name, "FISHER" | "FISHERINV" | "MROUND"))
                    && (s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    if matches!(name, "MROUND" | "INT")
                        || excel
                            && (name.starts_with("FLOOR")
                                || name.starts_with("CEILING")
                                || name == "ISO.CEILING")
                    {
                        number::parse_excel(s, date1904)
                    } else {
                        number::parse(s, date1904)
                    }
                }
            }
            _ => arg.numeric(),
        }
        .unwrap_or(f64::NAN);
        if numbers[i].is_nan() {
            return Value::Error("#VALUE!");
        }
    }
    let [x, y, mode] = numbers;
    let result = match name {
        "DELTA" | "GESTEP" => {
            // Excel's threshold functions suppress the last binary rounding
            // digit, while still distinguishing 3 + 1e-15 from 3. Scientific
            // formatting bounds these temporary strings even at f64 extremes.
            let rounded = |n: f64| format!("{n:.15e}").parse::<f64>().unwrap_or(n);
            if x == y || name == "GESTEP" && x > y || rounded(x) == rounded(y) {
                1.
            } else {
                0.
            }
        }
        "PI" => PI,
        "INT" => x.floor(),
        "MROUND" => {
            if !x.is_finite() || !y.is_finite() {
                return Value::Error("#NUM!");
            }
            if y == 0. {
                return Value::Number(0.);
            }
            if x > 0. && y < 0. || x < 0. && y > 0. {
                return Value::Error("#NUM!");
            }
            // IronCalc mathematical.rs rounds ties away from zero. Once the
            // quotient exceeds binary64's integer precision, no representable
            // rounding is needed; this also avoids quotient overflow.
            let ratio = x / y;
            if ratio >= 4503599627370496. {
                x
            } else {
                ratio.round() * y
            }
        }
        "LN" | "LOG10" if x <= 0. => return Value::Error("#NUM!"),
        "LN" => x.ln(),
        "LOG10" => x.log10(),
        "SIN" => x.sin(),
        "COS" => x.cos(),
        "TAN" => x.tan(),
        "SINH" => x.sinh(),
        "COSH" => x.cosh(),
        "TANH" | "FISHERINV" => x.tanh(),
        "ASIN" => x.asin(),
        "ACOS" => x.acos(),
        "ATAN" => x.atan(),
        "ASINH" => x.asinh(),
        "ACOSH" => x.acosh(),
        "ATANH" | "FISHER" => x.atanh(),
        "SQRTPI" => (x * PI).sqrt(),
        "ACOT" => {
            if x >= 0. {
                (1. / x).atan()
            } else {
                (1. / x).atan() + PI
            }
        }
        "ACOTH" => {
            if x.abs() == 1. {
                return Value::Error("#NUM!");
            } else {
                0.5 * ((x + 1.) / (x - 1.)).ln()
            }
        }
        "COT" | "COTH" | "CSC" | "CSCH" if x == 0. => return Value::Error("#DIV/0!"),
        "COT" => x.cos() / x.sin(),
        "COTH" => {
            if x.abs() > 20. {
                x.signum()
            } else {
                x.cosh() / x.sinh()
            }
        }
        "CSC" => 1. / x.sin(),
        "CSCH" => 1. / x.sinh(),
        "SEC" => 1. / x.cos(),
        "SECH" => 1. / x.cosh(),
        "EXP" => x.exp(),
        "SIGN" => {
            if x == 0. {
                0.
            } else {
                x.signum()
            }
        }
        "DEGREES" => x * (180. / PI),
        "RADIANS" => x * (PI / 180.),
        "ODD" => x.signum() * (((x.abs() - 1.) / 2.).ceil() * 2. + 1.),
        "EVEN" => x.signum() * (x.abs() / 2.).ceil() * 2.,
        "ATAN2" => {
            if x == 0. && y == 0. {
                return Value::Error("#DIV/0!");
            } else {
                y.atan2(x)
            }
        }
        "LOG" => {
            if x <= 0. || y <= 0. {
                return Value::Error("#NUM!");
            }
            if y == 1. {
                return Value::Error("#DIV/0!");
            }
            x.log(y)
        }
        "QUOTIENT" => {
            if y == 0. {
                return Value::Error("#DIV/0!");
            }
            (x / y).trunc()
        }
        "POWER" => {
            if x == 0. && y == 0. {
                return Value::Error("#NUM!");
            }
            if y == 0. {
                return Value::Number(1.);
            }
            let inverse = 1. / y;
            let integer = inverse.round();
            let odd_root = (inverse - integer).abs() <= integer.abs() / (16_777_216. * 16_777_216.)
                && integer % 2. != 0.;
            let result = if x < 0. && odd_root {
                -(-x).powf(y)
            } else {
                x.powf(y)
            };
            if result.is_infinite() {
                return Value::Error("#DIV/0!");
            }
            result
        }
        "FLOOR" | "FLOOR.XCL" | "FLOOR.MATH" | "FLOOR.PRECISE" | "CEILING" | "CEILING.XCL"
        | "CEILING.MATH" | "CEILING.PRECISE" | "ECMA.CEILING" | "ISO.CEILING" => {
            if y == 0. {
                return if matches!(name, "FLOOR" | "FLOOR.XCL") && x != 0. {
                    Value::Error("#DIV/0!")
                } else {
                    Value::Number(0.)
                };
            }
            let legacy = matches!(
                name,
                "FLOOR" | "FLOOR.XCL" | "CEILING" | "CEILING.XCL" | "ECMA.CEILING"
            );
            if legacy && x > 0. && y < 0. {
                return Value::Error("#NUM!");
            }
            let significance = if legacy { y } else { y.abs() };
            // Round the ratio to Excel's 15 significant digits before choosing
            // a multiple: e.g. 7.1/0.1 otherwise falls just below 71 in f64.
            let ratio = x / significance;
            let ratio = if ratio.is_finite() {
                format!("{ratio:.14e}").parse::<f64>().unwrap_or(ratio)
            } else {
                ratio
            };
            let floor = name.starts_with("FLOOR");
            let reverse = x < 0. && mode != 0. && matches!(name, "FLOOR.MATH" | "CEILING.MATH");
            (if floor != reverse {
                ratio.floor()
            } else {
                ratio.ceil()
            }) * significance
        }
        "FACTDOUBLE" => {
            let x = x.floor();
            // 300!! is finite; larger inputs overflow f64.
            if !(-1. ..=300.).contains(&x) {
                return Value::Error("#NUM!");
            }
            let mut result = 1.;
            let mut k = if x % 2. == 0. { 2. } else { 1. };
            while k <= x {
                result *= k;
                k += 2.;
            }
            result
        }
        _ => return Value::Error("#NAME?"),
    };
    Value::number(result)
}
