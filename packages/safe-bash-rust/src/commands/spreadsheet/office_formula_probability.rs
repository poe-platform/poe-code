// PROB domain and sum tolerance: IronCalc f936620 statistical/prob.rs (MIT).
// Pairing, bound expansion and error order: Univer 4767b3b statistical/prob
// (Apache-2.0). See LICENSE.IronCalc and LICENSE.Univer. Reuse sparse numeric
// pairs and compensated sums; never allocate the empty part of a whole axis.
use super::super::{Calculation, Coord, Expr, matrix_functions::shape, regression::sum};
use super::{Value, student::numeric};

impl Calculation<'_> {
    pub(in super::super) fn probability(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(3..=4).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let (xs, tx) = self.matrix_source(&args[0], pos, depth + 1)?;
        let (ps, tp) = self.matrix_source(&args[1], pos, depth + 1)?;
        let direct_error = [&xs, &ps].into_iter().find_map(|v| match v {
            Value::Error(e) | Value::LiteralError(e) => Some(*e),
            _ => None,
        });
        let data = (|| {
            let xshape = match shape(&xs, tx) {
                Ok(s) => s,
                Err(e) => return Some(Err(e)),
            };
            let pshape = match shape(&ps, tp) {
                Ok(s) => s,
                Err(e) => return Some(Err(e)),
            };
            for (source, dimensions) in [(&xs, xshape), (&ps, pshape)] {
                if dimensions == (1, 1) {
                    let blank = match source {
                        Value::Blank | Value::Empty | Value::Omitted => true,
                        Value::Matrix(rows) => {
                            matches!(rows[0][0], Value::Blank | Value::Empty | Value::Omitted)
                        }
                        Value::Range(..) => matches!(
                            self.matrix(source.clone(), depth + 1)?[0][0],
                            Value::Blank | Value::Empty
                        ),
                        _ => false,
                    };
                    if blank {
                        return Some(Err("#VALUE!"));
                    }
                }
            }
            if xshape.0.checked_mul(xshape.1)? != pshape.0.checked_mul(pshape.1)? {
                return Some(Err("#N/A"));
            }
            let xentries = match self.paired_entries(xs, tx, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Err(e)),
            };
            let pentries = match self.paired_entries(ps, tp, depth + 1)? {
                Ok(v) => v,
                Err(e) => return Some(Err(e)),
            };
            self.work = self
                .work
                .checked_sub(xentries.len().checked_add(pentries.len())?)?;
            let xe = xentries
                .iter()
                .find_map(|(&i, v)| v.as_ref().err().map(|&e| (i, e)));
            let pe = pentries
                .iter()
                .find_map(|(&i, v)| v.as_ref().err().map(|&e| (i, e)));
            let error = match (xe, pe) {
                (Some(a), Some(b)) => Some(if a.0 <= b.0 { a.1 } else { b.1 }),
                (Some((_, e)), _) | (_, Some((_, e))) => Some(e),
                _ => None,
            };
            if let Some(e) = error {
                return Some(Err(e));
            }
            let capacity = xentries.len().min(pentries.len());
            self.work = self.work.checked_sub(capacity.checked_mul(32)?)?;
            let mut data = Vec::with_capacity(capacity);
            for (i, x) in xentries {
                self.tick(depth)?;
                if let (Ok(x), Some(Ok(p))) = (x, pentries.get(&i)) {
                    if !(0.0..=1.0).contains(p) {
                        return Some(Err("#NUM!"));
                    }
                    data.push((x, *p));
                }
            }
            if data.is_empty() {
                return Some(Err("#DIV/0!"));
            }
            self.work = self.work.checked_sub(data.len())?;
            if (sum(data.iter().map(|(_, p)| *p)) - 1.).abs() > 1e-14 {
                return Some(Err("#NUM!"));
            }
            Some(Ok(data))
        })()?;
        let end = if args.len() == 3 || matches!(args[3], Expr::Value(Value::Blank)) {
            3
        } else {
            4
        };
        let mut limits = Vec::with_capacity(end - 2);
        for arg in &args[2..end] {
            let mut value = self.eval(arg, pos, depth + 1, true)?;
            if !self.array && !matches!(value, Value::Matrix(_)) {
                value = self.implicit_invalid_range(arg, value, pos)?;
                value = self.scalar(value, pos, depth + 1)?;
            }
            limits.push(self.matrix(value, depth + 1)?);
        }
        let lower = &limits[0];
        let upper = limits.get(1).unwrap_or(lower);
        let rows = lower.len().max(upper.len());
        let cols = lower.first()?.len().max(upper.first()?.len());
        self.work = self.work.checked_sub(
            rows.checked_mul(cols)?
                .checked_mul(std::mem::size_of::<Value>() + 32)?,
        )?;
        let mut result = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for c in 0..cols {
                self.tick(depth)?;
                let low = lower
                    .get(if lower.len() == 1 { 0 } else { r })
                    .and_then(|v| v.get(if v.len() == 1 { 0 } else { c }))
                    .unwrap_or(&Value::Error("#N/A"));
                let high = upper
                    .get(if upper.len() == 1 { 0 } else { r })
                    .and_then(|v| v.get(if v.len() == 1 { 0 } else { c }))
                    .unwrap_or(&Value::Error("#N/A"));
                self.charge_value(low)?;
                self.charge_value(high)?;
                let error = direct_error
                    .or_else(|| {
                        [low, high].into_iter().find_map(|v| match v {
                            Value::Error(e) | Value::LiteralError(e) => Some(*e),
                            _ => None,
                        })
                    })
                    .or_else(|| data.as_ref().err().copied());
                let value = if let Some(e) = error {
                    Value::Error(e)
                } else {
                    match (
                        numeric(low, self.book.date1904, false),
                        numeric(high, self.book.date1904, false),
                    ) {
                        (Ok(low), Ok(high)) => {
                            let data = data.as_ref().ok()?;
                            self.work = self.work.checked_sub(data.len())?;
                            Value::number(sum(data
                                .iter()
                                .filter(|(x, _)| *x >= low && *x <= high)
                                .map(|(_, p)| *p)))
                        }
                        (Err(e), _) | (_, Err(e)) => Value::Error(e),
                    }
                };
                row.push(value);
            }
            result.push(row);
        }
        if rows == 1 && cols == 1 {
            result.pop()?.pop()
        } else {
            Some(Value::Matrix(result))
        }
    }
}
