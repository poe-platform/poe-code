// Contracts adapted from IronCalc f936620 statistical/{normal,z_test}.rs
// (MIT, LICENSE.IronCalc) and Univer 4767b3b statistical/{confidence-*,z-test}
// (Apache-2.0, LICENSE.Univer). Reuse the normal/beta kernels and scaled moments.
use super::super::{Calculation, Coord, Expr, regression};
use super::{Value, beta, math, student::numeric};

pub(in super::super) fn arguments(name: &str) -> Option<(usize, usize)> {
    match name {
        "CONFIDENCE" | "CONFIDENCE.NORM" | "CONFIDENCE.T" => Some((3, 3)),
        _ => None,
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
        values[i] = match numeric(v, date1904, false) {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
    }
    let [alpha, sigma, size] = values;
    let size = size.trunc();
    if alpha <= 0. || alpha >= 1. || sigma <= 0. || size < 1. {
        return Some(Value::Error("#NUM!"));
    }
    let result = if name == "CONFIDENCE.T" && size < 1e23 {
        if size == 1. {
            return Some(Value::Error("#DIV/0!"));
        }
        let df = size - 1.;
        let (z, y) = beta::inverse(alpha, df / 2., 0.5, work)?;
        let logz = if z < f64::MIN_POSITIVE {
            (alpha.ln() + (df / 2.).ln() + beta::log_beta(df / 2., 0.5)) / (df / 2.)
        } else {
            z.ln()
        };
        let logy = if y < f64::MIN_POSITIVE {
            ((-alpha).ln_1p() + 0.5_f64.ln() + beta::log_beta(df / 2., 0.5)) / 0.5
        } else {
            y.ln()
        };
        // Compute the interval width directly: the unscaled t quantile or
        // its square can overflow even when the final interval is finite.
        (sigma.ln() + 0.5 * (df.ln() + logy - logz - size.ln())).exp()
    } else {
        let q = if alpha / 2. == 0. {
            -math::inverse_tail(alpha.ln() - std::f64::consts::LN_2)
        } else {
            -math::inverse(alpha / 2.)
        };
        regression::scaled(q, sigma, size.sqrt())
    };
    Some(Value::number(result))
}

impl Calculation<'_> {
    pub(in super::super) fn z_test(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(2..=3).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let (source, transposed) = self.matrix_source(&args[0], pos, depth + 1)?;
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
        let n = data.len() as f64;
        let axis = if data.is_empty() {
            None
        } else {
            Some(regression::normalize(&mut data, 0, 1, true))
        };
        let mean = self.eval(&args[1], pos, depth + 1, true)?;
        let mean = self.matrix(mean, depth + 1)?;
        let sigma = if args.len() == 3 {
            let v = self.eval(&args[2], pos, depth + 1, true)?;
            Some(self.matrix(v, depth + 1)?)
        } else {
            None
        };
        let rows = mean.len().max(sigma.as_ref().map_or(1, Vec::len));
        let cols = mean[0].len().max(sigma.as_ref().map_or(1, |v| v[0].len()));
        self.work = self.work.checked_sub(
            rows.checked_mul(cols)?
                .checked_mul(std::mem::size_of::<Value>() + 128)?,
        )?;
        let mut result = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for c in 0..cols {
                self.tick(depth)?;
                let x = mean
                    .get(if mean.len() == 1 { 0 } else { r })
                    .and_then(|v| v.get(if v.len() == 1 { 0 } else { c }))
                    .unwrap_or(&Value::Error("#N/A"));
                let s = sigma.as_ref().map(|v| {
                    v.get(if v.len() == 1 { 0 } else { r })
                        .and_then(|v| v.get(if v.len() == 1 { 0 } else { c }))
                        .unwrap_or(&Value::Error("#N/A"))
                });
                self.charge_value(x)?;
                if let Some(v) = s {
                    self.charge_value(v)?;
                }
                let value = (|| {
                    for v in std::iter::once(x).chain(s) {
                        if let Value::Error(e) | Value::LiteralError(e) = v {
                            return Value::Error(e);
                        }
                    }
                    let Some(axis) = axis else {
                        return Value::Error("#N/A");
                    };
                    let x = match numeric(x, self.book.date1904, false) {
                        Ok(v) => v,
                        Err(e) => return Value::Error(e),
                    };
                    let (sigma_scale, sigma_factor) = if let Some(s) = s {
                        match numeric(s, self.book.date1904, false) {
                            Ok(v) if v > 0. => (v, 1.),
                            Ok(_) => return Value::Error("#NUM!"),
                            Err(e) => return Value::Error(e),
                        }
                    } else {
                        if n < 2. || axis.norm == 0. {
                            return Value::Error("#DIV/0!");
                        }
                        (axis.scale, axis.norm / (n - 1.).sqrt())
                    };
                    let difference = axis.origin - x;
                    let scale = axis.scale.max(if difference.is_finite() {
                        difference.abs()
                    } else {
                        axis.origin.abs().max(x.abs())
                    });
                    let delta = (if difference.is_finite() {
                        difference / scale
                    } else {
                        axis.origin / scale - x / scale
                    }) + axis.mean * (axis.scale / scale);
                    let direct =
                        regression::scaled(delta, scale, sigma_scale) / sigma_factor * n.sqrt();
                    let z = if direct.is_finite() && (direct != 0. || delta == 0.) {
                        direct
                    } else {
                        (delta.abs().ln() + scale.ln() - sigma_scale.ln() - sigma_factor.ln()
                            + 0.5 * n.ln())
                        .exp()
                        .copysign(delta)
                    };
                    // Evaluate the small survival tail directly, not 1-CDF.
                    Value::number(math::cdf(-z))
                })();
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
