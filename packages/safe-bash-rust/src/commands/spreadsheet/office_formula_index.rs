use super::{Calculation, Coord, Expr, Value};

impl Calculation<'_> {
    pub(super) fn index(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.is_empty() || args.len() > 4 {
            return Some(Value::Error(if args.is_empty() {
                "Err:511"
            } else {
                "Err:504"
            }));
        }
        let mut source = &args[0];
        while let Expr::Group(child) = source {
            self.tick(depth)?;
            source = child;
        }
        let mut value = self.eval(
            source,
            pos,
            depth + 1,
            matches!(
                source,
                Expr::Binary("~" | "~;" | "!" | ";", ..) | Expr::Ref(_) | Expr::Name(_)
            ),
        )?;
        if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
            return Some(Value::Error("#REF!"));
        }
        if let Value::Error(error) | Value::LiteralError(error) = value {
            return Some(Value::Error(error));
        }
        let mut offsets = [-1., -1., 0.];
        for (arg, offset) in args[1..].iter().zip(&mut offsets) {
            let value = self.eval(arg, pos, depth + 1, false)?;
            let value = self.scalar(value, pos, depth + 1)?;
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            let Some(number) = value.numeric() else {
                return Some(Value::Error("#VALUE!"));
            };
            if self.dynamic.is_some() && (!number.is_finite() || number < 0.) {
                return Some(Value::Error("#VALUE!"));
            }
            *offset = number.trunc() - 1.;
        }
        // Calc validates truncated arguments by position before checking source bounds.
        if self.dynamic.is_some() && offsets[2] < 0. {
            return Some(Value::Error("#VALUE!"));
        }
        if self.dynamic.is_none()
            && (!(-1. ..i32::MAX as f64).contains(&offsets[0])
                || !(-1. ..i16::MAX as f64).contains(&offsets[1])
                || !(0. ..u32::MAX as f64).contains(&offsets[2]))
        {
            return Some(Value::Error("Err:502"));
        }
        if matches!(value, Value::Set(_)) {
            let mut pending = vec![value];
            let mut values = Vec::new();
            while let Some(value) = pending.pop() {
                self.tick(depth)?;
                if let Value::Set(mut set) = value {
                    set.reverse();
                    pending.extend(set);
                } else if let Value::Error(error) | Value::LiteralError(error) = value {
                    return Some(Value::Error(error));
                } else {
                    values.push(value);
                }
            }
            if offsets[2] >= values.len() as f64 {
                return Some(Value::Error("#REF!"));
            }
            value = values.into_iter().nth(offsets[2] as usize)?;
            if matches!(value, Value::Range(a, b) if a.0 != b.0) {
                return Some(Value::Error("#REF!"));
            }
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
        } else if let Value::Range(a, b) = &value {
            if a.0 != b.0 || offsets[2] != 0. {
                return Some(Value::Error("#REF!"));
            }
        } else if offsets[2] != 0. {
            return Some(Value::Error("#REF!"));
        }
        value = value.into_range();
        let (height, width) = match &value {
            Value::Range(a, b) => (a.1.abs_diff(b.1) + 1, a.2.abs_diff(b.2) + 1),
            Value::Matrix(rows) => (rows.len(), rows.first().map_or(0, Vec::len)),
            _ => (1, 1),
        };
        let [mut row, mut column, _] = offsets;
        if args.len() == 2 && height == 1 {
            column = row;
            row = 0.;
        }
        if row < -1. || column < -1. || row >= height as f64 || column >= width as f64 {
            return Some(Value::Error("#REF!"));
        }
        let first_row = row.max(0.) as usize;
        let first_column = column.max(0.) as usize;
        let last_row = if row == -1. { height - 1 } else { first_row };
        let last_column = if column == -1. {
            width - 1
        } else {
            first_column
        };
        Some(match value {
            Value::Range(a, b) => {
                let first = (a.0, a.1.min(b.1) + first_row, a.2.min(b.2) + first_column);
                let last = (b.0, a.1.min(b.1) + last_row, a.2.min(b.2) + last_column);
                if first == last {
                    Value::Single(first)
                } else {
                    Value::Range(first, last)
                }
            }
            Value::Matrix(rows) => {
                let rows: Vec<Vec<Value>> = rows
                    .into_iter()
                    .skip(first_row)
                    .take(last_row - first_row + 1)
                    .map(|row| {
                        row.into_iter()
                            .skip(first_column)
                            .take(last_column - first_column + 1)
                            .map(|v| {
                                if matches!(v, Value::Blank | Value::Empty) {
                                    if args.len() == 1
                                        || offsets[0] == -1.
                                            && (args.len() == 2 || offsets[1] == -1.)
                                    {
                                        Value::Empty
                                    } else {
                                        Value::Text(String::new())
                                    }
                                } else {
                                    v
                                }
                            })
                            .collect()
                    })
                    .collect();
                if offsets[0] == -1. && offsets[1] == -1.
                    || (row == -1. || column == -1.)
                        && !(width == 1 && row >= 0. || height == 1 && column >= 0.)
                {
                    Value::Matrix(rows)
                } else {
                    match rows.into_iter().next()?.into_iter().next()? {
                        Value::UninternedText(text) => Value::Text(text),
                        value => value,
                    }
                }
            }
            _ => Value::Error("#REF!"),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Workbook, parse};
    use super::*;

    #[test]
    fn index_rejects_a_sheet_span_inside_an_area_union() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".into(), "Sheet2".into(), "Sheet3".into()];
        let expression = parse(
            "=INDEX(('Sheet1':'Sheet3'!A1:C3,Sheet2!A1:C3),2,2,1)",
            &sheets,
            &book,
            (0, 0, 0),
            None,
            false,
            None,
            100_000,
            false,
        )
        .unwrap()
        .unwrap();
        let mut calculation = Calculation::new(&book, &sheets, vec![(65536, 256); 3], 100_000);
        let value = calculation.eval(&expression, (0, 0, 0), 0, true).unwrap();
        assert!(matches!(value, Value::Error("#REF!")));
    }
}
