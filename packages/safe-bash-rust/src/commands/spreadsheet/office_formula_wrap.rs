// Adapted from IronCalc lookup_and_reference/wrapcols_wraprows.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc), with compact
// single-vector results and parameter broadcasting from Univer lookup/wraprows
// and wrapcols at 4767b3b309467c283bbd52b725536ca73861e0fc (Apache-2.0, LICENSE.Univer).
use super::{Calculation, Coord, Expr, Value, lookup};

fn count(value: &Value) -> Result<f64, &'static str> {
    if let Value::Error(e) | Value::LiteralError(e) = value {
        return Err(e);
    }
    let n = value
        .numeric()
        .filter(|n| n.is_finite())
        .ok_or("#VALUE!")?
        .trunc();
    if n < 1. { Err("#NUM!") } else { Ok(n) }
}

impl Calculation<'_> {
    pub(super) fn wrap_vector(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(2..=3).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let source = self.eval(&args[0], pos, depth + 1, true)?.into_range();
        let dimensions = lookup::dimensions(&source);
        let error = match &source {
            Value::Error(e) | Value::LiteralError(e) => Some(*e),
            Value::InvalidReference | Value::InvalidRange(..) => Some("#REF!"),
            Value::Blank | Value::Empty | Value::Set(_) => Some("#VALUE!"),
            Value::Range(a, b) if a.0 != b.0 => Some("#VALUE!"),
            _ if dimensions.0 == 0 || dimensions.1 == 0 || dimensions.0 > 1 && dimensions.1 > 1 => {
                Some("#VALUE!")
            }
            _ => None,
        };
        let mut counts = self.eval(&args[1], pos, depth + 1, true)?.into_range();
        let mut padding = if let Some(arg) = args
            .get(2)
            .filter(|a| !matches!(a, Expr::Value(Value::Blank)))
        {
            self.eval(arg, pos, depth + 1, true)?.into_range()
        } else {
            Value::Error("#N/A")
        };
        for value in [&mut counts, &mut padding] {
            if matches!(value, Value::Range(a,b) if a.0 != b.0) {
                *value = Value::Error("#VALUE!");
            }
        }
        let (cr, cc) = lookup::dimensions(&counts);
        let (pr, pc) = lookup::dimensions(&padding);
        let (rows, cols) = (cr.max(pr), cc.max(pc));
        if rows > 1 || cols > 1 {
            // Array parameters lift the function over their broadcast shape.
            // Each inner result contributes its first value, without allocating
            // or reading the remaining vector for each parameter combination.
            self.work = self.work.checked_sub(
                rows.checked_mul(cols)?
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            let mut output = Vec::with_capacity(rows);
            for r in 0..rows {
                let mut row = Vec::with_capacity(cols);
                for c in 0..cols {
                    self.tick(depth)?;
                    let value = if let Some(e) = error {
                        Value::Error(e)
                    } else if cr != 1 && r >= cr || cc != 1 && c >= cc {
                        Value::Error("#N/A")
                    } else {
                        let value = self.lookup_entry(
                            &counts,
                            if cr == 1 { 0 } else { r },
                            if cc == 1 { 0 } else { c },
                            pos,
                            depth + 1,
                        )?;
                        match count(&value) {
                            Err(e) => Value::Error(e),
                            Ok(_) => self.lookup_entry(&source, 0, 0, pos, depth + 1)?,
                        }
                    };
                    row.push(if matches!(value, Value::Blank | Value::Empty) {
                        Value::Number(0.)
                    } else {
                        value
                    });
                }
                output.push(row);
            }
            return Some(Value::Matrix(output));
        }
        if let Some(e) = error {
            return Some(Value::Error(e));
        }
        let value = self.lookup_entry(&counts, 0, 0, pos, depth + 1)?;
        let n = match count(&value) {
            Ok(n) => n,
            Err(e) => return Some(Value::Error(e)),
        };
        let len = dimensions.0.max(dimensions.1);
        // Clamp before the float-to-integer conversion and before allocation.
        let wrap = n.min(len as f64) as usize;
        let by_columns = name == "WRAPCOLS";
        let (rows, cols) = if by_columns {
            (wrap, len.div_ceil(wrap))
        } else {
            (len.div_ceil(wrap), wrap)
        };
        self.work = self.work.checked_sub(
            rows.checked_mul(cols)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let pad = self.lookup_entry(&padding, 0, 0, pos, depth + 1)?;
        let pad = if matches!(pad, Value::Blank | Value::Empty) {
            Value::Error("#N/A")
        } else {
            pad
        };
        let mut output = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for c in 0..cols {
                self.tick(depth)?;
                let i = if by_columns {
                    c * rows + r
                } else {
                    r * cols + c
                };
                let value = if i < len {
                    self.lookup_entry(
                        &source,
                        if dimensions.0 == 1 { 0 } else { i },
                        if dimensions.1 == 1 { 0 } else { i },
                        pos,
                        depth + 1,
                    )?
                } else {
                    self.charge_value(&pad)?;
                    pad.clone()
                };
                row.push(if matches!(value, Value::Blank | Value::Empty) {
                    Value::Number(0.)
                } else {
                    value
                });
            }
            output.push(row);
        }
        Some(Value::Matrix(output))
    }
}
