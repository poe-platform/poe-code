// Adapted from IronCalc logical/{map_reduce,scan,bycol_byrow}.rs and cast.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc).
// Read ranges one value at a time; REDUCE retains only its accumulator.
use super::{Calculation, Coord, Expr, Format, Value, lookup};

impl Calculation<'_> {
    pub(super) fn higher_order(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let map = name == "MAP";
        let scan = name == "SCAN";
        if args.len() < 2 || !map && args.len() > 3 {
            return Some(Value::Error("#ERROR!"));
        }
        let callable = self.eval(args.last()?, pos, depth + 1, true)?;
        let index = match callable {
            Value::Lambda(index) => index,
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            _ => return Some(Value::Error("#VALUE!")),
        };
        let count = if map { args.len() - 1 } else { 2 };
        if self.lambdas.get(index)?.parameters.len() != count {
            return Some(Value::Error("#VALUE!"));
        }
        let input = if map {
            &args[..args.len() - 1]
        } else {
            &args[args.len() - 2..args.len() - 1]
        };
        self.work = self
            .work
            .checked_sub(input.len().checked_mul(std::mem::size_of::<Value>())?)?;
        let mut sources = Vec::with_capacity(input.len());
        let mut dimensions = None;
        for arg in input {
            let source = self.eval(arg, pos, depth + 1, true)?.into_range();
            match &source {
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::InvalidReference | Value::InvalidRange(..) => {
                    return Some(Value::Error("#REF!"));
                }
                Value::Set(_) => return Some(Value::Error("#VALUE!")),
                Value::Range(a, b) if a.0 != b.0 => return Some(Value::Error("#VALUE!")),
                _ => {}
            }
            let size = lookup::dimensions(&source);
            if size.0 == 0 || size.1 == 0 || dimensions.is_some_and(|previous| previous != size) {
                return Some(Value::Error("#VALUE!"));
            }
            dimensions = Some(size);
            sources.push(source);
        }
        let (rows, columns) = dimensions?;
        let cells = rows.checked_mul(columns)?;
        // All callbacks must be visited, including blank inputs. Reject an
        // impossible iteration count before scanning ranges or allocating output.
        self.work = self.work.checked_sub(
            cells.checked_mul(
                count
                    .checked_mul(std::mem::size_of::<(Value, Option<Format>)>() + 32)?
                    .checked_add(1)?,
            )?,
        )?;
        if map || scan {
            self.work = self.work.checked_sub(
                cells
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
        }
        for source in &sources {
            if let Value::Range(a, b) = source {
                self.read_spill_range(*a, *b)?;
            }
        }
        let seeded = !map && args.len() == 3;
        let mut accumulator = if seeded {
            self.eval(&args[0], pos, depth + 1, true)?
        } else {
            Value::Blank
        };
        if seeded && matches!(accumulator, Value::Error(_) | Value::LiteralError(_)) {
            return Some(accumulator);
        }
        let mut output = Vec::with_capacity(if map || scan { rows } else { 0 });
        for r in 0..rows {
            let mut row = Vec::with_capacity(if map || scan { columns } else { 0 });
            for c in 0..columns {
                self.tick(depth)?;
                if map {
                    let mut values = Vec::with_capacity(sources.len());
                    for source in &sources {
                        values.push((self.lookup_entry(source, r, c, pos, depth + 1)?, None));
                    }
                    let value = self.invoke_values(index, values, pos, depth + 1)?;
                    row.push(self.lambda_element(value, pos, depth + 1)?);
                } else {
                    let current = self.lookup_entry(&sources[0], r, c, pos, depth + 1)?;
                    if !seeded && r == 0 && c == 0 {
                        accumulator = current;
                    } else {
                        accumulator = self.invoke_values(
                            index,
                            vec![(accumulator, None), (current, None)],
                            pos,
                            depth + 1,
                        )?;
                    }
                    if scan {
                        accumulator = self.lambda_element(accumulator, pos, depth + 1)?;
                        self.charge_value(&accumulator)?;
                        row.push(accumulator.clone());
                    }
                }
            }
            if map || scan {
                output.push(row);
            }
        }
        Some(if map || scan {
            Value::Matrix(output)
        } else {
            accumulator
        })
    }

    pub(super) fn array_callback(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let generated = name == "MAKEARRAY";
        let byrow = name == "BYROW";
        if args.len() != if generated { 3 } else { 2 } {
            return Some(Value::Error("#ERROR!"));
        }
        let mut source = Value::Blank;
        let (rows, columns) = if generated {
            let mut size = [0; 2];
            for (i, arg) in args[..2].iter().enumerate() {
                let value = self.eval(arg, pos, depth + 1, true)?;
                let value = self.scalar(value, pos, depth + 1)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let Some(n) = value.numeric().filter(|n| n.is_finite()).map(f64::trunc) else {
                    return Some(Value::Error("#VALUE!"));
                };
                if n < 1. || n > if i == 0 { 1_048_576. } else { 16_384. } {
                    return Some(Value::Error("#VALUE!"));
                }
                size[i] = n as usize;
            }
            (size[0], size[1])
        } else {
            source = self.eval(&args[0], pos, depth + 1, true)?.into_range();
            match &source {
                Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                Value::InvalidReference | Value::InvalidRange(..) => {
                    return Some(Value::Error("#REF!"));
                }
                Value::Set(_) => return Some(Value::Error("#VALUE!")),
                Value::Range(a, b) if a.0 != b.0 => return Some(Value::Error("#VALUE!")),
                _ => {}
            }
            lookup::dimensions(&source)
        };
        if rows == 0 || columns == 0 {
            return Some(Value::Error("#VALUE!"));
        }
        let callable = self.eval(args.last()?, pos, depth + 1, true)?;
        let index = match callable {
            Value::Lambda(index) => index,
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            _ => return Some(Value::Error("#VALUE!")),
        };
        let count = if generated { 2 } else { 1 };
        if self.lambdas.get(index)?.parameters.len() != count {
            return Some(Value::Error("#VALUE!"));
        }
        let (height, width) = if generated {
            (rows, columns)
        } else if byrow {
            (rows, 1)
        } else {
            (1, columns)
        };
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(
                    std::mem::size_of::<Value>()
                        + count * (std::mem::size_of::<(Value, Option<Format>)>() + 32),
                )?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        if let Value::Range(a, b) = &source {
            self.read_spill_range(*a, *b)?;
        }
        let mut output = Vec::with_capacity(height);
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                self.tick(depth)?;
                let values = if generated {
                    vec![
                        (Value::Number((r + 1) as f64), None),
                        (Value::Number((c + 1) as f64), None),
                    ]
                } else {
                    let slice = if let Value::Range(a, b) = &source {
                        let (start_r, start_c) = (a.1.min(b.1), a.2.min(b.2));
                        if byrow {
                            Value::Range(
                                (a.0, start_r + r, start_c),
                                (a.0, start_r + r, start_c + columns - 1),
                            )
                        } else {
                            Value::Range(
                                (a.0, start_r, start_c + c),
                                (a.0, start_r + rows - 1, start_c + c),
                            )
                        }
                    } else {
                        let (h, w) = if byrow { (1, columns) } else { (rows, 1) };
                        self.work = self.work.checked_sub(
                            h.checked_mul(w)?
                                .checked_mul(std::mem::size_of::<Value>())?
                                .checked_add(h.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
                        )?;
                        let mut slice = Vec::with_capacity(h);
                        for sr in 0..h {
                            let mut line = Vec::with_capacity(w);
                            for sc in 0..w {
                                line.push(self.lookup_entry(
                                    &source,
                                    if byrow { r } else { sr },
                                    if byrow { sc } else { c },
                                    pos,
                                    depth + 1,
                                )?);
                            }
                            slice.push(line);
                        }
                        Value::Matrix(slice)
                    };
                    vec![(slice, None)]
                };
                let value = self.invoke_values(index, values, pos, depth + 1)?;
                row.push(self.lambda_element(value, pos, depth + 1)?);
            }
            output.push(row);
        }
        Some(Value::Matrix(output))
    }

    fn lambda_element(&mut self, value: Value, pos: Coord, depth: usize) -> Option<Value> {
        let value = match value {
            Value::Matrix(mut rows) if rows.len() == 1 && rows[0].len() == 1 => {
                rows.pop()?.pop()?
            }
            Value::Matrix(_) | Value::Set(_) | Value::Lambda(_) => {
                return Some(Value::Error("#CALC!"));
            }
            Value::Range(a, b) if a != b => return Some(Value::Error("#CALC!")),
            value => value,
        };
        self.scalar(value, pos, depth + 1)
    }
}
