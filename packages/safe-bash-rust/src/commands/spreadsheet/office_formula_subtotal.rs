use super::{Calculation, Coord, Expr, Value, descriptive, summation::Sum};

fn nested(expression: &Expr, work: &mut usize) -> Option<bool> {
    let mut pending = vec![expression];
    while let Some(expression) = pending.pop() {
        *work = work.checked_sub(1)?;
        match expression {
            Expr::Call(name, _) if matches!(name.as_str(), "SUBTOTAL" | "AGGREGATE") => {
                return Some(true);
            }
            Expr::Call(_, args) => pending.extend(args),
            Expr::Group(child) | Expr::Unary(_, child) => pending.push(child),
            Expr::Binary(_, left, right) => {
                pending.push(left);
                pending.push(right);
            }
            Expr::MatrixCell(child, _) => pending.push(child),
            _ => {}
        }
    }
    Some(false)
}
impl Calculation<'_> {
    pub(super) fn subtotal(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(2..=255).contains(&args.len()) {
            return Some(Value::Error("#VALUE!"));
        }
        let operation = self.eval(&args[0], pos, depth + 1, true)?;
        let operation = self.scalar(operation, pos, depth + 1)?;
        if let Value::Error(e) | Value::LiteralError(e) = operation {
            return Some(Value::Error(e));
        }
        let Some(operation) = operation.numeric().map(f64::trunc) else {
            return Some(Value::Error("#VALUE!"));
        };
        if !(1. ..=11.).contains(&operation) && !(101. ..=111.).contains(&operation) {
            return Some(Value::Error("#VALUE!"));
        }
        let hidden = operation > 100.;
        let operation = operation as u8 % 100;
        let mut count = 0usize;
        let mut nonempty = 0usize;
        let mut sum = Sum::default();
        let mut numbers = Vec::new();
        let mut product = 1.;
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        for arg in &args[1..] {
            let mut pending = vec![self.eval(arg, pos, depth + 1, true)?];
            while let Some(value) = pending.pop() {
                self.tick(depth)?;
                let mut cells = Vec::new();
                match value {
                    Value::Single(coord) => cells.push(coord),
                    Value::Range(a, b) => {
                        self.read_spill_range(a, b)?;
                        self.work = self.work.checked_sub(self.values.len().checked_mul(32)?)?;
                        cells.extend(self.values.keys().copied().filter(|c| {
                            (a.0.min(b.0)..=a.0.max(b.0)).contains(&c.0)
                                && (a.1.min(b.1)..=a.1.max(b.1)).contains(&c.1)
                                && (a.2.min(b.2)..=a.2.max(b.2)).contains(&c.2)
                        }));
                    }
                    Value::Set(values) => {
                        pending.extend(values);
                        continue;
                    }
                    Value::InvalidReference | Value::InvalidRange(..) => {
                        return Some(Value::Error("#REF!"));
                    }
                    Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                    _ => return Some(Value::Error("#VALUE!")),
                }
                for coord in cells {
                    self.tick(depth)?;
                    if self.filtered_rows.contains(&(coord.0, coord.1))
                        || hidden && self.hidden_rows.contains(&(coord.0, coord.1))
                    {
                        continue;
                    }
                    if let Some(expression) = self.expressions.get(&coord)
                        && nested(expression, &mut self.work)?
                    {
                        continue;
                    }
                    let value = self.cell(coord, depth + 1)?;
                    if !matches!(value, Value::Blank | Value::Empty) {
                        nonempty += 1;
                    }
                    match value {
                        Value::Error(e) | Value::LiteralError(e) if !matches!(operation, 2 | 3) => {
                            return Some(Value::Error(e));
                        }
                        Value::Number(n) => {
                            count += 1;
                            sum.add(n);
                            product *= n;
                            minimum = minimum.min(n);
                            maximum = maximum.max(n);
                            if matches!(operation, 7 | 8 | 10 | 11) {
                                self.work = self.work.checked_sub(16)?;
                                numbers.push(n);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        Some(match operation {
            1 if count == 0 => Value::Error("#DIV/0!"),
            1 => Value::number(sum.total() / count as f64),
            2 => Value::Number(count as f64),
            3 => Value::Number(nonempty as f64),
            4 => Value::number(if count == 0 { 0. } else { maximum }),
            5 => Value::number(if count == 0 { 0. } else { minimum }),
            6 => Value::number(if count == 0 { 0. } else { product }),
            9 => Value::number(sum.total()),
            _ => {
                self.result_format = None;
                descriptive::calculate(
                    match operation {
                        7 => "STDEV.S",
                        8 => "STDEV.P",
                        10 => "VAR.S",
                        _ => "VAR.P",
                    },
                    &mut numbers,
                    &mut self.work,
                )?
            }
        })
    }
}
