// Adapted from IronCalc lookup_and_reference/expand.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc). Omitted
// dimensions and parameter broadcasting follow Univer lookup/expand at
// 4767b3b309467c283bbd52b725536ca73861e0fc (Apache-2.0, LICENSE.Univer).
use super::{Calculation, Coord, Expr, Value, lookup};

fn shape(
    rows: &Value,
    columns: &Value,
    source: (usize, usize),
) -> Result<(usize, usize), &'static str> {
    let mut result = [0; 2];
    for (axis, value, minimum, maximum) in [
        (0, rows, source.0, 1_048_576),
        (1, columns, source.1, 16_384),
    ] {
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Err(e);
        }
        let n = value
            .numeric()
            .filter(|n| n.is_finite())
            .ok_or("#VALUE!")?
            .trunc();
        if n < minimum as f64 {
            return Err("#VALUE!");
        }
        if n > maximum as f64 {
            return Err("#NUM!");
        }
        result[axis] = n as usize;
    }
    Ok((result[0], result[1]))
}

impl Calculation<'_> {
    pub(super) fn expand_array(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if !(2..=4).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let source = self.eval(&args[0], pos, depth + 1, true)?.into_range();
        let source_shape = lookup::dimensions(&source);
        let error = match &source {
            Value::Error(e) | Value::LiteralError(e) => Some(*e),
            Value::InvalidReference | Value::InvalidRange(..) => Some("#REF!"),
            Value::Blank | Value::Empty | Value::Set(_) => Some("#VALUE!"),
            Value::Range(a, b) if a.0 != b.0 => Some("#VALUE!"),
            _ if source_shape.0 == 0 || source_shape.1 == 0 => Some("#VALUE!"),
            _ => None,
        };
        let mut parameters = [
            Value::Number(source_shape.0 as f64),
            Value::Number(source_shape.1 as f64),
        ];
        for (axis, value) in parameters.iter_mut().enumerate() {
            if let Some(arg) = args
                .get(axis + 1)
                .filter(|arg| !matches!(arg, Expr::Value(Value::Blank)))
            {
                *value = self.eval(arg, pos, depth + 1, true)?.into_range();
                if matches!(value,Value::Range(a,b) if a.0!=b.0) {
                    *value = Value::Error("#VALUE!");
                }
            }
        }
        let mut padding = if let Some(arg) = args
            .get(3)
            .filter(|arg| !matches!(arg, Expr::Value(Value::Blank)))
        {
            self.eval(arg, pos, depth + 1, true)?.into_range()
        } else {
            Value::Error("#N/A")
        };
        if matches!(&padding,Value::Range(a,b) if a.0!=b.0) {
            padding = Value::Error("#VALUE!");
        }
        let invalid_padding =
            lookup::dimensions(&padding) != (1, 1) || matches!(padding, Value::Set(_));
        let sizes = parameters.each_ref().map(lookup::dimensions);
        let (rows, columns) = (sizes[0].0.max(sizes[1].0), sizes[0].1.max(sizes[1].1));
        if rows > 1 || columns > 1 {
            // Each array-valued parameter combination contributes its first
            // output value. Validate its requested size without allocating it.
            self.work = self.work.checked_sub(
                rows.checked_mul(columns)?
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            let mut output = Vec::with_capacity(rows);
            for r in 0..rows {
                let mut row = Vec::with_capacity(columns);
                for c in 0..columns {
                    self.tick(depth)?;
                    let value = if let Some(e) = error {
                        Value::Error(e)
                    } else {
                        let mut counts = [Value::Empty, Value::Empty];
                        for axis in 0..2 {
                            let (h, w) = sizes[axis];
                            counts[axis] = if h != 1 && r >= h || w != 1 && c >= w {
                                Value::Error("#N/A")
                            } else {
                                self.lookup_entry(
                                    &parameters[axis],
                                    if h == 1 { 0 } else { r },
                                    if w == 1 { 0 } else { c },
                                    pos,
                                    depth + 1,
                                )?
                            };
                        }
                        match shape(&counts[0], &counts[1], source_shape) {
                            Err(e) => Value::Error(e),
                            Ok(_) if invalid_padding => Value::Error("#VALUE!"),
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
        let rows = self.lookup_entry(&parameters[0], 0, 0, pos, depth + 1)?;
        let columns = self.lookup_entry(&parameters[1], 0, 0, pos, depth + 1)?;
        let (rows, columns) = match shape(&rows, &columns, source_shape) {
            Ok(shape) => shape,
            Err(e) => return Some(Value::Error(e)),
        };
        if invalid_padding {
            return Some(Value::Error("#VALUE!"));
        }
        self.work = self.work.checked_sub(
            rows.checked_mul(columns)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let padding = self.lookup_entry(&padding, 0, 0, pos, depth + 1)?;
        let mut output = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row = Vec::with_capacity(columns);
            for c in 0..columns {
                self.tick(depth)?;
                let value = if r < source_shape.0 && c < source_shape.1 {
                    self.lookup_entry(&source, r, c, pos, depth + 1)?
                } else {
                    self.charge_value(&padding)?;
                    padding.clone()
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
