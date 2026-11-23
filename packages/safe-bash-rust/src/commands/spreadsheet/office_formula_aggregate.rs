// Coercion and aggregate cases adapted from IronCalc statistical/
// count_and_average.rs, logical/and_or_xor_not.rs and math_and_trigonometry
// (f93662006b8fb1c401dc870bbda26c5d60ac6037).
// MIT license: LICENSE.IronCalc. Keep Calc's existing aggregate path unchanged.
use super::{
    Calculation, Coord, Expr, Format, FormatKind, Value, descriptive, lookup, mathematics,
    summation::Sum,
};
use std::collections::BTreeSet;

impl Calculation<'_> {
    // Unary mathematical arrays can be consumed as runs. Keep the same scalar
    // functions and row-major reduction order, including transformed blanks.
    fn aggregate_input(
        &mut self,
        arg: &Expr,
        aggregate: &str,
        pos: Coord,
        depth: usize,
    ) -> Option<Vec<(Value, bool, usize)>> {
        if self.dynamic.is_some()
            && self.array
            && matches!(aggregate, "MIN" | "MAX")
            && let Some((source, vertical, mask)) = super::filter::coordinate_product(arg)
        {
            return Some(vec![(
                self.coordinate_extrema(
                    arg,
                    source,
                    vertical,
                    mask,
                    aggregate == "MAX",
                    pos,
                    depth,
                )?,
                true,
                1,
            )]);
        }
        let mut names = Vec::new();
        let mut source = arg;
        if self.dynamic.is_some() && self.array {
            loop {
                self.tick(depth + names.len())?;
                match source {
                    Expr::Group(inner) => source = inner,
                    Expr::Call(name, args)
                        if args.len() == 1 && mathematics::arguments(name) == Some((1, 1)) =>
                    {
                        self.work = self.work.checked_sub(std::mem::size_of::<&str>())?;
                        names.push(name.as_str());
                        source = &args[0];
                    }
                    _ => break,
                }
            }
        }
        if names.is_empty() {
            return Some(vec![(self.eval(arg, pos, depth + 1, true)?, false, 1)]);
        }
        let value = self.eval(source, pos, depth + names.len() + 1, true)?;
        let (a, b) = match value {
            Value::Range(a, b) if a.0 == b.0 => (a, b),
            mut value => {
                for name in names.into_iter().rev() {
                    value = self.call(name, &[Expr::Value(value)], pos, depth + 1)?;
                }
                return Some(vec![(value, false, 1)]);
            }
        };
        let start = (a.0, a.1.min(b.1), a.2.min(b.2));
        let end = (a.0, a.1.max(b.1), a.2.max(b.2));
        let width = end.2 - start.2 + 1;
        let length = (end.1 - start.1 + 1).checked_mul(width)?;
        if length > 536_870_912 {
            return Some(vec![(Value::Error("Err:538"), true, 1)]);
        }
        self.read_spill_range(a, b)?;
        let mut cells = BTreeSet::new();
        for &coord in self
            .values
            .range(start..=end)
            .map(|(p, _)| p)
            .chain(self.expressions.range(start..=end).map(|(p, _)| p))
            .chain(self.visiting.range(start..=end))
        {
            self.work = self.work.checked_sub(1)?;
            if (start.2..=end.2).contains(&coord.2) {
                self.work = self.work.checked_sub(96)?;
                cells.insert(coord);
            }
        }
        let mut runs = Vec::new();
        let mut offset = 0;
        let mut blank: Option<Value> = None;
        for coord in cells.into_iter().map(Some).chain(std::iter::once(None)) {
            let index = coord.map_or(length, |c| (c.1 - start.1) * width + c.2 - start.2);
            if index > offset {
                let value = match &blank {
                    Some(value) => value.clone(),
                    None => {
                        let value = self.aggregate_math_value(&names, Value::Empty, depth)?;
                        blank = Some(value.clone());
                        value
                    }
                };
                self.work = self
                    .work
                    .checked_sub(std::mem::size_of::<(Value, bool, usize)>())?;
                runs.push((value, true, index - offset));
            }
            if let Some(coord) = coord {
                let mut value = self.cell(coord, depth + names.len() + 1)?;
                if matches!(value, Value::Blank)
                    || matches!(value, Value::Number(0.))
                        && matches!(
                            self.results.get(&coord).or_else(|| self.values.get(&coord)),
                            Some(Value::Blank | Value::Empty)
                        )
                {
                    value = Value::Empty;
                }
                let value = self.aggregate_math_value(&names, value, depth)?;
                self.work = self
                    .work
                    .checked_sub(std::mem::size_of::<(Value, bool, usize)>())?;
                runs.push((value, true, 1));
                offset = index + 1;
            }
        }
        runs.reverse();
        Some(runs)
    }

    fn aggregate_math_value(
        &mut self,
        names: &[&str],
        mut value: Value,
        depth: usize,
    ) -> Option<Value> {
        for (index, name) in names.iter().rev().enumerate() {
            self.tick(depth + index)?;
            self.charge_value(&value)?;
            value =
                mathematics::calculate(name, &[&value], self.book.date1904, self.dynamic.is_some());
        }
        Some(value)
    }

    pub(super) fn aggregate_excel(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let descriptive = descriptive::minimum(name).is_some();
        let multinomial = name == "MULTINOMIAL";
        let integer = matches!(name, "GCD" | "LCM");
        let logical = matches!(name, "AND" | "OR" | "XOR");
        let mut logical_result = name == "AND";
        let mut integer_result = if name == "LCM" { 1_u64 } else { 0 };
        let mut collection = false;
        if args.is_empty() || args.len() > 255 {
            return Some(Value::Error(
                if descriptive || multinomial || integer || logical {
                    "#ERROR!"
                } else {
                    "#VALUE!"
                },
            ));
        }
        let include_text = matches!(
            name,
            "AVERAGEA" | "MINA" | "MAXA" | "STDEVA" | "STDEVPA" | "VARA" | "VARPA"
        );
        let mut numbers = Vec::new();
        // Compact ranges can cover more than 2^32 observations across arguments,
        // even though each individual matrix fits the worksheet/pool limits.
        let mut count = 0u64;
        let mut sum = Sum::default();
        let mut product = 1.;
        let mut multinomial_total: f64 = 0.;
        let mut minimum = f64::INFINITY;
        let mut maximum = f64::NEG_INFINITY;
        let mut result_format = None;
        for arg in args {
            if integer && matches!(arg, Expr::Value(Value::Blank)) {
                return Some(Value::Error("#N/A"));
            }
            let mut pending = self.aggregate_input(arg, name, pos, depth)?;
            let mut argument_format = None;
            let mut format_position = None;
            while let Some((mut value, mut reference, mut repeat)) = pending.pop() {
                self.tick(depth)?;
                let mut position = None;
                match value {
                    Value::InvalidReference | Value::InvalidRange(..) => {
                        return Some(Value::Error("#REF!"));
                    }
                    Value::Single(coord) => {
                        value = self.cell(coord, depth + 1)?;
                        // A formula returning an empty reference evaluates to
                        // numeric zero even on its first visit. Blanks inside
                        // a range also count as zero; direct blank references skip.
                        if integer
                            && (reference || self.formula_sources.contains_key(&coord))
                            && matches!(value, Value::Blank | Value::Empty)
                        {
                            value = Value::Number(0.);
                        }
                        reference = true;
                        position = Some(coord);
                    }
                    Value::Range(a, b) => {
                        collection = true;
                        self.read_spill_range(a, b)?;
                        let start = (a.0.min(b.0), a.1.min(b.1), a.2.min(b.2));
                        let end = (a.0.max(b.0), a.1.max(b.1), a.2.max(b.2));
                        let mut cells = BTreeSet::new();
                        for &coord in self
                            .values
                            .range(start..=end)
                            .map(|(c, _)| c)
                            .chain(self.expressions.range(start..=end).map(|(c, _)| c))
                        {
                            self.work = self.work.checked_sub(1)?;
                            if (start.1..=end.1).contains(&coord.1)
                                && (start.2..=end.2).contains(&coord.2)
                            {
                                self.work = self.work.checked_sub(96)?;
                                cells.insert(coord);
                            }
                        }
                        if name == "LCM" {
                            // Missing cells in a range contribute zero. Clip
                            // whole axes to stored data, counting gaps without
                            // allocating a value for each blank worksheet cell.
                            let (mut last_row, mut last_col) = (end.1, end.2);
                            if last_row == 1_048_575 || last_col == 16_383 {
                                let mut used = (0, 0);
                                for coord in self
                                    .values
                                    .range((start.0, 0, 0)..=(end.0, usize::MAX, usize::MAX))
                                    .map(|(c, _)| c)
                                    .chain(
                                        self.formula_sources
                                            .range(
                                                (start.0, 0, 0)..=(end.0, usize::MAX, usize::MAX),
                                            )
                                            .map(|(coord, _)| coord),
                                    )
                                {
                                    self.work = self.work.checked_sub(1)?;
                                    used.0 = used.0.max(coord.1);
                                    used.1 = used.1.max(coord.2);
                                }
                                last_row = last_row.min(used.0);
                                last_col = last_col.min(used.1);
                            }
                            let rows = (last_row + 1).saturating_sub(start.1);
                            let cols = (last_col + 1).saturating_sub(start.2);
                            let size = rows.checked_mul(cols)?.checked_mul(end.0 - start.0 + 1)?;
                            if size > cells.len() {
                                integer_result = 0;
                                count += 1;
                            }
                        }
                        pending
                            .extend(cells.into_iter().rev().map(|c| (Value::Single(c), true, 1)));
                        continue;
                    }
                    Value::Matrix(rows) => {
                        collection = true;
                        self.work = self.work.checked_sub(
                            rows.iter()
                                .map(Vec::len)
                                .sum::<usize>()
                                .checked_mul(std::mem::size_of::<(Value, bool, usize)>())?,
                        )?;
                        pending.extend(
                            rows.into_iter()
                                .rev()
                                .flat_map(|row| row.into_iter().rev())
                                .map(|value| (value, true, 1)),
                        );
                        continue;
                    }
                    Value::Set(values) => {
                        self.work = self.work.checked_sub(
                            values
                                .len()
                                .checked_mul(std::mem::size_of::<(Value, bool, usize)>())?,
                        )?;
                        pending.extend(values.into_iter().rev().map(|value| (value, reference, 1)));
                        continue;
                    }
                    _ => {}
                }
                if multinomial && repeat > 1 {
                    self.charge_value(&value)?;
                    pending.push((value.clone(), reference, repeat - 1));
                    repeat = 1;
                }
                let number = match value {
                    Value::Number(n) => n,
                    Value::Bool(_) if multinomial || integer => {
                        return Some(Value::Error("#VALUE!"));
                    }
                    Value::Bool(b) if !reference || include_text || logical => f64::from(b),
                    Value::Text(ref text) | Value::UninternedText(ref text) if logical => {
                        // Logical text is recognized only as a scalar argument.
                        // Strings in ranges/arrays and other text are ignored.
                        if reference {
                            continue;
                        }
                        if text.eq_ignore_ascii_case("true") {
                            1.
                        } else if text.eq_ignore_ascii_case("false") {
                            0.
                        } else {
                            continue;
                        }
                    }
                    Value::Text(_) | Value::UninternedText(_) if reference && include_text => 0.,
                    Value::Text(ref text) | Value::UninternedText(ref text)
                        if !reference || multinomial || integer =>
                    {
                        if (multinomial || integer)
                            && (text.trim().eq_ignore_ascii_case("true")
                                || text.trim().eq_ignore_ascii_case("false"))
                        {
                            return Some(Value::Error("#VALUE!"));
                        }
                        let parsed = if integer {
                            lookup::number::parse_excel(text, self.book.date1904)
                        } else {
                            lookup::number::parse(text, self.book.date1904)
                        };
                        let Some(n) = parsed else {
                            return Some(Value::Error("#VALUE!"));
                        };
                        n
                    }
                    Value::Blank | Value::Empty if integer => continue,
                    Value::Blank | Value::Empty if !reference => 0.,
                    Value::Error(e) | Value::LiteralError(e) => return Some(Value::Error(e)),
                    _ => continue,
                };
                if logical {
                    // Fold in place; deciding values still evaluate the later
                    // inputs so errors are preserved. No numeric result buffer.
                    logical_result = match name {
                        "AND" => logical_result && number != 0.,
                        "OR" => logical_result || number != 0.,
                        _ => logical_result ^ (number != 0. && repeat % 2 != 0),
                    };
                    count += repeat as u64;
                    continue;
                }
                if integer {
                    // Euclidean reduction adapted from IronCalc gcd_lcm.rs.
                    // Divide before multiplying, then check the exact-integer
                    // limit. Zero/one results still validate later arguments.
                    if !number.is_finite() || !(0. ..9007199254740992.).contains(&number) {
                        return Some(Value::Error("#NUM!"));
                    }
                    let n = number.trunc() as u64;
                    let (mut a, mut b) = (integer_result, n);
                    while b != 0 {
                        self.work = self.work.checked_sub(1)?;
                        (a, b) = (b, a % b);
                    }
                    integer_result = if name == "GCD" {
                        a
                    } else if n == 0 || integer_result == 0 {
                        0
                    } else {
                        let Some(product) = (integer_result / a)
                            .checked_mul(n)
                            .filter(|v| *v < (1_u64 << 53))
                        else {
                            return Some(Value::Error("#NUM!"));
                        };
                        product
                    };
                    count += repeat as u64;
                    continue;
                }
                if multinomial {
                    if number < 0. {
                        return Some(Value::Error("#NUM!"));
                    }
                    // MULTINOMIAL contracts: IronCalc mathematical/multinomial.rs
                    // (MIT) and Univer math/multinomial (Apache-2.0). Cancel each
                    // factorial ratio as a binomial product. No factorial storage
                    // or overflowing intermediate sum, even for (1E308, 1).
                    let number = number.trunc();
                    let small = multinomial_total.min(number);
                    let large = multinomial_total.max(number);
                    let mut divisor = 1.;
                    while divisor <= small {
                        self.work = self.work.checked_sub(1)?;
                        product *= 1. + large / divisor;
                        if !product.is_finite() {
                            return Some(Value::Error("#NUM!"));
                        }
                        divisor += 1.;
                    }
                    multinomial_total += number;
                    continue;
                }
                if descriptive {
                    self.work = self.work.checked_sub(16usize.checked_mul(repeat)?)?;
                    numbers.extend(std::iter::repeat_n(number, repeat));
                    continue;
                }
                let order = |c: Coord| (c.0, c.2, c.1);
                if argument_format.is_none()
                    || name == "SUM"
                        && position
                            .zip(format_position)
                            .is_some_and(|(new, old)| order(new) > order(old))
                {
                    argument_format = Some(position.and_then(|c| self.formats.get(&c).copied()));
                    format_position = position;
                }
                count += repeat as u64;
                if matches!(name, "SUM" | "SUMSQ" | "AVERAGE" | "AVERAGEA") {
                    let term = if name == "SUMSQ" {
                        number * number
                    } else {
                        number
                    };
                    if term != 0. {
                        self.work = self.work.checked_sub(repeat - 1)?;
                        for _ in 0..repeat {
                            sum.add(term);
                        }
                    }
                }
                if name == "PRODUCT" {
                    if number == 0. || number == 1. {
                        product *= number;
                    } else {
                        self.work = self.work.checked_sub(repeat - 1)?;
                        for _ in 0..repeat {
                            product *= number;
                        }
                    }
                }
                minimum = minimum.min(number);
                maximum = maximum.max(number);
            }
            if result_format.is_none() {
                result_format = argument_format;
            }
        }
        if logical {
            self.result_format = None;
            return Some(if count == 0 {
                Value::Error("#VALUE!")
            } else {
                Value::Bool(logical_result)
            });
        }
        if integer {
            self.result_format = None;
            return Some(if count == 0 {
                if collection {
                    Value::Number(0.)
                } else {
                    Value::Error("#VALUE!")
                }
            } else {
                Value::Number(integer_result as f64)
            });
        }
        if multinomial {
            self.result_format = None;
            return Some(Value::Number(product.round()));
        }
        if descriptive {
            self.result_format = None;
            return descriptive::calculate(name, &mut numbers, &mut self.work);
        }
        self.result_format = result_format
            .flatten()
            .and_then(Format::aggregate)
            .filter(|f| f.kind != FormatKind::Logical);
        Some(match name {
            "AVERAGE" | "AVERAGEA" if count == 0 => Value::Error("#DIV/0!"),
            "AVERAGE" | "AVERAGEA" => Value::number(sum.total() / count as f64),
            "MIN" | "MINA" => Value::number(if count == 0 { 0. } else { minimum }),
            "MAX" | "MAXA" => Value::number(if count == 0 { 0. } else { maximum }),
            "PRODUCT" => Value::number(if count == 0 { 0. } else { product }),
            _ => Value::number(sum.total()),
        })
    }
}
