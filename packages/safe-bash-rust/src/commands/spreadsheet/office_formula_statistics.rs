#[path = "office_formula_beta.rs"]
pub(super) mod beta;
#[path = "office_formula_binomial.rs"]
pub(super) mod binomial;
#[path = "office_formula_chisquare.rs"]
pub(super) mod chisquare;
#[path = "office_formula_f_distribution.rs"]
pub(super) mod f_distribution;
#[path = "office_formula_inference.rs"]
pub(super) mod inference;
#[path = "office_formula_probability.rs"]
mod probability;
#[path = "office_formula_student.rs"]
pub(super) mod student;
use super::{Value, lookup::number};
#[path = "office_formula_combinatorial.rs"]
mod combinatorial;
#[path = "office_formula_gamma_math.rs"]
pub(super) mod gamma;
#[path = "office_formula_normal_math.rs"]
mod math;

// Excel contracts from IronCalc f936620 statistical/{normal,log_normal,gamma}.rs
// (MIT, LICENSE.IronCalc). The converter keeps its native Calc arities below.
pub(super) fn excel_arguments(name: &str) -> Option<(usize, usize)> {
    let count = match name {
        "NORMDIST" | "NORM.DIST" | "LOGNORM.DIST" => 4,
        "NORMINV" | "NORM.INV" | "LOGNORMDIST" | "LOGINV" | "LOGNORM.INV" | "STANDARDIZE" => 3,
        "NORM.S.DIST" => 2,
        "NORMSDIST" | "NORMSINV" | "NORM.S.INV" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE" => 1,
        _ => return None,
    };
    Some((count, count))
}

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "ERF" => (1, 2),
        "ERFC" | "ERF.PRECISE" | "ERFC.PRECISE" => (1, 1),
        "FACT" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE" => (1, 1),
        "COMBIN" | "COMBINA" | "PERMUT" | "PERMUTATIONA" => (2, 2),
        "HYPGEOMDIST" => (4, 5),
        "HYPGEOM.DIST" => (5, 5),
        "GAMMADIST" | "NORMDIST" => (3, 4),
        "GAMMA.DIST" => (4, 4),
        "GAMMAINV" | "GAMMA.INV" | "POISSON.DIST" => (3, 3),
        "POISSON" => (2, 3),
        "NORM.DIST" | "LOGNORM.DIST" => (4, 4),
        "LOGNORMDIST" => (1, 4),
        "LOGINV" | "LOGNORM.INV" => (1, 3),
        "NORMINV" | "NORM.INV" | "STANDARDIZE" => (3, 3),
        "NORM.S.DIST" => (2, 2),
        "NORMSDIST" | "NORMSINV" | "NORM.S.INV" | "PHI" | "GAUSS" => (1, 1),
        _ => return None,
    })
}

pub(super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    excel: bool,
    work: &mut usize,
) -> Option<Value> {
    if matches!(name, "ERF" | "ERFC" | "ERF.PRECISE" | "ERFC.PRECISE") {
        *work = work.checked_sub(64)?;
        let mut numbers = [0.; 2];
        for (index, value) in args.iter().enumerate() {
            numbers[index] = match value {
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::Bool(_) => None,
                Value::Text(text) | Value::UninternedText(text) => {
                    if text.trim().eq_ignore_ascii_case("true")
                        || text.trim().eq_ignore_ascii_case("false")
                    {
                        None
                    } else {
                        number::parse(text, date1904)
                    }
                }
                _ => value.numeric(),
            }
            .unwrap_or(f64::NAN);
            if numbers[index].is_nan() {
                return Some(Value::Error("#VALUE!"));
            }
        }
        let [lower, upper] = numbers;
        return Some(Value::Number(match name {
            // Excel's two-limit function subtracts ERF values, including its
            // tail cancellation. Retain the original workbook's cached results.
            "ERF" if args.len() == 2 => math::erf(upper) - math::erf(lower),
            "ERF" | "ERF.PRECISE" => math::erf(lower),
            _ => math::erfc(lower),
        }));
    }
    if excel {
        *work = work.checked_sub(64)?;
        for arg in args {
            if let Value::Error(error) | Value::LiteralError(error) = arg {
                return Some(Value::Error(error));
            }
        }
    }
    let mut numbers = [0., 0., 1., 1., 0.];
    let mut error = None;
    for (index, value) in args.iter().enumerate().rev() {
        let value = match value {
            Value::LiteralError(e) => {
                error = Some(*e);
                Some(0.)
            }
            Value::Error(e) => {
                error.get_or_insert(*e);
                Some(0.)
            }
            Value::Text(text) | Value::UninternedText(text) => {
                let cumulative = index == 3
                    && matches!(name, "NORMDIST" | "NORM.DIST" | "LOGNORM.DIST")
                    || index == 1 && name == "NORM.S.DIST";
                if excel
                    && !cumulative
                    && (text.trim().eq_ignore_ascii_case("true")
                        || text.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    number::parse(text, date1904)
                }
            }
            _ => value.numeric(),
        };
        numbers[index] = value.unwrap_or_else(|| {
            error.get_or_insert("#VALUE!");
            0.
        });
    }
    if let Some(error) = error {
        return Some(Value::Error(error));
    }
    if matches!(
        name,
        "FACT" | "COMBIN" | "COMBINA" | "PERMUT" | "PERMUTATIONA" | "HYPGEOMDIST" | "HYPGEOM.DIST"
    ) {
        return combinatorial::calculate(name, numbers, work);
    }
    let [x, mean, sigma, cumulative, _] = numbers;
    let domain_error = if excel { "#NUM!" } else { "Err:502" };
    let endpoint_error = if excel { "#NUM!" } else { "#VALUE!" };
    let standardize = |x: f64, mean: f64| {
        let delta = x - mean;
        if excel && delta.is_infinite() {
            x / sigma - mean / sigma
        } else {
            delta / sigma
        }
    };
    if matches!(
        name,
        "GAMMA"
            | "GAMMALN"
            | "GAMMALN.PRECISE"
            | "GAMMADIST"
            | "GAMMA.DIST"
            | "GAMMAINV"
            | "GAMMA.INV"
            | "POISSON"
            | "POISSON.DIST"
    ) {
        return gamma::calculate(name, [x, mean, sigma, cumulative], work).map(|value| {
            // Input errors have already returned above. Translate only errors
            // produced by the selected Excel function, keeping Calc unchanged.
            if excel && matches!(value, Value::Error("Err:502")) {
                Value::Error("#NUM!")
            } else {
                value
            }
        });
    }
    let value = match name {
        "PHI" => math::density(x),
        "GAUSS" => math::gauss(x),
        "NORMSDIST" => math::cdf(x),
        "NORM.S.DIST" => {
            if mean != 0. {
                math::cdf(x)
            } else {
                math::exp(-(x * x) / 2.) / (2. * std::f64::consts::PI).sqrt()
            }
        }
        "NORMSINV" | "NORM.S.INV" => {
            if !(0. ..=1.).contains(&x) {
                return Some(Value::Error(domain_error));
            }
            if x == 0. || x == 1. {
                return Some(Value::Error(endpoint_error));
            }
            math::inverse(x)
        }
        "NORMINV" | "NORM.INV" => {
            if sigma <= 0. || !(0. ..=1.).contains(&x) {
                return Some(Value::Error(domain_error));
            }
            if x == 0. || x == 1. {
                return Some(Value::Error(endpoint_error));
            }
            let z = math::inverse(x);
            if excel {
                z.mul_add(sigma, mean)
            } else {
                z * sigma + mean
            }
        }
        "LOGINV" | "LOGNORM.INV" => {
            if sigma <= 0. || x <= 0. || x >= 1. {
                return Some(Value::Error(domain_error));
            }
            let z = math::inverse(x);
            math::exp(if excel {
                z.mul_add(sigma, mean)
            } else {
                mean + sigma * z
            })
        }
        "STANDARDIZE" => {
            if sigma < 0. {
                return Some(Value::Error(domain_error));
            }
            if sigma == 0. {
                return Some(Value::Error(if excel { "#NUM!" } else { "#DIV/0!" }));
            }
            standardize(x, mean)
        }
        "LOGNORMDIST" | "LOGNORM.DIST" => {
            if sigma <= 0. || excel && x <= 0. {
                return Some(Value::Error(domain_error));
            }
            if cumulative != 0. {
                if x <= 0. {
                    0.
                } else {
                    math::cdf(standardize(x.ln(), mean))
                }
            } else {
                if x <= 0. {
                    return Some(Value::Error("Err:502"));
                }
                let z = standardize(x.ln(), mean);
                if excel {
                    math::exp(-(z * z) / 2. - sigma.ln() - x.ln() - 0.9189385332046727)
                } else {
                    math::density(z) / sigma / x
                }
            }
        }
        _ => {
            if sigma <= 0. {
                return Some(Value::Error(domain_error));
            }
            if cumulative != 0. {
                math::cdf(standardize(x, mean))
            } else {
                let z = standardize(x, mean);
                if excel {
                    math::exp(-(z * z) / 2. - sigma.ln() - 0.9189385332046727)
                } else {
                    math::density(z) / sigma
                }
            }
        }
    };
    Some(Value::number(value))
}

#[cfg(test)]
mod erf_tests {
    use super::{Value, calculate};

    // Copyright 2023-present DreamNum Co., Ltd. Apache-2.0, LICENSE.Univer.
    // The four mixed-array groups in Univer 4767b3b engineering/{erf,erfc,
    // erf-precise,erfc-precise}/__tests__/index.spec.ts call the scalar function
    // directly. Broadcast dispatch is tested separately through Spreadsheet.
    #[test]
    fn univer_error_function_arrays_at_the_scalar_boundary() {
        let array = Value::Matrix(vec![
            vec![
                Value::Number(1.),
                Value::Text(" ".into()),
                Value::Number(1.23),
                Value::Bool(true),
                Value::Bool(false),
                Value::Blank,
            ],
            vec![
                Value::Number(0.),
                Value::Text("100".into()),
                Value::Text("2.34".into()),
                Value::Text("test".into()),
                Value::Number(-3.),
                Value::Error("#NAME?"),
            ],
        ]);
        for name in ["ERF", "ERFC", "ERF.PRECISE", "ERFC.PRECISE"] {
            assert!(
                matches!(
                    calculate(name, &[&array], false, false, &mut 100_000),
                    Some(Value::Error("#VALUE!"))
                ),
                "{name}"
            );
        }
    }
}

#[cfg(test)]
mod gamma_tests {
    use super::{Value, calculate};

    #[test]
    fn gamma_excel_domains_preserve_source_errors_and_calc_contracts() {
        for name in ["GAMMA", "GAMMALN", "GAMMALN.PRECISE"] {
            for excel in [false, true] {
                let expected = if excel { "#NUM!" } else { "Err:502" };
                assert!(
                    matches!(calculate(name, &[&Value::Number(0.)], false, excel, &mut 100_000),
                    Some(Value::Error(error)) if error == expected)
                );
                for value in [Value::Error("Err:502"), Value::LiteralError("Err:502")] {
                    assert!(matches!(
                        calculate(name, &[&value], false, excel, &mut 100_000),
                        Some(Value::Error("Err:502"))
                    ));
                }
            }
        }
    }
}
