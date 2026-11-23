use super::{
    super::{
        Calculation, Coord, Dialect, Expr, FormatKind, Value, lookup::number, production,
        summation::Sum,
    },
    goal_seek, growth, power,
};

impl Calculation<'_> {
    pub(in super::super) fn cashflow(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        if (self.csv || self.dialect == Dialect::Gnumeric) && name != "FVSCHEDULE" {
            return self.public_cashflow(name, args, pos, depth);
        }
        let schedule = name == "FVSCHEDULE";
        let public_schedule = (self.csv || self.dialect == Dialect::Gnumeric) && schedule;
        let principal_first = name == "NPV" || schedule;
        let (minimum, maximum) = match name {
            "NPV" => (2, usize::MAX),
            "IRR" => (1, 2),
            "FVSCHEDULE" => (2, 2),
            _ => (3, 3),
        };
        if public_schedule && args.len() != 2 {
            return Some(Value::Error("#N/A"));
        }
        let format = if schedule {
            FormatKind::Number
        } else if name == "NPV" {
            FormatKind::Currency
        } else {
            FormatKind::Percent
        };
        let mut values = Vec::new();
        for (index, arg) in args.iter().enumerate() {
            let array = self.array;
            if public_schedule && index == 1 {
                self.array = true;
            }
            let value = self.eval(arg, pos, depth + 1, true);
            if public_schedule {
                self.array = array;
            }
            let mut value = value?;
            if public_schedule {
                if let Value::Error(error) | Value::LiteralError(error) = value {
                    return Some(Value::Error(error));
                }
                if index == 0
                    && !(array
                        && matches!(
                            value,
                            Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
                        ))
                {
                    value = self.scalar(value, pos, depth + 1)?;
                    value = match production::operand(&value, self.book.date1904) {
                        Ok(number) => Value::Number(number),
                        Err(error) => return Some(Value::Error(error)),
                    };
                }
            }
            if matches!(value, Value::Error(_)) {
                return Some(value);
            }
            self.charge_value(&value)?;
            values.push(value);
        }
        if !(minimum..=maximum).contains(&args.len()) {
            self.result_format = if self.array { None } else { format.standard() };
            return Some(Value::Error(if args.len() < minimum && !schedule {
                "Err:511"
            } else {
                "Err:504"
            }));
        }
        let mut rates = Vec::new();
        let mut shape = None;
        let mut cash = Vec::new();
        let mut cash_error = None;
        for (index, mut value) in values.into_iter().enumerate() {
            if (principal_first && index == 0) || (!principal_first && index != 0) {
                if !self.array {
                    value = self.implicit_invalid_range(&args[index], value, pos)?;
                    if !matches!(value, Value::Matrix(_)) {
                        value = self.scalar(value, pos, depth + 1)?;
                    }
                }
                let matrix = matches!(
                    value,
                    Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
                );
                let rows = self.matrix(value, depth + 1)?;
                if matrix {
                    let dimensions = (rows.len(), rows.first()?.len());
                    shape = Some(shape.map_or(dimensions, |(h, w): (usize, usize)| {
                        (h.max(dimensions.0), w.max(dimensions.1))
                    }));
                }
                rates.push(rows);
                continue;
            }
            let mut pending = vec![value];
            while let Some(value) = pending.pop() {
                self.tick(depth)?;
                if cash_error.is_some() {
                    continue;
                }
                if let Value::Set(parts) = value {
                    if name == "NPV" || public_schedule {
                        pending.extend(parts.into_iter().rev());
                    } else {
                        cash_error = Some("Err:504");
                    }
                    continue;
                }
                if public_schedule {
                    for row in self.matrix(value, depth + 1)? {
                        for cell in row {
                            self.tick(depth)?;
                            match cell {
                                Value::Number(number) => {
                                    self.work = self.work.checked_sub(std::mem::size_of::<f64>())?;
                                    cash.push(number);
                                }
                                Value::Blank
                                | Value::Empty
                                | Value::FunctionEmpty
                                | Value::MatrixEmpty => {}
                                Value::Error(error) | Value::LiteralError(error) => {
                                    cash_error.get_or_insert(error);
                                }
                                _ => {
                                    cash_error.get_or_insert("#VALUE!");
                                }
                            }
                        }
                    }
                    continue;
                }
                if schedule
                    && !matches!(
                        value,
                        Value::Range(..) | Value::LabelRange(..) | Value::Matrix(_)
                    )
                {
                    let value = self.scalar(value, pos, depth + 1)?;
                    match &value {
                        Value::Error(error) | Value::LiteralError(error) => {
                            cash_error = Some(*error);
                        }
                        _ => {
                            let number = match &value {
                                Value::Text(s) | Value::UninternedText(s) => {
                                    number::parse(s, self.book.date1904)
                                }
                                _ => value.numeric(),
                            };
                            if let Some(number) = number {
                                self.work = self.work.checked_sub(std::mem::size_of::<f64>())?;
                                cash.push(number);
                            } else {
                                cash_error = Some("#VALUE!");
                            }
                        }
                    }
                    continue;
                }
                let reference = matches!(
                    value,
                    Value::Range(..) | Value::LabelRange(..) | Value::Single(_)
                );
                let matrix = matches!(value, Value::Matrix(_));
                if name != "NPV"
                    && !matches!(
                        value,
                        Value::Range(..) | Value::LabelRange(..) | Value::Matrix(_)
                    )
                {
                    cash_error = Some("Err:504");
                    continue;
                }
                if matches!(value, Value::InvalidReference | Value::InvalidRange(..)) {
                    cash_error = Some("#REF!");
                    continue;
                }
                let value = if let Value::Single(coord) = value {
                    Value::Range(coord, coord)
                } else {
                    value
                };
                let rows = self.matrix(value, depth + 1)?;
                let height = rows.len();
                let width = rows.first()?.len();
                let mut previous = 0.;
                for offset in 0..height.checked_mul(width)? {
                    self.work = self.work.checked_sub(std::mem::size_of::<f64>())?;
                    let value = if schedule || name == "NPV" && reference {
                        &rows[offset / width][offset % width]
                    } else {
                        &rows[offset % height][offset / height]
                    };
                    match value {
                        Value::Number(n) => {
                            cash.push(*n);
                            previous = *n;
                        }
                        Value::Bool(b) => {
                            previous = f64::from(*b);
                            cash.push(previous);
                        }
                        Value::Blank if !reference && !matrix => cash.push(0.),
                        Value::Error(e) | Value::LiteralError(e) if reference || matrix => {
                            if name == "MIRR" && reference {
                                // Calc's range iterator leaves the preceding numeric value in place
                                // when MIRR consumes an error cell and continues to the next cell.
                                cash.push(previous);
                            } else if schedule && reference {
                                cash_error.get_or_insert("Err:504");
                            } else {
                                cash_error.get_or_insert(*e);
                            }
                        }
                        _ if reference => {}
                        _ if matrix && name != "NPV" => {}
                        _ => {
                            cash_error.get_or_insert(if matrix { "Err:502" } else { "Err:504" });
                        }
                    }
                }
            }
        }
        if name == "IRR" && rates.is_empty() {
            rates.push(vec![vec![Value::Number(0.1)]]);
        }
        self.result_format = if !self.array && shape.is_none() {
            format.standard()
        } else {
            None
        };
        let (height, width) = shape.unwrap_or((1, 1));
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut result = Vec::new();
        for row in 0..height {
            let mut output = Vec::new();
            for column in 0..width {
                let mut numbers = [0.; 2];
                let mut error = None;
                for (index, rows) in rates.iter().enumerate().rev() {
                    let item = rows
                        .get(if rows.len() == 1 { 0 } else { row })
                        .and_then(|r| r.get(if r.len() == 1 { 0 } else { column }))
                        .unwrap_or(&Value::Error("#N/A"));
                    match item {
                        Value::Error(e) | Value::LiteralError(e) => {
                            error.get_or_insert(*e);
                        }
                        _ => {
                            let number = match item {
                                Value::Text(s) | Value::UninternedText(s) => {
                                    number::parse(s, self.book.date1904)
                                }
                                _ => item.numeric(),
                            };
                            if let Some(n) = number {
                                numbers[index] = n;
                            } else {
                                error.get_or_insert("#VALUE!");
                            }
                        }
                    }
                }
                let error = if schedule && !public_schedule {
                    cash_error.or(error)
                } else {
                    error.or(cash_error)
                };
                output.push(if let Some(error) = error {
                    Value::Error(error)
                } else if schedule
                    && !public_schedule
                    && args
                        .iter()
                        .any(|arg| matches!(arg, Expr::Value(Value::Blank)))
                {
                    Value::Error("Err:502")
                } else {
                    match calculate(name, &cash, numbers, &mut self.work)? {
                        Value::Error("Err:502") if public_schedule => Value::Error("#NUM!"),
                        value => value,
                    }
                });
            }
            result.push(output);
        }
        Some(if shape.is_some() {
            Value::Matrix(result)
        } else {
            result.pop()?.pop()?
        })
    }

    fn public_cashflow(
        &mut self,
        name: &str,
        args: &[Expr],
        pos: Coord,
        depth: usize,
    ) -> Option<Value> {
        self.result_format = None;
        if name == "NPV" {
            let mut cash = Vec::new();
            for arg in args {
                let value = self.eval(arg, pos, depth + 1, true)?;
                match self.public_cashflow_values(value, true, depth)? {
                    Ok(values) => cash.extend(values),
                    Err(error) => return Some(Value::Error(error)),
                }
            }
            self.result_format = None;
            let Some(rate) = cash.first() else {
                return Some(Value::Error("#DIV/0!"));
            };
            if *rate == -1. {
                return Some(Value::Error("#DIV/0!"));
            }
            let factor = 1. / (1. + rate);
            let mut discount = 1.;
            let mut total = 0.;
            for value in &cash[1..] {
                self.tick(depth)?;
                discount *= factor;
                total += value * discount;
            }
            return Some(if total.is_finite() {
                Value::Number(total)
            } else {
                Value::Error("#NUM!")
            });
        }
        let irr = name == "IRR";
        if (irr && !(1..=2).contains(&args.len())) || (!irr && args.len() != 3) {
            return Some(Value::Error("#N/A"));
        }
        let array = self.array;
        let mut sequence = Value::Blank;
        let mut rates = Vec::new();
        let mut shape = None;
        for (index, arg) in args.iter().enumerate() {
            self.array = array || index == 0;
            let value = self.eval(arg, pos, depth + 1, index == 0);
            self.array = array;
            let value = value?;
            if let Value::Error(error) | Value::LiteralError(error) = value {
                return Some(Value::Error(error));
            }
            if index == 0 {
                sequence = value;
            } else if array
                && matches!(
                    value,
                    Value::Matrix(_) | Value::Range(..) | Value::LabelRange(..)
                )
            {
                let rows = self.matrix(value, depth + 1)?;
                let dimensions = (rows.len(), rows.first()?.len());
                if shape.is_some_and(|shape| shape != dimensions) {
                    return Some(Value::Error("#VALUE!"));
                }
                shape = Some(dimensions);
                rates.push(rows);
            } else {
                let value = self.scalar(value, pos, depth + 1)?;
                let number = if irr
                    && matches!(
                        value,
                        Value::Blank | Value::Empty | Value::FunctionEmpty | Value::MatrixEmpty
                    ) {
                    0.1
                } else {
                    match production::operand(&value, self.book.date1904) {
                        Ok(number) => number,
                        Err(error) => return Some(Value::Error(error)),
                    }
                };
                rates.push(vec![vec![Value::Number(number)]]);
            }
        }
        if rates.is_empty() {
            rates.push(vec![vec![Value::Number(0.1)]]);
        }
        self.result_format = None;
        let cash = self.public_cashflow_values(sequence, false, depth)?;
        let (height, width) = shape.unwrap_or((1, 1));
        self.work = self.work.checked_sub(
            height
                .checked_mul(width)?
                .checked_mul(std::mem::size_of::<Value>())?,
        )?;
        let mut result = Vec::new();
        for row in 0..height {
            let mut output = Vec::new();
            for column in 0..width {
                self.tick(depth)?;
                let mut numbers = [0.; 2];
                let mut error = None;
                for (index, rate) in rates.iter().enumerate() {
                    let value = &rate[if rate.len() == 1 { 0 } else { row }]
                        [if rate[0].len() == 1 { 0 } else { column }];
                    match production::operand(value, self.book.date1904) {
                        Ok(number) => numbers[index] = number,
                        Err(value) => {
                            error = Some(value);
                            break;
                        }
                    }
                }
                output.push(if let Some(error) = error {
                    Value::Error(error)
                } else {
                    match &cash {
                        Err(error) => Value::Error(error),
                        Ok(cash) => public_calculate(irr, cash, numbers, &mut self.work)?,
                    }
                });
            }
            result.push(output);
        }
        Some(if shape.is_some() {
            Value::Matrix(result)
        } else {
            result.pop()?.pop()?
        })
    }

    fn public_cashflow_values(
        &mut self,
        value: Value,
        ignore_booleans: bool,
        depth: usize,
    ) -> Option<Result<Vec<f64>, &'static str>> {
        let mut values = Vec::new();
        self.collect_reference(value, depth, &mut values)?;
        let mut cash = Vec::new();
        for value in values {
            self.tick(depth)?;
            match value {
                Value::Number(number) => cash.push(number),
                Value::Error(error) | Value::LiteralError(error) => return Some(Err(error)),
                Value::Bool(_) if !ignore_booleans => return Some(Err("#VALUE!")),
                _ => {}
            }
        }
        Some(Ok(cash))
    }
}

fn public_calculate(irr: bool, cash: &[f64], rates: [f64; 2], work: &mut usize) -> Option<Value> {
    let result = if irr {
        let limit = 1e10_f64.min(power::pow(f64::MAX / 1e10, 1. / cash.len() as f64) - 1.);
        let value = |rate, work: &mut usize| {
            *work = work.checked_sub(cash.len().checked_mul(2)?)?;
            let mut total = 0.;
            let mut factor = 1.;
            for amount in cash {
                total = amount.mul_add(factor, total);
                factor *= 1. / (1. + rate);
            }
            Some(if total.is_finite() { total } else { f64::NAN })
        };
        let derivative = |rate| {
            let mut total = 0.;
            let mut factor = 1.;
            for (index, amount) in cash.iter().enumerate().skip(1) {
                total = (amount * -(index as f64)).mul_add(factor, total);
                factor *= 1. / (1. + rate);
            }
            total
        };
        let mut solver = goal_seek::Solver::new(value, work, -1., limit, Some(&derivative));
        if !solver.newton(rates[0])? {
            let mut scale = 2.;
            for _ in 0..10 {
                if solver.bracketed() {
                    break;
                }
                solver.point(rates[0] * scale)?;
                solver.point(rates[0] / scale)?;
                scale *= 2.;
            }
            if !solver.bracketed() {
                solver.newton(-0.99)?;
            }
            if !solver.bracketed() {
                solver.point(1. - f64::EPSILON)?;
            }
            solver.bisect()?;
        }
        solver.root
    } else {
        *work = work.checked_sub(cash.len())?;
        let mut positive = 0.;
        let mut negative = 0.;
        for (index, amount) in cash.iter().enumerate() {
            if *amount >= 0. {
                positive += amount / growth(rates[1], index as f64);
            } else {
                negative += amount / growth(rates[0], index as f64);
            }
        }
        if positive == 0. || negative == 0. || rates[1] <= -1. {
            return Some(Value::Error("#DIV/0!"));
        }
        power::pow(
            -positive * growth(rates[1], cash.len() as f64) / (negative * (1. + rates[1])),
            1. / (cash.len() as f64 - 1.),
        ) - 1.
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}

fn calculate(name: &str, cash: &[f64], rates: [f64; 2], work: &mut usize) -> Option<Value> {
    let result = match name {
        "FVSCHEDULE" => {
            *work = work.checked_sub(cash.len())?;
            let mut principal = rates[0];
            for rate in cash {
                principal *= 1. + rate;
            }
            if !principal.is_finite() {
                return Some(Value::Error("Err:502"));
            }
            principal
        }
        "NPV" => {
            *work = work.checked_sub(cash.len())?;
            let mut sum = Sum::default();
            for (index, value) in cash.iter().enumerate() {
                sum.add(value / power::pow(1. + rates[0], (index + 1) as f64));
            }
            sum.total()
        }
        "IRR" => {
            let mut rate = if rates[0] == -1. { 0.1 } else { rates[0] };
            let mut difference = 1.;
            for _ in 0..20 {
                *work = work.checked_sub(cash.len())?;
                let mut numerator = Sum::default();
                let mut denominator = Sum::default();
                for (index, value) in cash.iter().enumerate() {
                    let period = index as f64;
                    numerator.add(value / power::pow(1. + rate, period));
                    denominator.add(-period * value / power::pow(1. + rate, period + 1.));
                }
                let next = rate - numerator.total() / denominator.total();
                difference = (next - rate).abs();
                rate = next;
                if difference <= 1e-7 || difference.is_nan() {
                    break;
                }
            }
            if rates[0] == 0. && rate.abs() < 1e-7 {
                rate = 0.;
            }
            if difference >= 1e-7 || difference.is_nan() {
                return Some(Value::Error("Err:523"));
            }
            rate
        }
        _ => {
            *work = work.checked_sub(cash.len())?;
            let mut positive = Sum::default();
            let mut negative = Sum::default();
            let mut has_positive = false;
            let mut has_negative = false;
            let mut investment = 1.;
            let mut reinvestment = 1.;
            for value in cash {
                if *value > 0. {
                    has_positive = true;
                    positive.add(value * reinvestment);
                } else if *value < 0. {
                    has_negative = true;
                    negative.add(value * investment);
                }
                investment /= 1. + rates[0];
                reinvestment /= 1. + rates[1];
            }
            if !has_positive || !has_negative {
                return Some(Value::Error("Err:502"));
            }
            let periods = (cash.len() - 1) as f64;
            let result = -positive.total() / negative.total() * power::pow(1. + rates[1], periods);
            power::pow(result, 1. / periods) - 1.
        }
    };
    Some(if result.is_finite() {
        Value::Number(result)
    } else {
        Value::Error("#NUM!")
    })
}
