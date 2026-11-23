use super::{Calculation, Coord, Expr, Value};

impl Calculation<'_> {
    // CELL consumes a reference, not its value. In particular ADDRESS/ROW/COL
    // must neither evaluate errors nor create cycles when inspecting themselves.
    pub(super) fn cell_info(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if !(1..=2).contains(&args.len()) {
            return Some(Value::Error("#ERROR!"));
        }
        let info = self.eval(&args[0], pos, depth + 1, true)?;
        let mut selectors = self.matrix(info, depth + 1)?;
        let reference = if args.len() == 2 {
            self.eval(&args[1], pos, depth + 1, true)?
        } else {
            Value::Single(pos)
        };
        for row in &mut selectors {
            for selector in row {
                self.tick(depth)?;
                if matches!(selector, Value::Error(_) | Value::LiteralError(_)) {
                    continue;
                }
                let coord = match &reference {
                    Value::Single(coord) => *coord,
                    Value::Range(a, b) if a.0 == b.0 => (a.0, a.1.min(b.1), a.2.min(b.2)),
                    Value::InvalidReference | Value::InvalidRange(..) => {
                        *selector = Value::Error("#REF!");
                        continue;
                    }
                    Value::Error(error) | Value::LiteralError(error) => {
                        *selector = Value::Error(error);
                        continue;
                    }
                    _ => {
                        *selector = Value::Error("#N/A");
                        continue;
                    }
                };
                let name = match selector {
                    Value::Text(text) | Value::UninternedText(text) => {
                        self.work = self.work.checked_sub(text.len())?;
                        text.to_ascii_lowercase()
                    }
                    _ => String::new(),
                };
                *selector = match name.as_str() {
                    "address" => {
                        let sheet = if coord.0 == pos.0 {
                            None
                        } else {
                            Some(self.sheets.get(coord.0)?.as_str())
                        };
                        self.work = self
                            .work
                            .checked_sub(32 + sheet.map_or(0, |s| s.len().saturating_mul(2)))?;
                        Value::Text(
                            super::Reference::table(coord.0, coord.1, coord.2, false)
                                .table_a1(0, sheet),
                        )
                    }
                    "row" => Value::Number((coord.1 + 1) as f64),
                    "col" => Value::Number((coord.2 + 1) as f64),
                    "contents" => match self.cell(coord, depth + 1)? {
                        Value::Blank | Value::Empty => Value::Number(0.),
                        value => value,
                    },
                    "type" => Value::Text(
                        match self.cell(coord, depth + 1)? {
                            Value::Blank | Value::Empty => "b",
                            Value::Text(_) | Value::UninternedText(_) => "l",
                            _ => "v",
                        }
                        .into(),
                    ),
                    _ => Value::Error("#VALUE!"),
                };
            }
        }
        if selectors.len() == 1 && selectors[0].len() == 1 {
            selectors.pop()?.pop()
        } else {
            Some(Value::Matrix(selectors))
        }
    }

    // Reference arrays follow IronCalc lookup_and_reference::fn_formulatext
    // and Univer's Formulatext. Read source only: evaluation would invent cycles.
    pub(super) fn formulatext(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.len() != 1 {
            return Some(Value::Error("#ERROR!"));
        }
        let value = self.eval(&args[0], pos, depth + 1, true)?;
        let (a, b) = match value {
            Value::Single(coord) => return self.formula_text_cell(coord, depth + 1),
            Value::Range(a, b) if a.0 == b.0 => (a, b),
            Value::InvalidReference | Value::InvalidRange(..) => {
                return Some(Value::Error("#REF!"));
            }
            Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
            _ => return Some(Value::Error("#VALUE!")),
        };
        let (height, width) = (a.1.abs_diff(b.1) + 1, a.2.abs_diff(b.2) + 1);
        if height == 1 && width == 1 {
            return self.formula_text_cell(a, depth + 1);
        }
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?
                .checked_add(height.checked_mul(std::mem::size_of::<Vec<Value>>())?)?,
        )?;
        let mut rows = Vec::with_capacity(height);
        for r in 0..height {
            let mut row = Vec::with_capacity(width);
            for c in 0..width {
                row.push(
                    self.formula_text_cell((a.0, a.1.min(b.1) + r, a.2.min(b.2) + c), depth + 1)?,
                );
            }
            rows.push(row);
        }
        Some(Value::Matrix(rows))
    }

    fn formula_text_cell(&mut self, coord: Coord, depth: usize) -> Option<Value> {
        self.tick(depth)?;
        let Some(&source) = self.formula_sources.get(&coord) else {
            return Some(Value::Error("#N/A"));
        };
        let source = source.trim_start_matches('=');
        // Excel limits the displayed formula, including its leading equals sign,
        // to 8,192 UTF-16 units. Check before allocating the returned text.
        self.work = self.work.checked_sub(source.len().min(8192 * 4))?;
        if source.encode_utf16().take(8192).count() > 8191 {
            return Some(Value::Error("#N/A"));
        }
        let size = source.len().checked_add(1)?;
        self.work = self.work.checked_sub(size)?;
        let mut text = String::with_capacity(size);
        text.push('=');
        text.push_str(source);
        Some(Value::Text(text))
    }

    pub(super) fn countblank(&mut self, args: &[Expr], pos: Coord, depth: usize) -> Option<Value> {
        if args.len() != 1 {
            return Some(Value::Error(if args.is_empty() {
                "Err:511"
            } else {
                "Err:504"
            }));
        }
        let blank = |value: &Value| {
            matches!(value, Value::Blank | Value::Empty)
                || matches!(value, Value::Text(text) | Value::UninternedText(text) if text.is_empty())
        };
        let mut pending = vec![self.eval(&args[0], pos, depth + 1, true)?];
        let mut count = 0u64;
        while let Some(value) = pending.pop() {
            self.tick(depth)?;
            match value {
                Value::Set(values) => pending.extend(values),
                Value::Single(coord) => {
                    count = count.checked_add(u64::from(blank(&self.cell(coord, depth + 1)?)))?;
                }
                Value::Range(a, b) => {
                    self.read_spill_range(a, b)?;
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
                _ => return Some(Value::Error("Err:504")),
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
        if args.len() != 1 {
            return Some(Value::Error(if args.is_empty() {
                "Err:511"
            } else {
                "Err:508"
            }));
        }
        let mut value = self.eval(&args[0], pos, depth + 1, true)?;
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
        if matches!(name, "ERROR.TYPE" | "ERRORTYPE")
            && (self.dynamic.is_none() || name == "ERRORTYPE")
            && (matches!(value, Value::Matrix(..))
                || self.array && matches!(value, Value::Range(..)))
        {
            return Some(Value::Error("#N/A"));
        }
        if name == "ISREF" {
            return Some(Value::Bool(matches!(
                value,
                Value::Single(_) | Value::Range(..) | Value::Set(_)
            )));
        }
        if name == "ISFORMULA"
            && !matches!(
                value,
                Value::Single(_) | Value::Range(..) | Value::InvalidReference
            )
        {
            return Some(if self.dynamic.is_some() {
                Value::Error("#VALUE!")
            } else {
                Value::Bool(false)
            });
        }
        // Editable workbooks classify the array itself; TYPE must not spill.
        if self.dynamic.is_some()
            && name == "TYPE"
            && matches!(value, Value::Matrix(_) | Value::Range(..))
        {
            return Some(Value::Number(64.));
        }
        if !invalid_range
            && (matches!(value, Value::Matrix(..))
                || self.array && matches!(value, Value::Range(..)))
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
                        Value::Range(a, b) if a.0 == b.0 => {
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
                        if self.dynamic.is_none()
                            && name == "ISLOGICAL"
                            && matches!(value, Value::Range(..))
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
            Value::Range(a, b) => {
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
            if self.dynamic.is_none()
                && name == "TYPE"
                && formula
                && !matches!(value, Value::Error(_))
            {
                return Some(Value::Number(8.));
            }
            if self.dynamic.is_none()
                && matches!(name, "TYPE" | "ISLOGICAL")
                && matches!(value, Value::Number(_) | Value::Bool(_))
            {
                logical = self.array_sizes.contains_key(&coord).then_some(false);
                if let Some(format) = self.formats.get(&coord) {
                    self.work = self.work.checked_sub(format.pattern.len())?;
                    logical = Some(super::super::number_format::logical(format.pattern));
                }
            }
            if matches!(
                self.results.get(&coord).or_else(|| self.values.get(&coord)),
                Some(Value::Blank | Value::Empty)
            ) {
                value = Value::Empty;
            }
        }
        Some(if matches!(name, "ERROR.TYPE" | "ERRORTYPE") {
            let error = match value {
                Value::Error(e) | Value::LiteralError(e) => e,
                Value::InvalidReference => "#REF!",
                Value::Set(_) => "#VALUE!",
                _ => return Some(Value::Error("#N/A")),
            };
            // Modern Excel errors have no corresponding Calc ERRORTYPE code.
            if name == "ERROR.TYPE" {
                let modern = match error {
                    "#GETTING_DATA" => Some(8.),
                    "#SPILL!" => Some(9.),
                    "#CALC!" => Some(14.),
                    _ => None,
                };
                if let Some(code) = modern {
                    return Some(Value::Number(code));
                }
            }
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
                Value::Blank | Value::Empty | Value::Text(_) | Value::UninternedText(_)
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
                Value::Bool(_) if self.dynamic.is_some() => 4.,
                Value::Number(_) | Value::Bool(_) if logical == Some(true) => 4.,
                Value::Blank | Value::Empty | Value::Number(_) | Value::Bool(_) => 1.,
                Value::Text(_) | Value::UninternedText(_) => 2.,
                Value::Matrix(_) => 64.,
                Value::Set(_) if !self.array => 1.,
                _ => 16.,
            })
        } else {
            Value::Bool(match name {
                "ISBLANK" => !formula && matches!(value, Value::Blank | Value::Empty),
                "ISNUMBER" => {
                    matches!(value, Value::Number(_))
                        || self.dynamic.is_none() && matches!(value, Value::Bool(_))
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
                source,
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
                source,
                &sheets,
                &book,
                (0, 0, 1),
                None,
                false,
                None,
                65536,
                false,
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
