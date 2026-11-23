use super::{Calculation, Coord, Dialect, Expr, Value};

impl Calculation<'_> {
    pub(super) fn formula_metadata(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if args.len() != 1 {
            return Some(Value::Error("#N/A"));
        }
        let array = self.array;
        self.array = true;
        let value = self.eval(&args[0], pos, depth + 1, true)?;
        self.array = array;
        let mut coord = match value {
            Value::Single(coord) => coord,
            Value::Range(a, b) | Value::LabelRange(a, b, _) if a == b => a,
            Value::Range(..)
            | Value::LabelRange(..)
            | Value::InvalidReference
            | Value::InvalidRange(..) => {
                return Some(Value::Error("#REF!"));
            }
            Value::Error(error) | Value::LiteralError(error) => return Some(Value::Error(error)),
            Value::Matrix(_) => return Some(Value::FunctionEmpty),
            _ => return Some(Value::Error("#VALUE!")),
        };
        self.work = self.work.checked_sub(self.array_sizes.len())?;
        if let Some((&anchor, _)) =
            self.array_sizes
                .iter()
                .find(|&(&(sheet, row, col), &(h, w))| {
                    coord.0 == sheet
                        && (row..row + h).contains(&coord.1)
                        && (col..col + w).contains(&coord.2)
                })
        {
            coord = anchor;
        }
        let Some(source) = self.formula_sources.get(&coord) else {
            return Some(Value::FunctionEmpty);
        };
        let text = super::super::super::office_ods::formula::expression_text(
            source,
            self.csv,
            &mut self.work,
        )
        .ok()?;
        let Some(mut text) = text else {
            self.failure = Some(super::Failure::Unsupported(
                "formula metadata syntax".into(),
            ));
            return None;
        };
        if name == "EXPRESSION" {
            text.remove(0);
        }
        Some(Value::Text(text))
    }

    pub(super) fn countblank(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        let gnumeric = self.dialect == Dialect::Gnumeric;
        if args.len() != 1 {
            return Some(Value::Error(if gnumeric {
                "#N/A"
            } else if args.is_empty() {
                "Err:511"
            } else {
                "Err:504"
            }));
        }
        let blank = |value: &Value| {
            matches!(
                value,
                Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
            ) || matches!(value, Value::Text(text) | Value::UninternedText(text) if text.is_empty())
        };
        let array = self.array;
        self.array |= gnumeric;
        let value = self.eval(&args[0], pos, depth + 1, true)?;
        self.array = array;
        let mut pending = vec![value];
        let mut count = 0u64;
        while let Some(value) = pending.pop() {
            self.tick(depth)?;
            match value {
                Value::Set(_) if gnumeric => return Some(Value::Error("#VALUE!")),
                Value::Set(values) => pending.extend(values),
                Value::Single(coord) => {
                    count = count.checked_add(u64::from(blank(&self.cell(coord, depth + 1)?)))?;
                }
                Value::Range(a, b) | Value::LabelRange(a, b, _) => {
                    let size = (a.0.abs_diff(b.0) as u64 + 1)
                        .checked_mul(a.1.abs_diff(b.1) as u64 + 1)?
                        .checked_mul(a.2.abs_diff(b.2) as u64 + 1)?;
                    count = count.checked_add(size)?;
                    // Missing cells are blank. Visit only stored cells and formulas,
                    // so whole-column ranges need no dense allocation or traversal.
                    self.work = self.work.checked_sub(
                        self.values
                            .len()
                            .checked_add(self.expressions.len())?
                            .checked_mul(std::mem::size_of::<Coord>())?,
                    )?;
                    let cells: std::collections::BTreeSet<_> = self
                        .values
                        .keys()
                        .chain(self.expressions.keys())
                        .copied()
                        .filter(|c| {
                            (a.0.min(b.0)..=a.0.max(b.0)).contains(&c.0)
                                && (a.1.min(b.1)..=a.1.max(b.1)).contains(&c.1)
                                && (a.2.min(b.2)..=a.2.max(b.2)).contains(&c.2)
                        })
                        .collect();
                    for coord in cells {
                        self.tick(depth)?;
                        if !blank(&self.cell(coord, depth + 1)?) {
                            count = count.checked_sub(1)?;
                        }
                    }
                }
                Value::Matrix(rows) => {
                    for value in rows.iter().flatten() {
                        self.tick(depth)?;
                        count = count.checked_add(u64::from(blank(value)))?;
                    }
                }
                Value::InvalidReference | Value::InvalidRange(..) => {
                    return Some(Value::Error("#REF!"));
                }
                Value::Error(error) => return Some(Value::Error(error)),
                Value::LiteralError(error) if gnumeric => return Some(Value::Error(error)),
                _ => return Some(Value::Error(if gnumeric { "#VALUE!" } else { "Err:504" })),
            }
        }
        Some(Value::Number(count as f64))
    }

    pub(super) fn information(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let gnumeric = self.dialect == Dialect::Gnumeric;
        if args.len() != 1 {
            return Some(Value::Error(if gnumeric && name == "ISREF" {
                if self.csv {
                    "Invalid number of arguments"
                } else {
                    "#\"Invalid number of arguments\""
                }
            } else if gnumeric {
                "#N/A"
            } else if args.is_empty() {
                "Err:511"
            } else {
                "Err:508"
            }));
        }
        let array = self.array;
        self.array |= gnumeric && name == "ISFORMULA";
        let mut value = self.eval(&args[0], pos, depth + 1, !(gnumeric && name == "TYPE"))?;
        self.array = array;
        if gnumeric {
            if name == "ISREF" {
                return Some(Value::Bool(matches!(
                    value,
                    Value::Single(_) | Value::Range(..) | Value::LabelRange(..)
                )));
            }
            if name == "ISFORMULA" {
                let coord = match value {
                    Value::Single(coord) => coord,
                    Value::Range(a, b) | Value::LabelRange(a, b, _) if a == b => a,
                    Value::Range(..)
                    | Value::LabelRange(..)
                    | Value::Matrix(_)
                    | Value::InvalidReference
                    | Value::InvalidRange(..) => return Some(Value::Error("#REF!")),
                    Value::Error(error) | Value::LiteralError(error) => {
                        return Some(Value::Error(error));
                    }
                    _ => return Some(Value::Error("#VALUE!")),
                };
                return Some(Value::Bool(
                    self.formula_sources.contains_key(&coord)
                        || self.expressions.contains_key(&coord)
                        || self.visiting.contains(&coord),
                ));
            }
            if name == "TYPE" {
                match value {
                    Value::Matrix(_) | Value::Set(_) => return Some(Value::Number(64.)),
                    Value::Single(_)
                    | Value::Range(..)
                    | Value::LabelRange(..)
                    | Value::InvalidRange(..) => {
                        return Some(Value::Number(16.));
                    }
                    _ => {}
                }
            }
            if matches!(value, Value::Set(_)) {
                while let Value::Set(values) = value {
                    self.tick(depth)?;
                    value = values.into_iter().next().unwrap_or(Value::Blank);
                }
                value = self.scalar(value, pos, depth + 1)?;
                if matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                ) {
                    value = Value::Number(0.);
                }
            }
        }
        let invalid_range = matches!(value, Value::InvalidRange(..));
        if name != "ISREF" {
            value = self.implicit_invalid_range(&args[0], value, pos)?;
        }
        if let Value::InvalidRange(a, b) = value {
            if matches!(name, "ERROR.TYPE" | "ERRORTYPE") {
                return self.information_value(name, Value::InvalidReference, depth + 1);
            }
            if matches!(name, "TYPE" | "N" | "T" | "ISODD" | "ISEVEN")
                || name == "ISFORMULA" && self.array
            {
                return Some(Value::Error("#REF!"));
            }
            if matches!(name, "ISERROR" | "ISERR" | "ISREF" | "ISNA") {
                return Some(Value::Bool(matches!(name, "ISERROR" | "ISERR")));
            }
            // Failed runtime reference pops reset invalid axes to zero. Predicates
            // such as ISNUMBER inspect that cell and clear the reference error.
            value = Value::Range(
                (a.0, a.1, if a.2 == usize::MAX { 0 } else { a.2 }),
                (b.0, b.1, if b.2 == usize::MAX { 0 } else { b.2 }),
            );
        }
        if !gnumeric
            && matches!(name, "ERROR.TYPE" | "ERRORTYPE")
            && (matches!(value, Value::Matrix(..))
                || self.array && matches!(value, Value::Range(..) | Value::LabelRange(..)))
        {
            return Some(Value::Error("#N/A"));
        }
        if name == "ISREF" {
            return Some(Value::Bool(matches!(
                value,
                Value::Single(_) | Value::Range(..) | Value::LabelRange(..) | Value::Set(_)
            )));
        }
        if name == "ISFORMULA"
            && !matches!(
                value,
                Value::Single(_)
                    | Value::Range(..)
                    | Value::LabelRange(..)
                    | Value::InvalidReference
            )
        {
            return Some(Value::Bool(false));
        }
        if !invalid_range
            && self.array
            && matches!(
                value,
                Value::Matrix(..) | Value::Range(..) | Value::LabelRange(..)
            )
        {
            let (height, width) = super::lookup::dimensions(&value);
            self.work = self.work.checked_sub(
                height
                    .checked_mul(width)?
                    .checked_mul(std::mem::size_of::<Value>())?,
            )?;
            let mut rows = Vec::new();
            for r in 0..height {
                let mut row = Vec::new();
                for c in 0..width {
                    self.tick(depth)?;
                    let item = match &value {
                        Value::Range(a, b) | Value::LabelRange(a, b, _) if a.0 == b.0 => {
                            Value::Single((a.0, a.1.min(b.1) + r, a.2.min(b.2) + c))
                        }
                        Value::Matrix(rows) => {
                            let item = rows.get(r)?.get(c)?;
                            self.charge_value(item)?;
                            item.clone()
                        }
                        _ => Value::Error("#VALUE!"),
                    };
                    row.push(
                        if !gnumeric
                            && name == "ISLOGICAL"
                            && matches!(value, Value::Range(..) | Value::LabelRange(..))
                        {
                            // Matrix references carry numeric values, without cell formats.
                            Value::Bool(false)
                        } else if name == "TYPE" {
                            Value::Number(64.)
                        } else {
                            self.information_value(name, item, depth + 1)?
                        },
                    );
                }
                rows.push(row);
            }
            return Some(Value::Matrix(rows));
        }
        let value = match value {
            Value::Matrix(_) if name == "TYPE" => return Some(Value::Number(64.)),
            Value::Matrix(rows) => rows.into_iter().next()?.into_iter().next()?,
            Value::Range(a, b) | Value::LabelRange(a, b, _) => {
                let (first, last) = ((a.1.min(b.1), a.2.min(b.2)), (a.1.max(b.1), a.2.max(b.2)));
                let value = if a.0 != b.0 {
                    Value::Error("#VALUE!")
                } else if first == last {
                    Value::Single((a.0, first.0, first.1))
                } else if first.0 == last.0 && (first.1..=last.1).contains(&pos.2) {
                    Value::Single((a.0, first.0, pos.2))
                } else if first.1 == last.1 && (first.0..=last.0).contains(&pos.1) {
                    Value::Single((a.0, pos.1, first.1))
                } else {
                    Value::Error("#VALUE!")
                };
                if name == "TYPE" && matches!(value, Value::Error(_)) {
                    return Some(value);
                }
                value
            }
            value => value,
        };
        self.information_value(name, value, depth + 1)
    }

    fn information_value(&mut self, name: &str, mut value: Value, depth: usize) -> Option<Value> {
        self.tick(depth)?;
        let gnumeric = self.dialect == Dialect::Gnumeric;
        if gnumeric && matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
            value = Value::Error("#REF!");
        }
        if name == "ISLOGICAL" && matches!(value, Value::InvalidReference) {
            return Some(Value::Bool(false));
        }
        if name == "TYPE" && matches!(value, Value::InvalidReference) {
            return Some(Value::Error("#REF!"));
        }
        if matches!(value, Value::InvalidReference)
            && !matches!(
                name,
                "ISERROR" | "ISERR" | "N" | "T" | "ISODD" | "ISEVEN" | "ERROR.TYPE" | "ERRORTYPE"
            )
        {
            // Calc's single-reference pop leaves the default A1 address on failure.
            value = Value::Single((0, 0, 0));
        }
        let mut formula = false;
        let mut logical = None;
        if let Value::Single(coord) = value {
            formula = self.formula_sources.contains_key(&coord)
                || self.expressions.contains_key(&coord)
                || self.visiting.contains(&coord);
            if name == "ISFORMULA" {
                return Some(Value::Bool(formula));
            }
            value = self.cell(coord, depth + 1)?;
            if !gnumeric && name == "TYPE" && formula && !matches!(value, Value::Error(_)) {
                return Some(Value::Number(8.));
            }
            if matches!(name, "TYPE" | "ISLOGICAL") && matches!(value, Value::Number(_)) {
                logical = self.array_sizes.contains_key(&coord).then_some(false);
                if let Some(format) = self.formats.get(&coord) {
                    self.work = self.work.checked_sub(format.pattern.len())?;
                    logical = Some(super::super::number_format::logical(format.pattern));
                }
            }
            if (!gnumeric || !self.results.contains_key(&coord))
                && matches!(
                    self.results.get(&coord).or_else(|| self.values.get(&coord)),
                    Some(Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty)
                )
            {
                value = Value::Empty;
            }
        }
        if gnumeric && matches!(name, "N" | "T" | "ISODD" | "ISEVEN") {
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            return Some(match name {
                "T" => match value {
                    Value::Text(_) | Value::UninternedText(_) => value,
                    _ => Value::FunctionEmpty,
                },
                "N" => match value {
                    Value::Number(_) => value,
                    Value::Bool(b) => Value::Number(f64::from(b)),
                    Value::Text(ref text) | Value::UninternedText(ref text) => {
                        if text.eq_ignore_ascii_case("true") || text.eq_ignore_ascii_case("false") {
                            Value::Bool(text.eq_ignore_ascii_case("true"))
                        } else {
                            Value::Number(
                                super::lookup::number::parse_production(text, self.book.date1904)
                                    .unwrap_or(0.),
                            )
                        }
                    }
                    _ => Value::Error("#NUM!"),
                },
                "ISODD" => {
                    let n = match &value {
                        Value::Text(text) | Value::UninternedText(text) => {
                            let text =
                                text.trim_start_matches([' ', '\t', '\n', '\r', '\x0b', '\x0c']);
                            if text.starts_with([
                                '+', '-', '.', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
                            ]) {
                                super::super::super::parse_float_prefix(text)
                            } else {
                                0.
                            }
                        }
                        _ => value.numeric().unwrap_or(0.),
                    };
                    Value::Bool(n.abs() % 2. >= 1.)
                }
                "ISEVEN" => {
                    let n = match &value {
                        Value::Text(text) | Value::UninternedText(text) => {
                            super::lookup::number::parse_production(text, self.book.date1904)
                        }
                        _ => value.numeric(),
                    };
                    n.map_or(Value::Error("#VALUE!"), |n| Value::Bool(n.abs() % 2. < 1.))
                }
                _ => unreachable!(),
            });
        }
        Some(if matches!(name, "ERROR.TYPE" | "ERRORTYPE") {
            let error = match value {
                Value::Error(e) | Value::LiteralError(e) => e,
                Value::InvalidReference => "#REF!",
                Value::Set(_) => "#VALUE!",
                _ => return Some(Value::Error("#N/A")),
            };
            let codes = match error {
                "#NULL!" => Some((1., 521.)),
                "#DIV/0!" => Some((2., 532.)),
                "#VALUE!" => Some((3., 519.)),
                "#REF!" => Some((4., 524.)),
                "#NAME?" => Some((5., 525.)),
                "#NUM!" => Some((6., 503.)),
                "#N/A" => Some((7., 32767.)),
                _ => None,
            };
            let number = if name == "ERROR.TYPE" {
                codes.map(|(standard, _)| standard)
            } else {
                codes
                    .map(|(_, raw)| raw)
                    .or_else(|| error.strip_prefix("Err:")?.parse().ok())
            };
            number.map_or(Value::Error("#N/A"), Value::Number)
        } else if matches!(name, "N" | "T" | "ISODD" | "ISEVEN") {
            match value {
                Value::Error(_) => value,
                Value::InvalidReference => Value::Error("#REF!"),
                Value::Set(_) if self.array => Value::Error("#REF!"),
                Value::LiteralError(error) if name == "N" => Value::Error(error),
                Value::LiteralError(_) | Value::Set(_) => {
                    Value::Error(if name == "T" { "Err:517" } else { "Err:504" })
                }
                Value::Text(_) | Value::UninternedText(_) if name == "T" => value,
                _ if name == "T" => Value::Text(String::new()),
                Value::Blank
                | Value::Empty
                | Value::FunctionEmpty
                | Value::MatrixEmpty
                | Value::Text(_)
                | Value::UninternedText(_)
                    if name == "N" =>
                {
                    Value::Number(0.)
                }
                Value::Number(_) | Value::Bool(_) => {
                    let n = value.numeric()?;
                    if name == "N" {
                        Value::Number(n)
                    } else {
                        let mut n = n.abs();
                        // Calc rounds to 15 significant digits unless the binary
                        // fraction already fits in eleven bits.
                        if n > 0. && n <= 2199023255552. && (n * 2048.).fract() != 0. {
                            let scale = 10f64.powi(14 - n.log10().floor() as i32);
                            let scaled = n * scale;
                            if scaled.is_finite() {
                                n = scaled.round() / scale;
                            }
                        }
                        Value::Bool((n.floor() % 2. < 0.5) == (name == "ISEVEN"))
                    }
                }
                _ => Value::Error("Err:504"),
            }
        } else if name == "TYPE" {
            Value::Number(match value {
                Value::Bool(_) => 4.,
                Value::Number(_) if logical == Some(true) => 4.,
                Value::Blank
                | Value::Empty
                | Value::FunctionEmpty
                | Value::MatrixEmpty
                | Value::Number(_) => 1.,
                Value::Text(_) | Value::UninternedText(_) => 2.,
                Value::Matrix(_) => 64.,
                Value::Set(_) if !self.array => 1.,
                _ => 16.,
            })
        } else {
            Value::Bool(match name {
                "ISBLANK" => {
                    (gnumeric || !formula)
                        && matches!(
                            value,
                            Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                        )
                }
                "ISNUMBER" => {
                    matches!(value, Value::Number(_))
                        || !gnumeric && matches!(value, Value::Bool(_))
                }
                "ISTEXT" => matches!(value, Value::Text(_) | Value::UninternedText(_)),
                "ISNONTEXT" => !matches!(value, Value::Text(_) | Value::UninternedText(_)),
                "ISNA" => matches!(value, Value::Error("#N/A") | Value::LiteralError("#N/A")),
                "ISERR" => {
                    matches!(value, Value::InvalidReference)
                        || self.array && matches!(value, Value::Set(_))
                        || matches!(value, Value::Error(e) | Value::LiteralError(e) if e != "#N/A")
                }
                "ISLOGICAL" => logical.unwrap_or(matches!(value, Value::Bool(_))),
                "ISFORMULA" => false,
                "ISERROR" => {
                    matches!(
                        value,
                        Value::Error(_) | Value::LiteralError(_) | Value::InvalidReference
                    ) || self.array && matches!(value, Value::Set(_))
                }
                _ => unreachable!(),
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::super::{Workbook, parse};
    use super::*;

    #[test]
    fn elementwise_arrays_charge_the_complete_output_before_allocation() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".into()];
        for source in [
            "=ISNUMBER(A1:AF32)",
            "=ISERROR(A1:AF32)",
            "=TYPE(A1:AF32)",
            "=ISERR(A1:AF32)",
            "=ISNA(A1:AF32)",
            "=ISNONTEXT(A1:AF32)",
            "=ISFORMULA(A1:AF32)",
            "=ISLOGICAL(A1:AF32)",
            "=N(A1:AF32)",
            "=T(A1:AF32)",
            "=ISODD(A1:AF32)",
            "=ISEVEN(A1:AF32)",
            "=YEAR(A1:AF32)",
            "=MONTH(A1:AF32)",
            "=DAY(A1:AF32)",
            "=HOUR(A1:AF32)",
            "=MINUTE(A1:AF32)",
            "=SECOND(A1:AF32)",
            "=WEEKDAY(A1:AF32)",
            "=WEEKNUM(A1:AF32)",
            "=ISOWEEKNUM(A1:AF32)",
            "=DATE(A1:AF32,1,1)",
            "=TIME(A1:AF32,0,0)",
            "=_xlfn.DAYS(A1:AF32,0)",
            "=EDATE(A1:AF32,1)",
            "=EOMONTH(A1:AF32,1)",
        ] {
            let expression = parse(
                Dialect::LibreOffice,
                source,
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
                        panic!("{source}")
                    };
                    assert_eq!(rows.len(), 32);
                    assert!(rows.iter().all(|row| row.len() == 32));
                }
            }
        }
    }

    #[test]
    fn repeated_logical_format_queries_consume_the_calculation_budget() {
        let book = Workbook::default();
        let sheets = vec!["Sheet1".into()];
        let format = format!("[$-{}409]BOOLEAN", "0".repeat(1024));
        for source in ["=ISLOGICAL(A1)", "=TYPE(A1)"] {
            let expression = parse(
                Dialect::LibreOffice,
                source,
                &sheets,
                &book,
                (0, 0, 1),
                None,
                false,
                None,
                65536,
            )
            .unwrap()
            .unwrap();
            let mut calc = Calculation::new(&book, &sheets, vec![(1024, 1024)], 16384);
            calc.values.insert((0, 0, 0), Value::Number(1.));
            calc.formats.insert(
                (0, 0, 0),
                super::super::Format {
                    pattern: &format,
                    kind: super::super::FormatKind::Number,
                },
            );
            assert!(calc.eval(&expression, (0, 0, 1), 0, true).is_some());
            assert!(
                (0..32).any(|_| calc.eval(&expression, (0, 0, 1), 0, true).is_none()),
                "{source}"
            );
        }
    }
}
