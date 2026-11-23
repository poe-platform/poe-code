use super::super::case_fold::fold;
use super::super::collation;
use super::{Calculation, Coord, Expr, Value};
use crate::commands::{
    search::ZeroRegex,
    structured::xlsx::{Dialect, LookupSearch},
};
use std::cmp::Ordering;
#[path = "office_formula_number.rs"]
pub(super) mod number;

pub(super) fn dimensions(value: &Value) -> (usize, usize) {
    match value {
        Value::Range(a, b) | Value::LabelRange(a, b, _) => {
            (a.1.abs_diff(b.1) + 1, a.2.abs_diff(b.2) + 1)
        }
        Value::Matrix(rows) => (rows.len(), rows.first().map_or(0, Vec::len)),
        _ => (1, 1),
    }
}
fn valid_seek(value: &Value) -> bool {
    matches!(
        value,
        Value::Number(_) | Value::Text(_) | Value::UninternedText(_) | Value::Bool(_)
    )
}
pub(super) fn boolean(value: &Value) -> Option<bool> {
    match value {
        Value::Text(s) | Value::UninternedText(s) => match s.to_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        },
        _ => value.numeric().map(|n| n != 0.),
    }
}
fn coerce(value: Value, kind: u8, iteration: bool, date1904: bool, dialect: Dialect) -> Value {
    if kind != b'E'
        && let Value::LiteralError(error) = value
    {
        return Value::Error(error);
    }
    if iteration && kind == b's' {
        return match value {
            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty => {
                Value::Text(String::new())
            }
            Value::Text(_) | Value::UninternedText(_) | Value::Error(_) => value,
            _ => Value::Error("#VALUE!"),
        };
    }
    if dialect == Dialect::Gnumeric
        && !iteration
        && kind == b'b'
        && matches!(value, Value::Text(_) | Value::UninternedText(_))
    {
        return boolean(&value).map_or(Value::Error("#VALUE!"), Value::Bool);
    }
    if matches!(kind, b'b' | b'f') {
        return match value {
            Value::Text(ref s) | Value::UninternedText(ref s) => (if dialect == Dialect::Gnumeric {
                number::parse_production(s, date1904)
            } else {
                number::parse(s, date1904)
            })
            .map_or(Value::Error("#VALUE!"), Value::number),
            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty => {
                Value::Number(0.)
            }
            _ => value,
        };
    }
    value
}
impl Calculation<'_> {
    pub(super) fn lookup(
        &mut self,
        name: &str,
        nodes: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let gnumeric = self.dialect == Dialect::Gnumeric;
        let (minimum, types): (usize, &[u8]) = match name {
            "ADDRESS" => (2, b"fffbs"),
            "ROW" | "COLUMN" => (0, b"A"),
            "TRANSPOSE" => (1, b"A"),
            "COLUMNNUMBER" => (1, b"s"),
            "HYPERLINK" => (1, b"SS"),
            "IFERROR" | "IFNA" => (2, b"EE"),
            "TEXT" => (2, b"Ss"),
            "VALUE" => (1, b"S"),
            "INDIRECT" => (1, b"sb"),
            "OFFSET" => (3, b"rffff"),
            "SHEET" => (0, b"?"),
            "SORT" => (1, b"rf"),
            "FLIP" => (1, b"Ab"),
            "UNIQUE" => (1, b"Abb"),
            "VLOOKUP" | "HLOOKUP" => (3, b"EAfbb"),
            "LOOKUP" => (2, if gnumeric { b"EAr" } else { b"EAA" }),
            "MATCH" => (2, b"EAf"),
            "XMATCH" => (2, b"EAff"),
            "XLOOKUP" => (3, b"EAA?ff"),
            _ => return None,
        };
        if nodes.len() < minimum || nodes.len() > types.len() {
            if !gnumeric && !matches!(name, "SORT" | "FLIP" | "COLUMNNUMBER" | "ROW" | "COLUMN") {
                return Some(Value::Error(if nodes.len() < minimum {
                    "Err:511"
                } else {
                    "Err:504"
                }));
            }
            return Some(Value::Error("#N/A"));
        }
        let mut args = Vec::new();
        let mut iteration = Vec::new();
        let mut shape = None;
        for (i, node) in nodes.iter().enumerate() {
            self.tick(depth)?;
            let kind = types[i];
            let area = matches!(kind, b'A' | b'r');
            let array = self.array;
            self.array |= area;
            let single_lookup =
                !gnumeric && name == "LOOKUP" && i == 1 && matches!(node, Expr::Ref(_));
            let value = self.eval(
                node,
                pos,
                depth + 1,
                (area || kind == b'E' || name == "XLOOKUP" && i == 3) && !single_lookup,
            )?;
            let value = if let Value::InvalidRange(a, b) = value {
                // ROW/COLUMN build a numeric matrix when that axis spans cells,
                // clearing the error from an invalid axis on the other dimension.
                if name == "ROW" && a.1 != b.1 {
                    Value::Range((a.0, a.1, 0), (b.0, b.1, 0))
                } else if name == "COLUMN" {
                    let column = |value| if value == usize::MAX { 0 } else { value };
                    if column(a.2) != column(b.2) {
                        Value::Range((a.0, 0, column(a.2)), (b.0, 0, column(b.2)))
                    } else {
                        Value::Error("#REF!")
                    }
                } else {
                    Value::Error("#REF!")
                }
            } else if matches!(value, Value::InvalidReference) {
                Value::Error("#REF!")
            } else {
                value
            };
            let value = if name == "OFFSET" && i == 0 || matches!(name, "IFERROR" | "IFNA") {
                value
            } else {
                value.into_range()
            };
            self.array = array;
            if area {
                if !gnumeric
                    && matches!(name, "LOOKUP" | "VLOOKUP" | "HLOOKUP")
                    && i == 1
                    && matches!(value, Value::LiteralError(_))
                {
                    args.push(Some(value));
                    continue;
                }
                if let Value::LiteralError(error) = value {
                    return Some(Value::Error(if !gnumeric && types[0] == b'E' {
                        "Err:504"
                    } else {
                        error
                    }));
                }
                if let Value::Error(error) = value {
                    return Some(Value::Error(if !gnumeric && name == "XLOOKUP" {
                        "Err:504"
                    } else {
                        error
                    }));
                }
                if kind == b'r'
                    && !matches!(
                        value,
                        Value::Single(_)
                            | Value::Range(..)
                            | Value::LabelRange(..)
                            | Value::Matrix(..)
                    )
                {
                    return Some(Value::Error(if !gnumeric && name == "OFFSET" {
                        "Err:504"
                    } else {
                        "#VALUE!"
                    }));
                }
                args.push(Some(value));
            } else if kind == b'?' {
                let value = if !gnumeric && name == "XLOOKUP" && matches!(value, Value::Blank) {
                    Value::Number(0.)
                } else {
                    value
                };
                args.push(
                    (if name == "XLOOKUP" {
                        gnumeric || !matches!(node, Expr::Value(Value::Blank))
                    } else {
                        gnumeric
                            || !matches!(
                                value,
                                Value::Blank
                                    | Value::Empty
                                    | Value::FunctionEmpty
                                    | Value::MatrixEmpty
                            )
                    })
                    .then_some(value),
                );
            } else if array
                && matches!(
                    value,
                    Value::Range(..) | Value::LabelRange(..) | Value::Matrix(..)
                )
                && !(kind == b'E'
                    && !matches!(name, "IFERROR" | "IFNA")
                    && matches!(value, Value::Range(a, b) | Value::LabelRange(a, b, _) if a == b))
            {
                let (mut rows, columns) = dimensions(&value);
                if let Value::Range(a, b) | Value::LabelRange(a, b, _) = &value {
                    rows = rows.checked_mul(a.0.abs_diff(b.0) + 1)?;
                }
                if (gnumeric || name == "TEXT") && shape.is_some_and(|size| size != (rows, columns))
                {
                    return Some(Value::Error("#VALUE!"));
                }
                shape = Some(shape.map_or((rows, columns), |(h, w): (usize, usize)| {
                    (h.max(rows), w.max(columns))
                }));
                iteration.push((i, self.matrix(value, depth + 1)?));
                args.push(None);
            } else {
                let reference = matches!(value, Value::Range(..) | Value::LabelRange(..));
                let mut value = self.scalar(value, pos, depth + 1)?;
                if kind == b'E'
                    && name == "XLOOKUP"
                    && !reference
                    && let Value::Error(error) = value
                {
                    value = Value::LiteralError(error);
                }
                if i >= minimum
                    && if gnumeric {
                        matches!(
                            value,
                            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                        )
                    } else {
                        name != "MATCH" && matches!(node, Expr::Value(Value::Blank))
                    }
                {
                    args.push(None);
                } else {
                    let mut value = if !gnumeric && name == "HYPERLINK" {
                        value
                    } else {
                        coerce(value, kind, false, self.book.date1904, self.dialect)
                    };
                    if !gnumeric && name == "XLOOKUP" && i == 4 && matches!(value, Value::Error(_))
                    {
                        value = Value::Number(0.);
                    }
                    if (kind != b'E' || !gnumeric && name == "LOOKUP" && i == 0)
                        && matches!(value, Value::Error(_))
                    {
                        return Some(value);
                    }
                    args.push(Some(value));
                }
            }
        }
        let Some((mut height, mut width)) = shape else {
            return self.lookup_values(name, &args, pos, depth + 1);
        };
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let (argument_height, argument_width) = (height, width);
        let mut rows = vec![vec![Value::Error("#N/A"); width]; height];
        let mut c = 0;
        while c < width {
            let mut r = 0;
            while r < height {
                self.tick(depth)?;
                let mut failure = None;
                for (i, matrix) in &iteration {
                    let value = matrix
                        .get(if matrix.len() == 1 { 0 } else { r })
                        .and_then(|row| row.get(if row.len() == 1 { 0 } else { c }));
                    let value = value.unwrap_or(if name == "HYPERLINK" {
                        &Value::LiteralError("#VALUE!")
                    } else {
                        &Value::Error("#VALUE!")
                    });
                    self.charge_value(value)?;
                    let mut value = if !gnumeric && name == "HYPERLINK" {
                        value.clone()
                    } else {
                        coerce(
                            value.clone(),
                            types[*i],
                            true,
                            self.book.date1904,
                            self.dialect,
                        )
                    };
                    if !gnumeric && name == "XLOOKUP" && *i == 4 && matches!(value, Value::Error(_))
                    {
                        value = Value::Number(0.);
                    }
                    if types[*i] != b'E'
                        && matches!(value, Value::Error(_))
                        && (gnumeric || name != "HYPERLINK")
                    {
                        failure = Some(value);
                        break;
                    }
                    args[*i] = Some(value);
                }
                let value = match failure {
                    Some(value) => value,
                    None => self.lookup_values(name, &args, pos, depth + 1)?,
                };
                if gnumeric {
                    rows[r][c] = self.scalar(value, pos, depth + 1)?;
                    r += 1;
                    continue;
                }
                let (h, w) = dimensions(&value);
                let next_height = if argument_height == 1 {
                    height.max(h)
                } else {
                    height
                };
                let next_width = if argument_width == 1 {
                    width.max(w)
                } else {
                    width
                };
                if (next_height, next_width) != (height, width) {
                    self.work = self.work.checked_sub(
                        next_height
                            .checked_mul(next_width)?
                            .checked_sub(height.checked_mul(width)?)?
                            .checked_mul(std::mem::size_of::<Value>())?,
                    )?;
                    for row in &mut rows {
                        row.resize(next_width, Value::Error("#N/A"));
                    }
                    rows.resize_with(next_height, || vec![Value::Error("#N/A"); next_width]);
                    (height, width) = (next_height, next_width);
                }
                rows[r][c] = if (h != 1 && r >= h) || (w != 1 && c >= w) {
                    Value::Error("#N/A")
                } else {
                    self.lookup_entry(
                        &value,
                        if h == 1 { 0 } else { r },
                        if w == 1 { 0 } else { c },
                        pos,
                        depth + 1,
                    )?
                };
                r += 1;
            }
            c += 1;
        }
        Some(Value::Matrix(rows))
    }
    fn lookup_values(
        &mut self,
        name: &str,
        args: &[Option<Value>],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if matches!(name, "IFERROR" | "IFNA") {
            let first = args[0].as_ref()?;
            let value = if matches!(first, Value::Error(error) | Value::LiteralError(error)
                if name == "IFERROR" || *error == "#N/A")
            {
                args[1].as_ref()?
            } else {
                first
            };
            self.charge_value(value)?;
            return Some(match value {
                Value::LiteralError(error) => Value::Error(error),
                value => value.clone(),
            });
        }
        if name == "VALUE" {
            let value = args[0].as_ref()?;
            return Some(match value {
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty => {
                    Value::FunctionEmpty
                }
                Value::Number(_) | Value::Bool(_) => value.clone(),
                Value::Text(text) | Value::UninternedText(text) => {
                    if text.eq_ignore_ascii_case("true") || text.eq_ignore_ascii_case("false") {
                        Value::Bool(text.eq_ignore_ascii_case("true"))
                    } else {
                        number::parse_production(text, self.book.date1904)
                            .map_or(Value::Error("#VALUE!"), Value::number)
                    }
                }
                _ => Value::Error("#VALUE!"),
            });
        }
        if name == "TEXT" {
            return match super::text::calculate(
                args[0].as_ref()?,
                args[1].as_ref()?,
                self.book.date1904,
                &mut self.work,
            ) {
                Ok(value) => Some(value),
                Err(failure) => {
                    self.failure = Some(failure);
                    None
                }
            };
        }
        if !matches!(
            name,
            "MATCH" | "LOOKUP" | "VLOOKUP" | "HLOOKUP" | "XMATCH" | "XLOOKUP"
        ) {
            return self.reference_function(name, args, pos, depth);
        }
        let get = |i: usize| args.get(i).and_then(Option::as_ref);
        let gnumeric = self.dialect == Dialect::Gnumeric;
        let number = |i, fallback| {
            get(i)
                .map_or(fallback, |v| v.numeric().unwrap_or(f64::NAN))
                .trunc()
        };
        let seek = get(0).unwrap_or(&Value::Blank);
        if !gnumeric && matches!(seek, Value::LiteralError(_)) {
            return Some(Value::Error("Err:504"));
        }
        if !gnumeric
            && name != "XLOOKUP"
            && let Value::Error(error) = seek
        {
            return Some(Value::Error(error));
        }
        let area = get(1).unwrap();
        let (height, width) = dimensions(area);
        if matches!(area, Value::LiteralError(_))
            || !gnumeric
                && matches!(area, Value::Range(a, b) | Value::LabelRange(a, b, _) if a.0 != b.0)
        {
            return Some(Value::Error("Err:504"));
        }
        if name == "MATCH" {
            let mode = number(2, 1.);
            if !gnumeric
                && (!matches!(
                    area,
                    Value::Range(..) | Value::LabelRange(..) | Value::Matrix(..)
                ) || width > 1 && height > 1
                    || !(-1. ..=1.).contains(&mode))
            {
                return Some(Value::Error("Err:504"));
            }
            if !valid_seek(seek) || gnumeric && width > 1 && height > 1 {
                return Some(Value::Error("#N/A"));
            }
            let index = self.lookup_find(area, seek, width <= 1, mode, 1., name, pos, depth + 1)?;
            return Some(match index {
                -2 => Value::Error("#VALUE!"),
                -1 => Value::Error("#N/A"),
                _ => Value::Number(index as f64 + 1.),
            });
        }
        if matches!(name, "VLOOKUP" | "HLOOKUP") {
            if !gnumeric
                && !matches!(
                    area,
                    Value::Range(..) | Value::LabelRange(..) | Value::Matrix(..)
                )
            {
                return Some(Value::Error("Err:504"));
            }
            if !valid_seek(seek) {
                return Some(Value::Error("#N/A"));
            }
            let vertical = name == "VLOOKUP";
            let offset = number(2, 0.);
            if offset <= 0. || offset > (if vertical { width } else { height }) as f64 {
                return Some(Value::Error(if !gnumeric {
                    "Err:502"
                } else if offset <= 0. {
                    "#VALUE!"
                } else {
                    "#REF!"
                }));
            }
            let approx = get(3).is_none_or(|v| boolean(v) == Some(true));
            let mode = if approx { 1. } else { 0. };
            let index = self.lookup_find(area, seek, vertical, mode, 1., name, pos, depth + 1)?;
            if index == -2 {
                return Some(Value::Error("#VALUE!"));
            }
            if get(4).is_some_and(|v| boolean(v) == Some(true)) {
                return Some(Value::Number(index as f64));
            }
            if index < 0 {
                return Some(Value::Error("#N/A"));
            }
            let value = self.lookup_entry(
                area,
                if vertical {
                    index as usize
                } else {
                    (offset - 1.) as usize
                },
                if vertical {
                    (offset - 1.) as usize
                } else {
                    index as usize
                },
                pos,
                depth + 1,
            )?;
            return Some(
                if !gnumeric
                    && matches!(area, Value::Matrix(_))
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    )
                {
                    Value::Text(String::new())
                } else if matches!(area, Value::Matrix(_))
                    && let Value::UninternedText(text) = value
                {
                    Value::Text(text)
                } else {
                    value
                },
            );
        }
        if name == "LOOKUP" {
            if !valid_seek(seek) {
                return Some(Value::Error("#N/A"));
            }
            let vertical = if gnumeric {
                width < height
            } else {
                width <= height
            };
            let result = get(2).unwrap_or(area);
            let (result_height, result_width) = dimensions(result);
            if get(2).is_some()
                && (result_height > 1 && result_width > 1
                    || !gnumeric
                        && matches!(result, Value::Range(a, b) | Value::LabelRange(a, b, _) if a.0 != b.0))
            {
                return Some(Value::Error(if gnumeric { "#N/A" } else { "Err:504" }));
            }
            let result_vertical = if gnumeric {
                result_width < result_height
            } else if get(2).is_some() && matches!(result, Value::Range(..) | Value::LabelRange(..))
            {
                result_height > 1
            } else {
                vertical
            };
            let index = self.lookup_find(area, seek, vertical, 1., 1., name, pos, depth + 1)?;
            if index < 0 {
                return Some(Value::Error("#N/A"));
            }
            let row = if result_vertical {
                index as usize
            } else if gnumeric || get(2).is_none() {
                result_height.saturating_sub(1)
            } else {
                0
            };
            let col = if result_vertical {
                if gnumeric || get(2).is_none() {
                    result_width.saturating_sub(1)
                } else {
                    0
                }
            } else {
                index as usize
            };
            if (gnumeric || !matches!(result, Value::Range(..) | Value::LabelRange(..)))
                && (row >= result_height || col >= result_width)
            {
                return Some(
                    if matches!(result, Value::Range(..) | Value::LabelRange(..)) {
                        Value::Number(0.)
                    } else {
                        Value::Error("#N/A")
                    },
                );
            }
            if let Value::Range(a, b) | Value::LabelRange(a, b, _) = result
                && (a.1.min(b.1).checked_add(row)? >= 1_048_576
                    || a.2.min(b.2).checked_add(col)? >= 16_384)
            {
                return Some(Value::Number(0.));
            }
            let value = self.lookup_entry(result, row, col, pos, depth + 1)?;
            if gnumeric {
                return Some(value);
            }
            if !matches!(
                result,
                Value::Range(..) | Value::LabelRange(..) | Value::Matrix(..)
            ) {
                return Some(match value {
                    Value::Bool(b) => Value::Number(f64::from(u8::from(b))),
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty => {
                        Value::Number(0.)
                    }
                    other => other,
                });
            }
            return Some(
                if matches!(result, Value::Matrix(_))
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    )
                {
                    Value::Text(String::new())
                } else {
                    value
                },
            );
        }
        let lookup = name == "XLOOKUP";
        let mode = number(if lookup { 4 } else { 2 }, 0.);
        let search = number(if lookup { 5 } else { 3 }, 1.);
        if !gnumeric
            && (!(-32768. ..=32767.).contains(&mode) || !(-32768. ..=32767.).contains(&search))
        {
            return Some(Value::Error("Err:502"));
        }
        let vertical = width <= height;
        if !gnumeric
            && (!matches!(
                area,
                Value::Range(..) | Value::LabelRange(..) | Value::Matrix(..)
            ) || width > 1 && height > 1
                || !(-1. ..=3.).contains(&mode)
                || !matches!(search, -2. | -1. | 1. | 2.))
        {
            return Some(Value::Error("Err:504"));
        }
        if !gnumeric && mode >= 2. && search.abs() == 2. && !matches!(area, Value::Matrix(_)) {
            return Some(Value::Error("#VALUE!"));
        }
        if lookup && !gnumeric {
            let result = get(2).unwrap();
            let (result_height, result_width) = dimensions(result);
            if matches!(result, Value::Range(a, b) | Value::LabelRange(a, b, _) if a.0 != b.0)
                || if vertical {
                    result_height != height
                } else {
                    result_width != width
                }
            {
                return Some(Value::Error("Err:504"));
            }
        }
        let index = if valid_seek(seek) {
            self.lookup_find(area, seek, vertical, mode, search, name, pos, depth + 1)?
        } else {
            -1
        };
        if index == -2 {
            return Some(Value::Error("#VALUE!"));
        }
        if index < 0 {
            let value = if lookup { get(3) } else { None }.unwrap_or(
                if !gnumeric && matches!(seek, Value::Error(_)) {
                    seek
                } else {
                    &Value::Error("#N/A")
                },
            );
            if gnumeric
                && lookup
                && let Value::Range(a, b) | Value::LabelRange(a, b, _) = value
                && a == b
            {
                let value = self.cell(*a, depth + 1)?;
                return Some(if matches!(value, Value::Blank | Value::Empty) {
                    Value::FunctionEmpty
                } else {
                    value
                });
            }
            self.charge_value(value)?;
            return Some(value.clone());
        }
        if !lookup {
            return Some(Value::Number(index as f64 + 1.));
        }
        let result = get(2).unwrap();
        let (result_height, result_width) = dimensions(result);
        let index = index as usize;
        if gnumeric
            && index
                >= if vertical {
                    result_height
                } else {
                    result_width
                }
        {
            return Some(Value::Error("#REF!"));
        }
        if !gnumeric && let Value::Range(a, b) | Value::LabelRange(a, b, _) = result {
            let (mut a, mut b) = (*a, *b);
            if vertical {
                a.1 = a.1.min(b.1) + index;
                b.1 = a.1;
            } else {
                a.2 = a.2.min(b.2) + index;
                b.2 = a.2;
            }
            return Some(if a == b {
                Value::Single(a)
            } else {
                Value::Range(a, b)
            });
        }
        if (if vertical {
            result_width
        } else {
            result_height
        }) == 1
        {
            let value = self.lookup_entry(
                result,
                if vertical { index } else { 0 },
                if vertical { 0 } else { index },
                pos,
                depth + 1,
            )?;
            return Some(
                if !gnumeric
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    )
                {
                    Value::Error("#N/A")
                } else {
                    value
                },
            );
        }
        let (height, width) = if vertical {
            (1, result_width)
        } else {
            (result_height, 1)
        };
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut rows = Vec::new();
        for r in 0..height {
            let mut row = Vec::new();
            for c in 0..width {
                let value = self.lookup_entry(
                    result,
                    if vertical { index } else { r },
                    if vertical { c } else { index },
                    pos,
                    depth + 1,
                )?;
                row.push(if !gnumeric && matches!(value, Value::Blank) {
                    if matches!(result, Value::Matrix(_)) {
                        Value::Empty
                    } else {
                        Value::Number(0.)
                    }
                } else {
                    value
                });
            }
            rows.push(row);
        }
        Some(Value::Matrix(rows))
    }
    fn lookup_entry(
        &mut self,
        value: &Value,
        row: usize,
        column: usize,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.tick(depth)?;
        let value = match value {
            Value::Range(a, b) | Value::LabelRange(a, b, _) => {
                let coord = (
                    a.0.min(b.0),
                    a.1.min(b.1).checked_add(row)?,
                    a.2.min(b.2).checked_add(column)?,
                );
                let value = self.cell(coord, depth + 1)?;
                Some(value)
            }
            Value::Matrix(rows) => {
                let value = rows
                    .get(row)
                    .and_then(|r| r.get(column))
                    .unwrap_or(&Value::Error("#N/A"));
                self.charge_value(value)?;
                Some(value.clone())
            }
            _ => {
                self.charge_value(value)?;
                self.scalar(value.clone(), pos, depth + 1)
            }
        }?;
        Some(
            if self.dialect == Dialect::Gnumeric && matches!(value, Value::Blank | Value::Empty) {
                Value::MatrixEmpty
            } else {
                value
            },
        )
    }
    #[allow(clippy::too_many_arguments)]
    fn lookup_find(
        &mut self,
        area: &Value,
        seek: &Value,
        vertical: bool,
        mode: f64,
        search: f64,
        function: &str,
        pos: Coord,
        depth: usize,
    ) -> Option<isize> {
        if matches!(area, Value::Range(a,b) | Value::LabelRange(a,b,_) if a.0 != b.0) {
            return Some(-2);
        }
        let (height, width) = dimensions(area);
        let length = if vertical { height } else { width };
        let gnumeric = self.dialect == Dialect::Gnumeric;
        let legacy = matches!(function, "MATCH" | "LOOKUP" | "VLOOKUP" | "HLOOKUP")
            && if gnumeric {
                mode != 0.
            } else {
                matches!(mode, -1. | 1.)
            };
        // Matrix searches retain production types and original indexes.
        let matrix = matches!(area, Value::Matrix(_));
        let compare = |calc: &mut Self, left: &Value, right: &Value, depth| {
            if (matrix || gnumeric)
                && let (
                    Value::Text(a) | Value::UninternedText(a),
                    Value::Text(b) | Value::UninternedText(b),
                ) = (left, right)
            {
                calc.tick(depth)?;
                calc.work = calc
                    .work
                    .checked_sub(a.len().checked_add(b.len())?.checked_mul(3)?)?;
                Some(fold(a).encode_utf16().cmp(fold(b).encode_utf16()))
            } else {
                calc.lookup_compare(left, right, depth)
            }
        };
        self.work = self
            .work
            .checked_sub(length.checked_mul(std::mem::size_of::<(Value, usize)>())?)?;
        let mut data = Vec::new();
        for i in 0..length {
            let value = self.lookup_entry(
                area,
                if vertical { i } else { 0 },
                if vertical { 0 } else { i },
                pos,
                depth + 1,
            )?;
            // Calc may skip one leading literal string as a range header in
            // approximate searches. Formula cells are never treated as headers.
            if i == 0
                && !gnumeric
                && legacy
                && matches!(seek, Value::Text(_) | Value::UninternedText(_))
                && matches!(value, Value::Text(_) | Value::UninternedText(_))
                && let Value::Range(a, b) | Value::LabelRange(a, b, _) = area
                && !self
                    .formula_sources
                    .contains_key(&(a.0.min(b.0), a.1.min(b.1), a.2.min(b.2)))
                && !self
                    .expressions
                    .contains_key(&(a.0.min(b.0), a.1.min(b.1), a.2.min(b.2)))
            {
                let order = compare(self, seek, &value, depth + 1)?;
                if mode > 0. && order.is_lt() || mode < 0. && order.is_gt() {
                    continue;
                }
            }
            if std::mem::discriminant(&value) == std::mem::discriminant(seek)
                || matches!(value, Value::Text(_) | Value::UninternedText(_))
                    && matches!(seek, Value::Text(_) | Value::UninternedText(_))
                || !matrix
                    && !gnumeric
                    && matches!(value, Value::Number(_) | Value::Bool(_))
                    && matches!(seek, Value::Number(_) | Value::Bool(_))
            {
                data.push((value, i));
            }
        }
        if !valid_seek(seek) {
            return Some(-1);
        }
        if (matrix || gnumeric) && (legacy || search.abs() == 2.) {
            let descending = if legacy { mode < 0. } else { search < 0. };
            let (mut low, mut high) = (0isize, data.len() as isize - 1);
            let mut last = None;
            while low <= high {
                self.tick(depth)?;
                let mut mid = (low + high) / 2;
                let mut order = compare(self, seek, &data[mid as usize].0, depth)?;
                if order.is_eq() {
                    if legacy {
                        let step = if mode > 0. { 1 } else { -1 };
                        while mid + step > 0 && mid + step < data.len() as isize {
                            if !compare(self, seek, &data[(mid + step) as usize].0, depth)?.is_eq()
                            {
                                break;
                            }
                            mid += step;
                        }
                    }
                    return Some(data[mid as usize].1 as isize);
                }
                if descending {
                    order = order.reverse();
                }
                if order.is_gt() {
                    last = Some(mid as usize);
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            let selected = if legacy || mode == -1. {
                last
            } else if mode == 1. {
                Some(last.map_or(0, |index| index + 1))
            } else {
                None
            };
            return Some(
                selected
                    .and_then(|index| data.get(index))
                    .map_or(-1, |(_, index)| *index as isize),
            );
        }

        if legacy {
            let (mut low, mut high) = (0isize, data.len() as isize - 1);
            let (mut last, mut found) = (0usize, None);
            while low <= high {
                self.tick(depth)?;
                let mid = ((low + high) / 2) as usize;
                let mut order = compare(self, seek, &data[mid].0, depth)?;
                if mode < 0. {
                    order = order.reverse();
                }
                if order.is_gt() {
                    let mut progress = compare(self, &data[last].0, &data[mid].0, depth)?;
                    if mode < 0. {
                        progress = progress.reverse();
                    }
                    if progress.is_gt() {
                        let mut selected = -1;
                        let mut exact = false;
                        for (value, index) in &data {
                            self.tick(depth)?;
                            let mut order = compare(self, seek, value, depth)?;
                            if mode < 0. {
                                order = order.reverse();
                            }
                            if order.is_lt() || exact && !order.is_eq() {
                                break;
                            }
                            selected = *index as isize;
                            exact = order.is_eq();
                        }
                        return Some(selected);
                    }
                    last = mid;
                    low = mid as isize + 1;
                } else if order.is_eq() {
                    found = Some(mid);
                    low = mid as isize + 1;
                } else {
                    high = mid as isize - 1;
                }
            }
            return Some(if let Some(found) = found {
                data[found].1 as isize
            } else if low > 0 {
                data[last].1 as isize
            } else {
                -1
            });
        }
        if search.abs() == 2. {
            let (mut low, mut high, mut last) = (0isize, data.len() as isize - 1, -1isize);
            let reverse = search == -2.;
            while low <= high {
                self.tick(depth)?;
                let mid = (low + high) / 2;
                let mut order = compare(self, seek, &data[mid as usize].0, depth)?;
                if order.is_eq() {
                    return Some(data[mid as usize].1 as isize);
                }
                if reverse {
                    order = order.reverse();
                }
                if order.is_gt() {
                    last = mid;
                    low = mid + 1;
                } else {
                    high = mid - 1;
                }
            }
            let selected = if mode == -1. {
                last
            } else if mode == 1. && last + 1 < data.len() as isize {
                last + 1
            } else {
                -1
            };
            return Some(if selected < 0 {
                -1
            } else {
                data[selected as usize].1 as isize
            });
        }
        if search == -1. {
            data.reverse();
        }
        let extended = matches!(function, "XMATCH" | "XLOOKUP");
        let whole = gnumeric || matrix || !self.book.lookup_substring || extended;
        let mut matching = if matrix || gnumeric {
            if mode == 2.
                || mode == 0.
                    && !extended
                    && matches!(seek, Value::Text(s) | Value::UninternedText(s) if s.contains(['*', '?', '~']))
            {
                LookupSearch::Wildcard
            } else {
                LookupSearch::Literal
            }
        } else {
            match mode {
                2. => LookupSearch::Wildcard,
                3. => LookupSearch::Regex,
                0. if !extended => self.book.lookup_search,
                _ => LookupSearch::Literal,
            }
        };
        let regex = if let Value::Text(pattern) | Value::UninternedText(pattern) = seek {
            let detected = match matching {
                LookupSearch::Wildcard => pattern.contains(['*', '?', '~']),
                LookupSearch::Regex => {
                    (pattern.encode_utf16().count() > 1 || pattern == ".")
                        && pattern.contains([
                            '?', '*', '+', '.', '[', ']', '^', '$', '\\', '<', '>', '(', ')', '|',
                        ])
                }
                LookupSearch::Literal => false,
            };
            if !detected && !matrix && !gnumeric {
                matching = LookupSearch::Literal;
            }
            if matching == LookupSearch::Regex {
                ZeroRegex::office(pattern, &mut self.work)?
            } else {
                None
            }
        } else {
            None
        };
        for (value, index) in &data {
            self.tick(depth)?;
            let matched = if let (
                Value::Text(pattern) | Value::UninternedText(pattern),
                Value::Text(text) | Value::UninternedText(text),
            ) = (seek, value)
            {
                match matching {
                    LookupSearch::Wildcard => self.lookup_wildcard(pattern, text, whole, depth)?,
                    LookupSearch::Regex => match &regex {
                        Some(regex) => regex.office_match(
                            text,
                            whole,
                            function == "MATCH" || !matrix && !extended,
                            &mut self.work,
                        )?,
                        None => false,
                    },
                    LookupSearch::Literal if !whole && !matrix => {
                        self.work = self
                            .work
                            .checked_sub(pattern.len().checked_add(text.len())?.checked_mul(3)?)?;
                        !pattern.is_empty() && fold(text).contains(&fold(pattern))
                    }
                    LookupSearch::Literal if mode == 0. && !matrix && !gnumeric => {
                        match (seek, value) {
                            (Value::UninternedText(_), Value::UninternedText(_)) => true,
                            (Value::UninternedText(_), _) | (_, Value::UninternedText(_)) => false,
                            _ => {
                                collation::uppercase(pattern, &mut self.work)?
                                    == collation::uppercase(text, &mut self.work)?
                            }
                        }
                    }
                    LookupSearch::Literal => compare(self, seek, value, depth)?.is_eq(),
                }
            } else {
                compare(self, seek, value, depth)?.is_eq()
            };
            if matched {
                return Some(*index as isize);
            }
        }
        if mode != -1. && mode != 1. {
            return Some(-1);
        }
        let mut best: Option<&(Value, usize)> = None;
        for item in &data {
            self.tick(depth)?;
            let order = compare(self, seek, &item.0, depth)?;
            if (if mode == -1. {
                order.is_gt()
            } else {
                order.is_lt()
            }) && match best {
                None => true,
                Some(best) => {
                    let order = compare(self, &item.0, &best.0, depth)?;
                    if mode == -1. {
                        order.is_gt()
                    } else {
                        order.is_lt()
                    }
                }
            } {
                best = Some(item);
            }
        }
        Some(best.map_or(-1, |(_, index)| *index as isize))
    }
    pub(super) fn lookup_compare(
        &mut self,
        left: &Value,
        right: &Value,
        depth: usize,
    ) -> Option<Ordering> {
        self.tick(depth)?;
        Some(match (left, right) {
            (Value::Number(a), Value::Number(b)) => a.partial_cmp(b)?,
            (Value::Bool(a), Value::Bool(b)) => a.cmp(b),
            (Value::Bool(a), Value::Number(b)) => f64::from(u8::from(*a)).partial_cmp(b)?,
            (Value::Number(a), Value::Bool(b)) => a.partial_cmp(&f64::from(u8::from(*b)))?,
            (
                Value::Text(a) | Value::UninternedText(a),
                Value::Text(b) | Value::UninternedText(b),
            ) => collation::compare(a, b, false, &mut self.work)?,
            _ => return None,
        })
    }
    pub(super) fn lookup_wildcard(
        &mut self,
        pattern: &str,
        text: &str,
        whole: bool,
        depth: usize,
    ) -> Option<bool> {
        self.work = self
            .work
            .checked_sub(pattern.len().checked_add(text.len())?.checked_mul(24)?)?;
        let input: Vec<_> = text.to_lowercase().chars().collect();
        let lower = pattern.to_lowercase();
        let mut chars = lower.chars().peekable();
        let mut previous = vec![!whole; input.len() + 1];
        previous[0] = true;
        while let Some(mut token) = chars.next() {
            self.tick(depth)?;
            let literal =
                token == '~' && chars.peek().is_some_and(|c| matches!(c, '*' | '?' | '~'));
            if literal {
                token = chars.next()?;
            }
            let mut next = vec![false; input.len() + 1];
            next[0] = !literal && token == '*' && previous[0];
            for i in 1..=input.len() {
                self.tick(depth)?;
                next[i] = if !literal && token == '*' {
                    previous[i] || next[i - 1]
                } else {
                    previous[i - 1] && (!literal && token == '?' || token == input[i - 1])
                };
            }
            previous = next;
        }
        Some(if whole {
            previous[input.len()]
        } else {
            previous.into_iter().any(|matched| matched)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Workbook, calculate, parse};
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn lookup_scans_and_result_arrays_are_bounded_before_materialization() {
        for formula in [
            "=MATCH(1,A1:A65536,0)",
            "=SUM(TRANSPOSE(XLOOKUP(1,{1,2},A1:B128)))",
        ] {
            let rows = vec![vec!["1".into(), formula.into()]];
            assert!(
                calculate(&rows, &BTreeSet::new(), 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::new(), 8_000_000).is_some(),
                "{formula}"
            );
        }
    }

    #[test]
    fn wildcard_matching_charges_each_dynamic_programming_step() {
        let rows = vec![vec![format!(
            "=XMATCH(\"{}\",{{\"{}\"}},2)",
            "*a".repeat(100),
            "a".repeat(300)
        )]];
        assert!(calculate(&rows, &BTreeSet::new(), 32_768).is_none());
        assert!(calculate(&rows, &BTreeSet::new(), 1_000_000).is_some());
    }
    #[test]
    fn broadcasting_and_returned_arrays_obey_the_work_budget() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".into()];
        let values: Vec<_> = (1..=32).map(|n| n.to_string()).collect();
        for source in [
            format!(
                "=ADDRESS({{{}}},{{{}}})",
                values.join(","),
                values.join(";")
            ),
            "=INDIRECT({\"A1:AF32\"},{1})".into(),
        ] {
            let expression = parse(
                crate::commands::structured::xlsx::Dialect::LibreOffice,
                &source,
                &sheets,
                &book,
                (0, 0, 0),
                None,
                false,
                None,
                1_000_000,
            )
            .unwrap()
            .unwrap();
            for limit in [16_384, 1_000_000] {
                let mut calculation = Calculation::new(&book, &sheets, vec![(65536, 256)], limit);
                calculation.array = true;
                let result = calculation.eval(&expression, (0, 0, 0), 0, true);
                if limit == 16_384 {
                    assert!(result.is_none(), "{source}");
                } else {
                    let Value::Matrix(rows) = result.unwrap() else {
                        panic!("{source}");
                    };
                    assert_eq!(rows.len(), 32, "{source}");
                    assert!(rows.iter().all(|row| row.len() == 32), "{source}");
                }
            }
        }
    }
}
