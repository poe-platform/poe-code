// Pairing and formulas adapted from IronCalc statistical/{correl,pearson,
// covariance,forecast}.rs (f936620, MIT, LICENSE.IronCalc) and Univer's
// getTwoArrayNumberValues/forecast (4767b3b, Apache-2.0, LICENSE.Univer).
// Keep original positions when skipping nonnumeric pairs. Sparse ranges do not
// allocate blanks. Center/scale before products to avoid cancellation/overflow.
use super::regression::{Axis, normalize, scaled, sum};
use super::{Calculation, Coord, Expr, Value, lookup, matrix_functions::shape};
use std::collections::{BTreeMap, BTreeSet};

fn predict(value: f64, slope: f64, x: Axis, y: Axis) -> f64 {
    let mean_y = y.center();
    if slope == 0. {
        return mean_y;
    }
    let normalized = y.mean + slope * (x.delta(value) - x.mean);
    let product = normalized * y.scale;
    let result = if product.is_finite() {
        y.origin + product
    } else {
        (y.origin / y.scale + normalized) * y.scale
    };
    if result.is_finite() {
        return result;
    }
    // New x values may exceed the normalized coordinate range while the result
    // still fits, e.g. y=x fitted near 1e-200 and evaluated at 1e308.
    let coefficient = scaled(slope, y.scale, x.scale);
    let mean_x = x.center();
    let difference = value - mean_x;
    if difference.is_finite() {
        mean_y + coefficient * difference
    } else {
        mean_y + (coefficient * value - coefficient * mean_x)
    }
}

impl Calculation<'_> {
    pub(super) fn paired_entries(
        &mut self,
        source: Value,
        transposed: bool,
        depth: usize,
    ) -> Option<Result<BTreeMap<usize, Result<f64, &'static str>>, &'static str>> {
        let (_, width) = match shape(&source, transposed) {
            Ok(s) => s,
            Err(e) => return Some(Err(e)),
        };
        let mut entries = BTreeMap::new();
        let mut add = |r: usize, c: usize, v: Value, work: &mut usize| {
            let value = match v {
                Value::Error(e) | Value::LiteralError(e) => Err(e),
                Value::Number(n) if n.is_finite() => Ok(n),
                Value::Number(_) => Err("#NUM!"),
                _ => return Some(()),
            };
            *work = work.checked_sub(64)?;
            let (r, c) = if transposed { (c, r) } else { (r, c) };
            entries.insert(r * width + c, value);
            Some(())
        };
        match source {
            Value::Range(a, b) => {
                self.read_spill_range(a, b)?;
                let start = (a.0, a.1.min(b.1), a.2.min(b.2));
                let end = (a.0, a.1.max(b.1), a.2.max(b.2));
                let mut cells = BTreeSet::new();
                for &coord in self
                    .values
                    .range(start..=end)
                    .map(|(c, _)| c)
                    .chain(self.expressions.range(start..=end).map(|(c, _)| c))
                {
                    self.work = self.work.checked_sub(1)?;
                    if (start.2..=end.2).contains(&coord.2) {
                        self.work = self.work.checked_sub(64)?;
                        cells.insert(coord);
                    }
                }
                for coord in cells {
                    let value = self.cell(coord, depth + 1)?;
                    // Referencing an empty cell displays zero, but statistics
                    // must distinguish that from an actual numeric zero.
                    if matches!(
                        self.results.get(&coord).or_else(|| self.values.get(&coord)),
                        Some(Value::Blank | Value::Empty)
                    ) {
                        continue;
                    }
                    add(coord.1 - start.1, coord.2 - start.2, value, &mut self.work)?;
                }
            }
            Value::Matrix(rows) => {
                for (r, row) in rows.into_iter().enumerate() {
                    for (c, value) in row.into_iter().enumerate() {
                        self.tick(depth)?;
                        add(r, c, value, &mut self.work)?;
                    }
                }
            }
            value => {
                add(0, 0, value, &mut self.work)?;
            }
        }
        Some(Ok(entries))
    }

    pub(super) fn paired_statistics(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let forecast = matches!(name, "FORECAST" | "FORECAST.LINEAR");
        if args.len() != if forecast { 3 } else { 2 } {
            return Some(Value::Error("#ERROR!"));
        }
        let mut prediction = if forecast {
            let v = self.eval(&args[0], pos, depth + 1, true)?;
            Some(self.matrix(v, depth + 1)?)
        } else {
            None
        };
        // Coerce requested x values before checking the shared source fit.
        // An invalid fit must not replace a parameter's own error or its shape.
        if let Some(output) = &mut prediction {
            for v in output.iter_mut().flatten() {
                self.tick(depth)?;
                self.charge_value(v)?;
                *v = match &*v {
                    Value::Error(e) | Value::LiteralError(e) => Value::Error(e),
                    Value::Text(t) | Value::UninternedText(t) => {
                        lookup::number::parse(t, self.book.date1904)
                            .map(Value::number)
                            .unwrap_or(Value::Error("#VALUE!"))
                    }
                    v => v
                        .numeric()
                        .map(Value::number)
                        .unwrap_or(Value::Error("#VALUE!")),
                };
            }
        }
        let result = (|| {
            let offset = usize::from(forecast);
            let (ys, ty) = self.matrix_source(&args[offset], pos, depth + 1)?;
            let (xs, tx) = self.matrix_source(&args[offset + 1], pos, depth + 1)?;
            let yshape = match shape(&ys, ty) {
                Ok(s) => s,
                Err(e) => return Some(Value::Error(e)),
            };
            let xshape = match shape(&xs, tx) {
                Ok(s) => s,
                Err(e) => return Some(Value::Error(e)),
            };
            if yshape.0.checked_mul(yshape.1)? != xshape.0.checked_mul(xshape.1)? {
                return Some(Value::Error("#N/A"));
            }
            let yentries = match self.paired_entries(ys, ty, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            let xentries = match self.paired_entries(xs, tx, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Value::Error(e)),
            };
            // Find the first error in pair order, including an error opposite
            // text or a blank. The first input wins a tie at the same position.
            self.work = self
                .work
                .checked_sub(yentries.len().checked_add(xentries.len())?)?;
            let first_y = yentries
                .iter()
                .find_map(|(&i, v)| v.as_ref().err().map(|&e| (i, e)));
            let first_x = xentries
                .iter()
                .find_map(|(&i, v)| v.as_ref().err().map(|&e| (i, e)));
            let error = match (first_y, first_x) {
                (Some(a), Some(b)) => Some(if a.0 <= b.0 { a.1 } else { b.1 }),
                (Some((_, e)), _) | (_, Some((_, e))) => Some(e),
                _ => None,
            };
            if let Some(e) = error {
                return Some(Value::Error(e));
            }
            self.work = self
                .work
                .checked_sub(yentries.len().min(xentries.len()).checked_mul(16)?)?;
            let mut pairs = Vec::with_capacity(2 * yentries.len().min(xentries.len()));
            for (i, y) in yentries {
                self.tick(depth)?;
                if let (Ok(y), Some(Ok(x))) = (y, xentries.get(&i)) {
                    pairs.extend([y, *x]);
                }
            }
            drop(xentries);
            let n = pairs.len() / 2;
            let covariance = matches!(name, "COVAR" | "COVARIANCE.P" | "COVARIANCE.S");
            let minimum = if matches!(name, "COVAR" | "COVARIANCE.P") {
                1
            } else if name == "STEYX" {
                3
            } else {
                2
            };
            if n < minimum {
                return Some(Value::Error("#DIV/0!"));
            }
            self.work = self.work.checked_sub(n.checked_mul(40)?)?;
            let y = normalize(&mut pairs, 0, 2, true);
            let x = normalize(&mut pairs, 1, 2, true);
            let cross = sum(pairs.chunks_exact(2).map(|p| p[0] * p[1]));
            self.result_format = None;
            if covariance {
                let factor = cross / (n - usize::from(name == "COVARIANCE.S")) as f64;
                let scales = x.scale * y.scale;
                let result = if scales.is_finite() && scales != 0. {
                    factor * scales
                } else if scales == 0. {
                    (factor * x.scale.max(y.scale)) * x.scale.min(y.scale)
                } else {
                    (factor * x.scale.min(y.scale)) * x.scale.max(y.scale)
                };
                return Some(Value::number(result));
            }
            if x.norm == 0. {
                return Some(Value::Error("#DIV/0!"));
            }
            if matches!(name, "CORREL" | "PEARSON" | "RSQ") {
                if y.norm == 0. {
                    return Some(Value::Error("#DIV/0!"));
                }
                let r = (cross / x.norm / y.norm).clamp(-1., 1.);
                return Some(Value::number(if name == "RSQ" { r * r } else { r }));
            }
            let slope = cross / sum(pairs.chunks_exact(2).map(|p| p[1] * p[1]));
            if let Some(mut output) = prediction.take() {
                for row in &mut output {
                    for v in row {
                        self.tick(depth)?;
                        if let Value::Number(n) = v {
                            *v = Value::number(predict(*n, slope, x, y));
                        }
                    }
                }
                return Some(if output.len() == 1 && output[0].len() == 1 {
                    output.pop()?.pop()?
                } else {
                    Value::Matrix(output)
                });
            }
            Some(Value::number(match name {
                "SLOPE" => scaled(slope, y.scale, x.scale),
                "INTERCEPT" => predict(0., slope, x, y),
                "STEYX" => {
                    let mut residual = pairs
                        .chunks_exact(2)
                        .fold(0_f64, |norm, p| norm.hypot(p[0] - slope * p[1]));
                    if residual <= 2. * f64::EPSILON * y.norm {
                        residual = 0.;
                    }
                    residual / (n as f64 - 2.).sqrt() * y.scale
                }
                _ => return None,
            }))
        })()?;
        if let (Value::Error(e), Some(mut output)) = (&result, prediction) {
            for v in output.iter_mut().flatten() {
                self.tick(depth)?;
                if matches!(v, Value::Number(_)) {
                    *v = Value::Error(e);
                }
            }
            return Some(if output.len() == 1 && output[0].len() == 1 {
                output.pop()?.pop()?
            } else {
                Value::Matrix(output)
            });
        }
        Some(result)
    }
}
