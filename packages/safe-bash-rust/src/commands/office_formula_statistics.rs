use super::{Value, lookup::number, math::logarithm::log};
#[path = "office_formula_combinatorial.rs"]
mod combinatorial;
#[path = "office_formula_gamma_math.rs"]
mod gamma;
#[path = "office_formula_gamma_log.rs"]
pub(super) mod logarithm;
#[path = "office_formula_normal_math.rs"]
pub(super) mod math;
#[path = "office_formula_public_combinatorial.rs"]
mod public_combinatorial;
#[path = "office_formula_public_gamma.rs"]
mod public_gamma;
#[path = "office_formula_public_normal.rs"]
mod public_normal;
#[path = "office_formula_public_probability.rs"]
mod public_probability;

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "FACT" | "GAMMA" | "GAMMALN" | "GAMMALN.PRECISE" => (1, 1),
        "COMBIN" | "COMBINA" | "PERMUT" | "PERMUTATIONA" => (2, 2),
        "HYPGEOMDIST" => (4, 5),
        "HYPGEOM.DIST" => (5, 5),
        "GAMMADIST" | "NORMDIST" => (3, 4),
        "R.DNORM" | "R.DLNORM" => (3, 4),
        "R.PNORM" | "R.PLNORM" | "R.QNORM" | "R.QLNORM" => (3, 5),
        "R.QCHISQ" => (2, 4),
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
    gnumeric: bool,
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    let mut numbers = [0., 0., 1., 1., 0.];
    if name == "R.QCHISQ" {
        numbers[3] = 0.;
    }
    let mut error = None;
    for (index, value) in args.iter().enumerate().rev() {
        let value = match value {
            Value::LiteralError(e) => {
                error = Some(*e);
                Some(0.)
            }
            Value::Error(e) => {
                if gnumeric {
                    error = Some(*e);
                } else {
                    error.get_or_insert(*e);
                }
                Some(0.)
            }
            Value::Text(text) | Value::UninternedText(text) => number::parse(text, date1904),
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
    if gnumeric && matches!(name, "COMBIN" | "COMBINA" | "PERMUT" | "PERMUTATIONA") {
        return public_combinatorial::calculate(name, numbers[0], numbers[1], work);
    }
    if gnumeric && matches!(name, "GAMMA" | "FACT") {
        let x = if name == "FACT" {
            numbers[0] + 1.
        } else {
            numbers[0]
        };
        return Some(Value::number(public_gamma::gamma(x, work)?));
    }
    if gnumeric && name == "GAMMALN" {
        let x = numbers[0];
        if x == 0. || x < 0. && (x == x.floor() || (-x).floor() % 2. == 0.) {
            return Some(Value::Error("#NUM!"));
        }
        return Some(Value::number(public_probability::log_gamma(x, work)?));
    }
    if gnumeric
        && matches!(
            name,
            "GAMMADIST" | "GAMMAINV" | "R.QCHISQ" | "HYPGEOMDIST" | "POISSON"
        )
    {
        return public_probability::calculate(name, numbers, work);
    }
    if gnumeric && matches!(name, "R.PNORM" | "R.PLNORM" | "R.QNORM" | "R.QLNORM") {
        let [x, mean, sigma, lower, logarithmic] = numbers;
        let log_normal = matches!(name, "R.PLNORM" | "R.QLNORM");
        let quantile = matches!(name, "R.QNORM" | "R.QLNORM");
        let lower = lower != 0.;
        let logarithmic = logarithmic != 0.;
        if sigma < 0.
            || log_normal && !quantile && sigma == 0.
            || quantile
                && if logarithmic {
                    x > 0.
                } else {
                    !(0. ..=1.).contains(&x)
                }
        {
            return Some(Value::Error("#NUM!"));
        }
        let value = if quantile {
            let boundary = x == if logarithmic { f64::NEG_INFINITY } else { 0. }
                || x == if logarithmic { 0. } else { 1. };
            let value = if boundary {
                public_normal::inverse(x, lower, logarithmic)
            } else if sigma == 0. {
                mean
            } else {
                mean + sigma * public_normal::inverse(x, lower, logarithmic)
            };
            if log_normal {
                super::financial::options::normal::exp(value)
            } else {
                value
            }
        } else if log_normal && x <= 0. {
            if logarithmic { f64::NEG_INFINITY } else { 0. }
        } else {
            let x = if log_normal { log(x, 0) } else { x };
            let z = if sigma == 0. {
                if x < mean {
                    f64::NEG_INFINITY
                } else {
                    f64::INFINITY
                }
            } else {
                (x - mean) / sigma
            };
            public_normal::probability(z, lower, logarithmic)
        };
        return Some(Value::number(value));
    }
    if gnumeric
        && (matches!(name, "R.DNORM" | "R.DLNORM") || name == "NORMDIST" && numbers[3] == 0.)
    {
        let [x, mean, sigma, logarithmic, _] = numbers;
        let logarithmic = args.len() == 4 && logarithmic != 0.;
        let log_normal = name == "R.DLNORM";
        if sigma < 0. || (log_normal || name == "NORMDIST") && sigma == 0. {
            return Some(Value::Error("#NUM!"));
        }
        let value = if log_normal && x <= 0. {
            f64::NEG_INFINITY
        } else if sigma == 0. {
            if (if log_normal { log(x, 0) } else { x }) == mean {
                f64::INFINITY
            } else {
                f64::NEG_INFINITY
            }
        } else {
            let z = ((if log_normal { log(x, 0) } else { x }) - mean) / sigma;
            -0.5 * (z * z)
                - log(sigma, 0)
                - 0.5 * log(2. * std::f64::consts::PI, 0)
                - if log_normal { log(x, 0) } else { 0. }
        };
        return Some(Value::number(if logarithmic {
            value
        } else {
            super::financial::options::normal::exp(value)
        }));
    }
    if matches!(
        name,
        "FACT" | "COMBIN" | "COMBINA" | "PERMUT" | "PERMUTATIONA" | "HYPGEOMDIST" | "HYPGEOM.DIST"
    ) {
        return combinatorial::calculate(name, numbers, work);
    }
    let [x, mean, sigma, cumulative, _] = numbers;
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
        return gamma::calculate(name, [x, mean, sigma, cumulative], work);
    }
    let cdf = if gnumeric {
        super::financial::options::normal::cdf
    } else {
        math::cdf
    };
    let inverse = |x| {
        if gnumeric {
            public_normal::inverse(x, true, false)
        } else {
            math::inverse(x)
        }
    };
    let invalid = if gnumeric { "#NUM!" } else { "Err:502" };
    let value = match name {
        "PHI" => math::density(x),
        "GAUSS" => math::gauss(x),
        "NORMSDIST" => cdf(x),
        "NORM.S.DIST" => {
            if mean != 0. {
                cdf(x)
            } else {
                math::exp(-(x * x) / 2.) / (2. * std::f64::consts::PI).sqrt()
            }
        }
        "NORMSINV" | "NORM.S.INV" => {
            if !(0. ..=1.).contains(&x) {
                return Some(Value::Error(invalid));
            }
            if x == 0. || x == 1. {
                return Some(Value::Error(if gnumeric { "#NUM!" } else { "#VALUE!" }));
            }
            inverse(x)
        }
        "NORMINV" | "NORM.INV" => {
            if sigma <= 0. || !(0. ..=1.).contains(&x) {
                return Some(Value::Error(invalid));
            }
            if x == 0. || x == 1. {
                return Some(Value::Error(if gnumeric { "#NUM!" } else { "#VALUE!" }));
            }
            inverse(x) * sigma + mean
        }
        "LOGINV" | "LOGNORM.INV" => {
            if sigma <= 0. || x < 0. || x >= 1. || !gnumeric && x == 0. {
                return Some(Value::Error(invalid));
            }
            if gnumeric {
                super::financial::options::normal::exp(mean + sigma * inverse(x))
            } else {
                math::exp(mean + sigma * inverse(x))
            }
        }
        "STANDARDIZE" => {
            if sigma < 0. || gnumeric && sigma == 0. {
                return Some(Value::Error(invalid));
            }
            if sigma == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            (x - mean) / sigma
        }
        "LOGNORMDIST" | "LOGNORM.DIST" => {
            if sigma <= 0. || gnumeric && (x <= 0. || mean < 0.) {
                return Some(Value::Error(invalid));
            }
            if cumulative != 0. {
                if x <= 0. {
                    0.
                } else {
                    cdf(((if gnumeric { log(x, 0) } else { x.ln() }) - mean) / sigma)
                }
            } else {
                if x <= 0. {
                    return Some(Value::Error("Err:502"));
                }
                math::density((x.ln() - mean) / sigma) / sigma / x
            }
        }
        _ => {
            if sigma <= 0. {
                return Some(Value::Error(invalid));
            }
            if cumulative != 0. {
                cdf((x - mean) / sigma)
            } else {
                math::density((x - mean) / sigma) / sigma
            }
        }
    };
    Some(Value::number(value))
}
