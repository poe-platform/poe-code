// Edge modes adapted from IronCalc lookup_and_reference/trimrange.rs at
// f93662006b8fb1c401dc870bbda26c5d60ac6037 (MIT, LICENSE.IronCalc).
// Retain references and find sparse extents before materializing any cells.
use super::{Calculation, Coord, Expr, Value, lookup};

impl Calculation<'_> {
    pub(super) fn trim_range(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.is_empty() || args.len() > 3 {
            return Some(Value::Error("#ERROR!"));
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
        let mut modes = [3u8; 2];
        for (axis, arg) in args[1..].iter().enumerate() {
            if matches!(arg, Expr::Value(Value::Blank)) {
                continue;
            }
            let value = self.eval(arg, pos, depth + 1, true)?;
            let value = self.scalar(value, pos, depth + 1)?;
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Some(Value::Error(e));
            }
            let Some(n) = value
                .numeric()
                .filter(|n| n.is_finite())
                .map(f64::trunc)
                .filter(|n| (0. ..=3.).contains(n))
            else {
                return Some(Value::Error("#VALUE!"));
            };
            modes[axis] = n as u8;
        }
        if modes == [0, 0] {
            return Some(source);
        }
        let (height, width) = lookup::dimensions(&source);
        let (mut first_row, mut first_col, mut last_row, mut last_col) =
            (height, width, 0usize, 0usize);
        if let Value::Range(a, b) = &source {
            self.read_spill_range(*a, *b)?;
            let start = (a.0, a.1.min(b.1), a.2.min(b.2));
            let end = (a.0, a.1.max(b.1), a.2.max(b.2));
            // Formatting-only cells are blank; formula cells and empty strings
            // are occupied. No per-cell allocation or whole-column scan.
            for (&coord, value) in self.values.range(start..=end) {
                self.work = self.work.checked_sub(1)?;
                if coord.2 < start.2
                    || coord.2 > end.2
                    || matches!(value, Value::Blank | Value::Empty)
                {
                    continue;
                }
                let (r, c) = (coord.1 - start.1, coord.2 - start.2);
                first_row = first_row.min(r);
                last_row = last_row.max(r + 1);
                first_col = first_col.min(c);
                last_col = last_col.max(c + 1);
            }
            for &coord in self
                .formula_sources
                .range(start..=end)
                .map(|(coord, _)| coord)
                .chain(self.expressions.range(start..=end).map(|(p, _)| p))
            {
                self.work = self.work.checked_sub(1)?;
                if coord.2 < start.2 || coord.2 > end.2 {
                    continue;
                }
                let (r, c) = (coord.1 - start.1, coord.2 - start.2);
                first_row = first_row.min(r);
                last_row = last_row.max(r + 1);
                first_col = first_col.min(c);
                last_col = last_col.max(c + 1);
            }
        } else {
            for r in 0..height {
                for c in 0..width {
                    self.tick(depth)?;
                    let value = match &source {
                        Value::Matrix(rows) => &rows[r][c],
                        value => value,
                    };
                    if !matches!(value, Value::Blank | Value::Empty) {
                        first_row = first_row.min(r);
                        last_row = last_row.max(r + 1);
                        first_col = first_col.min(c);
                        last_col = last_col.max(c + 1);
                    }
                }
            }
        }
        if modes[0] & 1 == 0 {
            first_row = 0;
        }
        if modes[0] & 2 == 0 {
            last_row = height;
        }
        if modes[1] & 1 == 0 {
            first_col = 0;
        }
        if modes[1] & 2 == 0 {
            last_col = width;
        }
        if first_row >= last_row || first_col >= last_col {
            return Some(Value::Error("#REF!"));
        }
        if let Value::Range(a, b) = source {
            let (r, c) = (a.1.min(b.1), a.2.min(b.2));
            return Some(Value::Range(
                (a.0, r + first_row, c + first_col),
                (a.0, r + last_row - 1, c + last_col - 1),
            ));
        }
        let rows = last_row - first_row;
        let cols = last_col - first_col;
        self.work = self.work.checked_sub(
            rows.checked_mul(cols)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let data = self.matrix(source, depth + 1)?;
        Some(Value::Matrix(
            data.into_iter()
                .skip(first_row)
                .take(rows)
                .map(|row| row.into_iter().skip(first_col).take(cols).collect())
                .collect(),
        ))
    }
}
