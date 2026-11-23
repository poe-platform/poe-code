use super::super::case_fold::fold;
use super::super::collation;
use super::{Calculation, Coord, Expr, Value};
use crate::commands::{search::ZeroRegex, spreadsheet::model::LookupSearch};
use std::cmp::Ordering;
#[path = "office_formula_number.rs"]
pub(super) mod number;

pub(super) fn dimensions(value: &Value) -> (usize, usize) {
    match value {
        Value::Range(a, b) => (a.1.abs_diff(b.1) + 1, a.2.abs_diff(b.2) + 1),
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
fn coerce(value: Value, kind: u8, iteration: bool, date1904: bool) -> Value {
    if kind != b'E'
        && let Value::LiteralError(error) = value
    {
        return Value::Error(error);
    }
    if iteration && kind == b's' {
        return match value {
            Value::Blank | Value::Empty => Value::Text(String::new()),
            Value::Text(_) | Value::UninternedText(_) | Value::Error(_) => value,
            _ => Value::Error("#VALUE!"),
        };
    }
    if matches!(kind, b'b' | b'f') {
        return match value {
            Value::Text(ref s) | Value::UninternedText(ref s) => {
                number::parse(s, date1904).map_or(Value::Error("#VALUE!"), Value::number)
            }
            Value::Blank | Value::Empty => Value::Number(0.),
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
        let (minimum, types): (usize, &[u8]) = match name {
            "ADDRESS" => (2, b"fffbs"),
            "ROW" | "COLUMN" => (0, b"A"),
            "TRANSPOSE" => (1, b"A"),
            "COLUMNNUMBER" => (1, b"s"),
            "HYPERLINK" => (1, b"SS"),
            "INDIRECT" => (1, b"sb"),
            "OFFSET" => (3, b"rffff"),
            "SHEET" => (0, b"?"),
            "SORT" => (1, b"rf"),
            "FLIP" => (1, b"Ab"),
            "UNIQUE" => (1, b"Abb"),
            "VLOOKUP" | "HLOOKUP" => (3, b"EAfbb"),
            "LOOKUP" => (2, b"EAA"),
            "MATCH" => (2, b"EAf"),
            "XMATCH" => (2, b"EAff"),
            "XLOOKUP" => (3, b"EAA?ff"),
            _ => return None,
        };
        if nodes.len() < minimum || nodes.len() > types.len() {
            if matches!(name, "ADDRESS" | "XMATCH" | "XLOOKUP") && self.dynamic.is_some() {
                return Some(Value::Error("#ERROR!"));
            }
            if matches!(name, "ROW" | "COLUMN") {
                // Runtime operand errors precede the parameter-count check;
                // reference values and literal error tokens do not.
                for node in nodes {
                    let value = self.eval(node, pos, depth + 1, true)?;
                    if matches!(value, Value::Error(_)) {
                        return Some(value);
                    }
                }
            }
            if !matches!(name, "SORT" | "FLIP" | "COLUMNNUMBER") {
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
            let single_lookup = name == "LOOKUP" && i == 1 && matches!(node, Expr::Ref(_));
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
            let value = if name == "OFFSET" && i == 0 {
                value
            } else {
                value.into_range()
            };
            self.array = array;
            if area {
                if matches!(name, "LOOKUP" | "VLOOKUP" | "HLOOKUP")
                    && i == 1
                    && matches!(value, Value::LiteralError(_))
                {
                    args.push(Some(value));
                    continue;
                }
                if let Value::LiteralError(error) = value {
                    return Some(Value::Error(
                        if self.dynamic.is_some() && matches!(name, "XMATCH" | "XLOOKUP") {
                            error
                        } else if types[0] == b'E' || matches!(name, "ROW" | "COLUMN") {
                            "Err:504"
                        } else {
                            error
                        },
                    ));
                }
                if let Value::Error(error) = value {
                    return Some(Value::Error(
                        if name == "XLOOKUP" && self.dynamic.is_none() {
                            "Err:504"
                        } else {
                            error
                        },
                    ));
                }
                if kind == b'r'
                    && !matches!(
                        value,
                        Value::Single(_) | Value::Range(..) | Value::Matrix(..)
                    )
                {
                    return Some(Value::Error(if name == "OFFSET" {
                        "Err:504"
                    } else {
                        "#VALUE!"
                    }));
                }
                args.push(Some(value));
            } else if kind == b'?' {
                let value = if name == "XLOOKUP" && matches!(value, Value::Blank) {
                    Value::Number(0.)
                } else {
                    value
                };
                args.push(
                    (if name == "XLOOKUP" {
                        !matches!(node, Expr::Value(Value::Blank))
                    } else {
                        !matches!(value, Value::Blank | Value::Empty)
                    })
                    .then_some(value),
                );
            } else if array
                && matches!(value, Value::Range(..) | Value::Matrix(..))
                && !(kind == b'E' && matches!(value, Value::Range(a, b) if a == b))
            {
                let (mut rows, columns) = dimensions(&value);
                if let Value::Range(a, b) = &value {
                    rows = rows.checked_mul(a.0.abs_diff(b.0) + 1)?;
                }
                shape = Some(shape.map_or((rows, columns), |(h, w): (usize, usize)| {
                    (h.max(rows), w.max(columns))
                }));
                iteration.push((i, self.matrix(value, depth + 1)?));
                args.push(None);
            } else {
                let reference = matches!(value, Value::Range(..));
                let mut value = self.scalar(value, pos, depth + 1)?;
                if kind == b'E'
                    && name == "XLOOKUP"
                    && !reference
                    && let Value::Error(error) = value
                {
                    value = Value::LiteralError(error);
                }
                if i >= minimum && name != "MATCH" && matches!(node, Expr::Value(Value::Blank)) {
                    args.push(None);
                } else {
                    let mut value = if name == "HYPERLINK" {
                        value
                    } else {
                        coerce(value, kind, false, self.book.date1904)
                    };
                    if self.dynamic.is_none()
                        && name == "XLOOKUP"
                        && i == 4
                        && matches!(value, Value::Error(_))
                    {
                        value = Value::Number(0.);
                    }
                    if (kind != b'E' || name == "LOOKUP" && i == 0)
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
                    } else if name == "ADDRESS" && self.dynamic.is_some() {
                        &Value::Error("#N/A")
                    } else {
                        &Value::Error("#VALUE!")
                    });
                    self.charge_value(value)?;
                    let mut value = if name == "HYPERLINK" {
                        value.clone()
                    } else {
                        coerce(
                            value.clone(),
                            types[*i],
                            !(name == "ADDRESS" && self.dynamic.is_some()),
                            self.book.date1904,
                        )
                    };
                    if self.dynamic.is_none()
                        && name == "XLOOKUP"
                        && *i == 4
                        && matches!(value, Value::Error(_))
                    {
                        value = Value::Number(0.);
                    }
                    if types[*i] != b'E' && matches!(value, Value::Error(_)) && name != "HYPERLINK"
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
        if !matches!(
            name,
            "MATCH" | "LOOKUP" | "VLOOKUP" | "HLOOKUP" | "XMATCH" | "XLOOKUP"
        ) {
            return self.reference_function(name, args, pos, depth);
        }
        let get = |i: usize| args.get(i).and_then(Option::as_ref);
        let number = |i, fallback| {
            get(i)
                .map_or(fallback, |v| v.numeric().unwrap_or(f64::NAN))
                .trunc()
        };
        let seek = get(0).unwrap_or(&Value::Blank);
        let modern = self.dynamic.is_some() && matches!(name, "XMATCH" | "XLOOKUP");
        if modern && let Value::Error(e) | Value::LiteralError(e) = seek {
            return Some(Value::Error(e));
        }
        if matches!(seek, Value::LiteralError(_)) {
            return Some(Value::Error("Err:504"));
        }
        if name != "XLOOKUP"
            && let Value::Error(error) = seek
        {
            return Some(Value::Error(error));
        }
        let area = get(1).unwrap();
        let (height, width) = dimensions(area);
        if matches!(area, Value::LiteralError(_))
            || matches!(area, Value::Range(a, b) if a.0 != b.0)
        {
            return Some(Value::Error("Err:504"));
        }
        if name == "MATCH" {
            let mode = number(2, 1.);
            if self.dynamic.is_some() && width > 1 && height > 1 {
                return Some(Value::Error("#N/A"));
            }
            if !matches!(area, Value::Range(..) | Value::Matrix(..))
                || width > 1 && height > 1
                || !(-1. ..=1.).contains(&mode)
            {
                return Some(Value::Error("Err:504"));
            }
            if !valid_seek(seek) {
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
            if !matches!(area, Value::Range(..) | Value::Matrix(..)) {
                if self.dynamic.is_none() {
                    return Some(Value::Error("Err:504"));
                }
                if matches!(area, Value::Text(_) | Value::UninternedText(_)) {
                    return Some(Value::Error("#VALUE!"));
                }
            }
            if !valid_seek(seek) {
                return Some(Value::Error("#N/A"));
            }
            let vertical = name == "VLOOKUP";
            let offset = number(2, 0.);
            if self.dynamic.is_some() {
                if !offset.is_finite() || offset <= 0. {
                    return Some(Value::Error("#VALUE!"));
                }
                if offset > (if vertical { width } else { height }) as f64 {
                    return Some(Value::Error("#REF!"));
                }
            }
            if offset <= 0. || offset > (if vertical { width } else { height }) as f64 {
                return Some(Value::Error("Err:502"));
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
                if matches!(area, Value::Matrix(_)) && matches!(value, Value::Blank | Value::Empty)
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
            let vertical = width <= height;
            let result = get(2).unwrap_or(area);
            let (result_height, result_width) = dimensions(result);
            if get(2).is_some()
                && (result_height > 1 && result_width > 1
                    || matches!(result, Value::Range(a, b) if a.0 != b.0))
            {
                return Some(Value::Error("Err:504"));
            }
            let result_vertical = if get(2).is_some() && matches!(result, Value::Range(..)) {
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
            } else if get(2).is_none() {
                result_height.saturating_sub(1)
            } else {
                0
            };
            let col = if result_vertical {
                if get(2).is_none() {
                    result_width.saturating_sub(1)
                } else {
                    0
                }
            } else {
                index as usize
            };
            if !matches!(result, Value::Range(..)) && (row >= result_height || col >= result_width)
            {
                return Some(Value::Error("#N/A"));
            }
            if let Value::Range(a, b) = result
                && (a.1.min(b.1).checked_add(row)? >= 1_048_576
                    || a.2.min(b.2).checked_add(col)? >= 16_384)
            {
                return Some(Value::Number(0.));
            }
            let value = self.lookup_entry(result, row, col, pos, depth + 1)?;
            if !matches!(result, Value::Range(..) | Value::Matrix(..)) {
                return Some(match value {
                    Value::Bool(b) => Value::Number(f64::from(u8::from(b))),
                    Value::Blank | Value::Empty => Value::Number(0.),
                    other => other,
                });
            }
            return Some(
                if matches!(result, Value::Matrix(_))
                    && matches!(value, Value::Blank | Value::Empty)
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
        if !(-32768. ..=32767.).contains(&mode) || !(-32768. ..=32767.).contains(&search) {
            return Some(Value::Error(if modern { "#VALUE!" } else { "Err:502" }));
        }
        let vertical = width <= height;
        if !matches!(area, Value::Range(..) | Value::Matrix(..))
            || width > 1 && height > 1
            || !(-1. ..=3.).contains(&mode)
            || !matches!(search, -2. | -1. | 1. | 2.)
        {
            return Some(Value::Error(if modern { "#VALUE!" } else { "Err:504" }));
        }
        if mode >= 2. && search.abs() == 2. {
            return Some(Value::Error("#VALUE!"));
        }
        if !modern && mode == 3. && matches!(area, Value::Matrix(_)) {
            return Some(Value::Error(if modern { "#VALUE!" } else { "Err:504" }));
        }
        if lookup {
            let result = get(2).unwrap();
            let (result_height, result_width) = dimensions(result);
            if matches!(result, Value::Range(a, b) if a.0 != b.0)
                || if vertical {
                    result_height != height
                } else {
                    result_width != width
                }
            {
                return Some(Value::Error(if modern { "#VALUE!" } else { "Err:504" }));
            }
        }
        let index = if valid_seek(seek) || modern && matches!(seek, Value::Blank | Value::Empty) {
            self.lookup_find(area, seek, vertical, mode, search, name, pos, depth + 1)?
        } else {
            -1
        };
        if index == -2 {
            return Some(Value::Error("#VALUE!"));
        }
        if index < 0 {
            let value =
                if lookup { get(3) } else { None }.unwrap_or(if matches!(seek, Value::Error(_)) {
                    seek
                } else {
                    &Value::Error("#N/A")
                });
            self.charge_value(value)?;
            return Some(value.clone());
        }
        if !lookup {
            return Some(Value::Number(index as f64 + 1.));
        }
        let result = get(2).unwrap();
        let (result_height, result_width) = dimensions(result);
        let index = index as usize;
        if let Value::Range(a, b) = result {
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
            return Some(if matches!(value, Value::Blank | Value::Empty) {
                Value::Error("#N/A")
            } else {
                value
            });
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
                row.push(if matches!(value, Value::Blank) {
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
    pub(super) fn lookup_entry(
        &mut self,
        value: &Value,
        row: usize,
        column: usize,
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.tick(depth)?;
        match value {
            Value::Range(a, b) => self.cell(
                (
                    a.0.min(b.0),
                    a.1.min(b.1).checked_add(row)?,
                    a.2.min(b.2).checked_add(column)?,
                ),
                depth + 1,
            ),
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
        }
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
        if matches!(area, Value::Range(a,b) if a.0 != b.0) {
            return Some(-2);
        }
        let (height, width) = dimensions(area);
        let length = if vertical { height } else { width };
        let legacy = matches!(function, "MATCH" | "LOOKUP" | "VLOOKUP" | "HLOOKUP")
            && matches!(mode, -1. | 1.);
        let modern = self.dynamic.is_some() && matches!(function, "XMATCH" | "XLOOKUP");
        if modern && mode == 3. && !matches!(seek, Value::Text(_) | Value::UninternedText(_)) {
            return Some(-1);
        }
        let matrix_binary = !modern
            && matches!(area, Value::Matrix(_))
            && (function == "MATCH" && legacy || search.abs() == 2.);
        // Read stored cells, including spill children, without materializing a
        // million empty entries for modern whole-axis lookups. Register the full
        // read so a later spill outside today's used area restarts calculation.
        let mut positions = if modern && let Value::Range(a, b) = area {
            self.read_spill_range(*a, *b)?;
            self.work = self.work.checked_sub(
                self.values
                    .len()
                    .checked_add(self.expressions.len())?
                    .checked_mul(64)?,
            )?;
            Some(
                self.values
                    .keys()
                    .chain(self.expressions.keys())
                    .filter_map(|&(s, r, c)| {
                        (s == a.0
                            && (a.1.min(b.1)..=a.1.max(b.1)).contains(&r)
                            && (a.2.min(b.2)..=a.2.max(b.2)).contains(&c))
                        .then_some(if vertical {
                            r.saturating_sub(a.1.min(b.1))
                        } else {
                            c.saturating_sub(a.2.min(b.2))
                        })
                    })
                    .collect::<std::collections::BTreeSet<_>>(),
            )
        } else {
            None
        };
        // Missing cells are all equivalent. Keep the first and last gap so
        // directional blank lookups remain sparse even across an entire axis.
        if matches!(seek, Value::Blank | Value::Empty)
            && let Some(positions) = &mut positions
        {
            let mut first = 0;
            for &index in positions.iter() {
                if index != first {
                    break;
                }
                first += 1;
            }
            let mut end = length;
            for &index in positions.iter().rev() {
                if index + 1 != end {
                    break;
                }
                end = index;
            }
            if first < length {
                positions.insert(first);
            }
            if end > 0 {
                positions.insert(end - 1);
            }
        }
        let count = positions.as_ref().map_or(length, |p| p.len());
        self.work = self
            .work
            .checked_sub(count.checked_mul(std::mem::size_of::<(Value, usize)>())?)?;
        let mut data = Vec::new();
        let mut sparse = positions.as_ref().map(|p| p.iter());
        for index in 0..count {
            let i = if let Some(p) = &mut sparse {
                *p.next()?
            } else {
                index
            };
            let mut value = self.lookup_entry(
                area,
                if vertical { i } else { 0 },
                if vertical { 0 } else { i },
                pos,
                depth + 1,
            )?;
            if self.dynamic.is_none()
                && matches!(mode, 0. | 2. | 3.)
                && search.abs() == 1.
                && matches!(seek, Value::Text(_) | Value::UninternedText(_))
                && let Value::Range(a, b) = area
            {
                let coord = (
                    a.0.min(b.0),
                    a.1.min(b.1) + if vertical { i } else { 0 },
                    a.2.min(b.2) + if vertical { 0 } else { i },
                );
                value = match value {
                    Value::Number(n) => Value::Text(super::super::number_format::text(
                        n,
                        self.formats.get(&coord).map_or("General", |f| f.pattern),
                        self.book.date1904,
                        super::super::number_format::Mode::Filter,
                        &mut self.work,
                    )?),
                    Value::Bool(b) if self.formats.contains_key(&coord) => {
                        Value::Text(super::super::number_format::text(
                            f64::from(u8::from(b)),
                            self.formats[&coord].pattern,
                            self.book.date1904,
                            super::super::number_format::Mode::Filter,
                            &mut self.work,
                        )?)
                    }
                    Value::Bool(_) | Value::Error(_) => Value::Text(value.text()),
                    other => other,
                };
            }
            // Calc may skip one leading literal string as a range header in
            // approximate searches. Formula cells are never treated as headers.
            if i == 0
                && legacy
                && matches!(seek, Value::Text(_) | Value::UninternedText(_))
                && matches!(value, Value::Text(_) | Value::UninternedText(_))
                && let Value::Range(a, b) = area
                && !self
                    .formula_sources
                    .contains_key(&(a.0.min(b.0), a.1.min(b.1), a.2.min(b.2)))
                && !self
                    .expressions
                    .contains_key(&(a.0.min(b.0), a.1.min(b.1), a.2.min(b.2)))
            {
                let order = self.lookup_compare(seek, &value, depth + 1)?;
                if mode > 0. && order.is_lt() || mode < 0. && order.is_gt() {
                    continue;
                }
            }
            if modern
                && (valid_seek(&value)
                    || matches!(seek, Value::Blank | Value::Empty)
                        && matches!(value, Value::Blank | Value::Empty))
                || matrix_binary
                || !modern
                    && (std::mem::discriminant(&value) == std::mem::discriminant(seek)
                        || matches!(value, Value::Text(_) | Value::UninternedText(_))
                            && matches!(seek, Value::Text(_) | Value::UninternedText(_))
                        || self.dynamic.is_none()
                            && matches!(value, Value::Number(_) | Value::Bool(_))
                            && matches!(seek, Value::Number(_) | Value::Bool(_)))
            {
                data.push((value, i));
            }
        }
        if !valid_seek(seek) && !(modern && matches!(seek, Value::Blank | Value::Empty)) {
            return Some(-1);
        }
        if modern && matches!(seek, Value::Blank | Value::Empty) {
            let blanks = |item: &&(Value, usize)| matches!(item.0, Value::Blank | Value::Empty);
            return Some(
                if search < 0. {
                    data.iter().rev().find(blanks)
                } else {
                    data.iter().find(blanks)
                }
                .map_or(-1, |item| item.1 as isize),
            );
        }
        if matrix_binary {
            let ascending = if legacy { mode > 0. } else { search > 0. };
            let approximate = legacy || if ascending { mode == -1. } else { mode == 1. };
            let (mut low, mut high) = (0, data.len().saturating_sub(1));
            // Calc 24.8 stops at adjacent endpoints. Exact hits can extend
            // through equal trailing entries, including the final element.
            while low < high {
                self.tick(depth)?;
                let mid = low + (high - low) / 2;
                let order = match &data[mid].0 {
                    Value::Blank | Value::Empty => Ordering::Greater,
                    Value::Error(_) | Value::LiteralError(_) => Ordering::Less,
                    Value::Text(_) | Value::UninternedText(_)
                        if !matches!(seek, Value::Text(_) | Value::UninternedText(_)) =>
                    {
                        Ordering::Less
                    }
                    Value::Number(_) | Value::Bool(_)
                        if matches!(seek, Value::Text(_) | Value::UninternedText(_)) =>
                    {
                        Ordering::Greater
                    }
                    value => self.lookup_compare(seek, value, depth)?,
                };
                if order.is_eq() {
                    let mut last = mid;
                    while let Some((next, _)) = data.get(last + 1) {
                        self.tick(depth)?;
                        let equal = match (&data[mid].0, next) {
                            (
                                Value::Text(a) | Value::UninternedText(a),
                                Value::Text(b) | Value::UninternedText(b),
                            ) => a == b,
                            (
                                Value::Number(_) | Value::Bool(_),
                                Value::Number(_) | Value::Bool(_),
                            ) => data[mid].0.numeric() == next.numeric(),
                            _ => false,
                        };
                        if !equal {
                            break;
                        }
                        last += 1;
                    }
                    return Some(data[last].1 as isize);
                }
                let before = if ascending {
                    order.is_lt()
                } else {
                    order.is_gt()
                };
                if high - low == 1 {
                    let endpoint = if before { low } else { high };
                    if !approximate || endpoint == 0 {
                        return Some(-1);
                    }
                    let (value, index) = &data[endpoint - 1];
                    return Some(match (seek, value) {
                        (
                            Value::Text(_) | Value::UninternedText(_),
                            Value::Text(_) | Value::UninternedText(_),
                        )
                        | (Value::Number(_) | Value::Bool(_), Value::Number(_) | Value::Bool(_)) => {
                            *index as isize
                        }
                        _ => -1,
                    });
                }
                if before {
                    high = mid;
                } else {
                    low = mid;
                }
            }
            return Some(-1);
        }
        if legacy {
            let (mut low, mut high) = (0isize, data.len() as isize - 1);
            let (mut last, mut found) = (0usize, None);
            while low <= high {
                self.tick(depth)?;
                let mid = ((low + high) / 2) as usize;
                let mut order = self.lookup_compare(seek, &data[mid].0, depth)?;
                if mode < 0. {
                    order = order.reverse();
                }
                if order.is_gt() {
                    let mut progress = self.lookup_compare(&data[last].0, &data[mid].0, depth)?;
                    if mode < 0. {
                        progress = progress.reverse();
                    }
                    if progress.is_gt() {
                        let mut selected = -1;
                        let mut exact = false;
                        for (value, index) in &data {
                            self.tick(depth)?;
                            let mut order = self.lookup_compare(seek, value, depth)?;
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
            let mut exact = None;
            while low <= high {
                self.tick(depth)?;
                let mid = (low + high) / 2;
                let mut order =
                    self.lookup_search_compare(seek, &data[mid as usize].0, modern, depth)?;
                if order.is_eq() {
                    if !modern {
                        return Some(data[mid as usize].1 as isize);
                    }
                    exact = Some(mid as usize);
                    if reverse {
                        low = mid + 1;
                    } else {
                        high = mid - 1;
                    }
                    continue;
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
            if let Some(index) = exact {
                return Some(data[index].1 as isize);
            }
            let selected = if mode == (if modern && reverse { 1. } else { -1. }) {
                last
            } else if mode == (if modern && reverse { -1. } else { 1. })
                && last + 1 < data.len() as isize
            {
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
        let matrix = matches!(area, Value::Matrix(_));
        let extended = matches!(function, "XMATCH" | "XLOOKUP");
        let whole = !(modern && mode == 3.) && (!self.book.lookup_substring || extended && !matrix);
        // VLOOKUP/HLOOKUP matrix searches compare shared-string identities;
        // unlike range searches and MATCH, native Calc does not interpret patterns.
        // The editor follows Excel/IronCalc wildcard semantics for both sources.
        let mut matching =
            if self.dynamic.is_none() && matrix && matches!(function, "VLOOKUP" | "HLOOKUP") {
                LookupSearch::Literal
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
                    modern || {
                        (pattern.encode_utf16().count() > 1 || pattern == ".")
                            && pattern.contains([
                                '?', '*', '+', '.', '[', ']', '^', '$', '\\', '<', '>', '(', ')',
                                '|',
                            ])
                    }
                }
                LookupSearch::Literal => false,
            };
            if !detected {
                matching = LookupSearch::Literal;
            }
            if matching == LookupSearch::Regex {
                let compiled = ZeroRegex::office(pattern, !modern, &mut self.work)?;
                if modern && compiled.is_none() {
                    return Some(-2);
                }
                compiled
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
                let matched = match matching {
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
                    LookupSearch::Literal
                        if self.dynamic.is_none()
                            && mode == 0.
                            && (!matrix || matches!(function, "VLOOKUP" | "HLOOKUP")) =>
                    {
                        match (seek, value) {
                            (Value::UninternedText(_), Value::UninternedText(_)) => true,
                            (Value::UninternedText(_), _) | (_, Value::UninternedText(_)) => false,
                            _ => {
                                collation::uppercase(pattern, &mut self.work)?
                                    == collation::uppercase(text, &mut self.work)?
                            }
                        }
                    }
                    LookupSearch::Literal => self
                        .lookup_search_compare(seek, value, modern, depth)?
                        .is_eq(),
                };
                matched
                    || !modern
                        && matrix
                        && matching != LookupSearch::Literal
                        && self
                            .lookup_search_compare(seek, value, modern, depth)?
                            .is_eq()
            } else {
                self.lookup_search_compare(seek, value, modern, depth)?
                    .is_eq()
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
            let order = self.lookup_search_compare(seek, &item.0, modern, depth)?;
            if (if mode == -1. {
                order.is_gt()
            } else {
                order.is_lt()
            }) && match best {
                None => true,
                Some(best) => {
                    let order = self.lookup_search_compare(&item.0, &best.0, modern, depth)?;
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
    // Modern lookup order follows Excel: numbers, text, then booleans.
    // Exact matches must not coerce FALSE to zero or TRUE to one.
    fn lookup_search_compare(
        &mut self,
        left: &Value,
        right: &Value,
        modern: bool,
        depth: usize,
    ) -> Option<Ordering> {
        if modern {
            let rank = |value: &Value| match value {
                Value::Number(_) => 0,
                Value::Text(_) | Value::UninternedText(_) => 1,
                Value::Bool(_) => 2,
                _ => 3,
            };
            let order = rank(left).cmp(&rank(right));
            if !order.is_eq() {
                self.tick(depth)?;
                return Some(order);
            }
        }
        self.lookup_compare(left, right, depth)
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
        self.tick(depth)?;
        crate::commands::spreadsheet::wildcard::matches(pattern, text, whole, true, &mut self.work)
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
                calculate(&rows, &BTreeSet::new(), "Sheet1", 4096).is_none(),
                "{formula}"
            );
            assert!(
                calculate(&rows, &BTreeSet::new(), "Sheet1", 8_000_000).is_some(),
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
        assert!(calculate(&rows, &BTreeSet::new(), "Sheet1", 32_768).is_none());
        assert!(calculate(&rows, &BTreeSet::new(), "Sheet1", 1_000_000).is_some());
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
                &source,
                &sheets,
                &book,
                (0, 0, 0),
                None,
                false,
                None,
                1_000_000,
                false,
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
