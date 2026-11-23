// Exponential and Weibull distributions adapted from IronCalc f936620
// statistical/{exponential,weibull}.rs (MIT, LICENSE.IronCalc), with array/type
// cases from Univer 4767b3b (Apache-2.0, LICENSE.Univer). Use expm1 for small
// probabilities and logarithms for densities, avoiding intermediate overflow.
use super::{Value, lookup::number};

pub(super) fn arguments(name: &str) -> Option<(usize, usize)> {
    Some(match name {
        "EXPONDIST" | "EXPON.DIST" => (3, 3),
        "WEIBULL" | "WEIBULL.DIST" => (4, 4),
        _ => return None,
    })
}

pub(super) fn calculate(args: &[&Value], date1904: bool, work: &mut usize) -> Option<Value> {
    *work = work.checked_sub(64)?;
    for arg in args {
        if let Value::Error(e) | Value::LiteralError(e) = arg {
            return Some(Value::Error(e));
        }
    }
    let mut numbers = [0.; 4];
    for (index, arg) in args.iter().enumerate() {
        let n = match arg {
            Value::Text(s) | Value::UninternedText(s) => {
                if index + 1 < args.len()
                    && (s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    number::parse(s, date1904)
                }
            }
            _ => arg.numeric(),
        };
        let Some(n) = n else {
            return Some(Value::Error("#VALUE!"));
        };
        if !n.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        numbers[index] = n;
    }
    let [x, alpha, beta, _] = numbers;
    let cumulative = numbers[args.len() - 1] != 0.;
    if x < 0. || alpha <= 0. || args.len() == 4 && beta <= 0. {
        return Some(Value::Error("#NUM!"));
    }
    let value = if args.len() == 3 {
        let exponent = x * alpha;
        if cumulative {
            -(-exponent).exp_m1()
        } else if x == 0. {
            alpha
        } else {
            (alpha.ln() - exponent).exp()
        }
    } else if x == 0. {
        if cumulative || alpha > 1. {
            0.
        } else if alpha == 1. {
            1. / beta
        } else {
            return Some(Value::Error("#NUM!"));
        }
    } else {
        let ratio = x / beta;
        let log_ratio = if (0.5..=2.).contains(&ratio) {
            // Preserve near-equal values before multiplying by a large shape.
            ((x - beta) / beta).ln_1p()
        } else if ratio.is_normal() {
            ratio.ln()
        } else {
            // A ratio can underflow/overflow while its fractional power is finite.
            x.ln() - beta.ln()
        };
        let exponent = (alpha * log_ratio).exp();
        if cumulative {
            -(-exponent).exp_m1()
        } else if exponent.is_infinite() {
            0.
        } else {
            (alpha.ln() - beta.ln() + (alpha - 1.) * log_ratio - exponent).exp()
        }
    };
    Some(Value::number(value))
}
