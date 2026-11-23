use super::{
    super::{
        Calculation, Coord, Dialect, Expr, Value, decimal, lookup::number, production, rounding,
    },
    goal_seek, growth, power,
};

impl Calculation<'_> {
    pub(in super::super) fn dated_cashflow(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        let irr = name == "XIRR";
        if self.csv || self.dialect == Dialect::Gnumeric {
            return self.csv_dated_cashflow(irr, args, pos, depth);
        }
        let mut values = Vec::new();
        for arg in args {
            let value = self.eval(arg, pos, depth + 1, true)?;
            if matches!(value, Value::Error(_)) {
                return Some(value);
            }
            self.charge_value(&value)?;
            values.push(value);
        }
        self.result_format = None;
        if args.len() > 3 || args.len() < if irr { 2 } else { 3 } {
            return Some(Value::Error("Err:504"));
        }
        let mut guess = Value::Number(0.1);
        if irr && values.len() == 3 {
            guess = self.addin_value(values.pop()?, pos, depth)?;
            if let Value::Error(e) | Value::LiteralError(e) = guess {
                return Some(Value::Error(e));
            }
        }

        // Add-in typed parameters convert from right to left. XIRR parses its
        // untyped guess only after both sequences have converted successfully.
        let dates = match self.dated_sequence(values.pop()?, true, pos, depth)? {
            Ok(dates) => dates,
            Err(e) => return Some(Value::Error(e)),
        };
        let cash = match self.dated_sequence(values.pop()?, false, pos, depth)? {
            Ok(cash) => cash,
            Err(e) => return Some(Value::Error(e)),
        };
        let mut rates = vec![vec![guess]];
        let mut matrix = false;
        if !irr {
            let mut rate = values.pop()?;
            if matches!(rate, Value::Set(_)) {
                return Some(Value::Error(if self.array { "#REF!" } else { "Err:504" }));
            }
            if !self.array {
                rate = self.implicit_invalid_range(&args[0], rate, pos)?;
                if !matches!(rate, Value::Matrix(_)) {
                    rate = self.scalar(rate, pos, depth + 1)?;
                }
            }
            matrix = matches!(
                rate,
                Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
            );
            rates = self.matrix(rate, depth + 1)?;
        }
        self.result_format = None;
        let omitted = args
            .iter()
            .take(if irr { 2 } else { 3 })
            .any(|arg| matches!(arg, Expr::Value(Value::Blank)));
        for row in &mut rates {
            for rate in row {
                let numeric = match rate {
                    Value::Text(s) | Value::UninternedText(s) if irr && s.is_empty() => Some(0.1),
                    Value::Text(s) | Value::UninternedText(s) => {
                        number::parse(s, self.book.date1904)
                    }
                    Value::Blank if irr => Some(0.1),
                    _ => rate.numeric(),
                };
                *rate = match rate {
                    Value::Error(e) | Value::LiteralError(e) => Value::Error(e),
                    _ if numeric.is_none() => Value::Error(if irr { "Err:502" } else { "#VALUE!" }),
                    _ if omitted || cash.len() < 2 || cash.len() != dates.len() => {
                        Value::Error("Err:502")
                    }
                    _ => calculate(irr, &cash, &dates, numeric?, &mut self.work)?,
                };
            }
        }
        Some(if matrix {
            Value::Matrix(rates)
        } else {
            rates.pop()?.pop()?
        })
    }

    fn csv_dated_cashflow(
        &mut self,
        irr: bool,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.result_format = None;
        if args.len() > 3 || args.len() < if irr { 2 } else { 3 } {
            return Some(Value::Error("#N/A"));
        }
        let mut sequences = Vec::new();
        let mut rates = vec![vec![Value::Number(0.1)]];
        let mut matrix = false;
        for (index, arg) in args.iter().enumerate() {
            let sequence = if irr { index < 2 } else { index > 0 };
            let array = self.array;
            self.array |= sequence;
            let value = self.eval(arg, pos, depth + 1, sequence);
            self.array = array;
            let value = value?;
            if let Value::Error(e) | Value::LiteralError(e) = value {
                return Some(Value::Error(e));
            }
            if sequence {
                sequences.push(value);
            } else if array
                && matches!(
                    value,
                    Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
                )
            {
                matrix = true;
                rates = self.matrix(value, depth + 1)?;
            } else {
                let value = self.scalar(value, pos, depth + 1)?;
                let rate = if irr
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    ) {
                    0.1
                } else {
                    match production::operand(&value, self.book.date1904) {
                        Ok(rate) => rate,
                        Err(e) => return Some(Value::Error(e)),
                    }
                };
                rates = vec![vec![Value::Number(rate)]];
            }
        }
        self.result_format = None;
        let mut values = Vec::new();
        let mut dates = Vec::new();
        let mut sequences = sequences.into_iter();
        self.collect_reference(sequences.next()?, depth, &mut values)?;
        self.collect_reference(sequences.next()?, depth, &mut dates)?;
        let mut cash = Vec::new();
        let mut days = Vec::new();
        let mut error = None;
        if values.len() != dates.len() {
            error = Some(if irr { "#VALUE!" } else { "#NUM!" });
        } else {
            for (value, date) in values.into_iter().zip(dates) {
                self.tick(depth)?;
                if let Value::Error(e) | Value::LiteralError(e) = value {
                    error = Some(e);
                    break;
                }
                if let Value::Error(e) | Value::LiteralError(e) = date {
                    error = Some(e);
                    break;
                }
                if matches!(value, Value::Bool(_)) || matches!(date, Value::Bool(_)) {
                    error = Some("#VALUE!");
                    break;
                }
                if matches!(
                    value,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                ) || matches!(
                    date,
                    Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                ) {
                    continue;
                }
                let numeric = |value: &Value| match value {
                    Value::Text(s) | Value::UninternedText(s) => {
                        let s = s.trim();
                        let (s, scale) = s.strip_suffix('%').map_or((s, 1.), |s| (s.trim(), 0.01));
                        decimal(s).map(|n| n * scale).filter(|n| n.is_finite())
                    }
                    _ => value.numeric(),
                };
                let (Some(value), Some(date)) = (numeric(&value), numeric(&date)) else {
                    error = Some("#VALUE!");
                    break;
                };
                cash.push(value);
                days.push(date);
            }
            if cash.is_empty() {
                error.get_or_insert(if irr { "#VALUE!" } else { "#NUM!" });
            }
        }
        for row in &mut rates {
            for rate in row {
                *rate = match production::operand(rate, self.book.date1904) {
                    Err(e) => Value::Error(e),
                    Ok(_) if error.is_some() => Value::Error(error?),
                    Ok(rate) => csv_calculate(irr, &cash, &days, rate, &mut self.work)?,
                };
            }
        }
        Some(if matrix {
            Value::Matrix(rates)
        } else {
            rates.pop()?.pop()?
        })
    }

    fn dated_sequence(
        &mut self,
        value: Value,
        integer: bool,
        pos: Coord,
        depth: usize,
    ) -> Option<Result<Vec<f64>, &'static str>> {
        if matches!(value, Value::Set(_)) {
            return Some(Err("Err:504"));
        }
        let reference = matches!(value, Value::Range(..) | Value::LabelRange(..));
        let matrix = matches!(value, Value::Matrix(_));
        let value = if reference || matrix {
            value
        } else {
            self.scalar(value, pos, depth + 1)?
        };
        let rows = self.matrix(value, depth + 1)?;
        let mut numbers = Vec::new();
        for value in rows.into_iter().flatten() {
            self.work = self.work.checked_sub(std::mem::size_of::<f64>())?;
            let mut n = match value {
                Value::Error(e) | Value::LiteralError(e) => {
                    return Some(Err(if reference { "Err:504" } else { e }));
                }
                Value::Text(_) | Value::UninternedText(_) if reference || matrix => 0.,
                Value::Text(s) | Value::UninternedText(s) => {
                    match number::parse(&s, self.book.date1904) {
                        Some(n) => n,
                        None => return Some(Err("#VALUE!")),
                    }
                }
                _ => value.numeric().unwrap_or(0.),
            };
            if integer {
                n = rounding::approximate(n).trunc();
                if reference || matrix {
                    // Calc narrows native long array elements to signed 32-bit
                    // dates; values outside native long's range become zero.
                    n = if (i64::MIN as f64..-(i64::MIN as f64)).contains(&n) {
                        (n as i64 as i32) as f64
                    } else {
                        0.
                    };
                } else if n < i32::MIN as f64 || n > i32::MAX as f64 {
                    return Some(Err("Err:502"));
                }
            }
            numbers.push(n);
        }
        Some(Ok(numbers))
    }
}

fn csv_calculate(
    irr: bool,
    cash: &[f64],
    dates: &[f64],
    rate: f64,
    work: &mut usize,
) -> Option<Value> {
    let f = |rate, work: &mut usize| {
        let mut total = 0.;
        for (value, date) in cash.iter().zip(dates) {
            *work = work.checked_sub(1)?;
            let days = date - dates[0];
            if irr && days < 0. {
                return Some(f64::NAN);
            }
            total += value / growth(rate, days / 365.);
        }
        Some(total)
    };
    if !irr {
        return Some(Value::number(f(rate, work)?));
    }
    let mut solver = goal_seek::Solver::new(f, work, -1., 1000., None);
    if !solver.newton(rate)? {
        solver.point(-1.)?;
        let mut point = 1.;
        while point <= 1024. {
            solver.point(-1. + 10. / (point + 9.))?;
            solver.point(point)?;
            if solver.bisect()? {
                break;
            }
            point *= 2.;
        }
    }
    Some(if solver.root.is_finite() {
        Value::number(solver.root)
    } else {
        Value::Error("#VALUE!")
    })
}

fn calculate(
    irr: bool,
    cash: &[f64],
    dates: &[f64],
    mut rate: f64,
    work: &mut usize,
) -> Option<Value> {
    if !irr {
        *work = work.checked_sub(cash.len())?;
        let mut sum = 0.;
        rate += 1.;
        for (value, date) in cash.iter().zip(dates) {
            sum += value / power::pow(rate, (date - dates[0]) / 365.);
        }
        return Some(if sum.is_finite() {
            Value::Number(sum)
        } else {
            Value::Error("Err:502")
        });
    }
    if rate <= -1. {
        return Some(Value::Error("Err:502"));
    }
    for scan in 0..200 {
        if scan != 0 {
            rate = -0.99 + (scan - 1) as f64 * 0.01;
        }
        for _ in 0..50 {
            *work = work.checked_sub(cash.len().checked_mul(2)?)?;
            let base = rate + 1.;
            let mut residual = cash[0];
            let mut derivative = 0.;
            for (value, date) in cash.iter().zip(dates).skip(1) {
                let exponent = (date - dates[0]) / 365.;
                residual += value / power::pow(base, exponent);
                derivative -= exponent * value / power::pow(base, exponent + 1.);
            }
            let next = rate - residual / derivative;
            let delta = (next - rate).abs();
            rate = next;
            if !(delta > 1e-10 && residual.abs() > 1e-10) {
                if rate.is_finite() && residual.is_finite() {
                    return Some(Value::Number(rate));
                }
                break;
            }
        }
    }
    Some(Value::Error("Err:502"))
}
