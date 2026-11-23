// Contracts adapted from IronCalc f936620 statistical/fisher.rs (MIT,
// LICENSE.IronCalc) and Univer 4767b3b statistical/f-* (Apache-2.0,
// LICENSE.Univer). Reuse Rust beta tails and scaled sample variances.
use super::super::{Calculation, Coord, Expr, regression};
use super::{Value, beta, number};

pub(in super::super) fn arguments(name: &str) -> Option<(usize, usize)> {
    match name {
        "F.DIST" => Some((4, 4)),
        "F.DIST.RT" | "F.INV" | "F.INV.RT" | "FDIST" | "FINV" => Some((3, 3)),
        _ => None,
    }
}

// Log odds retain probabilities even when the F ratio or its normalized beta
// fraction is outside binary64. Both fractions are formed independently.
pub(super) fn probability(
    log_f: f64,
    d1: f64,
    d2: f64,
    upper: bool,
    density: bool,
    work: &mut usize,
) -> Option<f64> {
    let (a, b) = (d1 / 2., d2 / 2.);
    let odds = log_f + (d1 / d2).ln();
    let ratio = (-odds.abs()).exp();
    if ratio < f64::MIN_POSITIVE {
        let (shape, log_small) = if odds < 0. {
            (a, a * odds)
        } else {
            (b, -b * odds)
        };
        let prefix = log_small - beta::log_beta(a, b);
        if density {
            return Some((prefix - log_f).exp());
        }
        let tail = prefix - shape.ln();
        return Some(if upper == (odds > 0.) {
            tail.exp()
        } else {
            -tail.exp_m1()
        });
    }
    let (x, y) = if odds < 0. {
        (ratio / (1. + ratio), 1. / (1. + ratio))
    } else {
        (1. / (1. + ratio), ratio / (1. + ratio))
    };
    if density {
        Some((beta::log_prefix(x, y, a, b, work)? - log_f).exp())
    } else if upper {
        beta::cdf(y, x, b, a, work)
    } else {
        beta::cdf(x, y, a, b, work)
    }
}

pub(in super::super) fn calculate(
    name: &str,
    args: &[&Value],
    date1904: bool,
    work: &mut usize,
) -> Option<Value> {
    *work = work.checked_sub(128)?;
    for v in args {
        if let Value::Error(e) | Value::LiteralError(e) = v {
            return Some(Value::Error(e));
        }
    }
    let mut values = [0.; 4];
    for (i, v) in args.iter().enumerate() {
        let n = match v {
            Value::Text(s) | Value::UninternedText(s) => {
                if i != 3
                    && (s.trim().eq_ignore_ascii_case("true")
                        || s.trim().eq_ignore_ascii_case("false"))
                {
                    None
                } else {
                    number::parse(s, date1904)
                }
            }
            _ => v.numeric(),
        };
        let Some(n) = n else {
            return Some(Value::Error("#VALUE!"));
        };
        if !n.is_finite() {
            return Some(Value::Error("#NUM!"));
        }
        values[i] = n;
    }
    let [x, d1, d2, cumulative] = values;
    let (d1, d2) = (d1.trunc(), d2.trunc());
    if !(1. ..=1e10).contains(&d1) || !(1. ..=1e10).contains(&d2) || x < 0. {
        return Some(Value::Error("#NUM!"));
    }
    let inverse = matches!(name, "F.INV" | "F.INV.RT" | "FINV");
    let result = if inverse {
        let upper = name != "F.INV";
        if x > 1. || x == if upper { 0. } else { 1. } {
            return Some(Value::Error("#NUM!"));
        }
        if x == if upper { 1. } else { 0. } {
            return Some(Value::Number(0.));
        }
        let (a, b) = if upper {
            (d2 / 2., d1 / 2.)
        } else {
            (d1 / 2., d2 / 2.)
        };
        let (t, u) = beta::inverse(x, a, b, work)?;
        let log_t = if t < f64::MIN_POSITIVE {
            (x.ln() + a.ln() + beta::log_beta(a, b)) / a
        } else {
            t.ln()
        };
        let log_u = if u < f64::MIN_POSITIVE {
            ((-x).ln_1p() + b.ln() + beta::log_beta(a, b)) / b
        } else {
            u.ln()
        };
        // A logarithmic fallback also recovers an underflowed beta quantile
        // when rescaling it to F produces a representable subnormal value.
        let ratio = if upper { u / t } else { t / u };
        let direct = (d2 / d1) * ratio;
        if t >= f64::MIN_POSITIVE && u >= f64::MIN_POSITIVE && direct.is_finite() && direct > 0. {
            direct
        } else {
            ((d2 / d1).ln() + if upper { log_u - log_t } else { log_t - log_u }).exp()
        }
    } else {
        let density = name == "F.DIST" && cumulative == 0.;
        if x == 0. {
            if density && d1 < 2. {
                return Some(Value::Error("#NUM!"));
            }
            if density {
                f64::from(d1 == 2.)
            } else {
                f64::from(name != "F.DIST")
            }
        } else {
            probability(x.ln(), d1, d2, name != "F.DIST", density, work)?
        }
    };
    Some(Value::number(result))
}

impl Calculation<'_> {
    pub(in super::super) fn f_test(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() != 2 {
            return Some(Value::Error("#ERROR!"));
        }
        let mut samples = [(0., 0.); 2];
        for (i, arg) in args.iter().enumerate() {
            let (source, transposed) = self.matrix_source(arg, pos, depth + 1)?;
            let entries = match self.paired_entries(source, transposed, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            self.work = self.work.checked_sub(entries.len().checked_mul(32)?)?;
            let mut data = Vec::with_capacity(entries.len());
            for v in entries.into_values() {
                match v {
                    Ok(v) => data.push(v),
                    Err(e) => return Some(Value::Error(e)),
                }
            }
            if data.len() < 2 {
                return Some(Value::Error("#DIV/0!"));
            }
            let axis = regression::normalize(&mut data, 0, 1, true);
            if axis.norm == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            samples[i] = (axis.scale.ln() + axis.norm.ln(), (data.len() - 1) as f64);
        }
        self.result_format = None;
        let [(s1, d1), (s2, d2)] = samples;
        let log_f = 2. * (s1 - s2) + (d2 / d1).ln();
        let lower = probability(log_f, d1, d2, false, false, &mut self.work)?;
        let upper = probability(log_f, d1, d2, true, false, &mut self.work)?;
        Some(Value::number((2. * lower.min(upper)).min(1.)))
    }
}
