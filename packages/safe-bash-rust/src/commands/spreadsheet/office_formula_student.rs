// Contracts from IronCalc f936620 statistical/t_dist.rs (MIT, LICENSE.IronCalc)
// and Univer 4767b3b statistical/t-* (Apache-2.0, LICENSE.Univer). Share Rust
// beta probabilities/inversion, sparse pairing and centered/scaled moments.
use super::super::{Calculation, Coord, Expr, matrix_functions::shape, regression};
use super::{Value, beta, f_distribution, math, number};
use std::collections::BTreeMap;

pub(in super::super) fn arguments(name: &str) -> Option<(usize, usize)> {
    match name {
        "T.DIST" | "TDIST" => Some((3, 3)),
        "T.DIST.RT" | "T.DIST.2T" | "T.INV" | "T.INV.2T" | "TINV" => Some((2, 2)),
        _ => None,
    }
}
pub(super) fn numeric(v: &Value, date1904: bool, logical: bool) -> Result<f64, &'static str> {
    let value = match v {
        Value::Error(e) | Value::LiteralError(e) => return Err(e),
        Value::Text(s) | Value::UninternedText(s) => {
            if !logical
                && (s.trim().eq_ignore_ascii_case("true") || s.trim().eq_ignore_ascii_case("false"))
            {
                None
            } else {
                number::parse(s, date1904)
            }
        }
        _ => v.numeric(),
    }
    .ok_or("#VALUE!")?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err("#NUM!")
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
    let mut values = [0.; 3];
    for (i, v) in args.iter().enumerate() {
        values[i] = match numeric(v, date1904, name == "T.DIST" && i == 2) {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
    }
    let [x, df, option] = values;
    let df = df.trunc();
    if df < 1. || name != "T.DIST" && df > 1e10 {
        return Some(Value::Error("#NUM!"));
    }
    // At these degrees the first normal-limit correction is below binary64
    // rounding for every representable tail (|x| < 39). Avoid a normalized
    // beta fraction becoming subnormal while df times that fraction is not.
    if name == "T.DIST" && df >= 1e23 {
        return Some(Value::number(if option == 0. {
            math::density(x)
        } else {
            math::cdf(x)
        }));
    }
    let result = if matches!(name, "T.INV" | "T.INV.2T" | "TINV") {
        let two = name != "T.INV";
        if x <= 0. || x > 1. || !two && x == 1. {
            return Some(Value::Error("#NUM!"));
        }
        let p = if two { x } else { 2. * x.min(1. - x) };
        if p == 1. {
            return Some(Value::Number(0.));
        }
        let (z, y) = beta::inverse(p, df / 2., 0.5, work)?;
        let t = if z >= f64::MIN_POSITIVE && y >= f64::MIN_POSITIVE {
            df.sqrt() * y.sqrt() / z.sqrt()
        } else {
            let logz = if z < f64::MIN_POSITIVE {
                (p.ln() + (df / 2.).ln() + beta::log_beta(df / 2., 0.5)) / (df / 2.)
            } else {
                z.ln()
            };
            let logy = if y < f64::MIN_POSITIVE {
                ((-p).ln_1p() + 0.5_f64.ln() + beta::log_beta(df / 2., 0.5)) / 0.5
            } else {
                y.ln()
            };
            (0.5 * (df.ln() + logy - logz)).exp()
        };
        if !two && x < 0.5 { -t } else { t }
    } else {
        let two = name == "T.DIST.2T" || name == "TDIST" && option.trunc() == 2.;
        if (name == "TDIST" || two) && x < 0.
            || name == "TDIST" && ![1., 2.].contains(&option.trunc())
        {
            return Some(Value::Error("#NUM!"));
        }
        if name == "T.DIST" && option == 0. {
            let odds = 2. * x.abs().ln() - df.ln();
            let log_power = if odds > 0. {
                odds + (-odds).exp().ln_1p()
            } else {
                odds.exp().ln_1p()
            };
            (-0.5 * df.ln() - beta::log_beta(df / 2., 0.5) - (df / 2. + 0.5) * log_power).exp()
        } else {
            // Squared t is F(1,df). Pass logarithms so x*x cannot overflow,
            // and keep the survival probability without subtracting a CDF.
            let tail = f_distribution::probability(2. * x.abs().ln(), 1., df, true, false, work)?;
            if two {
                tail
            } else if (name == "T.DIST") == (x >= 0.) {
                1. - tail / 2.
            } else {
                tail / 2.
            }
        }
    };
    Some(Value::number(result))
}

fn sample_statistic(
    first: &BTreeMap<usize, Result<f64, &'static str>>,
    second: &BTreeMap<usize, Result<f64, &'static str>>,
    same_size: bool,
    kind: usize,
    work: &mut usize,
) -> Option<Result<(f64, f64), &'static str>> {
    for v in first.values().chain(second.values()) {
        if let Err(e) = v {
            return Some(Err(e));
        }
    }
    if kind == 1 {
        if !same_size {
            return Some(Err("#N/A"));
        }
        *work = work.checked_sub(first.len().min(second.len()).checked_mul(40)?)?;
        let mut scale = 0_f64;
        for (i, x) in first {
            *work = work.checked_sub(1)?;
            if let (Ok(x), Some(Ok(y))) = (x, second.get(i)) {
                let difference = x - y;
                scale = scale.max(if difference.is_finite() {
                    difference.abs()
                } else {
                    x.abs().max(y.abs())
                });
            }
        }
        if scale == 0. {
            scale = 1.;
        }
        let mut differences = Vec::with_capacity(first.len().min(second.len()));
        for (i, x) in first {
            *work = work.checked_sub(1)?;
            if let (Ok(x), Some(Ok(y))) = (x, second.get(i)) {
                let difference = x - y;
                differences.push(if difference.is_finite() {
                    difference / scale
                } else {
                    x / scale - y / scale
                });
            }
        }
        let n = differences.len() as f64;
        if n < 2. {
            return Some(Err("#DIV/0!"));
        }
        let axis = regression::normalize(&mut differences, 0, 1, true);
        if axis.norm == 0. {
            return Some(Err("#DIV/0!"));
        }
        return Some(Ok((
            axis.center().abs().ln() - axis.scale.ln() - axis.norm.ln() + 0.5 * (n * (n - 1.)).ln(),
            n - 1.,
        )));
    }
    let mut axes = Vec::with_capacity(2);
    for entries in [first, second] {
        if entries.len() < 2 {
            return Some(Err("#DIV/0!"));
        }
        *work = work.checked_sub(entries.len().checked_mul(32)?)?;
        let mut data = entries
            .values()
            .map(|v| *v.as_ref().unwrap())
            .collect::<Vec<_>>();
        axes.push((
            regression::normalize(&mut data, 0, 1, true),
            data.len() as f64,
        ));
    }
    let ((a, n1), (b, n2)) = (axes[0], axes[1]);
    let difference = a.origin - b.origin;
    let scale = a.scale.max(b.scale).max(if difference.is_finite() {
        difference.abs()
    } else {
        a.origin.abs().max(b.origin.abs())
    });
    let delta = (if difference.is_finite() {
        difference / scale
    } else {
        a.origin / scale - b.origin / scale
    }) + a.mean * (a.scale / scale)
        - b.mean * (b.scale / scale);
    let log_difference = delta.abs().ln() + scale.ln();
    let mut s1 = a.scale.ln() + a.norm.ln();
    let mut s2 = b.scale.ln() + b.norm.ln();
    if kind == 3 {
        s1 -= 0.5 * (n1 * (n1 - 1.)).ln();
        s2 -= 0.5 * (n2 * (n2 - 1.)).ln();
    }
    let maximum = s1.max(s2);
    if maximum == f64::NEG_INFINITY {
        return Some(Err("#DIV/0!"));
    }
    let (v1, v2) = ((2. * (s1 - maximum)).exp(), (2. * (s2 - maximum)).exp());
    let total = v1 + v2;
    let mut log_se = maximum + 0.5 * total.ln();
    let df = if kind == 2 {
        let df = n1 + n2 - 2.;
        log_se += 0.5 * ((1. / n1 + 1. / n2) / df).ln();
        df
    } else {
        total * total / (v1 * v1 / (n1 - 1.) + v2 * v2 / (n2 - 1.))
    };
    Some(Ok((log_difference - log_se, df)))
}

impl Calculation<'_> {
    pub(in super::super) fn student_test(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() != 4 {
            return Some(Value::Error("#ERROR!"));
        }
        let (first, ft) = self.matrix_source(&args[0], pos, depth + 1)?;
        let (second, st) = self.matrix_source(&args[1], pos, depth + 1)?;
        let (fr, fc) = match shape(&first, ft) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        let (sr, sc) = match shape(&second, st) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        let same_size = fr.checked_mul(fc)? == sr.checked_mul(sc)?;
        let first = match self.paired_entries(first, ft, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let second = match self.paired_entries(second, st, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let tails = self.eval(&args[2], pos, depth + 1, true)?;
        let tails = self.matrix(tails, depth + 1)?;
        let kinds = self.eval(&args[3], pos, depth + 1, true)?;
        let kinds = self.matrix(kinds, depth + 1)?;
        let rows = tails.len().max(kinds.len());
        let cols = tails[0].len().max(kinds[0].len());
        self.work = self.work.checked_sub(
            rows.checked_mul(cols)?
                .checked_mul(std::mem::size_of::<Value>() + 32)?,
        )?;
        let mut result = Vec::with_capacity(rows);
        let mut cache: [Option<Result<(f64, f64), &'static str>>; 3] = [None; 3];
        for r in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for c in 0..cols {
                self.tick(depth)?;
                let t = tails
                    .get(if tails.len() == 1 { 0 } else { r })
                    .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                    .unwrap_or(&Value::Error("#N/A"));
                let k = kinds
                    .get(if kinds.len() == 1 { 0 } else { r })
                    .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }))
                    .unwrap_or(&Value::Error("#N/A"));
                self.charge_value(t)?;
                self.charge_value(k)?;
                let value = (|| {
                    for v in [t, k] {
                        if let Value::Error(e) | Value::LiteralError(e) = v {
                            return Some(Value::Error(e));
                        }
                    }
                    let t = match numeric(t, self.book.date1904, false) {
                        Ok(v) => v.trunc(),
                        Err(e) => return Some(Value::Error(e)),
                    };
                    let k = match numeric(k, self.book.date1904, false) {
                        Ok(v) => v.trunc(),
                        Err(e) => return Some(Value::Error(e)),
                    };
                    if ![1., 2.].contains(&t) || ![1., 2., 3.].contains(&k) {
                        return Some(Value::Error("#NUM!"));
                    }
                    let index = k as usize - 1;
                    if cache[index].is_none() {
                        cache[index] = Some(sample_statistic(
                            &first,
                            &second,
                            same_size,
                            k as usize,
                            &mut self.work,
                        )?);
                    }
                    let (log_t, df) = match cache[index]? {
                        Ok(v) => v,
                        Err(e) => return Some(Value::Error(e)),
                    };
                    let probability = f_distribution::probability(
                        2. * log_t,
                        1.,
                        df,
                        true,
                        false,
                        &mut self.work,
                    )?;
                    Some(Value::number(probability * (t / 2.)))
                })()?;
                row.push(value);
            }
            result.push(row);
        }
        self.result_format = None;
        Some(if rows == 1 && cols == 1 {
            result.pop()?.pop()?
        } else {
            Value::Matrix(result)
        })
    }
}
