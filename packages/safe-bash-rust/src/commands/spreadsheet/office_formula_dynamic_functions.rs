// SEQUENCE, FILTER, SORT and SORTBY follow IronCalc's sequence.rs and spill_functions.rs,
// MIT, LICENSE.IronCalc, f93662006b8fb1c401dc870bbda26c5d60ac6037.
use super::{Calculation, Coord, Expr, Value};

impl Calculation<'_> {
    // Reuse one bounded entropy batch across RAND, RANDBETWEEN and RANDARRAY
    // calls within a calculation. Allocate only when a random draw is needed.
    pub(super) fn random_value(&mut self, min: f64, max: f64, whole: bool) -> Option<Value> {
        if min == max {
            return Some(Value::Number(min));
        }
        self.work = self.work.checked_sub(8)?;
        if self.random_bytes.is_empty() {
            if self.random_bytes.capacity() == 0 {
                self.work = self.work.checked_sub(4096)?;
            }
            self.random_bytes.resize(4096, 0);
            if crate::vfs::memory::fill_random(&mut self.random_bytes).is_err() {
                self.random_bytes.clear();
                return Some(Value::Error("#CALC!"));
            }
        }
        let offset = self.random_bytes.len().checked_sub(8)?;
        let bits = u64::from_le_bytes(self.random_bytes[offset..].try_into().ok()?);
        self.random_bytes.truncate(offset);
        let unit = (bits >> 11) as f64 / 9_007_199_254_740_992.;
        let span = max - min + f64::from(whole);
        let n = if span.is_finite() {
            let delta = unit * span;
            min + if whole { delta.floor() } else { delta }
        } else {
            // Finite opposite-sign bounds can have an infinite difference.
            min * (1. - unit) + max * unit
        };
        let n = if whole { n.floor() } else { n };
        Some(Value::Number(n.clamp(min, max)))
    }

    // Univer 4767b3b math/randbetween (Apache-2.0, LICENSE.Univer).
    pub(super) fn random_between(&mut self, args: [&Value; 2]) -> Option<Value> {
        for value in args {
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Some(Value::Error(e));
            }
        }
        let mut bounds = [0.; 2];
        for (i, value) in args.iter().enumerate() {
            bounds[i] = match value {
                Value::Bool(_) => return Some(Value::Error("#VALUE!")),
                Value::Text(s) | Value::UninternedText(s) => s.trim().parse().ok(),
                _ => value.numeric(),
            }
            .unwrap_or(f64::NAN);
            if bounds[i].is_nan() {
                return Some(Value::Error("#VALUE!"));
            }
        }
        let [min, max] = bounds;
        let (min, max) = (min.ceil(), max.floor());
        // Validate after rounding too: (1.1, 1.9) contains no integer.
        if !min.is_finite() || !max.is_finite() || min > max {
            return Some(Value::Error("#NUM!"));
        }
        self.random_value(min, max, true)
    }

    // IronCalc random.rs supplies the shape/default/error behavior. Use Poe
    // Code's host entropy in bounded batches; no JS calculation or RNG state.
    pub(super) fn random_array(
        &mut self,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() > 5 {
            return Some(Value::Error("#ERROR!"));
        }
        let mut numbers = [1., 1., 0., 1.];
        let mut whole = false;
        for (i, arg) in args.iter().enumerate() {
            if matches!(arg, Expr::Value(Value::Blank)) {
                continue;
            }
            let value = self.eval(arg, pos, depth + 1, true)?;
            let value = self.scalar(value, pos, depth + 1)?;
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Some(Value::Error(e));
            }
            if i == 4 {
                let Some(flag) = super::lookup::boolean(&value) else {
                    return Some(Value::Error("#VALUE!"));
                };
                whole = flag;
            } else {
                let Some(n) = value.numeric() else {
                    return Some(Value::Error("#VALUE!"));
                };
                if !n.is_finite() {
                    return Some(Value::Error("#NUM!"));
                }
                numbers[i] = n;
            }
        }
        let [rows, columns, min, max] = numbers;
        let (rows, columns) = (rows.floor(), columns.floor());
        if rows < 0. || columns < 0. || rows > 1_048_576. || columns > 16_384. {
            return Some(Value::Error("#VALUE!"));
        }
        if rows == 0. || columns == 0. {
            return Some(Value::Error("#CALC!"));
        }
        let (rows, columns) = (rows as usize, columns as usize);
        let size = rows.checked_mul(columns)?;
        if size > 1_000_000 {
            return Some(Value::Error("#ERROR!"));
        }
        // Excel requires integral bounds in whole-number mode. Flooring a
        // fractional minimum can otherwise return values outside the interval.
        if min > max || whole && (min.fract() != 0. || max.fract() != 0.) {
            return Some(Value::Error("#VALUE!"));
        }
        self.work = self.work.checked_sub(
            size.checked_mul(std::mem::size_of::<Value>())?
                .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut result = Vec::with_capacity(rows);
        for _ in 0..rows {
            let mut row = Vec::with_capacity(columns);
            for _ in 0..columns {
                self.tick(depth)?;
                let value = self.random_value(min, max, whole)?;
                if matches!(value, Value::Error(_)) {
                    return Some(value);
                }
                row.push(value);
            }
            result.push(row);
        }
        Some(Value::Matrix(result))
    }

    pub(super) fn sort_dynamic(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let by = name == "SORTBY";
        if if by {
            args.len() < 2 || args.len() > 3 && args.len() % 2 == 0
        } else {
            args.is_empty() || args.len() > 4
        } {
            return Some(Value::Error("#ERROR!"));
        }
        let value = self.eval(&args[0], pos, depth + 1, true)?;
        if let Value::Error(e) | Value::LiteralError(e) = value {
            return Some(Value::Error(e));
        }
        let mut rows = self.matrix(value, depth + 1)?;
        let mut columns = false;
        let mut index = 0usize;
        let mut directions = Vec::new();
        let mut external = Vec::new();
        if by {
            for i in (1..args.len()).step_by(2) {
                let value = self.eval(&args[i], pos, depth + 1, true)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let (h, w) = super::lookup::dimensions(&value);
                // Horizontal keys sort columns; row vectors matching the row
                // count retain IronCalc's accepted row-key spelling.
                if i == 1
                    && h == 1
                    && w == rows.first().map_or(0, Vec::len)
                    && (rows.len() == 1 || w != rows.len())
                {
                    rows = self.transpose(rows, depth + 1)?;
                    columns = true;
                }
                if h != rows.len() && !(h == 1 && w == rows.len()) {
                    return Some(Value::Error("#VALUE!"));
                }
                let mut keys = self.matrix(value, depth + 1)?;
                let keys = if keys.len() == 1 && keys[0].len() == rows.len() {
                    keys.pop()?
                } else {
                    keys.into_iter()
                        .map(|row| row.into_iter().next())
                        .collect::<Option<Vec<_>>>()?
                };
                let mut ascending = true;
                if let Some(arg) = args
                    .get(i + 1)
                    .filter(|arg| !matches!(arg, Expr::Value(Value::Blank)))
                {
                    let value = self.eval(arg, pos, depth + 1, true)?;
                    let value = self.scalar(value, pos, depth + 1)?;
                    if let Value::Error(e) | Value::LiteralError(e) = value {
                        return Some(Value::Error(e));
                    }
                    if matches!(&value,Value::Text(s) | Value::UninternedText(s) if s.is_empty()) {
                        return Some(Value::Error("#VALUE!"));
                    }
                    ascending = match value.numeric().map(f64::trunc) {
                        Some(1.) => true,
                        Some(-1.) => false,
                        _ => return Some(Value::Error("#VALUE!")),
                    };
                }
                self.work = self.work.checked_sub(64)?;
                external.push(keys);
                directions.push(ascending);
            }
        } else {
            let (mut column, mut order) = (1., 1.);
            for (i, arg) in args.iter().enumerate().skip(1) {
                if matches!(arg, Expr::Value(Value::Blank)) {
                    continue;
                }
                let value = self.eval(arg, pos, depth + 1, true)?;
                let value = self.scalar(value, pos, depth + 1)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                if i == 3 {
                    let Some(b) = super::lookup::boolean(&value) else {
                        return Some(Value::Error("#VALUE!"));
                    };
                    columns = b;
                } else {
                    if matches!(&value,Value::Text(s) | Value::UninternedText(s) if s.is_empty()) {
                        return Some(Value::Error("#VALUE!"));
                    }
                    let Some(n) = value.numeric().filter(|n| n.is_finite()) else {
                        return Some(Value::Error("#VALUE!"));
                    };
                    if i == 1 {
                        column = n.trunc();
                    } else {
                        order = n.trunc();
                    }
                }
            }
            if columns {
                rows = self.transpose(rows, depth + 1)?;
            }
            if column < 1.
                || column > rows.first().map_or(0, Vec::len) as f64
                || !matches!(order, 1. | -1.)
            {
                return Some(Value::Error("#VALUE!"));
            }
            index = column as usize - 1;
            directions.push(order == 1.);
        }
        let count = rows.len();
        self.work = self.work.checked_sub(
            count
                .checked_mul(directions.len())?
                .checked_mul(128 + (count.max(1).ilog2() as usize + 1) * 2)?,
        )?;
        let sources: Vec<Vec<&Value>> = if by {
            external.iter().map(|key| key.iter().collect()).collect()
        } else {
            vec![rows.iter().map(|row| &row[index]).collect()]
        };
        let mut text_keys = Vec::new();
        for values in &sources {
            let mut keys = Vec::with_capacity(count);
            for value in values {
                keys.push(match value {
                    Value::Text(s) | Value::UninternedText(s) => {
                        Some(super::super::collation::key(s, false, &mut self.work)?)
                    }
                    _ => None,
                });
            }
            text_keys.push(keys);
        }
        let rank = |value: &Value| match value {
            Value::Number(_) => 0,
            Value::Text(_) | Value::UninternedText(_) => 1,
            Value::Bool(_) => 2,
            Value::Error(_) | Value::LiteralError(_) => 3,
            _ => 4,
        };
        let mut order: Vec<_> = (0..count).collect();
        order.sort_by(|&left, &right| {
            for ((values, keys), ascending) in sources.iter().zip(&text_keys).zip(&directions) {
                let (a, b) = (values[left], values[right]);
                let (ar, br) = (rank(a), rank(b));
                let compared = ar.cmp(&br).then_with(|| match (a, b) {
                    (Value::Number(a), Value::Number(b)) => {
                        a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal)
                    }
                    (Value::Bool(a), Value::Bool(b)) => a.cmp(b),
                    (
                        Value::Error(a) | Value::LiteralError(a),
                        Value::Error(b) | Value::LiteralError(b),
                    ) => {
                        // Excel orders error values by code; text labels use collation.
                        let code = |error: &str| match error {
                            "#NULL!" => 1,
                            "#DIV/0!" => 2,
                            "#VALUE!" => 3,
                            "#REF!" => 4,
                            "#NAME?" => 5,
                            "#NUM!" => 6,
                            "#N/A" => 7,
                            "#GETTING_DATA" => 8,
                            "#SPILL!" => 9,
                            "#CALC!" => 14,
                            _ => 255,
                        };
                        code(a).cmp(&code(b))
                    }
                    (
                        Value::Text(_) | Value::UninternedText(_),
                        Value::Text(_) | Value::UninternedText(_),
                    ) => keys[left].cmp(&keys[right]),
                    _ => std::cmp::Ordering::Equal,
                });
                let compared = if !ascending && ar != 4 && br != 4 {
                    compared.reverse()
                } else {
                    compared
                };
                if !compared.is_eq() {
                    return compared;
                }
            }
            std::cmp::Ordering::Equal
        });
        drop(sources);
        // The permutation moves complete records; no cell strings are cloned.
        let rows = order
            .into_iter()
            .map(|i| std::mem::take(&mut rows[i]))
            .collect();
        Some(Value::Matrix(if columns {
            self.transpose(rows, depth + 1)?
        } else {
            rows
        }))
    }

    pub(super) fn dynamic_function(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if name == "ANCHORARRAY" {
            if args.len() != 1 {
                return Some(Value::Error("#VALUE!"));
            }
            let reference = self.eval(&args[0], pos, depth + 1, true)?;
            return self.spill_reference(reference, depth + 1);
        }
        if name == "SEQUENCE" {
            if args.is_empty() || args.len() > 4 {
                return Some(Value::Error("#ERROR!"));
            }
            let mut numbers = [1.; 4];
            for (i, arg) in args.iter().enumerate() {
                let value = self.eval(arg, pos, depth + 1, true)?;
                if matches!(value, Value::Blank) {
                    continue;
                }
                let value = self.scalar(value, pos, depth + 1)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    return Some(Value::Error(e));
                }
                let Some(number) = value.numeric() else {
                    return Some(Value::Error("#VALUE!"));
                };
                if !number.is_finite() {
                    return Some(Value::Error("#NUM!"));
                }
                numbers[i] = number;
            }
            let [rows, columns, start, step] = numbers;
            let (rows, columns) = (rows.floor(), columns.floor());
            if rows < 0. || columns < 0. || rows > 1_048_576. || columns > 16_384. {
                return Some(Value::Error("#VALUE!"));
            }
            if rows == 0. || columns == 0. {
                return Some(Value::Error("#CALC!"));
            }
            let (rows, columns) = (rows as usize, columns as usize);
            let size = rows.checked_mul(columns)?;
            if size > 1_000_000 {
                return Some(Value::Error("#ERROR!"));
            }
            self.work = self.work.checked_sub(
                size.checked_mul(std::mem::size_of::<Value>())?
                    .checked_add(rows.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
            )?;
            let mut result = Vec::with_capacity(rows);
            for r in 0..rows {
                let mut row = Vec::with_capacity(columns);
                for c in 0..columns {
                    self.tick(depth)?;
                    let n = start + (r * columns + c) as f64 * step;
                    row.push(if n.is_finite() {
                        Value::Number(n)
                    } else {
                        Value::Error("#NUM!")
                    });
                }
                result.push(row);
            }
            return Some(Value::Matrix(result));
        }
        self.filter(args, pos, depth)
    }

    pub(super) fn spill_reference(&mut self, reference: Value, depth: usize) -> Option<Value> {
        let coord = match reference {
            Value::Single(coord) => coord,
            Value::Range(a, b) if a == b => a,
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            _ => return Some(Value::Error("#REF!")),
        };
        self.cell(coord, depth + 1)?;
        Some(
            if let Some([w, h]) = self.dynamic.as_ref().and_then(|s| s.ranges.get(&coord)) {
                Value::Range(coord, (coord.0, coord.1 + h - 1, coord.2 + w - 1))
            } else {
                Value::Error("#REF!")
            },
        )
    }
}

#[cfg(test)]
mod random_tests {
    // All seven groups from Univer 4767b3b math/{rand,randbetween}/__tests__
    // (Apache-2.0, LICENSE.Univer). Values and assertions are unchanged.
    // The 0.5 random mock is supplied through the calculation's entropy buffer.
    use super::{Calculation, Value};
    fn case(bottom: Value, top: Value, expected: Value) {
        let book = super::super::Workbook::default();
        let mut c = Calculation::new(&book, &[], Vec::new(), 100_000);
        c.random_bytes = (1u64 << 63).to_le_bytes().to_vec();
        assert_eq!(c.random_between([&bottom, &top]), Some(expected));
    }
    #[test]
    fn univer_rand_normal() {
        let book = super::super::Workbook::default();
        let mut c = Calculation::new(&book, &[], Vec::new(), 100_000);
        c.random_bytes = (1u64 << 63).to_le_bytes().to_vec();
        assert_eq!(c.random_value(0., 1., false), Some(Value::Number(0.5)));
    }
    #[test]
    fn univer_randbetween_normal() {
        case(Value::Number(1.), Value::Number(100.), Value::Number(51.));
    }
    #[test]
    fn univer_randbetween_bottom_above_top() {
        case(Value::Number(3.), Value::Number(1.), Value::Error("#NUM!"));
    }
    #[test]
    fn univer_randbetween_text() {
        case(
            Value::Text("test".into()),
            Value::Number(3.),
            Value::Error("#VALUE!"),
        );
    }
    #[test]
    fn univer_randbetween_boolean() {
        case(
            Value::Bool(true),
            Value::Number(3.),
            Value::Error("#VALUE!"),
        );
    }
    #[test]
    fn univer_randbetween_blank() {
        case(Value::Blank, Value::Number(3.), Value::Number(2.));
    }
    #[test]
    fn univer_randbetween_array() {
        case(
            Value::Matrix(vec![vec![
                Value::Number(1.),
                Value::Number(2.),
                Value::Number(3.),
            ]]),
            Value::Number(3.),
            Value::Error("#VALUE!"),
        );
    }
}
