// Output conventions from IronCalc statistical/linest.rs (f93662006b8fb1c401dc870bbda26c5d60ac6037,
// MIT, LICENSE.IronCalc). Householder QR adapted from Univer basics/statistical.ts
// (4767b3b309467c283bbd52b725536ca73861e0fc, Apache-2.0, LICENSE.Univer).
// Centered/scaled flat buffers, column pivoting, and the same triangular factor
// for standard errors avoid the normal equations' loss of precision. Predict in
// the centered coordinates, including exponential fits, before rescaling.
use super::{Calculation, Coord, Expr, Value, lookup, matrix_functions::shape};

pub(in super::super) fn sum(values: impl Iterator<Item = f64>) -> f64 {
    let (mut total, mut correction) = (0_f64, 0_f64);
    for value in values {
        let next = total + value;
        correction += if total.abs() >= value.abs() {
            (total - next) + value
        } else {
            (value - next) + total
        };
        total = next;
    }
    total + correction
}

pub(super) fn scaled(value: f64, numerator: f64, denominator: f64) -> f64 {
    let product = value * numerator;
    if product.is_finite() && (product != 0. || value == 0. || numerator == 0.) {
        product / denominator
    } else {
        (value / denominator) * numerator
    }
}

#[derive(Clone, Copy)]
pub(super) struct Axis {
    pub(super) origin: f64,
    pub(super) scale: f64,
    pub(super) mean: f64,
    pub(super) norm: f64,
}
impl Axis {
    pub(super) fn center(&self) -> f64 {
        let value = self.origin + self.mean * self.scale;
        if value.is_finite() {
            value
        } else {
            (self.origin / self.scale + self.mean) * self.scale
        }
    }
    pub(super) fn delta(&self, value: f64) -> f64 {
        let difference = value - self.origin;
        if difference.is_finite() {
            difference / self.scale
        } else {
            value / self.scale - self.origin / self.scale
        }
    }
}

pub(super) fn normalize(data: &mut [f64], column: usize, width: usize, constant: bool) -> Axis {
    let origin = if constant { data[column] } else { 0. };
    let mut scale = data
        .iter()
        .skip(column)
        .step_by(width)
        .fold(0_f64, |s, &v| s.max((v - origin).abs()));
    if !scale.is_finite() {
        scale = data
            .iter()
            .skip(column)
            .step_by(width)
            .fold(0_f64, |s, &v| s.max(v.abs()));
    }
    if scale == 0. {
        scale = 1.;
    }
    let mut axis = Axis {
        origin,
        scale,
        mean: 0.,
        norm: 0.,
    };
    for value in data.iter_mut().skip(column).step_by(width) {
        *value = axis.delta(*value);
    }
    if constant {
        axis.mean =
            sum(data.iter().skip(column).step_by(width).copied()) / (data.len() / width) as f64;
    }
    for value in data.iter_mut().skip(column).step_by(width) {
        *value -= axis.mean;
        axis.norm = axis.norm.hypot(*value);
    }
    axis
}

struct Fit {
    coefficients: Vec<f64>,
    axes: Vec<Axis>,
    y: Axis,
    statistics: Vec<Vec<Value>>,
}
impl Fit {
    fn intercept(&self) -> f64 {
        sum(
            std::iter::once(self.y.origin / self.y.scale + self.y.mean).chain(
                self.coefficients
                    .iter()
                    .zip(&self.axes)
                    .map(|(&c, a)| -c * (a.origin / a.scale + a.mean)),
            ),
        ) * self.y.scale
    }
    fn predict(&self, x: &[f64]) -> f64 {
        let value = self.y.mean
            + sum(x
                .iter()
                .zip(&self.axes)
                .zip(&self.coefficients)
                .filter(|(_, c)| **c != 0.)
                .map(|((&v, a), &c)| c * (a.delta(v) - a.mean)));
        let product = value * self.y.scale;
        let result = if product.is_finite() {
            self.y.origin + product
        } else {
            (self.y.origin / self.y.scale + value) * self.y.scale
        };
        if result.is_finite() {
            return result;
        }
        // A new x can overflow normalized coordinates while the prediction
        // remains finite, e.g. fit y=x near 1e-200 and predict at 1e308.
        sum(std::iter::once(self.y.center()).chain(
            x.iter()
                .zip(&self.axes)
                .zip(&self.coefficients)
                .filter(|(_, c)| **c != 0.)
                .map(|((&v, a), &c)| {
                    let coefficient = scaled(c, self.y.scale, a.scale);
                    let center = a.center();
                    let difference = v - center;
                    if difference.is_finite() {
                        coefficient * difference
                    } else {
                        coefficient * v - coefficient * center
                    }
                }),
        ))
    }
}

fn fit(
    y: &mut [f64],
    x: &mut [f64],
    p: usize,
    constant: bool,
    stats: bool,
    work: &mut usize,
) -> Option<Fit> {
    let n = y.len();
    // Reserve the entire factorization's O(n*p*p) work before its loops. No
    // per-observation row allocations, matrix inverse, or fitted-value buffer.
    *work = work.checked_sub(
        n.checked_mul(p)?
            .checked_mul(p.checked_add(8)?)?
            .checked_mul(6)?,
    )?;
    *work = work.checked_sub(p.checked_mul(96)?)?;
    let y_axis = normalize(y, 0, 1, constant);
    let total = sum(y.iter().map(|v| v * v));
    let mut axes = Vec::with_capacity(p);
    for column in 0..p {
        let axis = normalize(x, column, p, constant);
        if axis.norm != 0. {
            for r in 0..n {
                x[r * p + column] /= axis.norm;
            }
        }
        axes.push(axis);
    }
    let mut permutation: Vec<_> = (0..p).collect();
    let mut rank = 0;
    for pivot in 0..p {
        let (mut best, mut norm) = (pivot, 0_f64);
        for c in pivot..p {
            let candidate = (pivot..n).fold(0_f64, |a, r| a.hypot(x[r * p + c]));
            if candidate > norm {
                best = c;
                norm = candidate;
            }
        }
        if norm <= f64::EPSILON * n as f64 {
            break;
        }
        if best != pivot {
            permutation.swap(pivot, best);
            for r in 0..n {
                x.swap(r * p + pivot, r * p + best);
            }
        }
        let first = x[pivot * p + pivot];
        let alpha = -norm.copysign(first);
        let tau = (alpha - first) / alpha;
        let divisor = first - alpha;
        for r in pivot + 1..n {
            x[r * p + pivot] /= divisor;
        }
        x[pivot * p + pivot] = alpha;
        for c in pivot + 1..p {
            let projection =
                x[pivot * p + c] + sum((pivot + 1..n).map(|r| x[r * p + pivot] * x[r * p + c]));
            let factor = tau * projection;
            x[pivot * p + c] -= factor;
            for r in pivot + 1..n {
                x[r * p + c] -= factor * x[r * p + pivot];
            }
        }
        let projection = y[pivot] + sum((pivot + 1..n).map(|r| x[r * p + pivot] * y[r]));
        let factor = tau * projection;
        y[pivot] -= factor;
        for r in pivot + 1..n {
            y[r] -= factor * x[r * p + pivot];
        }
        rank += 1;
    }
    let mut coefficients = vec![0.; p];
    for r in (0..rank).rev() {
        coefficients[r] =
            (y[r] - sum((r + 1..rank).map(|c| x[r * p + c] * coefficients[c]))) / x[r * p + r];
    }
    let mut ordered = vec![0.; p];
    for i in 0..rank {
        let c = permutation[i];
        ordered[c] = coefficients[i] / axes[c].norm;
    }
    let mut result = Fit {
        coefficients: ordered,
        axes,
        y: y_axis,
        statistics: Vec::new(),
    };
    if !stats {
        return Some(result);
    }
    *work = work.checked_sub(rank.checked_mul(rank)?.checked_mul(rank.checked_add(2)?)?)?;
    *work = work.checked_sub(
        rank.checked_mul(rank)?
            .checked_mul(8)?
            .checked_add(p.checked_mul(16)?)?,
    )?;
    let df = n - rank - usize::from(constant);
    let mut residual = sum(y[rank..].iter().map(|v| v * v));
    if residual <= 4. * f64::EPSILON * f64::EPSILON * total {
        residual = 0.;
    }
    let explained = (total - residual).max(0.);
    let variance = if df > 0 { residual / df as f64 } else { 0. };
    let deviation = variance.sqrt();
    let mut inverse = vec![0.; rank * rank];
    for c in 0..rank {
        for r in (0..=c).rev() {
            inverse[r * rank + c] = (f64::from(r == c)
                - sum((r + 1..=c).map(|k| x[r * p + k] * inverse[k * rank + c])))
                / x[r * p + r];
        }
    }
    let mut errors = vec![Value::Number(0.); p + 1];
    for i in 0..rank {
        let c = permutation[i];
        let norm = (i..rank).fold(0_f64, |a, k| a.hypot(inverse[i * rank + k]));
        errors[p - 1 - c] = Value::number(scaled(
            deviation * norm / result.axes[c].norm,
            result.y.scale,
            result.axes[c].scale,
        ));
    }
    errors[p] = if constant {
        let mut norm = 1. / (n as f64).sqrt();
        for k in 0..rank {
            let term = sum((0..=k).map(|i| {
                let a = result.axes[permutation[i]];
                (a.origin / a.scale + a.mean) / a.norm * inverse[i * rank + k]
            }));
            norm = norm.hypot(term);
        }
        Value::number(scaled(deviation * norm, result.y.scale, 1.))
    } else {
        Value::Error("#N/A")
    };
    let mut rows = vec![vec![Value::Error("#N/A"); p + 1]; 3];
    rows[0][0] = Value::number(if total == 0. {
        1.
    } else {
        (explained / total).clamp(0., 1.)
    });
    rows[0][1] = Value::number(deviation * result.y.scale);
    rows[1][0] = if df == 0 || rank == 0 || residual == 0. {
        Value::Error("#NUM!")
    } else {
        Value::number((explained / rank as f64) / (residual / df as f64))
    };
    rows[1][1] = Value::number(df as f64);
    rows[2][0] = Value::number(explained * result.y.scale * result.y.scale);
    rows[2][1] = Value::number(residual * result.y.scale * result.y.scale);
    result.statistics.push(errors);
    result.statistics.extend(rows);
    Some(result)
}

impl Calculation<'_> {
    pub(super) fn regression(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(1..=4).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let predict = matches!(name, "TREND" | "GROWTH");
        let exponential = matches!(name, "LOGEST" | "GROWTH");
        let (mut constant, mut stats) = (true, false);
        for i in if predict { 3..4 } else { 2..4 } {
            if let Some(arg) = args.get(i) {
                let value = self.eval(arg, pos, depth + 1, true)?;
                if matches!(value, Value::Blank | Value::Empty | Value::Omitted) {
                    continue;
                }
                let value = match value {
                    Value::Range(a, b) if a.0 == b.0 => {
                        self.cell((a.0, a.1.min(b.1), a.2.min(b.2)), depth + 1)?
                    }
                    value => self.scalar(value, pos, depth + 1)?,
                };
                self.charge_value(&value)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let Some(flag) = lookup::boolean(&value).or_else(|| match &value {
                    Value::Text(t) | Value::UninternedText(t) => {
                        lookup::number::parse(t, self.book.date1904).map(|n| n != 0.)
                    }
                    _ => None,
                }) else {
                    return Some(Value::Error("#VALUE!"));
                };
                if predict || i == 2 {
                    constant = flag;
                } else {
                    stats = flag;
                }
            }
        }
        let (source_y, ty) = self.matrix_source(&args[0], pos, depth + 1)?;
        let (yr, yc) = match shape(&source_y, ty) {
            Ok(s) => s,
            Err(e) => return Some(Value::Error(e)),
        };
        let mut y = match self.numeric_matrix(&source_y, ty, depth + 1)? {
            Ok(v) => v,
            Err(e) => return Some(Value::Error(e)),
        };
        let n = y.len();
        let source_x = if let Some(arg) = args.get(1) {
            let (source, transposed) = self.matrix_source(arg, pos, depth + 1)?;
            (!matches!(source, Value::Blank | Value::Empty | Value::Omitted))
                .then_some((source, transposed))
        } else {
            None
        };
        let mut row_samples = false;
        let (mut x, p) = if let Some((source, transposed)) = &source_x {
            let (xr, xc) = match shape(source, *transposed) {
                Ok(s) => s,
                Err(e) => return Some(Value::Error(e)),
            };
            if (yr == 1 && xc != yc)
                || (yc == 1 && xr != yr)
                || (yr > 1 && yc > 1 && (xr != yr || xc != yc))
            {
                return Some(Value::Error("#REF!"));
            }
            let p = if yr == 1 {
                row_samples = xr > 1;
                xr
            } else if yc == 1 {
                xc
            } else {
                1
            };
            let x = match self.numeric_matrix(source, *transposed ^ row_samples, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            (x, p)
        } else {
            self.work = self.work.checked_sub(n.checked_mul(8)?)?;
            ((1..=n).map(|i| i as f64).collect(), 1)
        };
        if n < p + usize::from(constant) {
            return Some(Value::Error("#N/A"));
        }
        if exponential {
            for v in &mut y {
                self.tick(depth)?;
                if *v <= 0. {
                    return Some(Value::Error("#NUM!"));
                }
                *v = v.ln();
            }
        }
        let prediction = if predict {
            let new_source = if let Some(arg) = args.get(2) {
                let (source, transposed) = self.matrix_source(arg, pos, depth + 1)?;
                (!matches!(source, Value::Blank | Value::Empty | Value::Omitted))
                    .then_some((source, transposed))
            } else {
                None
            };
            if let Some((source, transposed)) = new_source {
                let (r, c) = match shape(&source, transposed) {
                    Ok(s) => s,
                    Err(e) => return Some(Value::Error(e)),
                };
                if p > 1 && (if row_samples { r != p } else { c != p }) {
                    return Some(Value::Error("#REF!"));
                }
                let values =
                    match self.numeric_matrix(&source, transposed ^ row_samples, depth + 1)? {
                        Ok(v) => v,
                        Err(e) => return Some(Value::Error(e)),
                    };
                Some((
                    values,
                    if p == 1 {
                        (r, c)
                    } else if row_samples {
                        (1, c)
                    } else {
                        (r, 1)
                    },
                ))
            } else {
                self.work = self.work.checked_sub(x.len().checked_mul(8)?)?;
                Some((x.clone(), (yr, yc)))
            }
        } else {
            None
        };
        let output_count = if let Some((_, (r, c))) = &prediction {
            r.checked_mul(*c)?
        } else {
            (p + 1).checked_mul(if stats { 5 } else { 1 })?
        };
        self.work = self.work.checked_sub(
            output_count
                .checked_mul(std::mem::size_of::<Value>() + std::mem::size_of::<Vec<Value>>())?,
        )?;
        let result = fit(&mut y, &mut x, p, constant, stats, &mut self.work)?;
        self.result_format = None;
        if let Some((values, (rows, columns))) = prediction {
            self.work = self.work.checked_sub(values.len().checked_mul(8)?)?;
            let mut output = Vec::with_capacity(rows);
            for r in 0..rows {
                let mut row = Vec::with_capacity(columns);
                for c in 0..columns {
                    let index = (r * columns + c) * p;
                    let value = result.predict(&values[index..index + p]);
                    row.push(Value::number(if exponential { value.exp() } else { value }));
                }
                output.push(row);
            }
            return Some(Value::Matrix(output));
        }
        let mut coefficients = Vec::with_capacity(p + 1);
        for c in (0..p).rev() {
            let value = scaled(result.coefficients[c], result.y.scale, result.axes[c].scale);
            coefficients.push(Value::number(if exponential { value.exp() } else { value }));
        }
        let intercept = if constant { result.intercept() } else { 0. };
        coefficients.push(Value::number(if exponential {
            intercept.exp()
        } else {
            intercept
        }));
        let mut output = vec![coefficients];
        output.extend(result.statistics);
        Some(Value::Matrix(output))
    }
}
