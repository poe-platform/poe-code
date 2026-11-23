use super::{Calculation, Coord, Expr, Value};
use crate::commands::structured::xlsx::Dialect;

impl Calculation<'_> {
    pub(super) fn index(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        let gnumeric = self.dialect == Dialect::Gnumeric;
        if args.is_empty() || args.len() > 4 {
            return Some(Value::Error(if gnumeric {
                "#VALUE!"
            } else if args.is_empty() {
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
        let area_set = matches!(source, Expr::Binary("~" | "~;" | ",", ..));
        let mut value = self.eval(
            source,
            pos,
            depth + 1,
            if gnumeric {
                area_set
            } else {
                matches!(
                    source,
                    Expr::Binary("~" | "~;" | "!" | ";", ..)
                        | Expr::Ref(_)
                        | Expr::Name(_)
                        | Expr::LiveName(..)
                )
            },
        )?;
        if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
            return Some(Value::Error("#REF!"));
        }
        if let Value::Error(error) | Value::LiteralError(error) = value {
            return Some(Value::Error(error));
        }
        let mut offsets = if gnumeric {
            [0., 0., 0.]
        } else {
            [-1., -1., 0.]
        };
        for (arg, offset) in args[1..].iter().zip(&mut offsets) {
            let value = self.eval(arg, pos, depth + 1, false)?;
            let value = self.scalar(value, pos, depth + 1)?;
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            let Some(number) = value.numeric() else {
                return Some(Value::Error("#VALUE!"));
            };
            *offset = number.trunc() - 1.;
        }
        // Calc validates truncated arguments by position before checking source bounds.
        if !gnumeric
            && (!(-1. ..i32::MAX as f64).contains(&offsets[0])
                || !(-1. ..i16::MAX as f64).contains(&offsets[1])
                || !(0. ..u32::MAX as f64).contains(&offsets[2]))
        {
            return Some(Value::Error("Err:502"));
        }
        if gnumeric && area_set || !gnumeric && matches!(value, Value::Set(_)) {
            let mut pending = vec![value];
            let mut values = Vec::new();
            while let Some(value) = pending.pop() {
                self.tick(depth)?;
                if let Value::Set(mut set) = value {
                    set.reverse();
                    pending.extend(set);
                } else if !gnumeric && let Value::Error(error) | Value::LiteralError(error) = value
                {
                    return Some(Value::Error(error));
                } else {
                    values.push(value);
                }
            }
            if offsets[2] < 0. || offsets[2] >= values.len() as f64 {
                return Some(Value::Error("#REF!"));
            }
            value = values.into_iter().nth(offsets[2] as usize)?;
            if !gnumeric
                && matches!(value, Value::Range(a, b) | Value::LabelRange(a, b, _) if a.0 != b.0)
            {
                return Some(Value::Error("#REF!"));
            }
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
        } else if let Value::Range(a, b) | Value::LabelRange(a, b, _) = &mut value {
            if gnumeric && a.0 != b.0 {
                if offsets[2] < 0. || offsets[2] >= (a.0.abs_diff(b.0) + 1) as f64 {
                    return Some(Value::Error("#REF!"));
                }
                let sheet = a.0.min(b.0) + offsets[2] as usize;
                a.0 = sheet;
                b.0 = sheet;
            } else if a.0 != b.0 || offsets[2] != 0. {
                return Some(Value::Error("#REF!"));
            }
        } else if offsets[2] != 0. {
            return Some(Value::Error("#REF!"));
        }
        value = value.into_range();
        let (height, width) = match &value {
            Value::Range(a, b) | Value::LabelRange(a, b, _) => {
                (a.1.abs_diff(b.1) + 1, a.2.abs_diff(b.2) + 1)
            }
            Value::Matrix(rows) => (rows.len(), rows.first().map_or(0, Vec::len)),
            _ => (1, 1),
        };
        let [mut row, mut column, _] = offsets;
        if !gnumeric && args.len() == 2 && height == 1 {
            column = row;
            row = 0.;
        }
        let minimum = if gnumeric { 0. } else { -1. };
        if row < minimum || column < minimum || row >= height as f64 || column >= width as f64 {
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
            Value::Range(a, b) | Value::LabelRange(a, b, _) => {
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
                                if matches!(
                                    v,
                                    Value::Blank
                                        | Value::Empty
                                        | Value::FunctionEmpty
                                        | Value::MatrixEmpty
                                ) {
                                    if gnumeric {
                                        Value::Number(0.)
                                    } else if args.len() == 1
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
            Dialect::LibreOffice,
            "=INDEX(('Sheet1':'Sheet3'!A1:C3,Sheet2!A1:C3),2,2,1)",
            &sheets,
            &book,
            (0, 0, 0),
            None,
            false,
            None,
            100_000,
        )
        .unwrap()
        .unwrap();
        let mut calculation = Calculation::new(&book, &sheets, vec![(65536, 256); 3], 100_000);
        let value = calculation.eval(&expression, (0, 0, 0), 0, true).unwrap();
        assert!(matches!(value, Value::Error("#REF!")));
    }
}
