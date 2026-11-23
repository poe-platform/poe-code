// Array shape operations adapted from IronCalc lookup_and_reference/
// {drop_take,tocol_torow,hstack_vstack,choosecols_chooserows}.rs.
// MIT, LICENSE.IronCalc, f93662006b8fb1c401dc870bbda26c5d60ac6037.
use super::{Calculation, Coord, Expr, Value, lookup};

impl Calculation<'_> {
    pub(super) fn shape_function(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let stack = matches!(name, "HSTACK" | "VSTACK");
        let flatten = matches!(name, "TOCOL" | "TOROW");
        let slice = matches!(name, "TAKE" | "DROP");
        if args.len() < if stack || flatten { 1 } else { 2 } || (flatten || slice) && args.len() > 3
        {
            return Some(Value::Error("#ERROR!"));
        }
        if stack {
            let mut arrays = Vec::new();
            let (mut height, mut width) = (0usize, 0usize);
            for arg in args {
                let value = self.eval(arg, pos, depth + 1, true)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let rows = self.matrix(value, depth + 1)?;
                let h = rows.len();
                let w = rows.first().map_or(0, Vec::len);
                if name == "HSTACK" {
                    height = height.max(h);
                    width = width.checked_add(w)?;
                } else {
                    height = height.checked_add(h)?;
                    width = width.max(w);
                }
                self.work = self
                    .work
                    .checked_sub(std::mem::size_of::<Vec<Vec<Value>>>())?;
                arrays.push(rows);
            }
            self.work = self.work.checked_sub(
                height
                    .checked_mul(width)?
                    .checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            let mut output = Vec::with_capacity(height);
            if name == "HSTACK" {
                output.resize_with(height, || Vec::with_capacity(width));
                for rows in arrays {
                    let columns = rows.first().map_or(0, Vec::len);
                    let mut rows = rows.into_iter();
                    for row in &mut output {
                        self.tick(depth)?;
                        if let Some(mut values) = rows.next() {
                            row.append(&mut values);
                        } else {
                            row.extend(std::iter::repeat_n(Value::Error("#N/A"), columns));
                        }
                    }
                }
            } else {
                for mut row in arrays.into_iter().flatten() {
                    self.tick(depth)?;
                    row.resize(width, Value::Error("#N/A"));
                    output.push(row);
                }
            }
            return Some(Value::Matrix(output));
        }
        let source = self.eval(&args[0], pos, depth + 1, true)?.into_range();
        match &source {
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            Value::InvalidReference | Value::InvalidRange(..) => {
                return Some(Value::Error("#REF!"));
            }
            Value::Set(_) => return Some(Value::Error("#VALUE!")),
            Value::Range(a, b) if a.0 != b.0 => return Some(Value::Error("#VALUE!")),
            _ => {}
        }
        let (height, width) = lookup::dimensions(&source);
        if height == 0 || width == 0 {
            return Some(Value::Error("#CALC!"));
        }
        if slice {
            let mut ranges = [0..height, 0..width];
            for (axis, arg) in args[1..].iter().enumerate() {
                let value = self.eval(arg, pos, depth + 1, true)?;
                let value = self.scalar(value, pos, depth + 1)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let Some(n) = value.numeric().filter(|n| n.is_finite()).map(f64::trunc) else {
                    return Some(Value::Error("#VALUE!"));
                };
                let size = if axis == 0 { height } else { width };
                let count = (n.abs() as usize).min(size);
                ranges[axis] = match (name, n >= 0.) {
                    ("TAKE", true) => 0..count,
                    ("TAKE", false) => size - count..size,
                    (_, true) => count..size,
                    (_, false) => 0..size - count,
                };
            }
            let [rr, cc] = ranges;
            if rr.is_empty() || cc.is_empty() {
                return Some(Value::Error("#CALC!"));
            }
            if let Value::Range(a, b) = source {
                let r = a.1.min(b.1);
                let c = a.2.min(b.2);
                return Some(Value::Matrix(self.matrix(
                    Value::Range(
                        (a.0, r + rr.start, c + cc.start),
                        (a.0, r + rr.end - 1, c + cc.end - 1),
                    ),
                    depth + 1,
                )?));
            }
            self.work = self.work.checked_sub(
                rr.len()
                    .checked_mul(cc.len())?
                    .checked_mul(std::mem::size_of::<Value>())?,
            )?;
            let data = self.matrix(source, depth + 1)?;
            let output = data
                .into_iter()
                .skip(rr.start)
                .take(rr.len())
                .map(|row| row.into_iter().skip(cc.start).take(cc.len()).collect())
                .collect();
            return Some(Value::Matrix(output));
        }
        if flatten {
            let (mut ignore, mut by_column) = (0u8, false);
            for (i, arg) in args.iter().enumerate().skip(1) {
                let value = self.eval(arg, pos, depth + 1, true)?;
                let value = self.scalar(value, pos, depth + 1)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                if i == 1 {
                    let Some(n) = value
                        .numeric()
                        .filter(|n| n.is_finite())
                        .map(f64::trunc)
                        .filter(|n| (0. ..=3.).contains(n))
                    else {
                        return Some(Value::Error("#VALUE!"));
                    };
                    ignore = n as u8;
                } else {
                    let Some(b) = lookup::boolean(&value) else {
                        return Some(Value::Error("#VALUE!"));
                    };
                    by_column = b;
                }
            }
            let mut flat = Vec::new();
            if ignore & 1 != 0
                && let Value::Range(a, b) = source
            {
                self.read_spill_range(a, b)?;
                let start = (a.0, a.1.min(b.1), a.2.min(b.2));
                let end = (a.0, a.1.max(b.1), a.2.max(b.2));
                let mut positions = std::collections::BTreeSet::new();
                for &coord in self
                    .values
                    .range(start..=end)
                    .map(|(p, _)| p)
                    .chain(self.expressions.range(start..=end).map(|(p, _)| p))
                {
                    self.work = self.work.checked_sub(64)?;
                    if (start.2..=end.2).contains(&coord.2) {
                        positions.insert(coord);
                    }
                }
                let mut positions: Vec<_> = positions.into_iter().collect();
                if by_column {
                    self.work = self.work.checked_sub(
                        positions
                            .len()
                            .checked_mul(positions.len().max(1).ilog2() as usize + 1)?,
                    )?;
                    positions.sort_unstable_by_key(|p| (p.2, p.1));
                }
                for coord in positions {
                    if !self.expressions.contains_key(&coord)
                        && matches!(self.values.get(&coord), Some(Value::Empty | Value::Blank))
                    {
                        continue;
                    }
                    self.work = self.work.checked_sub(std::mem::size_of::<Value>())?;
                    flat.push(self.cell(coord, depth + 1)?);
                }
            } else {
                let mut data = self.matrix(source, depth + 1)?;
                if by_column {
                    data = self.transpose(data, depth + 1)?;
                }
                self.work = self.work.checked_sub(
                    height
                        .checked_mul(width)?
                        .checked_mul(std::mem::size_of::<Value>())?,
                )?;
                flat.extend(data.into_iter().flatten());
            }
            flat.retain(|value| {
                !(ignore & 1 != 0 && matches!(value, Value::Blank | Value::Empty)
                    || ignore & 2 != 0 && matches!(value, Value::Error(_) | Value::LiteralError(_)))
            });
            if flat.is_empty() {
                return Some(Value::Error("#CALC!"));
            }
            return Some(Value::Matrix(if name == "TOROW" {
                vec![flat]
            } else {
                self.work = self
                    .work
                    .checked_sub(flat.len().checked_mul(std::mem::size_of::<Vec<Value>>())?)?;
                flat.into_iter().map(|value| vec![value]).collect()
            }));
        }
        // CHOOSECOLS/CHOOSEROWS accept repeated and negative indexes. Borrow only
        // selected cells from reference arguments instead of reading the whole range.
        let columns = name == "CHOOSECOLS";
        let size = if columns { width } else { height };
        let mut indices = Vec::new();
        for arg in &args[1..] {
            let value = self.eval(arg, pos, depth + 1, true)?;
            for value in self.matrix(value, depth + 1)?.into_iter().flatten() {
                self.tick(depth)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let Some(n) = value.numeric().filter(|n| n.is_finite()).map(f64::trunc) else {
                    return Some(Value::Error("#VALUE!"));
                };
                if n == 0. || n.abs() > size as f64 {
                    return Some(Value::Error("#VALUE!"));
                }
                self.work = self.work.checked_sub(std::mem::size_of::<usize>())?;
                indices.push(if n > 0. {
                    n as usize - 1
                } else {
                    size - (-n) as usize
                });
            }
        }
        let rows = if columns { height } else { indices.len() };
        let cols = if columns { indices.len() } else { width };
        self.work = self.work.checked_sub(
            rows.checked_mul(cols)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let (reference, data) = if let Value::Range(a, b) = source {
            (Some((a.0, a.1.min(b.1), a.2.min(b.2))), Vec::new())
        } else {
            (None, self.matrix(source, depth + 1)?)
        };
        let mut output = Vec::with_capacity(rows);
        for r in 0..rows {
            let mut row = Vec::with_capacity(cols);
            for c in 0..cols {
                let (r, c) = if columns {
                    (r, indices[c])
                } else {
                    (indices[r], c)
                };
                let value = if let Some((sheet, top, left)) = reference {
                    self.cell((sheet, top + r, left + c), depth + 1)?
                } else {
                    self.tick(depth)?;
                    self.charge_value(&data[r][c])?;
                    data[r][c].clone()
                };
                row.push(value);
            }
            output.push(row);
        }
        Some(Value::Matrix(output))
    }
}
